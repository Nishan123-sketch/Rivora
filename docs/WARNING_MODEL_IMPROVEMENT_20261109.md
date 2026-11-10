# Warning-model improvement — 9 November 2026

Completed another substantive improvement pass on the existing warning pipeline. Fixed a training/runtime eligibility mismatch, tested six development candidates, investigated official archive recovery, and registered an untouched-evaluation protocol. **No candidate passed the development requirements, so warning probabilities remain disabled and the production failed-validation result is unchanged.**

## Fixed training/runtime mismatch

Live inference forecasts a new issuance only when the official current state is confirmed NONE. Training and development previously admitted positive examples whose origin state was UNKNOWN or already ADVISORY, even though the runtime would withhold a forecast for those origins.

Added the shared Python `new_issuance_origins` filter and applied it to production training and development research. This excludes inapplicable origins without changing authentic bulletin labels or declaring unknown periods negative.

The new development audit found **220 positive samples outside runtime scope**: **192 UNKNOWN** origins and **28 ADVISORY** origins. After alignment, training contains 27 eligible issuance events, selection 20, calibration 9 and threshold selection 3. This is a substantial change in eligible support, so the new metrics must not be presented as a directly comparable update to the old production 1.9% independent-test precision.

## Real model comparisons

All model fitting and selection used pre-2026 data and the saved 2025 development blocks. The inspected 2026 final test was not scored or used for tuning. Model ranking used selection-block average precision; calibration and decision checks retained their separate roles.

Added training-only station-relative context: same-gauge median, p05/p95 range, relative 1h/3h/6h changes and exceedance of its training p90. These are statistical context features, not historical datum corrections or reconstructed official flood thresholds. An unknown gauge retains missing context with an explicit indicator; it is not assigned another gauge's reference. Tests verify that future rows and labels cannot alter the fitted context.

Six candidates were actually fitted and evaluated:

- Existing HGB: selection AP **0.167531**; frozen-threshold diagnostic precision **1.020%**, event detection **100%**.
- Hydrological HGB: AP **0.129598**; precision **1.143%**, event detection **100%**.
- Hydrological logistic: AP **0.171351**; precision **3.797%**, event detection **33.3%**.
- Station-context HGB: AP **0.158572**; precision **0.962%**, event detection **100%**.
- Constrained station-context HGB: AP **0.140723**; precision **0.930%**, event detection **100%**.
- Balanced station-context HGB: AP **0.178642**; precision **1.142%**, event detection **100%**.

The balanced station-context candidate ranked first on the predeclared selection metric, but **none of the six found a qualifying decision threshold** at precision ≥20% and event detection ≥80%. Its Brier score was **0.0000737794**, worse than the frozen training-climatology baseline **0.0000696579**. The logistic model reduced false positives but missed two of the three threshold-block events; that tradeoff does not satisfy the recall requirement.

The threshold block has only three events and nine positive hourly samples, so these diagnostics remain weak development evidence. No threshold-block result was used to switch to another candidate after selection, and no model was promoted. See `backend/reports/warning-model-improvement-20261109/warning-research-results.json` and `promotion-decision.json`.

The first context experiment hit a pandas column-lookup error before fitting. It was corrected, regression-tested, and all six fits then completed. Only the successful run supplies these model metrics.

## Official archive recovery attempt

Attempted to retrieve and reconcile the official 2023 Han warning archive through the existing collector. The published CSV exposed 13 distinct bulletin numbers with maximum 16, **missing numbers 7, 9 and 14**. The completeness check rejected the archive before importing events or creating complete coverage.

Saved the exact source URL, response hash, sequence and failure in `backend/reports/official-warning-year-2023-unavailable.json`. The official source was `https://www.hrfco.go.kr/flood/downloadPastCSV.do`. Earlier states must remain unknown until complete, reconciled bulletin history and a verified initial-state anchor establish them. Merely moving the interval start to January 1 would create unsupported negative labels.

This identifies specific official records needed to investigate restoration of excluded early-warning examples. It does not prove that obtaining those three bulletins alone will resolve every station's initial state, missing water/rainfall features or future accuracy requirement.

## Independent evaluation

Registered `prospective-evaluation-plan.json` under the new report directory. Earliest eligible origins begin **10 November 2026, 00:00 KST**, excluding all earlier outcomes. This is an eligibility boundary, **not** a promised completion or release date.

The protocol requires a qualifying frozen candidate and immutable artifact/schema/calibration/threshold checksums before forecasts; genuine forecast-time predictions rather than reconstructed retrospective predictions; complete official target-window coverage; and one scoring pass after ten completed independent future storm-proxy groups, with at least ten positive events. The unchanged precision, recall, Brier and per-station event requirements still apply.

The read-only readiness check reports two current blockers: **NO_DEVELOPMENT_CANDIDATE_QUALIFIED** and **UNTOUCHED_FUTURE_PERIOD_NOT_STARTED**. No candidate was frozen for release because none passed development gates. An exposed final test cannot become independent again by rerunning it. No prospective accuracy is claimed and no future background evaluation has been represented as running.

## Integration and verification

The production model remains `warning-v1-20261108T070103`, status INDEPENDENT_TEST_ACCEPTANCE_FAILED. Its saved validation report SHA-256 remained `83855857cd66f313ab5734ea2f025352b59ad328df1ea0e636c1bfb3d35ff81a` before and after this pass. Existing level forecasts and the React interface were not changed in this pass.

Actual final checks:

- **46 Python ML tests passed**, including new runtime-scope, training-only station-context and unknown-gauge regressions. Output saved in `backend/reports/warning-model-improvement-20261109/python-tests.txt`.
- **368 backend tests passed**, zero failed.
- Python compilation and Node syntax checks passed for changed code.
- The archive failure produced no event imports or complete coverage rows. The readiness check used read-only database queries and wrote no production model data.

Implementation files: `backend/ml/advanced_warning.py`, `backend/ml/warning_development_research.py`, `backend/ml/warning_hydrology_research.py`, their existing Python test files, `backend/extend-warning-seasons.js`, and `backend/scripts/check-warning-evaluation-readiness.js`.

The visible failure message still reflects the actual production result. This pass repaired a real training fault and evaluated replacements, but it did not establish a reliable replacement warning classifier.
