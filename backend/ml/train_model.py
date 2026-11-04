
import os
import json
from pathlib import Path
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import mysql.connector

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from dotenv import load_dotenv

from sklearn.linear_model import Ridge
from sklearn.ensemble import (
    RandomForestRegressor,
    HistGradientBoostingRegressor
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import (
    TimeSeriesSplit,
    GridSearchCV
)
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    r2_score
)
from sklearn.inspection import permutation_importance

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(__file__).resolve().parent

load_dotenv(ROOT / ".env")

STATION_ID = 207
AWS_CODE = "152"
START_DATE = "2026-06-01 00:00:00"

# Use only 2026 data until the 2025/2026
# gauge datum difference is investigated.
FEATURES = [
    "current_level",
    "previous_change_1h",
    "change_3h",
    "rainfall_1h",
    "rainfall_3h",
    "rainfall_6h",
    "rainfall_previous_1h"
]


def database_connection():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv(
            "DB_NAME", "weather_flood_db"
        )
    )


def load_observations():
    conn = database_connection()

    try:
        cursor = conn.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT observed_at, water_level
            FROM water_readings
            WHERE station_id = %s
              AND observed_at >= %s
              AND water_level IS NOT NULL
            ORDER BY observed_at
            """,
            (STATION_ID, START_DATE)
        )

        river = pd.DataFrame(cursor.fetchall())

        cursor.execute(
            """
            SELECT observed_at, hourly_rainfall
            FROM aws_rainfall_readings
            WHERE aws_station_code = %s
              AND observed_at >= %s
            ORDER BY observed_at
            """,
            (AWS_CODE, START_DATE)
        )

        rain = pd.DataFrame(cursor.fetchall())

        cursor.close()
        return river, rain

    finally:
        conn.close()


def prepare_series(river, rain):
    if river.empty or rain.empty:
        raise ValueError(
            "Missing river or rainfall observations."
        )

    river["observed_at"] = pd.to_datetime(
        river["observed_at"]
    )

    rain["observed_at"] = pd.to_datetime(
        rain["observed_at"]
    )

    river["water_level"] = pd.to_numeric(
        river["water_level"],
        errors="coerce"
    )

    rain["hourly_rainfall"] = pd.to_numeric(
        rain["hourly_rainfall"],
        errors="coerce"
    )

    # Negative rainfall is invalid.
    # Do not delete high real rainfall values.
    rain.loc[
        rain["hourly_rainfall"] < 0,
        "hourly_rainfall"
    ] = np.nan

    river = (
        river.dropna(
            subset=["observed_at", "water_level"]
        )
        .drop_duplicates("observed_at")
        .set_index("observed_at")
        .sort_index()
    )

    rain = (
        rain.dropna(subset=["observed_at"])
        .drop_duplicates("observed_at")
        .set_index("observed_at")
        .sort_index()
    )

    start = max(
        river.index.min(),
        rain.index.min()
    ).floor("h")

    end = min(
        river.index.max(),
        rain.index.max()
    ).floor("h")

    if start >= end:
        raise ValueError(
            "No overlapping historical period."
        )

    hourly = pd.date_range(
        start=start,
        end=end,
        freq="h"
    )

    data = pd.DataFrame(index=hourly)

    data["level"] = river[
        "water_level"
    ].reindex(hourly)

    data["rain"] = rain[
        "hourly_rainfall"
    ].reindex(hourly)

    # Reindexing makes missing hours explicit.
    # No interpolation or fabricated zero rain.
    data["current_level"] = data["level"]

    data["previous_change_1h"] = (
        data["level"] -
        data["level"].shift(1)
    )

    data["change_3h"] = (
        data["level"] -
        data["level"].shift(3)
    )

    data["rainfall_1h"] = data["rain"]

    data["rainfall_3h"] = (
        data["rain"].rolling(
            window=3,
            min_periods=3
        ).sum()
    )

    data["rainfall_6h"] = (
        data["rain"].rolling(
            window=6,
            min_periods=6
        ).sum()
    )

    data["rainfall_previous_1h"] = (
        data["rain"].shift(1)
    )

    # Target: the next hour's change,
    # not the next absolute level.
    data["target_change"] = (
        data["level"].shift(-1) -
        data["level"]
    )

    complete = data.dropna(
        subset=FEATURES + ["target_change"]
    ).copy()

    print("Overlapping hourly timeline:", len(data))
    print("Complete training examples:", len(complete))
    print("Missing values are not filled with zero.")

    return complete, data


def metrics(y_true, y_pred):
    return {
        "MAE": round(float(
            mean_absolute_error(y_true, y_pred)
        ), 5),
        "RMSE": round(float(
            np.sqrt(mean_squared_error(
                y_true, y_pred
            ))
        ), 5),
        "R2": round(float(
            r2_score(y_true, y_pred)
        ), 5)
    }


def make_candidates():
    return {
        "Ridge": (
            make_pipeline(
                StandardScaler(),
                Ridge()
            ),
            {
                "ridge__alpha": [
                    0.1, 1.0, 10.0, 100.0
                ]
            }
        ),

        "RandomForest": (
            RandomForestRegressor(
                random_state=42,
                n_jobs=-1
            ),
            {
                "n_estimators": [100, 200],
                "max_depth": [3, 6],
                "min_samples_leaf": [3, 8]
            }
        ),

        "HistGradientBoosting": (
            HistGradientBoostingRegressor(
                random_state=42,
                early_stopping=False
            ),
            {
                "max_iter": [100, 200],
                "max_leaf_nodes": [5, 10],
                "learning_rate": [0.03, 0.1],
                "min_samples_leaf": [5, 15]
            }
        )
    }


def predict_next_hour(model, latest_row):
    """
    latest_row is one feature row containing
    only observations available at prediction
    time. No future rainfall is assumed.
    """
    values = pd.DataFrame(
        [{name: latest_row[name]
          for name in FEATURES}]
    )

    if values.isna().any().any():
        raise ValueError(
            "Missing current prediction features."
        )

    predicted_change = float(
        model.predict(values)[0]
    )

    current_level = float(
        latest_row["current_level"]
    )

    return {
        "predicted_change_m":
            round(predicted_change, 4),
        "predicted_level_m":
            round(current_level + predicted_change, 4),
        "horizon_hours": 1
    }


def plot_comparison(results):
    names = list(results.keys())
    errors = [results[n]["MAE"] for n in names]

    plt.figure(figsize=(9, 5))
    plt.bar(names, errors)
    plt.ylabel("MAE (meters)")
    plt.title("One-hour river prediction comparison")
    plt.xticks(rotation=15)
    plt.tight_layout()

    plt.savefig(
        MODEL_DIR / "model_comparison.png",
        dpi=160
    )
    plt.close()


def plot_feature_importance(model, x_test, y_test):
    importance = permutation_importance(
        model,
        x_test,
        y_test,
        scoring="neg_mean_absolute_error",
        n_repeats=10,
        random_state=42
    )

    order = np.argsort(
        importance.importances_mean
    )

    plt.figure(figsize=(9, 5))

    plt.barh(
        np.array(FEATURES)[order],
        importance.importances_mean[order]
    )

    plt.xlabel(
        "Increase in MAE when feature is shuffled"
    )
    plt.title(
        "Permutation feature importance (test period)"
    )
    plt.tight_layout()

    plt.savefig(
        MODEL_DIR / "feature_importance.png",
        dpi=160
    )
    plt.close()


def train():
    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    print("Loading KMA and WAMIS data...")

    river, rain = load_observations()

    print("River records:", len(river))
    print("Rainfall records:", len(rain))

    samples, full_series = prepare_series(
        river, rain
    )

    if len(samples) < 70:
        raise ValueError(
            "Not enough aligned data for reliable "
            "training and chronological validation."
        )

    split = int(0.8 * len(samples))

    training = samples.iloc[:split]
    testing = samples.iloc[split:]

    x_train = training[FEATURES]
    y_train = training["target_change"]

    x_test = testing[FEATURES]
    y_test = testing["target_change"]

    current_test_levels = testing[
        "current_level"
    ].to_numpy()

    actual_next_levels = (
        current_test_levels + y_test.to_numpy()
    )

    # Persistence predicts zero change.
    baseline_levels = current_test_levels.copy()

    results = {
        "Persistence": metrics(
            actual_next_levels,
            baseline_levels
        )
    }

    fitted = {}

    cv = TimeSeriesSplit(n_splits=3)

    for name, (model, grid) in (
        make_candidates().items()
    ):
        print("\nTraining", name)

        search = GridSearchCV(
            estimator=model,
            param_grid=grid,
            scoring="neg_mean_absolute_error",
            cv=cv,
            n_jobs=-1,
            refit=True
        )

        search.fit(x_train, y_train)

        predicted_change = search.predict(
            x_test
        )

        predicted_level = (
            current_test_levels + predicted_change
        )

        results[name] = metrics(
            actual_next_levels,
            predicted_level
        )

        fitted[name] = search.best_estimator_

        print("Best parameters:", search.best_params_)
        print("Test metrics:", results[name])

    best_ml_name = min(
        fitted,
        key=lambda name: results[name]["MAE"]
    )

    beats_baseline = (
        results[best_ml_name]["MAE"] <
        results["Persistence"]["MAE"]
    )

    # Prefer persistence unless ML beats it.
    selected_name = (
        best_ml_name if beats_baseline
        else "Persistence"
    )

    print("\nFINAL EVALUATION")

    for name, score in results.items():
        print(name, score)

    print("\nSelected approach:", selected_name)

    # The model artifact remains a candidate,
    # not automatically deployed in Express.
    best_model = fitted[best_ml_name]

    joblib.dump(
        {
            "model": best_model,
            "features": FEATURES,
            "station_id": STATION_ID,
            "aws_code": AWS_CODE,
            "model_name": best_ml_name,
            "trained_until": str(
                training.index.max()
            )
        },
        MODEL_DIR / "candidate_model.joblib"
    )

    plot_comparison(results)

    plot_feature_importance(
        best_model,
        x_test,
        y_test
    )

    # Only show a latest prediction when the
    # latest complete feature row coincides
    # with the latest river observation and
    # is reasonably fresh.
    latest_observed_time = full_series[
        "level"
    ].last_valid_index()

    latest_complete_time = None
    latest_prediction = None

    available = full_series.dropna(
        subset=FEATURES
    )

    if not available.empty:
        latest_complete_time = (
            available.index.max()
        )

        age_hours = (
            pd.Timestamp.now(
                tz="Asia/Seoul"
            ).tz_localize(None) -
            latest_complete_time
        ).total_seconds() / 3600

        if (
            latest_complete_time ==
                latest_observed_time
            and 0 <= age_hours <= 3
        ):
            latest_prediction = predict_next_hour(
                best_model,
                available.loc[
                    latest_complete_time
                ]
            )

    report = {
        "project":
            "Weather and Flood Risk Forecasting",
        "status":
            "EXPERIMENTAL_MODEL_EVALUATED",
        "created_at_utc":
            datetime.now(timezone.utc).isoformat(),
        "station_id": STATION_ID,
        "horizon_hours": 1,
        "features": FEATURES,
        "training_samples": len(training),
        "testing_samples": len(testing),
        "training_start": str(
            training.index.min()
        ),
        "training_end": str(
            training.index.max()
        ),
        "testing_start": str(
            testing.index.min()
        ),
        "testing_end": str(
            testing.index.max()
        ),
        "evaluation_method":
            "CHRONOLOGICAL_80_20_WITH_TRAINING_CV",
        "results": results,
        "best_ml_candidate": best_ml_name,
        "selected_approach": selected_name,
        "beats_baseline": beats_baseline,
        "latest_observed_time":
            str(latest_observed_time),
        "latest_complete_feature_time":
            str(latest_complete_time),
        "latest_ml_prediction":
            latest_prediction,
        "flood_classification_validated": False,
        "notes": [
            "Target is next-hour river-level change.",
            "Missing rainfall is not replaced with zero.",
            "2025 data is excluded pending datum verification.",
            "A single held-out period is not enough to demonstrate flood-event accuracy.",
            "Candidate ML predictions are not official flood warnings."
        ]
    }

    with open(
        MODEL_DIR / "evaluation.json",
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            report,
            file,
            indent=2
        )

    print("\nFiles saved in ml folder:")
    print("evaluation.json")
    print("candidate_model.joblib")
    print("model_comparison.png")
    print("feature_importance.png")

    print(
        "\nExisting Node.js backend remains unchanged."
    )


if __name__ == "__main__":
    train()
