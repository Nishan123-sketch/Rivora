# ML data and result clarity upgrade — 8 November 2026

The working database received 97,584 additional official WAMIS water-level observations across 99 stations. Existing observations were preserved with INSERT IGNORE, and every new row stores its official source request URL. The targeted queue originally contained 651 stations with insufficient history. 110 have been attempted: 99 received usable history and 11 had failed requests; 541 remain queued. Repeated upstream timeouts/connection resets stopped the importer safely. This is not a claim that all 651 histories have been downloaded.

KMA enrichment added 17,925 rainfall records over 25 requested historical hours, plus 702 records from an additional hour. Missing hourly amounts remain missing. HRFCO supplied 13 further authentic bulletins, increasing the stored archive from 329 to 342 records, including 225 issuance records. Other requested dates returned ambiguous code 990 rather than usable archive data. No negative warning labels or complete-coverage intervals were invented.

After actual network evaluation, forecast-ready stations increased from 138 to 237 out of 789 monitored gauges. “Ready” means at least one usable horizon, not necessarily all three. In the final snapshot, one-hour forecasts were available for 166 gauges; three- and six-hour forecasts were available for 237. Availability changes with observation age.

Sample-weighted chronological test MAE was approximately 0.00678 m at one hour, 0.02020 m at three hours and 0.02814 m at six hours. Corresponding persistence baselines were 0.00794 m, 0.02215 m and 0.03317 m. These are measured errors on the available station-specific test periods, not flood-event accuracy, guaranteed future accuracy or nationwide validation. Ridge is selected only using earlier validation data; the final test is not used to select it.

## Data and model changes

- Added resumable `backend/enrich-ml-history.js`, a persisted station queue, duplicate-run lock, bounded two-worker collection, shared request-rate slots, explicit source failures and network evaluation after collection. Unattempted stations are tried before previously failed requests so a few failed gauges cannot block the entire queue.
- Updated `wamis-client.js` to close upstream connections and provide a bounded history path; normal live imports retain their existing retries and serial lane.
- Updated `ai-water-level-outlook.js` to use explicit hourly rainfall, preferably from a linked KMA AWS station within 25 km, rather than a generic rainfall column. Missing rainfall does not become zero. Nearby point rainfall is explicitly distinguished from catchment rainfall.
- The training window now retains older actual hourly observations alongside recent high-frequency live observations, preventing frequent live readings from crowding the hourly history out of the bounded query. Test-period timestamps are recorded with the holdout report.
- Existing chronological train/validation/test partitions, horizon purging, persistence comparisons, model availability gates, measurement-reference guard and warning-history requirements remain active.

## Clear results in the interface

The ML page now begins its station results with the recorded water level and separately dated +1h, +3h and +6h experimental predictions. “No data” was replaced by specific states: comparison not verified, reading out of date, awaiting observation or risk estimate withheld. Recorded readings are not hidden merely because a risk comparison cannot be certified.

Import progress and actual inserted-observation counts are exposed through the overview. The last valid reported hourly rainfall is shown separately from model feature windows, with its ending time. It never fills a missing model-window hour.

For Taehwa Bridge, actual endpoint and browser verification showed a recorded 4.62 m and available predicted levels of approximately 4.678 / 4.844 / 4.969 m, valid at 02:00 / 04:00 / 07:00 KST on 8 November. These are verification snapshots, not current forecasts for later use. Consult the application timestamps.

## Why some results remain withheld

The warning model was rerun. Its result remains `INSUFFICIENT_VALIDATION_DATA / NO_COMPLETE_WARNING_ARCHIVE_COVERAGE`: 342 authentic bulletins do not establish continuous warning-free periods or a known initial state. A validated warning probability requires a complete, authoritative event timeline and valid positive/negative labels. More positive bulletins alone cannot establish that validation.

Official threshold compatibility remains a separate requirement from level-model performance. No verified datum entries were invented to turn unavailable stage comparisons into Low/Moderate/High.

The KMA AWS response for Ulsan station 152 at 202611080100 contained RN_HR1=0.0 but RN_HR1_MI=-99. The latter is an invalid time marker; the application correctly does not promote that amount into an exact hourly model window. The last valid reported hour can still be displayed, with its own time. Moving-window maxima are not substituted for hourly totals.

## Executed checks and operation

The full backend suite passed 284 tests; frontend tests passed 29. ESLint and the production build passed; the existing MapLibre bundle-size advisory remains. Live `/api/ml/overview` and `/api/ml/stations/207` returned 200. Browser proof is in `verification/ML_Clear_Results.png`; data, endpoint and metric snapshots are in `verification/ML_Enrichment_Results.json`.

Tests include source-preserving inserts, genuine zero observations, missing-value rejection, hourly rainfall selection, chronological evaluation and UI distinctions between missing observations and unverified comparisons. A compatibility regression in the assistant fallback export was caught by the full suite and repaired; both the original monitoring fallback and the new conversational fallback remain exported.

When WAMIS access recovers, resume the persisted queue from the backend directory with `npm run ml:enrich`. It skips successfully imported stations and evaluates again after the pass. It does not fabricate data when a provider is unavailable. The queue and its failures remain visible; no complete nationwide enrichment is claimed.

The new raw observations are in the local MySQL database. A source-code ZIP contains the importer and evaluation reports, not a new full database backup.
