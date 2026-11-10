# Rivora scientific ML continuation — 9 November 2026

The project write check passed. Existing production models, model acceptance policy, Taehwa forecasts, APIs and React ML Analysis components were preserved. No deployment or independent accuracy improvement is claimed.

## Level experiments

Re-executed the existing 12-station, three-horizon development experiment against local MySQL. Results are in `backend/reports/scientific-continuation-20261109/`; the original reports remain intact. Selection is already inspected development data and cannot support independent acceptance.

Saved candidate mean MAE was 0.028652, 0.063170 and 0.089116 m at 1h, 3h and 6h. Rerun mean MAE was 0.028651, 0.063241 and 0.088860 m. Persistence MAE was 0.027740, 0.071906 and 0.113205 m. Each station has the same selection sample count, so sample-weighted pooled MAE equals station-mean MAE here. The summary implementation also handles unequal counts correctly.

This is a close reproduction, not an exact one: the largest station/horizon MAE difference was 0.005674 m at station 5001625, 6h, where the chosen candidate changed. The archived run did not preserve complete input fingerprints and environment versions, so a specific cause cannot be established. New executions now record both. See `reproduction-comparison.json` for every comparison. Do not attribute these differences to the five imports: the level runs preceded those imports, and the repaired stations are outside the 12-station cohort.

The saved 1h result improved 10/12 stations but worsened the average because station 1023667 rose from 0.151783 to 0.196169 m MAE (+0.044386 m). That loss outweighed improvements elsewhere; station 4008660 also worsened slightly. A win count alone obscures loss magnitude.

Tail errors also argue against promotion: rerun candidate pooled RMSE was 0.116239, 0.241761 and 0.341166 m, versus persistence 0.087823, 0.207790 and 0.306688 m. Lower MAE at longer horizons did not imply lower severe-error risk.

Added station-level training-defined rising, high-water, heavy-point-rain, wet and dry diagnostics, with pooled regime MAE. For the high-water proxy, candidate/persistence MAE was 0.051339/0.043528 m at 1h, 0.109464/0.110014 m at 3h, and 0.152712/0.176695 m at 6h. These conditions and 72h time episodes are proxies, not independently verified storm or flood-event labels. Missing rainfall is excluded from wet/dry groups.

Tested an opt-in persistence candidate in training-only cross-validation. It worsened pooled MAE to 0.028980, 0.064413 and 0.091088 m. Kept this as a reproducible experimental ablation under `persistence-cv/`; did not enable it in production. Existing acceptance criteria remain unchanged.

## Authentic data repair

Corrected the acquisition audit to use whole-hour origins, matching the feature pipeline. Previously an interval starting at 11:20 generated an hourly grid at :20 and falsely classified observations at :00 as absent. Correcting alignment changes both the extent and fragmentation of gaps: the old 77 contiguous windows became 102, across the same 71 stations. These are timestamp-coverage counts, not a certification of all historical values or provenance.

Three bounded access probes returned historical HRFCO water, HRFCO rainfall and WAMIS water records. This establishes access for the tested requests, not unlimited bulk-download entitlement. A generic weather API key does not establish historical AWS-product authorization; that entitlement remains unverified. KMA lists authentication and product application in its [official API catalogue](https://apihub.kma.go.kr/apiList.do).

Fetched only eight short audited gaps. WAMIS supplied five missing observations at 2025-01-31 03:00 KST for stations 3004690, 3011660, 3201690, 3012607 and 3013605. Inserted five rows with original official timestamps and source URLs using INSERT IGNORE. No existing observations were replaced. Saved retrieved records and their SHA-256 digests in `gap-repair-results.json`.

Two HRFCO rainfall gaps returned no matching observation and remain missing: rain gauge 30064020 at 2024-07-09 17:00 and 2025-12-23 22:00 KST. Station 3014610 water recovery was unavailable. No missing rainfall was replaced with zero.

The post-import audit confirms 97 remaining contiguous gaps and 102,233 missing point-rain hours. Exact station codes, linked rainfall codes, date ranges and source requirements are in `after-repair/authentic-data-gaps.csv`. Long ranges were not bulk imported. Seek historical AWS-product entitlement or an official export for remaining rainfall gaps, with verified gauge identity before substituting a different provider. Closing five isolated gaps does not establish increased accepted-model coverage.

## Warning research

Reran the hydrology comparison with official-provenance water inputs and only pre-2026 observations. The already-inspected 2026 final test was excluded from scoring and model selection. No warning artifact or validation status was replaced.

The threshold block still contains only three events and nine positive samples among 129,359 rows. At the existing frozen diagnostic threshold, Existing HGB gave 581 false positives, 8 true positives and 1.358% precision. Hydrological HGB gave 510 false positives, 8 true positives and 1.544% precision. Hydrological logistic gave 123 false positives and 3 true positives (2.381% precision), sacrificing detection. No candidate found a qualifying threshold at the unchanged 20% precision and 80% event-recall requirements.

Hydrological HGB development Brier was 0.00006835 versus training-climatology baseline 0.00007069, but passing that development metric alone cannot authorize warning probabilities. Selection AP ranked Existing HGB (0.37452) above Hydrological HGB (0.35426); the threshold-block diagnostics must not override the predefined selection rule. These are rerun development results after repair, not a clean causal estimate of the imports' benefit.

Added explicit rejection of threshold qualification with fewer than two events, and a calibration/threshold event-count guard in the hydrology runner. Acceptance requirements were strengthened, not relaxed.

The current configured rainfall context is nearest-point rainfall. No verified upstream topology, catchment weights or travel-time mapping was supplied by the existing audit. Upstream water and basin rainfall cannot responsibly be invented from proximity. Improving that context needs verified mappings and authentic aligned historical records. A genuinely untouched future evaluation is still required. The production warning-model independent validation remains failed.

## Changed implementation files

- `backend/ml/level_development_upgrade.py`: separate output directories, pooled/regime summaries, optional persistence ablation, environment and input fingerprints.
- `backend/ml/scientific_data_audit.py`: aligned hourly gap grid and separate output directory.
- `backend/ml/warning_development_research.py`: minimum threshold-event guard.
- `backend/ml/warning_hydrology_research.py`: separate output directory and calibration/threshold guards.
- `backend/ml/test_scientific_upgrade.py`: gap-alignment, event-count and pooled-metric regressions.
- `backend/scripts/probe-scientific-archives.js`: bounded read-only historical access checks without credential logging.
- `backend/scripts/repair-scientific-gaps.js`: bounded authentic short-gap imports that preserve existing rows.
- `backend/tests/scientific-gap-repair.test.js`: timestamp, final-period, finite-value and genuine-zero protections.

## Verification

Executed the backend Node suite, Python ML unittest discovery and frontend Node suite. Initial backend HTTP tests were blocked by sandbox loopback EACCES; the final full rerun with approved loopback access passed all 360 tests, including the new short-gap regression. Python passed 39 tests; frontend passed 41 tests. The existing frontend tests verify that network warning failure is separate from level forecast availability and that accepted models, baselines and unavailable forecasts retain distinct presentation.

No frontend redesign was necessary. No production promotion, coverage increase, deployment or independent validation success is asserted.
