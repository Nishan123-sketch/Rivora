# Rivora advanced ML — Windows PowerShell

This update extends the existing application. It does not recreate the database, remove observations, replace authentication, or enable outgoing email.

## Install and update

Use your existing MySQL database and project configuration. Start MySQL before these commands.

```powershell
Set-Location D:\Capstone\WeatherForecasting\backend
npm ci
python -m pip install -r ml\requirements.txt
npm run ml:migrate
npm run ml:history
npm run ml:evaluate:levels
npm run ml:train:warning
```

`ml:history` imports the bundled authentic, deduplicated HRFCO bulletin capture. Re-running is safe. Predictions require your actual water/weather history in MySQL; reports bundled with the source are historical evaluations, not replacement observations.

In `backend/.env`, configure your own database credentials and API keys. The ZIP intentionally excludes the real `.env`. `HRFCO_SERVICE_KEY` accepts either the service key or a complete HTTPS endpoint from `api.hrfco.go.kr`; the importer extracts the key without logging it. Do not put credentials in source or command arguments.

```powershell
# Fetch specific historical query-end dates. A response is NOT proof of complete archive coverage.
npm run ml:history:fetch -- 20250718 20250719 20250720 20240718 20230715

# Run all checks
npm test
npm run ml:test

# Start backend in this terminal
npm run dev
```

In another PowerShell terminal:

```powershell
Set-Location D:\Capstone\WeatherForecasting\frontend
npm ci
npm test
npm run build
npm run dev
```

Open `http://localhost:5173` → **ML Analysis**. Existing Stations and River Monitoring use the same official-warning priority overlay. The previous ML page source remains available for compatibility, while navigation uses `MLAdvanced.jsx`.

## Automatic work

While the backend runs, existing WAMIS/KMA import jobs continue. Advanced network level evaluations refresh hourly. A local process lock prevents duplicate network training jobs. HRFCO query-end history is refreshed every ten minutes when a service key is present. API code 990, malformed payloads and failed calls remain unknown; they are never interpreted as confirmed no-warning periods.

Set `ENABLE_ADVANCED_ML_JOBS=false` to disable these additional background jobs during isolated testing. Warning-classifier retraining is explicit: run `npm run ml:train:warning` after importing and reviewing suitable archive coverage. No paid ML service is used. Keep automatic alert emails disabled while testing.

## Warning archive coverage

Records and coverage are separate. Imported responses receive **PARTIAL** coverage metadata. No negative warning labels are generated without reviewed complete station/time coverage and a known initial warning state.

To import reviewed coverage, use:

```powershell
node advanced-hrfco-import.js --manifest C:\path\to\reviewed-coverage.json
```

The JSON has a `coverage` array. Each interval requires `station_code`, `start_at`, `end_at`, `status`, `source_url`, and `evidence`. COMPLETE additionally requires `reviewed_complete: true` and `initial_state` of NONE, ADVISORY or WARNING. Times are KST wall-clock strings. Future completeness is rejected. Do not mark coverage complete just to enable a model; obtain evidence that the provider's full station event timeline is present. No COMPLETE example with invented evidence is supplied.

## API reference

All responses use `{success, data}` or an HTTP error with `{success:false, status, message}`.

- `GET /api/ml/overview` — network counts, searchable gauge names/codes, model availability.
- `GET /api/ml/stations/:id` — complete station analysis, level forecasts, quality, history, warning model status.
- `GET /api/ml/stations/:id/level-forecast` — +1h/+3h/+6h level forecasts and genuine holdout errors.
- `GET /api/ml/stations/:id/warning-prediction` — calibrated future issuance probability only if independently evaluated and eligible; otherwise null with an explicit reason.
- `GET /api/ml/stations/:id/warning-history` — matched historical bulletins, coverage and distinct current status.
- `GET /api/ml/stations/:id/assessment` — priority-selected badge and source.
- `GET /api/ml/stations/:id/status` — feature/model/forecast availability.
- `GET /api/ml/models/performance?station_id=207` — saved warning evaluation and gauge level report.

Prediction records identify station, observation time, issue time, valid time, horizon, model/version, type, value, validation status, quality and unavailability reason. Probability null is intentional when validation is insufficient. A successful HTTP request does not mean a forecast exists; check its `status`/`forecast_status`.

## Model files and storage

- `backend/migrations/advanced-ml.sql`: additive, idempotent SQL.
- `backend/hrfco-warning-history.js`: exact-code bulletin normalization and persistence.
- `backend/advanced-hrfco-import.js`: official importer and explicit coverage review.
- `backend/ml/advanced_warning.py`: chronological event dataset, candidate training, calibration, metrics, gated local inference.
- `backend/ml-refresh-network.js`: bounded-memory per-gauge level evaluation and real aggregate errors.
- `backend/reports/advanced-level-network.json`: saved level results, overall and by river.
- `backend/reports/advanced-warning-validation.json`: actual warning-training outcome, including insufficiency reasons.
- `backend/ml/advanced_models`: locally generated validated artifacts, if any. Never load joblib files from an untrusted source.
- `backend/ml_source_coverage` is a database table, not a directory. The other additive tables are `ml_dataset_runs`, `ml_model_versions`, `ml_feature_snapshots`, and `ml_advanced_predictions`; authentic events reuse `hr_flood_warning_history`.

Existing routes remain available. Older next-hour stage classifiers are distinct from the new future **official issuance** target and are not used as issuance probabilities.
