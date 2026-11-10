# Rivora Hydrological Machine Learning Technical Audit

**Project:** Rivora – Weather and Flood Risk Forecasting  
**Location:** `D:\Capstone\WeatherForecasting`  
**Evaluation Date:** 2026-11-08  
**Audit Scope:** Core ML pipelines, physical water-level predictors, warning-issuance models, database schemas, serving architecture, and frontend presentation.

---

## 1. Executive Summary

This technical audit reviews the machine learning and hydrological risk assessment architecture in the Rivora platform. Rivora integrates official hydrometeorological data from the Korea Meteorological Administration (KMA), the Water Resources Management Information System (WAMIS), the Han River/Geum River/Nakdong River Flood Control Centers (HRFCO), and K-water.

The system features two fundamentally distinct predictive engines:
1. **Physical River-Level Forecasting Engine:** A multi-horizon (+1h, +3h, +6h) direct water-level regressor evaluated against chronological persistence baselines.
2. **Official Flood Warning Issuance Model:** A binary classifier predicting whether HRFCO will issue a new official flood advisory or warning in the subsequent 3 hours $(t, t+3\text{h}]$.

The audit confirms that the physical river-level models operate reliably for verified stations (demonstrated by benchmark station **Taehwa Bridge, Station ID 207, WAMIS 2201670** with up to 71.3% MAE improvement over persistence). Conversely, the official warning issuance classifier legitimately holds an `INDEPENDENT_TEST_ACCEPTANCE_FAILED` status due to extreme real-world class rarity (prevalence $0.0148\%$) and resulting false-alarm rates, leading to its probability display being safely and honestly withheld.

---

## 2. Inventory of Existing Machine Learning Components

### A. Physical Water-Level Regression Pipeline
* **Research & Fitting Module:** [`backend/ml/level_research.py`](file:///D:/Capstone/WeatherForecasting/backend/ml/level_research.py)
  * Implements direct multi-horizon forecasting for horizons $H \in \{1, 3, 6\}$ hours.
  * Evaluates five candidate model families per station/horizon:
    1. `PERSISTENCE`: $y_{t+H} = y_t$
    2. `BOUNDED_TREND`: $y_{t+H} = y_t + \text{clip}(\Delta y_{1\text{h}}, -\tau, \tau) \times H$
    3. `RIDGE`: $L_2$-regularized linear regression ($\alpha = 5.0$) on standardized lags and rolling statistics.
    4. `ELASTIC_NET`: $L_1/L_2$-regularized regression ($\alpha = 0.001, \rho = 0.15$) for sparse covariate selection.
    5. `HIST_GRADIENT_BOOSTING`: Non-linear decision trees (`HistGradientBoostingRegressor`, max leaf nodes 15, $L_2 = 5$) trained when sufficient sample depth ($\ge 4,000$) and dynamic events ($\ge 3$) exist.
* **Inference Module:** [`backend/ml/level_predict.py`](file:///D:/Capstone/WeatherForecasting/backend/ml/level_predict.py)
  * Executes lightweight inference from frozen `.joblib` model artifacts under [`backend/ml/level_models_v4/`](file:///D:/Capstone/WeatherForecasting/backend/ml/level_models_v4/).
  * Implements causal unexpired hourly origin selection: if lag covariates at the newest minute are partially incomplete, it identifies the latest unexpired whole-hour origin within the 3-hour freshness window rather than immediately dropping to an uncalibrated baseline.
* **Serving Service & Normalizer:** [`backend/level-artifact-service.js`](file:///D:/Capstone/WeatherForecasting/backend/level-artifact-service.js)
  * Serves cached forecasts from [`backend/reports/advanced-level-network.json`](file:///D:/Capstone/WeatherForecasting/backend/reports/advanced-level-network.json).
  * Normalizes output freshness and withholds expired forecasts without fabricating fallback stages.

### B. Warning-Issuance Prediction Pipeline
* **Production Training & Inference Module:** [`backend/ml/advanced_warning.py`](file:///D:/Capstone/WeatherForecasting/backend/ml/advanced_warning.py)
  * Predicts new government flood advisory/warning issuances in $(t, t+3\text{h}]$.
  * Features: Water level, 1h/3h/6h rise, 1h acceleration, 72h historical percentile, 1h/3h/6h/12h/24h accumulated rainfall.
  * Partitions: Calendar seasons with a 72-hour temporal purge around storm proxies.
  * Validation Status: `INDEPENDENT_TEST_ACCEPTANCE_FAILED` (Precision $1.88\%$, Brier $0.0001532$).
* **Development Research Module:** [`backend/ml/warning_development_research.py`](file:///D:/Capstone/WeatherForecasting/backend/ml/warning_development_research.py)
  * Strictly isolated to pre-2026 data.
  * Investigated unweighted logistic regression, balanced logistic regression, histogram gradient boosting, and datum-independent gradient boosting across 2025 selection, calibration, and decision blocks.

### C. Experimental Flood-Stage Threshold-Crossing Outlook
* **Module:** [`backend/flood-stage-outlook.js`](file:///D:/Capstone/WeatherForecasting/backend/flood-stage-outlook.js)
  * Evaluates physical forecast levels against station-specific verified thresholds:
    - Advisory Stage (`caution_level_m` / `advisory_level_m`)
    - Warning Stage (`alert_level_m` / `warning_level_m`)
    - Severe Stage (`severe_level_m` / `danger_level_m`)
  * Computes forecast proximity margin in metres ($\text{Threshold} - y_{\text{pred}}$).
  * Enforces measurement safety holds (`NOT_ASSESSED` for stations with unverified datum compatibility).

---

## 3. Database Schema and Storage Review

| Table Name | Primary Role | Integrity & Constraints |
| :--- | :--- | :--- |
| `stations` | Gauge registry | Identifies official external WAMIS/KMA codes and geographic coordinates. |
| `water_readings` | Real-time & historical river stages | Indexed by covering index `idx_water_recent(observed_at, station_id, water_level)`. Contains millions of observations. |
| `aws_rainfall_readings` | Surface precipitation | 1-hour rainfall records from KMA Automatic Weather Stations. |
| `hr_rainfall_history` | HRFCO precipitation | Provider-specific precipitation matched to river gauge links. |
| `flood_thresholds` | Published reference stages | Station-specific advisory, warning, and severe flood heights with verification metadata. |
| `ml_source_coverage` | Bulletin completeness intervals | Tracks contiguous verified periods with known initial state (`status = 'COMPLETE'`). Prevents negative fabrication. |
| `hr_flood_warning_history`| Bulletin archives | Authenticated deduplicated flood notices from HRFCO. |
| `ml_advanced_predictions` | Persisted forecasts | Records horizon, model version, prediction value, valid time, and data quality status. |
| `ml_model_versions` | Model registry | Version metadata, training manifests, and evaluation summaries. |

---

## 4. Root Causes for "Baseline Only" and "Insufficient Data" Labels

Inspection of the catalog of 789 monitored stations revealed why a large proportion displayed "Baseline only" or were previously blocked:

1. **Official Source Provenance Requirements:**
   * In earlier iterations, stations had thousands of historical readings in `water_readings`, but their `source_url` metadata was unverified or lacked official provider host validation (`wamis.go.kr` / `hrfco.go.kr`).
   * The pipeline strictly refuses to train advanced estimators on unprovenanced data. The recent reconciliation ([`backend/repair-level-history.js`](file:///D:/Capstone/WeatherForecasting/backend/repair-level-history.js)) successfully restored `2,187,886` provenanced records across 253 stations, raising evaluated artifacts from 530 to 772.
2. **High Minimum Recent Coverage Threshold ($\ge 80\%$):**
   * Policy requires that during the last 120 days prior to the historical end date, hourly coverage must be at least $80\%$. Stations with extended sensor outages or intermittent communication fail this test and are categorized as `INSUFFICIENT_RECENT_PROVENANCED_COVERAGE`.
3. **Rigorous Multifold Acceptance Gaps:**
   * To transition from `PERSISTENCE` to an advanced model (`RIDGE`, `ELASTIC_NET`, or `HIST_GRADIENT_BOOSTING`), the candidate model must:
     - Improve validation MAE by $\ge 5\%$ over persistence.
     - Outperform persistence in at least two rolling-origin temporal folds.
     - Beat persistence RMSE on the holdout test set.
     - Maintain an MAE ratio $\le 1.10$ during rising-water and high-water proxy regimes.
     - Show a strictly positive 95% bootstrap confidence interval for MAE improvement.
   * If a station's water level is dominated by flat pool conditions (where persistence error is tiny, e.g. $\text{MAE} < 0.02\text{ m}$), complex models often fit slight sensor noise and fail the 5% improvement threshold, correctly triggering an honest fallback to `PERSISTENCE`.
4. **Measurement Reference Holds:**
   * Stations with conflicting elevation datums (e.g., **Yongdam Bridge, Station ID 3009, Code 1022640**, displaying stage $\approx 89.92\text{ m}$ against published thresholds of $13.7\text{ m}$ and $18.0\text{ m}$) are held under `REFERENCE_OR_MEASUREMENT_REVIEW_REQUIRED`. Stage comparisons and risk classifications are withheld as `NOT_ASSESSED`.

---

## 5. Audit Recommendations & Technical Next Steps

1. **Maintain Honest Model Separation:** Continue displaying "Ready" only for stations with verified, accepted ML improvements over baseline; clearly label persistence baselines as "Baseline only" demonstrations.
2. **Preserve the Experimental Flood-Stage Outlook:** Keep the physical threshold-crossing outlook separate from the statistical warning classifier.
3. **Withhold Warning Probabilities:** Maintain the null probability policy on the warning model until broader nationwide coverage and catchment precipitation can be integrated.
