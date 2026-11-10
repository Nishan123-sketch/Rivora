# Rivora targeted ML validation and dashboard repair

Completed 9 November 2026. Existing application, APIs and model artifacts retained. Evidence directory: `backend/reports/targeted-ml-repair-20261109/`.

## 1. Verified causes

The published warning failure is genuine, not a stale React status. Saved production evaluation, MySQL model record and API agree on `warning-v1-20261108T070103`, evaluated 2026-11-08T07:01:03.407450Z. Precision is approximately 1.88% against 20%; event recall approximately 90.5% against 80%; Brier 0.0001532 is worse than frozen baseline 0.0001491. Calibration and threshold event counts alone cannot override these failures. No warning probability is enabled.

Training previously admitted positive origins outside live new-issuance eligibility: 192 UNKNOWN and 28 ADVISORY samples. This is a real scope defect. The shared confirmed-NONE filter now applies before splitting, including direct classifier-training calls. Unknown coverage cannot become a negative label. Explicit legacy scope-audit mode remains diagnostic only.

The changing 25–27 accepted-station count conflated live advanced forecast availability with saved acceptance. The manifest actually contains 27 accepted stations and 49 accepted station-horizon models. Live observation completeness, horizon expiry and caching explain changes in active forecasts; they do not revoke or create saved acceptance.

An overnight interruption also left six missing Taehwa hourly water observations. Inference publication recorded a Windows PermissionError replacing its JSON report. The lock owner is unproven. Unique temporary files, bounded sharing-error retries and preservation of the prior report now protect publication. Frozen level research/training engine hashes were preserved. A complete but expired advanced origin can use an explicitly labeled, saved evaluated persistence baseline when a fresh genuine observation is available.

## 2. Consistency and leakage checks

The target is a new official issuance at an origin with confirmed NONE status, not physical inundation or an ongoing advisory. Existing official coverage intervals and event labels remain authoritative. Origin-time calendar features use KST and no future observations. Station-relative features use training-only statistics. Missing/nonfinite observations are excluded, never filled with zero. No geographic-nearest relation is treated as upstream topology. No current flood threshold is retrospectively backfilled as a historical feature.

Independent evidence gates now also protect serving: a purported validated flag cannot enable probabilities when precision, recall, Brier, event or calibration evidence fails. Regression tests cover this case.

## 3. New development hypothesis and results

The previous six failed experiments were not repeated as a new search. A paired ablation tested one distinct hypothesis: known seasonal and KST issuance-hour cycles might improve rare-event discrimination. The control was the previous best balanced station-context HGB, with identical settings; the candidate added four cyclic calendar features. Reports preserve design and input fingerprints. Only pre-2026 training and existing disjoint development blocks were read. No final-test predictions were read and no deployment occurred.

Before recovery, selection average precision was 0.178642 for control versus 0.140540 for calendar; decision Brier was 0.0000737794 versus 0.0000675517. After genuine rainfall recovery, the same pair was remeasured: selection AP 0.183945 versus 0.109894, decision AP 0.022830 versus 0.058136, and Brier 0.0000763368 versus 0.0000693935. Neither run produced a qualified decision threshold meeting the unchanged precision and event-recall rules.

Calendar features improved a development Brier statistic but worsened the predefined selection discrimination metric. This is not evidence of independently improved accuracy. Neither candidate was promoted. False-alarm, missed-event, calibration and threshold evidence is retained in `calendar-after-recovery/warning-research-results.json`; lead-time success cannot be asserted for a candidate without an admissible decision threshold. Production warning evaluation remains unchanged.

## 4. Authentic data recovered and still needed

Only two bounded eligible-event rainfall windows were requested. HRFCO gauge 10224020 supplied 26 genuine missing hourly observations for 2025-08-12 13:00 through 2025-08-13 14:00 KST. Gauge 10144170 supplied no recoverable observations for the requested 2022 storm window; that gap remains. Existing rows were preserved with insert-ignore semantics. Retrieval receipts and hashes are in `event-rain-recovery.json`.

Official HRFCO Taehwa gauge 2201670 supplied six missing recent hourly water observations; existing records were preserved. See `taehwa-water-recovery.json`. Total targeted additions in this repair: 26 rainfall and six water records.

The eligible-event audit changed from 59 reconstructable and 11 feature-incomplete events to 60 and 10 respectively; 282 event origins remain outside runtime scope. This is an event-origin audit, not the sample counts used by model fitting. The final broad audit retains 99 contiguous windows and 102,063 missing point-rain hours. Recovering observations can split windows and increase their count.

`eligible-warning-data-requests.csv` gives every remaining priority event, river gauge, original rainfall gauge, exact KST dates, provider, dataset, official URL, tested access and required action. Request the original hourly observations with QC/missing flags and instrument operating history. A blank response is not dry weather. The final full-gap inventory is under `final-observation-gaps/`.

Historical KMA AWS access was confirmed using the existing key in the preceding November 9 continuation, so new authorization is not presently demonstrated necessary. Exact product, endpoint, QC interpretation and permission instructions if access is later denied are in `docs/ML_OFFICIAL_DATA_REQUIREMENTS_20261109.md`. KMA alternative point gauges cannot be relabeled as recovered HRFCO instruments. The 2023 official Han archive still lacks bulletin numbers 7, 9 and 14; it remains excluded from complete negative coverage. See `backend/reports/official-warning-year-2023-unavailable.json`.

Verified upstream/catchment/dam context cannot currently be reconstructed. Required official holdings are WAMIS water-resource unit catchment polygons and gauge/basin crosswalks; RIMGIS directed reach connectivity and official gauge-to-reach associations; responsible flood-office routing/travel-time evidence; K-water historical releases, gate operations and their actual availability timestamps. Obtain versions, effective dates, CRS, original identities and QC. Exact official source links and fields are in `docs/ML_OFFICIAL_DATA_REQUIREMENTS_20261109.md`. Point rainfall, shared river names and flow-rate columns do not establish catchment rainfall, upstream direction or dam releases.

## 5. Level-model preservation

The saved-evidence audit checked 772 artifact files and all 49 accepted horizons across 27 stations: zero acceptance-evidence problems. It checks the existing MAE improvement, RMSE non-degradation, rising/high-water MAE, bootstrap evidence and no test-based selection rules. There are 2,267 saved evaluated baseline horizons. This is an artifact/evidence audit, not a fresh independent level-validation experiment or a claim that every saved horizon is currently live. Full per-horizon MAE/RMSE and persistence comparisons are in `all-level-evidence-audit.json`.

The earlier 12-station scientific continuation remains the development baseline; no candidate from this repair replaced an accepted model or a better persistence baseline. Authentic extremes were retained. The warning failure does not disable level forecasts. Live integration checked Taehwa's 1h/3h/6h availability and representative baseline/unavailable/reference-held stations.

## 6. Count and presentation repair

The existing React page now contains the shared **Experimental Official Warning-Issuance Model** section with version, status, precision/minimum, event recall/minimum, Brier/baseline, evaluation timestamp and explicit disabled reasons. Station rows say **Network model not validated**. Station input completeness is separate from shared scientific acceptance. All text is English and existing Rivora styles/layout components are used.

One overview snapshot captures source timestamps and catalog consistently. At API verification 2026-11-09T00:06:13.777Z: 789 gauges; 27 accepted stations; 49 accepted horizons; two stations with three active advanced horizons; 770 baseline-only stations; 772 forecast outputs; 17 unavailable; 65 with live official coverage; zero validated warning models. Thus 2 + 770 = 772 and 772 + 17 = 789. Live counts naturally change as observations age. Shared validated warning models are counted once, separately from eligible station forecasts. Counts are computed, not hardcoded. API integration records snapshot provenance and manifest agreement.

## 7. Independent validation and blockers

The already inspected 2026 warning final test was not reused for tuning or rescoring. No development candidate qualifies for independent promotion. A prospectively registered earliest future start of November 10 is only a plan: it requires a qualified frozen candidate, complete official coverage, sufficient independent storms/events, disjoint calibration/threshold evidence and unchanged acceptance gates. No automatic future evaluation is claimed to be running. More historical incomplete data cannot create an untouched test retrospectively.

Remaining blockers are insufficient qualified warning discrimination, absent verified upstream/catchment/release mappings, ten eligible feature-incomplete event windows, missing official bulletin evidence and an untouched independent period with adequate events. No warning-model success is claimed.

## 8. Files changed in this targeted repair

Backend: `level-availability.js`, `advanced-ml-service.js`, `advanced-ml-routes.js`, `atomic-json-file.js`, `level-pipeline.js`; Python: `ml/advanced_warning.py`, `ml/warning_hydrology_research.py`, `ml/atomic_json.py`, `ml/level_predict.py`; scripts: `scripts/audit-targeted-ml.py`, `scripts/recover-eligible-warning-rain.js`, `scripts/repair-taehwa-recent-water.js`; tests: `tests/level-availability.test.js`, `tests/live-warning-inputs.test.js`, `tests/atomic-json-file.test.js`, `tests/integration-targeted-ml-live.js`, `ml/test_advanced_warning.py`, `ml/test_scientific_upgrade.py`, `ml/test_atomic_json.py`, `ml/test_level_predict.py`.

Frontend: `src/pages/MLAdvanced.jsx`, `src/lib/mlAnalysisState.js`, `tests/mlAnalysisState.test.mjs`. Evidence outputs: `backend/reports/targeted-ml-repair-20261109/`, this document, and `validation/targeted-ml-repair/dashboard.png`. The workspace contains unrelated earlier changes; this list is not a claim of ownership of the entire git diff. Production forecast/health JSON was regenerated by normal inference; accepted training artifacts and the published warning model were not replaced.

## 9. Executed verification

- Python: 52 tests passed.
- Frontend: 44 module tests plus seven existing JavaScript tests passed; full ESLint and production Vite build passed. Existing large map-chunk advisory remains.
- Live API/database/proxy integration passed: five representative stations, count identities, warning evidence agreement, recovered rainfall identity and Taehwa availability. JSON serialization comparisons allow 1e-12 numeric round-trip tolerance, not relaxed scientific gates. Vite proxy returned HTTP 200.
- Browser: refreshed existing ML Analysis, verified shared evidence and station labels, reconciled live counts, captured `validation/targeted-ml-repair/dashboard.png`.
- Backend: 375 tests passed, zero failures, in the socket-enabled full regression run. The first sandboxed attempt encountered EACCES on local test-server sockets and is not counted as a successful run.

Initial integration also exposed stale/gapped Taehwa input and floating-point database JSON serialization differences; both were investigated and corrected before the successful final integration. Successful frozen-artifact inference publication returned 772 available stations out of 789.
