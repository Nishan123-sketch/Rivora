# Additional warning seasons — 8 November 2026

Imported and reconciled the complete published 2022 Han sequence: 47 notices, 12 historical coverage intervals. These intervals end in 2022 and cannot establish current warning status. Published 2020 and 2023 numbering gaps remain unverified; they were not silently treated as complete negative periods.

Added 44,812 water observations and 41,646 rainfall observations. Failed large requests were retried with 14-day chunks. A gauge with no authentic 2022 rainfall retains missing data. No readings or events were invented.

A frozen calendar policy now uses pre-2025 data for training, 2025 for validation and 2026 for the retrospective test. Whole overlapping storm groups are excluded, with a 72-hour purge. This replaces winter-dominated quantile validation. The 2026 event counts had already been inspected, so this is explicitly retrospective, not prospective validation. Acceptance criteria were not relaxed. Threshold selection now uses equivalent sorted cumulative counts instead of quadratic exhaustive scans.

The updated dataset has 493 historical records, 307 issuance records, 40 complete coverage intervals, 490,609 usable samples and 81 unique warning events. Partition event counts: training 43, validation 27, test 11. The original zero-event validation problem is resolved.

Training stopped before fitting at INSUFFICIENT_CALIBRATION_OR_THRESHOLD_EVENTS. Validation contains 24 model-selection events, one calibration event and two decision-threshold events. The remaining calibration storm's other recorded issuance is outside the independently reconciled Han coverage (Geum gauge 3201690); its presence does not establish a complete negative timeline for that basin. Enabling a calibrated probability still requires more independently reconciled storm coverage and matching observations, rather than reducing the minimum or reusing the final test for tuning.

Verification: 298 backend tests, eight Python ML tests, 29 frontend tests, frontend lint and production build passed. Exact per-run evidence is stored alongside this report.
