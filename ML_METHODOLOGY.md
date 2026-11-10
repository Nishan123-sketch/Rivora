# Rivora model methodology and limitations

## Five separate outputs

1. **Official warning status:** reconstructed station-specific HRFCO timeline only when complete coverage and a known initial state are available through a recent as-of time. Unknown and stale coverage remain UNKNOWN. Historical notices never become current warnings by age or name similarity.
2. **Observed stage:** measured level compared with verified station-specific stages. This is a comparison, not an issued government warning.
3. **Experimental potential:** existing V2 screening heuristic. Inputs include station historical percentile, actual water-level rise and complete nearby point rainfall windows. It is uncalibrated; a low score cannot fill missing rain with zero or overrule an official warning.
4. **Future level:** independent +1h/+3h/+6h water-level regression or persistence, in metres. It is not an event probability.
5. **Future issuance:** calibrated probability of a new advisory/warning in `(t,t+3 hours]`, only after the event classifier passes its independent evaluation gate. It predicts official issuance, not physical inundation.

The shared badge priority is current reliably matched official warning, verified observed stage, independently evaluated future warning model, then explicitly experimental screening. Current Stations remain limited to the verified-threshold network. A current active official warning cannot be replaced by a lower model grade.

## Inputs and quality

Only observations at or before the feature time are used. The hourly feature grid uses backward matching within 15 minutes, never a later reading assigned to an earlier hour. It contains level, 1/3/6h changes, acceleration, past 72-hour percentile and 1/3/6/12/24h rainfall. Unknown, negative-sentinel and missing rainfall remain missing. All hours in an accumulated window must exist. Nearby point rainfall within 30km is explicitly a regional proxy, not a demonstrated upstream catchment aggregate.

Discharge is exposed only when supplied; it is not forced into a model with unavailable data. Temperature is not added without demonstrated predictive benefit. Archived forecast rainfall is excluded from warning training unless availability at prediction time can be established. Current KMA issued forecasts elsewhere in the app are not future observations and must not be substituted for historical archives.

Dam/reservoir measurement semantics, invalid coordinates and unverified threshold identities are excluded by the verified gauge policy. Observations older than three hours, future timestamps, missing lag windows and jumps greater than 5m in one hour are quality problems. The jump limit is a conservative review flag, not proof a hydrological event is impossible. No data is deleted to resolve a flag.

## River-level evaluation

Each gauge/horizon is evaluated independently with older training data, later validation data and a final chronological test. Boundaries are purged by the six-hour lag plus prediction horizon. Ridge is selected only when validation MAE improves by at least 5% over persistence. Final test MAE/RMSE are not used for selection. The chosen recipe can then be refitted with observed historical targets for live inference; its stored holdout scores remain out-of-sample evaluation of that recipe.

Ten-minute live data and hourly historical observations coexist. The model uses an actual recent complete lag window with explicit reference and valid timestamps. If Ridge lag inputs are missing but a fresh current level and sufficient historical evaluation exist, a genuine persistence forecast may be used and labelled PERSISTENCE. Its value is the last measured level, not an invented ML output. Expired forecast valid times are rejected. No forecast is produced from stale water data. Rainfall can be omitted only from a separately evaluated level-only recipe, not silently replaced with dry weather.

Overall errors are sample-weighted aggregates of actual gauge holdouts. River-level aggregates require at least three gauges, and per-gauge errors remain available. These metrics may be dominated by calm-water periods; they do not establish flood-event accuracy. No probabilistic uncertainty interval is shown without a separately evaluated coverage method.

## Warning targets and event timeline

HRFCO `sttnm` is matched exactly to the provider station code. `ancdt`, `kind`, `no`, `obsnm`, `rvrnm`, `sttcurhgt` and `wrnaranm` are retained. A bulletin's observed level is never converted into an official threshold. Event identity is hashed from exact station/time/type/bulletin; repeated imports are idempotent.

An advisory or warning issuance in `(t,t+3h]` is positive. A cancellation is not a new issuance. Advisory-to-warning upgrades are distinct qualifying issuances; repeated same-severity ongoing announcements do not automatically become new events. Cancellation/issuance ties are ordered deterministically. Ongoing warning state is recorded separately, and the current classifier is not served to stations with an ongoing or unknown official state.

Negative targets require complete reviewed station coverage for the entire prediction window plus a known initial warning state. Otherwise the target is UNKNOWN and excluded. A code-990 response, an empty response, one historical query, or a successful import does not certify coverage. This conservative rule currently prevents a scientifically unjustified trained probability.

## Event classifier and calibration

Candidate models are Logistic Regression, Random Forest and histogram Gradient Boosting, compared on validation average precision (PR-AUC summary). Class weighting is used where supported. Baselines include training climatology and a documented simple rise/rain rule. Candidate complexity does not guarantee improvement.

Splits are global chronological partitions, rather than random rows or independent per-station shuffles. Issuances separated by at most 72 hours are grouped into storm proxies; extended groups and a 72h boundary purge prevent those related observations crossing train/test partitions. Background time blocks are global too. These are conservative temporal storm proxies, not independently delineated meteorological catchment events.

Validation is subdivided chronologically for candidate selection, sigmoid probability calibration and operating thresholds. Moderate targets 95% validation recall and High targets 80%, with precision used to select feasible thresholds. Final test results never retune thresholds. Minimum independent positive-event counts are 20 training, 12 validation and 10 test, plus distinct classes and adequate calibration partitions. Missing requirements produce INSUFFICIENT_VALIDATION_DATA.

The predeclared educational acceptance gate requires test Brier score better than training-climatology baseline, event detection of at least 80%, and precision of at least 20%. Passing this gate is not certification for public safety. Local inference additionally checks model age, training station scope, feature completeness, official state, artifact checksum and probability range. No paid inference service is involved.

Saved metrics, when a real eligible model exists, include precision, recall, F1, average-precision PR-AUC, meaningful ROC-AUC, confusion matrix, false-alarm episodes per station-day, missed/detected warning events, median lead time, Brier score and calibration-bin observations. Gauge and river metrics require sufficient events. Global permutation importance uses actual validation AP degradation; it is neither local SHAP nor a causal contribution. No numbers are supplied for an untrained model.

## Present evidence and remaining work

See `backend/reports/advanced-warning-validation.json` for the actual latest dataset counts. The implementation has imported authentic records across selected 2023/2024/2025 query dates, but complete warning coverage remains unverified. More events alone do not make missing periods valid negatives. River-level and rainfall history must also overlap warning events, and geographically matched rainfall must be adequate.

The next scientific steps are provider-confirmed complete multi-storm archives, historical rainfall coverage, event-period holdouts across seasons, comparison of datum consistency, and external operational review. Until then this is an explainable educational monitoring prototype, not a warning-issuance authority or a validated inundation predictor.

## Official references

- HRFCO API documentation: https://www.hrfco.go.kr/web/openapiPage/reference.do
- HRFCO query-end bulletin service: `https://api.hrfco.go.kr/{private-key}/fldfct/list/YYYYMMDD.json` (the actual key is never shipped).
- KMA observation/forecast API documentation: https://apihub.kma.go.kr/apiList.do
- WAMIS hourly hydrology API: https://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata

The repository inspection identified multiple historical risk modules. Existing routes are preserved; the new ML dashboard uses the advanced service, while current station comparisons retain the unified engine and official-priority overlay. Legacy stage classifiers are not relabelled as future warning classifiers.
