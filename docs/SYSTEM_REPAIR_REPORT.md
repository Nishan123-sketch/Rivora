# Rivora complete-system repair — 8 November 2026

Implemented directly in `D:/Capstone/WeatherForecasting`. Existing unrelated working-tree changes were preserved. This report covers the assistant, request performance, English presentation and warning-model development research. The calibrated warning probability is still unavailable for a scientifically valid reason; this repair does not claim the failed warning classifier became deployable.

## Assistant: verified failure and correction

The application was configured for llama.cpp/Qwen3 4B on port 11435. The failing step was local model initialization, not a broken React route or missing login. Actual CUDA logs show allocation failures at 99 GPU layers (2375.91 MiB) and 16 layers (1177.62 MiB). A CPU attempt with repacking also failed a 1,765,048,320-byte allocation under current memory pressure. The old UI flattened unavailable states into a persistent reconnecting label.

The working local configuration uses GPU layers 0, context 2048, `--no-repack`, batch 256, microbatch 64 and four CPU threads. The real model starts and answers. Only the two local model settings and performance-profiling flag were changed in the private environment; credentials were not changed or printed. The model files and llama.cpp installation remain local and are excluded from the delivery ZIP.

Status checks now have a 7-second deadline, one in-flight check, bounded exponential backoff with jitter, a five-attempt limit, hidden-page suspension and a manual retry. Permanent authentication/configuration/model failures stop automatic retries. A ready local status requires the model's actual health endpoint. Remote providers distinguish configuration evidence from a successful local health check; remote provider accounts were not tested.

Chat SSE headers open immediately and include a heartbeat while generation runs. The response remains buffered until the model answer passes the existing factual-response guard; this is a completed-answer SSE delivery, not incremental upstream token display. A 60-second model deadline and 70-second client deadline prevent an indefinite spinner. Duplicate sends/streams are guarded synchronously; stop, clear, unmount and replaced requests abort their own controller. Provider errors have explicit codes and retryability. The current question is never silently truncated: context budgeting drops oldest turns first or returns a useful context-limit error.

Actual local integration evidence (`assistant-live-integration.json`): guest model response, remembered conversation context, a database-grounded Taehwa reading, authenticated model response, saved/reloaded authenticated messages, and isolation against a second account all passed. Two synthetic `example.invalid` accounts were removed after testing; no existing user's chats were read or modified. Cross-account read, rename, delete and append all returned 404; guest access to private history returned 401. No emails were sent.

Measured guest response: SSE headers 55.8 ms, completed model answer 15.90 s under concurrent imports/tests. Context reply 7.77 s; authenticated reply 6.77 s; database-grounded reply 0.242 s. These are actual completed-answer timings, not a claimed speedup over a comparable prior successful model. CPU generation remains slower than a sufficiently provisioned GPU/cloud model.

A real model process stop was also tested: status moved from MODEL_STARTING to healthy in about 4.5 seconds through automatic backend launch. A subsequent real generated message completed successfully in 9.88 seconds (`assistant-real-restart.json`, `assistant-after-restart-message.json`). Browser React-to-Express messaging on localhost:5173 was observed completing with a model answer, and screenshot evidence is saved separately.

## Performance: measurements and limits

Six sequential requests per endpoint were run before and after, on the existing live MySQL database with background importers enabled. Each run mixes a first cold/cache-miss request with warm requests; with six samples the reported p95 is the maximum. These are local development observations, not a controlled production load test. Separate compact-map timings are not substituted for the original full-map contract.

API p50 / p95 in milliseconds, before → after:
- `/api/health`: 3.0 / 151.2 → 4.7 / 179.4.
- `/api/stations`: 7.1 / 13.7 → 12.4 / 87.7.
- `/api/weather/latest`: 3.5 / 22.5 → 6.3 / 48.2.
- `/api/water/latest`: 10.4 / 46.2 → 12.4 / 65.1.
- `/api/monitoring/stations`: 192.6 / 20266.4 → 262.1 / 5271.1.
- `/api/ml/overview`: 16.6 / 7717.9 → 43.7 / 2091.6.
- `/api/ml/stations/207`: 6.7 / 5020.4 → 11.2 / 487.3.
- `/api/map/rivers`: 225.0 / 278.9 → 284.8 / 308.5.
- `/api/risk-alerts`: 43.6 / 62.6 → 47.7 / 92.8.
- `/api/chat/status`: 4.8 / 11.9 → 7.4 / 10.1.

The largest improvements are cold monitoring (20.27 s → 5.27 s), ML overview (7.72 s → 2.09 s) and selected-station ML detail (5.02 s → 0.487 s). Some already-fast warm endpoints became slightly slower with compression and concurrent activity; no claim that every timing improved is made.

The first browser station-risk request previously timed out after 15.02 seconds; its next poll recovered at 60.78 seconds. After changes, the observed page had risk data at 0.828 seconds, with a 181 ms request. DOMContentLoaded 569.8 → 407.5 ms, load 597.4 → 466.5 ms, request count by risk-ready 65 → 58, transfer bytes by risk-ready 2,598,556 → 335,192. Browser caches were shared rather than cleared, so these are a reproduced failure/recovery and an observed repaired load, not a matched cold-start benchmark. JSON console evidence includes individual requests.

Identified bottlenecks and changes:

- Network risk assessment previously issued per-station forecast/history/threshold/link queries across 862 river gauges. Seven bulk source reads now feed the unchanged canonical evaluator. A read-only consistent transaction compared 16 assessment fields for seven actual stations, including Yongdam 3009; all matched the original single-station calculation. Yongdam remains unassessed.
- Correlated latest-reading/latest-forecast subqueries were replaced with grouped indexed maxima. Official-warning overlays fetch relevant events in one bulk query rather than one query per station.
- Added the non-destructive `idx_water_recent(observed_at,station_id,water_level)` index. EXPLAIN changed from a full scan estimated at 3,792,659 rows to a covering range scan estimated at 66,634 rows. Existing records and indexes were retained. The index is also declared in the re-runnable optimization script.
- HRFCO recent-rain repair no longer blocks a frontend ML-detail response. It is scheduled in the background; missing feature windows remain missing until authentic data arrives.
- Gzip JSON transfer preserves the complete response. The original monitoring payload remains about 4.65 MB decoded; it is compressed over the wire. Chat SSE is excluded from compression.
- The map UI requests the explicit compact map projection, retaining identity, coordinates, level, source observation time and risk display fields. The full API response remains available. Compact map is 318,048 decoded bytes / 35,115 compressed, versus the prior full-map payload of about 4.56 MB. Warm compact requests were 57–61 ms; its separate cache-miss request still took 4.81 s. Expensive cold summary/prediction retrieval remains a bottleneck.
- App pages load only their required root feeds. The assistant no longer requests unrelated weather/water lists. Risk subscriptions share one poller, page polling pauses when hidden, and existing page-level lazy loading remains intact. Source timestamps and all freshness gates are preserved.

Remaining resource limits: a 16 GB host had roughly 1.58 GB free in the before snapshot and 1.83 GB in the sampled after snapshot. Node RSS was 306.6 → 230.5 MB and heap used 170.9 → 84.4 MB; snapshots are at different points in live background work, not isolated causal memory benchmarks. MySQL buffer-pool data was 114.1 → 129.8 MB; after snapshot had 32 connections / 2 running, versus 25 / 4 before. Query timings include pool wait, not just database execution. No reliable separate database CPU measurement was collected. Background daily aggregation still took about 18.4 s; per-row rainfall imports and the full map/summary cold path remain candidates for later work. MapLibre remains a lazy-loaded 1.09 MB minified map chunk, triggering a build-size warning. No business logic was removed for speed.

## Warning ML: reproduced failure, development experiment and decision

Saved evaluation was reproduced from `advanced-warning-validation.json`, not retrained against the already-inspected 2026 test:

- 647 historical notices, 395 issuances, 79 complete coverage intervals, 1,081,182 usable samples, 165 usable station-events.
- Training / validation / retrospective testing: 91 / 53 / 21 station-events. Separate 2025 blocks: 37 model-selection, 13 calibration and 3 threshold events. Calibration and threshold event-count minima are satisfied, but only two calibration storm groups and one threshold storm group make the evidence narrow.
- Retrospective test confusion matrix: 422,796 true negatives, 2,406 false positives, 17 false negatives and 46 true positives. Precision 1.876%, sample recall 73.02%, event detection 90.48%, 839 false-alarm episodes, two missed warning events, median detected-event lead 150 minutes.
- Test Brier 0.0001531873 fails training-climatology Brier 0.0001490844. Precision fails the unchanged 20% requirement; event detection passes the unchanged 80% requirement. Final status remains INDEPENDENT_TEST_ACCEPTANCE_FAILED.

The verified statistical problem is rare-event discrimination/calibration under a substantial distribution change, plus a recall-focused threshold that permits too many false positives. Training prevalence was 0.11297%; retrospective test prevalence was 0.01481%, about 7.6 times lower. The saved selection average precision 0.3639 fell to retrospective test AP 0.0543 despite high ROC AUC. A reassuring ROC score does not solve low precision in an extremely rare target. Calibration overstates some probability bands. This is evidence of failure; it does not prove a particular physical cause.

The source pipeline was inspected: labels target a new official issuance in the next three hours, not inundation; unknown archive coverage is not assigned a negative; ongoing warnings are treated separately. Features use backward-only water alignment (15-minute tolerance), backward differences and complete rainfall windows. Large one-hour discontinuities are excluded; linked rain gauges are distance-limited. Frozen calendar partitions, storm grouping and the 72-hour purge remain unchanged. Source measurement-reference holds remain unchanged. The development audit records incomplete feature/label rows per station rather than filling gaps with zero.

A new research-only script explicitly reads feature and label rows strictly before 2026. It uses the saved 2025 chronological selection/calibration/threshold blocks and writes its design manifest before fitting. No 2026 predictions were used for model selection, calibration or threshold search. No deployable artifact or model-version record was written. Four candidates actually ran:
- Logistic unweighted: selection AP 0.348167; threshold-block AP 0.230676; calibrated Brier 0.0000642069; no threshold meeting both precision ≥0.2 and event detection ≥0.8.
- Logistic balanced: selection AP 0.270363; threshold-block AP 0.045587; calibrated Brier 0.0000646413; no threshold meeting both precision ≥0.2 and event detection ≥0.8.
- Existing gradient boosting: selection AP 0.375702; threshold-block AP 0.062342; calibrated Brier 0.0000676619; no threshold meeting both precision ≥0.2 and event detection ≥0.8.
- Datum-independent gradient boosting: selection AP 0.358958; threshold-block AP 0.074606; calibrated Brier 0.0000658346; no threshold meeting both precision ≥0.2 and event detection ≥0.8.

The threshold-block training-climatology Brier was 0.0000666790. Unweighted logistic regression improves that development Brier, but still has no qualifying precision/recall operating point. Gradient boosting ranks first by development selection AP; it still fails to yield a qualifying threshold. Removing absolute water level to reduce cross-datum dependence also did not solve the problem. Additional LightGBM/XGBoost dependencies were not added: the implemented histogram gradient boosting already evaluates that model family, and there was no development evidence justifying another complexity increase.

When no threshold qualifies, the research JSON's decision confusion matrix is the explicit withhold-all operating policy (threshold >1), not a useful model detection result. Its zero precision/recall/F1, zero alarms and three missed events must not be read as a measured approved deployment point. The probability-ranking AP/Brier metrics above remain informative. No candidate has an accepted operating threshold, so an operational lead time is unavailable. Calibration bins and all component metrics are in the research JSON.

Warning probability remains disabled. The inspected 2026 test is retrospective evidence and was not reused to accept a replacement. A substantially broader verified pre-2026 event/coverage and rainfall dataset, followed by frozen development selection and a genuinely untouched future evaluation, is still required. No promise that adding arbitrary records will fix accuracy is made.

Independently working 1h/3h/6h water-level forecasts were preserved. SHA-256 comparison against the previous delivered archive found all 772 level artifacts unchanged, as well as the warning evaluation artifact. The warning training source, split policy and level research engine hashes also match their protected baseline. No model acceptance criteria were reduced.

## English presentation and provenance

Central shared phrase data and backend/frontend display formatters now render bulletin titles such as `홍수예보 제 2025-37 호` as `Flood Forecast Bulletin No. 2025-37`. Original source records, Korean names, station/warning IDs and dates remain stored unchanged. Known names use the existing English mappings; other names use consistent romanization, which is not claimed to be an official translation.

Updated dynamic displays include ML bulletin/history titles, alert area/wind names, map labels/search, onboarding and preference dropdowns, assistant English defaults and relevant shared station/river components. Original Korean name fields remain available for provenance/search, and a browser search for `태화강` returned seven English-labelled Taehwa gauges with unchanged station IDs. English UI auditing observed no Hangul fragments on the loaded sampled overview, weather, station, history, river monitoring, alerts and ML screens. This is a sampled screen audit, not proof over every historical record or arbitrary external map tile. Map labels prefer English/Latin names and omit a label when none is supplied; original map data is not rewritten. User-authored chat text and source documents are deliberately retained in their original language.

## Verification actually executed

- Backend `npm test`: **326 passed, 0 failed** (prior baseline 313; 13 new targeted tests).
- Python `python -m unittest discover -s ml -p test_*.py -v`: **30 passed**, including warning split/label safeguards and water-level forecasting regressions.
- Frontend `npm test`: **39 passed, 0 failed** (prior baseline 34; five new targeted tests). An initial new-test import-path failure was fixed and the suite was rerun successfully.
- Frontend `npm run lint`: passed.
- Frontend `npm run build`: passed; known large lazy map chunk warning remains.
- Actual MySQL bulk/single assessment parity: 862 rows loaded, seven representative stations, 16 fields each matched in the same read-only consistent transaction.
- Actual guest/authenticated model, private persistence/isolation and model stop/restart tests: passed.
- HTTP SSE delayed-generation, timeout and permanent-provider-error tests: passed; frontend retry exhaustion, permanent errors, overlapping status requests and disposal tests: passed.
- JSON compressed/uncompressed response parity and compact-map identity/time preservation tests: passed.
- Browser message completion, improved station data load, English labels and original Korean river search: observed; proof logs/screenshots retained.

Detailed evidence is under `backend/reports/system-repair/`; test command output is in the delivery's `validation/system-repair/`. No external email, private account data or live warning probability was fabricated.

## File inventory for this repair

Backend connection and messaging:
- `backend/local-assistant.js`: bounded launch lifecycle, low-memory local launch options and explicit startup errors.
- `backend/chat-routes.js`: useful readiness/error evidence and retryability.
- `backend/chat-stream.js`: model context budgeting without current-question truncation.
- `backend/assistant-v2-routes.js`: deadlines, immediate SSE/heartbeat, structured provider failures and concurrency cleanup.
- `backend/assistant-core.js`: explicit English response mode while preserving legacy language behavior for other callers.

Backend performance:
- `backend/performance-metrics.js`, `backend/db.js`, `backend/server.js`: bounded sanitized request/query profiling and HTTP middleware.
- `backend/json-compression.js`: gzip JSON with negotiation, body parity and chat exclusion.
- `backend/risk-bulk.js`, `backend/risk-engine.js`: bulk inputs and indexed latest forecast joins; canonical evaluation unchanged.
- `backend/official-warning-priority.js`: bulk official event lookup, same warning precedence.
- `backend/ml-network-stages.js`: grouped latest observations, same datum/identity/stage evaluator.
- `backend/advanced-ml-service.js`: nonblocking authentic rain repair and original-name search fields.
- `backend/map-data.js`, `backend/monitoring-routes.js`: explicit compact map projection, preserving full default API.
- `backend/add-performance-indexes.js`: persist recent-water covering-index declaration.

English/shared:
- `shared/english-display.json`, `backend/display-names.js`, `frontend/src/lib/englishDisplay.js`: shared English phrases, bulletin ID handling and existing name/romanization reuse.

Frontend behavior:
- `frontend/src/App.jsx`, `frontend/src/lib/pageData.js`: page-specific root data requests, queued page-transition loading, hidden-page polling.
- `frontend/src/lib/clientPerformance.js`: opt-in `?profile=1` client timings without message contents.
- `frontend/src/lib/useRisk.js`: shared subscription poller and cleanup.
- `frontend/src/lib/assistantConnection.js`, `frontend/src/pages/AIAssistant.jsx`: bounded checks, truthful labels, explicit retry, duplicate-send protection and cancellation ownership.
- `frontend/src/pages/MLAdvanced.jsx`: English bulletins, original Korean matching, hidden-page polling.
- `frontend/src/pages/LiveMap.jsx`: compact feed, English/Latin map labels and original-name matching.
- `frontend/src/pages/Alerts.jsx`, `frontend/src/pages/AlertPreferences.jsx`, `frontend/src/components/StationOnboarding.jsx`, `frontend/src/components/RiverAiOutlookCard.jsx`: English dynamic fields/dropdowns.
- Existing consumers listed below now import the centralized English display facade rather than the old direct name helper; no layout redesign was included in this repair.
  - `frontend/src/components/RiverAiOutlookCard.jsx`
  - `frontend/src/components/Shared.jsx`
  - `frontend/src/components/StationOnboarding.jsx`
  - `frontend/src/pages/AIAssistant.jsx`
  - `frontend/src/pages/AlertPreferences.jsx`
  - `frontend/src/pages/Alerts.jsx`
  - `frontend/src/pages/Dashboard.jsx`
  - `frontend/src/pages/LiveMap.jsx`
  - `frontend/src/pages/MLAdvanced.jsx`
  - `frontend/src/pages/RiverMonitoring.jsx`
  - `frontend/src/pages/StationDetails.jsx`
  - `frontend/src/pages/Stations.jsx`
  - `frontend/src/pages/WeatherForecast.jsx`

Research, tests and reproducibility:
- `backend/ml/warning_development_research.py`: isolated development-only candidate comparison, no deployment writes.
- `backend/tests/system-repair.test.js`, `frontend/tests/system-repair.test.mjs`: new connection, timeout, context, language, polling, compression and map regression cases.
- `backend/profile-system.js`, `backend/test-system-live.js`, `backend/check-risk-bulk.js`: measured local integration/performance/parity checks. The live test creates and removes only its own synthetic accounts.
- `backend/reports/system-repair/*`, `docs/SYSTEM_REPAIR_REPORT.md`, `validation/system-repair/*`: actual measurements and reproducible evidence.

No destructive migration was used. No historical observation, official warning or existing user's conversation was deleted. The SQL index is already applied locally. The running backend uses port 5001; Vite remains localhost:5173 with its existing proxy configuration.
