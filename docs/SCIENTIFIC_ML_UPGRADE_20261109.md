# Rivora scientific ML improvement report — 9 November 2026

Implemented in the existing project; the ML Analysis system, design, existing API contracts and accepted artifacts were preserved. This report separates live operational restoration from new development-only experiments. No new candidate was promoted using the inspected final test.

## 1. Practical repair and before/after availability

Verification snapshots, not permanent hardcoded totals:

- Monitored gauges: 789 before / 789 after.
- Usable accepted advanced-model stations: 22 before / 27 after.
- Usable accepted station-horizons: 41 before / 49 after. The dashboard's original 49 was the trained accepted total, not the 41 usable horizons in its live snapshot.
- Stations with any forecast: 769 before / 769 after.
- Persistence-only stations: 747 before / 742 after.
- Live accepted horizons by lead: 1h 12→16, 3h 15→17, 6h 14→16.
- Official-warning probabilities: disabled before / disabled after.

These counts can fall temporarily when a valid time expires, an observation ages or a source has not published a new hour. They are not guarantees of constant future availability. The browser verified the 27-station snapshot and separately verified an expired 1h forecast being withheld while the 3h and 6h outlook remained available.

The immediate limitation was not that only 22 models had passed training. The frozen training report contains 27 accepted-model stations and 49 accepted horizons. Eight accepted horizons at six stations were using correctly labelled persistence fallbacks because rainfall features were missing. Five of those stations had no remaining usable advanced horizon, explaining 27 trained versus 22 live.

Verified implementation gap: accepted rainfall-dependent models use rain_48 and rain_72, but the recent-rain helper queried/repaired only about 30 hours and stopped after 24 complete hours. It could therefore leave an accepted model unable to compute its actual feature schema.

Repair:
- Extend the helper with an explicit bounded 72-hour option while retaining the 24-hour default used by existing warning callers.
- Select only accepted rainfall-dependent models with real runtime feature gaps.
- Require the same HRFCO rain-gauge code and the original <=25 km distance bound. Never silently replace a KMA or HRFCO training source.
- Retrieve authentic HRFCO hourly observations with the existing configured key, including genuine zero values. Retain INSERT IGNORE and source provenance.
- Run inference from the existing frozen artifacts; do not retrain or lower acceptance.
- Integrate this bounded repair before the existing scheduled inference job, outside HTTP handlers.

Affected station codes / internal IDs:
- 1018697 / 1696: +1h.
- 1018675 / 2948: +6h.
- 1101635 / 3002: +1h.
- 1101670 / 3003: +1h.
- 1018695 / 3076: +1h and +3h.
- 3012690 / 3109: +3h and +6h.

All six original rain links had 72/72 required hours after repair. See accepted-rain-coverage-after.json and runtime-advanced-fallbacks.json for codes, source gauges, original missing features and timestamps. No station links or model criteria changed.

For these eight restored horizons, their already-saved retrospective evaluations have mean persistence MAE 0.018813 m versus mean accepted-model MAE 0.014672 m (about 22% lower). These are original historical metrics, not newly measured future live accuracy. Full MAE/RMSE pairs are in restored-model-historical-skill.csv.

## 2. Why most stations still use persistence

A census covered all 789 stations and all reported horizons. Rejection counts are nonexclusive:
- NO_CANDIDATE_PASSED_DEVELOPMENT_GATES: 2142 horizons.
- CONSTANT_READING_REVIEW: 18 horizons.
- RESEARCH_HOLDOUT_MAE_GAIN_BELOW_5_PERCENT: 45 horizons.
- NO_POSITIVE_BLOCK_CONFIDENCE_BOUND: 124 horizons.
- REFERENCE_OR_MEASUREMENT_REVIEW_REQUIRED: 18 horizons.
- RESEARCH_HOLDOUT_RMSE_WORSE: 8 horizons.
- REGIME_DEGRADATION_HIGH_WATER_PROXY: 7 horizons.
- REGIME_DEGRADATION_RISING: 4 horizons.
- INSUFFICIENT_PROVENANCED_CHRONOLOGICAL_SAMPLES: 12 horizons.
- INSUFFICIENT_RECENT_PROVENANCED_COVERAGE: 3 horizons.

Most failures are genuine development performance/reliability checks, not missing training data: 2,142 horizons chose persistence because no candidate passed all development gates. Across candidate comparisons, 7,197 failed at least one rolling-origin MAE check, 5,967 failed the required selection MAE gain, and 4,384 had worse selection RMSE; candidates can fail several checks. Nineteen selection windows had exactly zero persistence error, making an honest 5% improvement impossible there. Ten candidate evaluations lacked two usable rolling folds.

The current acceptance system does NOT categorically reject every candidate with sparse high-water samples: regime gates apply when at least 40 relevant samples exist, and the tree candidate has an additional training-data/event prerequisite. Therefore sparse high-water evidence is a qualification and limits storm confidence, but must not be invented as the cause of every baseline-only station.

Seventeen stations have no evaluated artifact: six constant-reading reviews, six reference/measurement holds, four insufficient provenanced chronological histories and one insufficient recent coverage case. Three additional evaluated stations currently have constant-reading reviews (1010633, 1006630, 1101656). This accounts for the 20 without available forecasts at the verification snapshot. Constant readings are a review flag, not proof of a faulty instrument; do not replace them with invented variation.

## 3. Water-level accuracy experiments: 1h / 3h / 6h

Research only; existing models remain unchanged. The predeclared sample was the first 12 stations in ID order with at least 3,000 frozen training samples at all horizons. It was not selected by final-test results. Existing train/selection calendar ranges and the 78-hour purge were preserved. Hyperparameters were ranked using two expanding chronological folds strictly inside training, then assessed on the original selection period. The already-inspected final test was not scored for these candidates.

Compared fixed Ridge (alpha 5), fixed ElasticNet and existing squared-error histogram gradient boosting with persistence. New candidates added causal trend acceleration and variability-ratio features, a small Ridge/ElasticNet grid and a regularized absolute-error histogram-gradient-boosting variant. Non-convergent fits were rejected; numerical convergence requirements were not relaxed.

Mean station MAE in metres, on the SAME development selection windows (12 stations per horizon):
- +1h: persistence 0.027740; fixed Ridge 0.028613; fixed ElasticNet 0.028515; existing HGB 0.021312; new training-CV-selected candidate 0.028652.
- +3h: persistence 0.071906; fixed Ridge 0.063897; fixed ElasticNet 0.063728; existing HGB 0.051822; new training-CV-selected candidate 0.063170.
- +6h: persistence 0.113205; fixed Ridge 0.090004; fixed ElasticNet 0.089681; existing HGB 0.080334; new training-CV-selected candidate 0.089116.

Interpretation: new candidates slightly improve 3h/6h average error over fixed Ridge, but do not beat the existing HGB control in these selection windows. The new 1h aggregate is worse than persistence. This experiment does not justify replacing accepted models. Per-station and per-horizon MAE/RMSE, CV decisions, samples and periods are in level-development-comparison.csv and level-development-results.json. No claim of independent accuracy improvement or operational storm certification is made from these reused development windows.

The implemented accuracy benefit is restoration of already-accepted models with their correct authentic inputs, rather than forcing a new model through failed acceptance.

## 4. Warning-issuance failure: root-cause evidence

The saved independent evaluation is unchanged: 647 notices, 395 issuances, 79 complete intervals, 1,081,182 usable samples, and 91/53/21 station-events in frozen train/validation/2026 retrospective test partitions. Test precision 0.0187602 fails 0.20. Test Brier 0.0001531873 is worse than training-climatology Brier 0.0001490844. Event detection 90.48% passes 80%, but sample recall is 73.02%; these are different metrics.

The recorded confusion matrix contains 46 true positives, 2,406 false positives, 17 false negatives and 422,796 true negatives. There were 839 false-alarm episodes and two missed station-events. A high event recall cannot compensate for very low precision.

Verified contributors/limitations:
- Extreme class rarity and season/distribution shift: training positive fraction 0.11297%, retrospective test fraction 0.01481%, around 7.6 times lower.
- The existing threshold search emphasizes recall and can retain far too many false alarms; the final precision/Brier gates correctly reject it. Those gates were preserved.
- Calibration has 13 station-events across two storm groups; threshold selection has only three station-events in one storm group. Minimum counts are satisfied but diversity is weak.
- Nearby rainfall links are point gauges, not verified upstream/catchment rainfall. No official catchment weighting, upstream topology, travel times or dam-release signal is established in the current feature pipeline. Wet conditions and rising levels do not imply an authority will issue a new warning within three hours.
- Historical datum/relocation epochs are unavailable. Pooling absolute stage levels across gauges may encode incompatible references. A feature candidate excluding absolute level was tested, without claiming to isolate a single causal mechanism.
- 21,110 raw water rows lacked source URLs in audited pre-2026 coverage windows. No numeric conflicts were found where raw rows overlapped independent reconciliation history. Missing provenance is a quality gap, not proof that readings are fabricated or the sole cause of failure.

Labels were inspected: the target is a NEW official advisory/warning issuance in (t,t+3h], not physical inundation. Unknown coverage must remain unknown rather than a negative. Ongoing warnings are treated separately. Features use backward alignment, past differences and complete rolling rainfall windows. The 72-hour storm purge, frozen partitions and existing minimum events remain intact.

New development-only warning experiment:
- Uses rows strictly before 2026, with the saved 2025 selection/calibration/threshold boundaries.
- Uses only official-URL water records plus independently reconciled history; source records are not overwritten. 21,110 unprovenanced raw rows were excluded from this experiment. Training/selection/calibration counts remain 220,411/239,130/43,788; threshold samples become 129,359 with three events.
- Adds observed rainfall growth/intensity, positive-rise × rainfall interaction and rise acceleration; does not invent upstream data or import current thresholds into historical labels.
- Fits original HGB, hydrological HGB and regularized logistic regression, with disjoint sigmoid calibration. Candidate rules are saved before fitting. No new final-test predictions or deployment artifacts are written.

Provenance-controlled results:
- Existing HGB: selection AP 0.358369; threshold-block AP 0.061320; Brier 0.0000716318; qualifying precision/event-recall threshold: none.
- Hydrological HGB: selection AP 0.371432; threshold-block AP 0.072824; Brier 0.0000685891; qualifying precision/event-recall threshold: none.
- Hydrological logistic: selection AP 0.339840; threshold-block AP 0.065835; Brier 0.0000685871; qualifying precision/event-recall threshold: none.

Threshold-block climatology Brier: 0.0000706929. Hydrological HGB improves development ranking and Brier versus the same-input existing HGB control and beats this development climatology. Nevertheless, no candidate has a threshold satisfying both precision >=20% and event detection >=80%.

At the previously frozen diagnostic threshold (not a newly accepted operating point), the provenance-controlled existing HGB had 558 false-positive samples and eight true positives; hydrological HGB had 509 and eight. Of those false positives, 122 versus 68 had nonpositive one-hour rise. Both HGB variants' false positives had at least 1 mm prior-six-hour point rainfall in this block. This supports a wet-weather false-alarm problem, not the simplistic claim that every false positive was caused by missing rain. The candidate combines several feature changes; individual causal effects are not established.

The original failed 2026 evaluation remains retrospective evidence and was not used for tuning these candidates. New experiments remain development-only. Warning probabilities remain unavailable. An untouched future evaluation meeting all existing criteria is still necessary; no deadline or guaranteed model success is claimed.

## 5. Experimental forecast-threshold-crossing outlook

Repaired the existing outlook, independently of the warning classifier:
- Require verified published thresholds AND canonical measurement compatibility; reject wrong evidence identity, missing/reversed levels and existing measurement holds.
- Null/blank is not zero. Genuine zero forecasts remain valid.
- No available forecast now returns NOT_ASSESSED instead of NORMAL.
- Validate station identity, supported horizons, input freshness and future valid time.
- Use accepted advanced forecasts or explicitly evaluated persistence. Persistence may have missing UNUSED rainfall features; that does not make it an advanced model.
- Use only explicitly coverage-checked and ordered uncertainty bounds; no inferred probability.
- Expose severe-stage comparison when the canonical verified stage scheme supplies it.
- Disclose partial horizons and missing coverage. The browser confirmed expired +1h being withheld while +3h/+6h remained available.

All 783 existing reference certificates have scope EXACT_OFFICIAL_OBSERVATION. The outlook therefore explicitly states that it verifies the current observation/reference and conditionally assumes the forecast remains in the same gauge reference. It does not claim historical datum validity, independently established crossing-event skill, an issued warning, flood probability or inundation boundaries. Historical crossing backtests were not manufactured using current thresholds; effective-dated historical threshold/datum records are required first.

Live integration verified an assessed experimental outlook at Taehwa 207, assessed restored-model output at 3002, and NOT_ASSESSED at Yongdam 3009. Warning probabilities remained null for all three.

## 6. Frontend distinction

The existing layout/CSS remains. The shared failure notice now explicitly says “Network-wide warning classifier failed independent evaluation” and explains that station water-level models and persistence are separate. Removed repeated “Failed validation” cells from every station row. The availability table now focuses on station/horizon forecast availability. Experimental stage comparisons disclose current-reference assumptions, baseline use, unverified intervals and partial horizons.

The browser verified the failure notice alongside 27 accepted-model stations / 769 available forecasts, without hiding the failed classifier. Evidence screenshots are saved with the handoff.

## 7. Data needed and approval status

See docs/SCIENTIFIC_DATA_REQUESTS_20261109.md and CSV manifests in backend/reports/scientific-upgrade-20261109/:
- authentic-data-gaps.csv: 134 exact contiguous missing windows, across 77 existing pre-2026 complete-coverage intervals and 71 stations. These are feature gaps inside known intervals, not fabricated new warning coverage. The interval-wise missing-rain tally is 587,134 hours; overlapping intervals can overlap requests. Gap rows include official station/rain IDs and dates.
- level-data-prerequisites.csv: 17 station-specific exclusions, exact stored endpoints and requested history/review ranges. Instrument review is distinct from obtaining missing data.
- datum-threshold-history-requests.csv: all 789 stations, their stored-history ranges and the required effective-dated datum/relocation/threshold history.

Recent HRFCO access worked using the existing key, so no additional approval was needed for the six current 72-hour repairs. Historical bulk/archive coverage and ledger exports are separate requirements; their availability/approval is not assumed. KMA historical AWS fallback requires the specific API Hub product permission, not merely any existing weather key. A current public reference-page request timed out during this audit; this does not establish that an archive does or does not exist.

## 8. Tests, preservation and limitations

Actual executions:
- Backend npm test: 359 passed, 0 failed.
- Python unittest discovery: 35 passed, including five new research/gap safeguards and existing level-inference tests.
- Frontend npm test: 41 passed, 0 failed.
- Frontend lint: passed.
- Frontend production build: passed; pre-existing large lazy MapLibre chunk warning remains.
- Real HRFCO retrieval and MySQL 72/72-hour checks for six linked gauges: passed.
- Actual inference from frozen artifacts: completed; 769 stations have forecast outputs.
- Real overview/detail API integration and browser presentation: verified.

Two old outlook test fixtures initially failed because they assumed comparison without verified metadata/timestamps. They were updated to supply explicit verified fixtures and fixed forecast times. Safety behavior was not weakened to satisfy them. An initial new research fit failed numerical convergence; non-convergent candidates are now excluded before selection. An initial unused frontend import was corrected and lint/build rerun.

All 772 deployed artifact checksums match their training registry. The protected level research engine/policy, warning engine/split policy, training report and saved failed warning evaluation hashes are unchanged. No new candidate was deployed; no historical warning record was changed by these experiments. Normal inference legitimately refreshed the live forecast report and current prediction persistence.

Remaining: warning precision and independent acceptance still fail; level candidate improvements have only development evidence; historical datum/threshold epochs, real catchment/upstream drivers and broader warning-event diversity remain unavailable. The recent-rain repair resolves a technical input gap, not those scientific limitations.

## 9. Files changed or added

Production changes:
- backend/hrfco-feature-history.js: explicit bounded 72h repair/read window, separate repair-cache key per window length, preserved 24h default and authentic-zero handling.
- backend/accepted-rain-repair.js: same-source repair for accepted rainfall-dependent models with real runtime gaps.
- backend/advanced-ml-jobs.js: schedule that repair before existing inference; no HTTP-triggered training.
- backend/flood-stage-outlook.js: verification, missing-value, identity, freshness, severe/partial-horizon and uncertainty safeguards.
- backend/risk-engine.js: expose the already-verified severe stage as an additive field; comparisons unchanged.
- backend/advanced-ml-service.js: additive network-wide warning-model scope.
- frontend/src/pages/MLAdvanced.jsx, frontend/src/lib/mlAnalysisState.js: shared-versus-station scope and conditional outlook presentation; existing design preserved.

Research/audit:
- backend/ml/level_development_upgrade.py: frozen-development Ridge/ElasticNet/HGB comparison, no final-test scoring or deployment.
- backend/ml/warning_hydrology_research.py: pre-2026 hydrological-feature/control experiment and diagnostics.
- backend/ml/warning_development_research.py: optional provenance-controlled dataset builder; legacy default preserved.
- backend/ml/scientific_data_audit.py: read-only source/coverage audit and exact missing-window manifests.

Tests:
- backend/tests/flood-stage-outlook.test.js, accepted-rain-repair.test.js, rainfall-repair.test.js.
- backend/tests/advanced-ml.test.js: verified/timestamped outlook fixtures.
- backend/ml/test_scientific_upgrade.py.
- frontend/tests/mlAnalysisState.test.mjs.

Evidence and documentation:
- backend/reports/scientific-upgrade-20261109/*.
- docs/SCIENTIFIC_ML_UPGRADE_20261109.md, docs/SCIENTIFIC_DATA_REQUESTS_20261109.md.
- validation/scientific-upgrade-20261109/*.
