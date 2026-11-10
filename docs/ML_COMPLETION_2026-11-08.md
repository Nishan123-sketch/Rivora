# Rivora ML completion — 8 November 2026

This report supersedes the earlier 237-forecast / zero-compatible-reference snapshots.

## Completed
- Attempted all 651 targeted station histories: 620 successful imports; 31 remain source/history failures. The enrichment checkpoint records 1,292,957 newly inserted water observations.
- Added authentic warning-period water and hourly rainfall history for 28 independently reconciled Han archive stations, in separate HRFCO rainfall tables. The feature-history log records at least 264,871 further water rows and 390,713 rainfall rows; earlier partial request writes mean water totals are conservative.
- Bulk official water observations refresh every five minutes. Hourly rainfall refreshes for the linked HRFCO gauges. Network forecast evaluation refreshes hourly. These jobs run while the backend is running.
- Reconciled 127 published 2024–2026 Han warning notices bidirectionally with typed API events and contiguous bulletin numbers. The resulting 28 publication-coverage intervals start at explicit cancellation anchors. This is scoped Han published-warning coverage, not nationwide coverage or proof of safety.
- Added exact-observation reference verification against official metadata, units and the reviewed official chart schema. The final audit finds 783 compatible current points, six withheld, no missing/stale/future observations or duplicate gauge codes. Certificates cover only the matched timestamp, value and thresholds. No historical datum epoch or future reading is automatically certified.
- Yongdam 1022640 remains withheld for measurement quality review; its reported value is preserved. Jamsu and Pilseung controls require separate stage-scheme assessment. No offset or replacement reading is invented.
- The ML page separates recorded levels, dated +1/+3/+6-hour experimental predictions, stage comparisons and issued-warning status. Wet/dry and upper-training-decile test metrics are available separately; upper decile is not an official flood threshold.
- Rainfall training and inference enforce the same provider. Missing values remain missing; original KMA data and links are preserved.

Final level-network evaluation: **759 of 789 gauges available**, versus the original 138. The other 30 require more usable level history. Forecast availability does not establish flood-event accuracy.

## Actual warning-model result
Training used 450,688 usable samples and 61 positive warning events. Chronological partitions contain 50 training, zero validation and 11 final-test events. The model correctly remains INSUFFICIENT_INDEPENDENT_POSITIVE_EVENTS: a probability cannot be calibrated or validated from a validation period with zero events. Additional independently covered rainy-season years and/or other flood-control-office archives are still needed. No synthetic events, relaxed acceptance criteria or fabricated probabilities were used.

## Verification
294 backend tests passed, plus two new targeted regression tests (296 total); 29 frontend tests and six Python ML tests passed. Frontend lint and production build passed. The map bundle size warning remains informational. Browser verification confirmed real recorded and forecast values with explicit limits.

## Operating and restoring
Keep the backend running for automatic updates; npm development commands are only one way to run it locally. The source archive excludes credentials, local model binaries, node_modules, operational import checkpoints and the MySQL database. It is not a database backup. A fresh installation needs its own environment configuration, schema setup and authentic history imports before model evaluation/training.

## Rainfall repair follow-up
The original 28 historical-training links did not cover Taehwa. ML detail requests now discover the nearest official HRFCO rain gauge within 30 km when unlinked, retain existing HRFCO links, retrieve actual last-30-hour observations when model windows have gaps, and cache repairs for five minutes. Existing bulk rainfall jobs keep linked gauges updated. API failures retain missing status rather than inventing zero. Taehwa was verified with gauge 22014080, 0.031 km away: all 1/3/6/12/24-hour totals are genuine zero, feature status FRESH with no issues. This fixes rainfall inputs; it does not validate the independent warning classifier. The warning panel now explicitly displays its 50/0/11 training/validation/test event counts. Backend 297/297 tests, frontend 29/29, lint and production build passed.
