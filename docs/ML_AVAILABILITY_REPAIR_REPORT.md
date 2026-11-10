# Rivora ML availability repair — verified 8 November 2026

The backend produces real evaluated level outputs and React displays them. This repair increases data eligibility and separates accepted models from persistence demonstrations. Calibrated warning probability remains disabled because the expanded model failed its unchanged final accuracy gates.

## 1. Root causes of “Waiting for inputs”

Most blocked stations had substantial legacy water history but insufficient acceptable source provenance. For example, Gwangdong had 9,602 raw rows but only 76 usable provenanced rows in the initial audit. The old enrichment helper only targeted three legacy reason codes, so the newer provenance-related blockers were not collected by that path. This was a collection/provenance gap, not justification to fabricate observations or relax sample minima.

The UI also called any available persistence output “Ready” and used “Waiting for inputs” for unrelated failures. Accepted advanced horizons, baseline demonstrations, stale inputs and specific blockers are now separate. The screenshot showed the network table lower on the page under sticky controls; Inspect and a new “Selected station results” control now scroll the window as well as the main container back to the actual results.

A further serving defect was reproduced: missing features at the newest hour caused a persistence fallback even when an earlier complete hourly origin still had an unexpired accepted forecast. Inference now uses the latest complete causal origin within the existing three-hour freshness limit, only when that horizon’s valid time remains in the future. It neither fills missing rainfall nor resets the original horizon. Input, issue and valid times remain explicit. Expired earlier origins cannot become new ML forecasts.

## 2. Warning-probability cause, before and after

Initially the frozen-policy validation blocks contained 24 selection, one calibration and two decision-threshold events. The existing minimum is two events and both label classes per block: calibration was short by at least one usable event, threshold selection had no event-count deficit. Those counts alone never guaranteed acceptance or storm reliability.

The official Geum public archive was independently reconciled in full: 175 unique bulletins, annual numbering 1–116 (2024), 1–38 (2025) and 1–21 (2026 as published at retrieval). All 230 typed station notices were checked against station identities and existing typed records. Two stations outside the app catalog were independently matched to official station metadata; their archive records were not presented as monitored app stations. Issuance time uses ANCDT, not forecast arrival/reach time RCHDT. Cancellation anchors, full pagination, numbering and bidirectional event matching support 39 office-specific complete intervals. Completeness is restricted to that published issuing-office archive; unpublished periods and unrelated basins remain unknown.

The resulting dataset has 647 historical notices, 395 issuance records, 79 complete intervals, 1,081,182 usable samples and 165 usable labelled station events (91 training, 53 validation, 21 retrospective test). Selection/calibration/threshold blocks now contain 37/13/3 events. Event minima are met. The selected Gradient Boosting warning model nevertheless failed: precision **0.0187602**, required **≥0.2**; Brier **0.000153187**, worse than climatology **0.000149084**. Event detection recall **0.904762** passes the ≥0.8 requirement. The actual outcome is `INDEPENDENT_TEST_ACCEPTANCE_FAILED`; probability is null/disabled.

## 3. Eligible stations before and after

All 789 catalog stations were diagnosed. Evaluated level artifacts increased from **530 to 772**. The repair checked 253 blocked stations and added **2,187,886 independently retrieved hourly rows** to derived history. It uses bounded ≤90-day official requests, two attempts, station/timestamp deduplication, response-record hashes, retrieval metadata, resumable checkpoints and verified-day skipping. It preserves authentic gaps and original water rows.

Geum matching-history collection separately added 600,755 authentic raw water rows and 467,113 provider-specific rainfall rows. Derived reconciliation rows can overlap existing raw readings; these storage additions must not be summed as independent new measurements or storm events. Empty rain responses remain missing. Optional rainfall does not block an independently evaluated observation-only model.

Three jobs recorded two ValueError failures and one MemoryError during execution. All three passed when retried individually under the same policy; the underlying ValueError could not be reproduced. A single individual retry for execution failures is now available in the bounded pipeline, without retrying rejected accuracy outcomes. No execution failures remain in the final station manifest.

## 4. Genuine live readiness

At **2026-11-08 19:21 KST**, the live API returned outputs for **772 stations**, including explicitly labelled baselines. **22 stations** were actually serving accepted advanced horizons: **12 one-hour, 15 three-hour and 14 six-hour** forecasts (41 live accepted horizons). **750 stations** were baseline-only at that snapshot. Separately, **49 advanced station–horizon artifacts across 27 stations** passed retrospective acceptance; live availability depends on current features and expiry and can change.

The old UI’s 530 “Ready” count included baselines, so it is not comparable to the new strict 22 accepted-model-station count. The comparable artifact-eligibility change is 530→772; accepted artifact horizons changed 8→49 and accepted-artifact stations 5→27. Total fitted candidate models are **5,411**, not 5,411 validated flood models.

Taehwa was verified in the live API and browser with actual accepted 1h/3h/6h predictions, their input and valid times, and measured performance. Previously blocked Gwangdong was also verified in React with actual numerical persistence outputs honestly labelled as baselines. Seven real station endpoints covered Taehwa, previously sample-blocked and coverage-blocked stations, and Yongdam’s reference hold. The frontend proxy returned HTTP 200. Current official-coverage counts intersect the monitored catalog and exclude duplicate or outside-catalog codes.

## 5. Accuracy versus persistence

The complete real-number comparison is in `availability-repair/results.html`; every evaluated station/horizon is in `performance.csv`, with model versions, samples and test periods. Taehwa’s unchanged accepted holdout results are:

- 1h Ridge: MAE 0.036994 m, RMSE 0.047460 m; persistence MAE 0.062327 m (40.65% MAE improvement), N=1,405.
- 3h ElasticNet: MAE 0.056185 m, RMSE 0.070829 m; persistence MAE 0.147969 m (62.03% improvement), N=1,403.
- 6h ElasticNet: MAE 0.060739 m, RMSE 0.075866 m; persistence MAE 0.211700 m (71.31% improvement), N=1,400.

Expanding station coverage changes network composition; a change in aggregate network error is not itself an accuracy improvement. Rejected candidates remain rejected, and an evaluated baseline is not called an accepted advanced model.

## 6. High-water performance and uncertainty

Taehwa rising-water holdout MAEs are 0.035351/0.046047/0.062707 m versus persistence 0.069512/0.143073/0.184488 m, with 205 samples across two separated temporal episodes. Training-decile high-water proxy errors are 0.038077/0.057076/0.062334 m versus 0.061943/0.144099/0.205731 m, with 705 samples in one episode. These are training-derived conditions, not official exceedance/flood labels. Heavy point rainfall had only three evaluated hours in one episode, insufficient to certify flood-event reliability.

No interval gate changed. Taehwa 1h nominal-90% interval coverage remains 84.9822%, below the 85% minimum, so it is withheld. The 3h/6h empirical checks achieved 87.7406%/91.4286%; future coverage is not guaranteed. Baseline fallback/non-hourly cadence intervals remain withheld. Existing leakage tests, backward-only features, chronological partitions, 78-hour level purge, train-only transformations and independent final acceptance remain intact.

## 7. New verified warning evidence

**154 additional typed notices**, including **88 previously unstored station issuances**, were verified from the official Geum archive; 84 additional usable labelled station events entered the expanded model dataset. Station issuances are not independent storms. New notices fall in five 72-hour-separated temporal proxy groups, three without previously stored issuances, but these are not externally certified storm labels. See `warning-expansion.json` for exact dates/counts and qualifications.

No partial archive was promoted to nationwide negative coverage. Matching source failures, missing observations, rainfall geography and event-window requirements remain visible. The read-only 2025 event audit lists specific missing feature windows for each stored issuance, rather than assuming all 160 development-season records are eligible labels.

## 8. Requirements still unmet

Calibration events are 13/2 minimum and threshold-selection events 3/2: zero additional events are needed merely to meet those count gates. The current blockers are final-test precision and Brier performance. More data cannot be promised to make a model pass. Any model improvements must use development evidence; the inspected 2026 test cannot be tuned against and then relabelled as a fresh test. A genuinely new prospective evaluation period would be required for a new unseen claim. Small numbers of separated development storm proxies remain an important reliability limitation even where event-count gates pass.

The classifier and `warning_split_policy.json` match their pre-work hashes. The pre-2025/2025/2026 calendar policy, 72-hour purge, event minima, calibration and final acceptance rules are unchanged. Whole-source evidence expansion changed the algorithm’s derived validation cutpoints; this is explicitly versioned as `han-geum-reconciled-v1-20261108` in `evaluation-design-version.json`. The final test remains retrospective. No hyperparameters, thresholds or acceptance rules were adjusted after the failed test.

## 9. Are calibrated probabilities enabled?

**No.** The page now explains the failed accuracy checks instead of incorrectly continuing to report a calibration-event shortage. It publishes no unvalidated warning percentage. Official issued warnings, current stage comparisons, experimental level forecasts and warning-event probabilities remain distinct.

## 10. Changed files and actual verification

Paths below are relative to `D:\Capstone\WeatherForecasting`.

- `backend/repair-level-history.js`: bounded, checkpointed independent official reconciliation for blocked stations.
- `backend/collect-geum-warning-archive.js`: fresh full public-archive pagination, annual sequence checks and response evidence; cached pages cannot falsely refresh completeness.
- `backend/reconcile-geum-warning-archive.js`: typed notice/identity matching, natural-event deduplication, evidence and office-specific cancellation-anchored coverage. Adds only the nondestructive `ml_warning_archive_evidence` table.
- `backend/hrfco-warning-history.js`: an API replay cannot duplicate an already reconciled office issuance just because bulletin wording differs.
- `backend/advanced-ml-jobs.js`: periodic independently reconciled Geum refresh alongside existing national history sync.
- `backend/level-pipeline.js`: detect repaired dataset revisions, reuse compatible checkpoints, individually retry execution errors once and rebuild canonical manifests without forcing refits.
- `backend/level-availability.js`: consistent accepted-model/baseline/blocked statuses, exact warning evidence and accuracy gates, monitored-catalog coverage counts and recovery summary.
- `backend/advanced-ml-service.js`: shared live per-horizon statuses/counts, separate baseline totals, evidence and repair diagnostics.
- `backend/ml/level_predict.py`: latest complete causal unexpired hourly origin; preserves actual times and does not invent rain or features.
- `backend/ml/availability_diagnostics.py`: read-only full-station measured requirements, sample periods, gaps, provenance, rainfall and artifact checks; JSON and CSV.
- `backend/ml/warning_evidence_audit.py`: read-only per-event development input-window audit.
- `backend/run-availability-repair.js`: sequential evidence collection/evaluation orchestration used for this run.
- `backend/retry-level-execution.py`: diagnostic retry utility used for the three execution failures; no fitting-policy modification.
- `backend/tests/level-availability.test.js`, `backend/tests/geum-warning-archive.test.js`, `backend/tests/hrfco-warning-history.test.js`, `backend/tests/integration-availability-live.js`, `backend/ml/test_level_predict.py`: status counts, expiry, source typing/deduplication, calibration gates, seven real APIs and latest-origin regression checks.
- `frontend/src/pages/MLAdvanced.jsx`: actual forecasts, explicit input/valid times, accurate counts, compact evidence explanation, recovered-history summary and working result navigation.
- `frontend/src/lib/levelForecast.js`, `frontend/src/lib/mlAnalysisState.js`, `frontend/tests/level-forecast.test.mjs`: consistent readiness and failed-validation explanations/tests.
- `docs/ML_AVAILABILITY_REPAIR_REPORT.md`, `docs/availability-repair/*`: this report, real-number HTML/CSV comparisons, full diagnostics and screenshots. Canonical model manifests/artifacts and source evidence were generated; previous warning records and older model versions were retained.

Final executed regressions: **313 backend tests passed**, **30 Python tests passed**, **34 frontend tests passed**; ESLint and production build passed. This is an increase from the previous 304/28/33 suite, not a claim that the suites are unchanged. The build still reports the existing large map chunk warning. Seven live selected-station API checks, dynamic count consistency, null unvalidated probabilities, unchanged classifier/split hashes and the Vite proxy passed. Browser verification confirmed Taehwa’s actual accepted forecasts and Gwangdong’s recovered baseline outputs. Forecast insertion remains duplicate-safe and prior integration proof is retained.

## 11. Remaining limitations and operation

Seventeen stations remain withheld: six reference/measurement holds, six constant-reading reviews, four insufficient provenanced chronological samples and one inadequate recent provenanced coverage. No arbitrary elevation offset, invented threshold, fabricated rain, interpolated continuous sequence or forced reassuring category was introduced. Yongdam’s original reading/reference hold remains intact. Historical datum epochs and relocations, catchment rainfall and original observation-arrival vintages remain unavailable. Authentic point rainfall is not a basin rainfall field.

Accepted level models support retrospective research, baselines are demonstrations, and flood-warning probabilities failed validation. This does not establish operational flood safety or replace official instructions. Live readiness changes with authentic source publication, missing inputs and forecast expiry.

The development frontend remains `http://localhost:5173/ml`, backed by port 5001. Keep the backend running for ingestion and scheduled inference. `npm run ml:levels:refresh` serves new predictions from saved artifacts; repaired data revisions trigger bounded fitting. `node level-pipeline.js --rebuild` rebuilds from checkpoints without forcing compatible fits. `npm run ml:levels:train` forces retraining and should not be confused with a page refresh. No email alerts were sent. No private environment file or database dump is included in the source download; configure credentials separately and preserve a private database backup.

Official archive reference: https://www.geumriver.go.kr/html/flood/present.jsp . Machine evidence includes the public data endpoint, fetched pages, normalized response hash, station matching and scope qualifications.
