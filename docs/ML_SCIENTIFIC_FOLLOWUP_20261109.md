# Rivora scientific follow-up — 9 November 2026

Continued the existing ML Analysis implementation using the November 9 continuation as the baseline. Recovered authentic rainfall, extended the existing development runner with robust and constrained candidates, and reran warning research. Production forecasts, accepted model artifacts, APIs and React architecture were not replaced. All new model results are development-only.

Machine-readable evidence is under `backend/reports/scientific-followup-20261109/`. See `verification-summary.json` for paired metrics, observation verification and artifact integrity checks.

## Authentic rainfall recovery

Inspected all 58 rainfall-gap windows in the prior post-repair audit. None overlaps the frozen 12-station level-development cohort. Acquisition priorities therefore used existing accepted-model status, same-station official warning issuances, and the independently documented July 16–20, 2025 storm. The [KMA July climate report](https://www.kma.go.kr/kma/news/press.jsp?mode=view&num=1194509) documents that storm period. National storm timing is context, not evidence that every gauge flooded.

The existing `KMA_API_KEY` successfully accessed historical **AWS 시간통계 자료 조회 → 강수**, using `awsh.php?var=RN`. The earlier lack of separately named historical-key variables did not establish an authorization problem. One tested July 2025 hour returned a genuine station-matched record. Documentation and exact access/fallback instructions are in `ML_OFFICIAL_DATA_REQUIREMENTS_20261109.md`.

Recovered **147 genuine observations**:

- 120 HRFCO hourly records at rainfall gauge **10224020**, covering **2025-07-16 00:00 through 2025-07-20 23:00 KST**. This repairs the full five-day storm window within the audited gap associated with river gauge 1022648.
- 24 HRFCO hourly records at rainfall gauge **10184160** on **2024-10-13**, within a gap associated with accepted-model station 1018695. The remainder of that long gap is still missing.
- Three KMA AWS records: station **181** at **2025-07-17 12:00** (11.5 mm), station **181** at **2024-07-10 12:00** (observed 0.0 mm), and station **493** at **2024-07-10 12:00** (observed 0.0 mm).

The KMA rows remain under their original AWS identities and table. They were not relabeled as HRFCO observations or as upstream/catchment rainfall. These zero values were returned by the source; no missing rain was filled with zero. Collectors use INSERT IGNORE, retain existing observations, require matching hour/gauge and finite nonnegative rainfall, and preserve source URLs, retrieved records and hashes in the recovery reports.

Read back every recovered observation from MySQL: **147 matched, zero value mismatches**. The post-recovery audit finds **102,089 missing HRFCO rainfall hours**, down from 102,233. Its **98 contiguous data-gap windows** compare with 97 before recovery: inserting a day inside a long gap splits that gap into two windows. Window count alone is not a useful measure of recovery success.

Some prioritized gauges still returned no usable historical data, including 30114110, 31014070, 30084010, 30134030 and 30124120 on the tested dates. Two initial unavailable requests were retried through the official fallback; one succeeded. Unavailable records remain missing. Remaining exact gauge IDs/date ranges are in `after-recovery/authentic-data-gaps.csv`.

## Reproduction and level-model improvements

Reproduced all **36 station/horizon results** from the 12-station November 9 continuation. The maximum candidate MAE difference was **0.0 m**. A second reproduction with error-tail diagnostics and one BLAS thread also matched exactly. Training and selection dates/sample counts for the robust comparison match the frozen baseline. Each horizon has **11,712 selection pairs**.

The predefined level-selection window includes June–July 2026; it is already inspected development data. This is distinct from the warning classifier's frozen 2026 final test, which was excluded. No new model was selected or evaluated using a level final-test outcome.

Extended `backend/ml/level_development_upgrade.py`, rather than creating a separate ML engine. The frozen experiment includes:

- Huber regression with all genuine targets retained.
- Strongly constrained absolute-error and squared-error histogram gradient boosting: 3/7 leaves, learning rate 0.03, minimum 100 observations per leaf, L2 penalty 25, 100 iterations, no random early-stopping split.
- A half-strength absolute-error model blended with persistence.
- Softly weighted squared-error training, assigning positive weights to every row rather than deleting large genuine changes.
- Causal positive-rise accumulation, rise consistency, acceleration and variability features; rainfall growth and rise/rain interactions only for existing rain-capable schemas.

Predeclared candidate selection used two expanding training-only folds with a timestamp-based 78-hour embargo. A candidate needed nonworse MAE in each fold, at least 5% pooled CV MAE improvement, and nonworse pooled CV RMSE. The eligible candidate with minimum pooled CV RMSE was then assessed against existing development MAE, RMSE and rising/high-water MAE safeguards. Persistence was retained on failure. No second candidate was selected from the inspected selection outcomes.

**Paired pooled development results, metres:**

- **3h:** November 9 candidate MAE **0.063241 → 0.054694**; RMSE **0.241761 → 0.187795**. Improvements relative to that candidate are **13.5% MAE** and **22.3% RMSE**. Persistence MAE/RMSE was 0.071906/0.207790.
- **6h:** November 9 candidate MAE **0.088860 → 0.085099**; RMSE **0.341166 → 0.291260**. Improvements are **4.2% MAE** and **14.6% RMSE**. Persistence MAE/RMSE was 0.113205/0.306688.

The research result uses advanced candidates in **10 of 24** station/horizon comparisons and persistence in **14**. These are experimental development choices, not newly accepted production models. Because the rainfall recovery does not overlap this cohort, these level-metric changes must not be attributed to the recovered rainfall.

## Why MAE improved while RMSE worsened

The old experiment selected primarily on average absolute error. That can reward smaller errors on many quiet hours while a few large, directionally wrong predictions dominate squared error. The direct evidence is strongest at station **1023667**:

- Its baseline 3h worst inspected-selection error was **−4.262 m**; the 6h worst error was **−6.761 m** during the predefined July 21, 2026 level-selection period. Those are prediction errors, not evidence that an authentic observation should be removed.
- The largest 1% of its errors contributed **26.4% of 3h squared error** and **34.8% of 6h squared error**.
- Its 6h large-observed-change subgroup improved MAE (1.679 → 1.456 m) but worsened RMSE (1.875 → 2.173 m) against persistence. Median and average absolute error did not capture the full tail cost.

Error examples, training-derived extreme-change cutoffs and subgroup metrics are saved in `reproduction-tail/level-development-results.json`. No authentic extreme target was removed. The new RMSE-aware CV filter and constrained squared-error candidates address this failure mode, but the results do not identify one causal improvement independently of all other experimental changes.

## Rising-water and high-water limitations

Evaluated these conditions separately, using training-defined thresholds rather than official flood labels:

- **3h rising water:** candidate/persistence MAE **0.232579/0.256522 m**; RMSE **0.515483/0.486664 m**.
- **6h rising water:** MAE **0.303238/0.352356 m**; RMSE **0.723658/0.672154 m**.
- **3h high-water proxy:** MAE **0.093691/0.110014 m**; RMSE **0.273558/0.276338 m**.
- **6h high-water proxy:** MAE **0.147290/0.176695 m**; RMSE **0.426178/0.423025 m**.

Overall improvements therefore do **not** establish uniformly better high-impact forecasts. Rising-water RMSE remains worse at both horizons, and 6h high-water RMSE is slightly worse. This is a material reason to keep these results experimental and require an untouched evaluation. Do not use the inspected subgroups to claim independent accuracy or to silently switch methods per observation using future outcomes.

## Upstream context and warning research

Identified the required official sources: WAMIS water-resource unit maps and basin code tables; RIMGIS directed reach/river-plan evidence; HRFCO hydrological yearbook gauge metadata and event hydrographs; KMA integrated basin area-rainfall catalogue 15170840; and reach/operation-specific routing/travel-time evidence from the flood control offices/K-water. Required fields, historical availability concerns and exact official links are in `ML_OFFICIAL_DATA_REQUIREMENTS_20261109.md`.

No verified directed upstream gauge edge, gauge-to-basin weight mapping or reach-specific travel-time table was established from the currently supplied files. No upstream feature was fabricated from proximity. A catalogue entry or a basin polygon is not a verified mapping for a particular gauge. Upstream model improvement remains **not evaluated**.

Reran the existing warning-hydrology research after rainfall recovery, using pre-2026 data only. The selection block gained **89 usable samples and one existing official warning event** (239,150/37 → 239,239/38). That is restored feature eligibility for a documented event, not an invented new flood event.

On the same updated data, at the frozen diagnostic operating threshold:

- Existing HGB: **603 false-positive samples, 8 true positives, 1.309% precision**.
- Hydrological HGB: **479 false-positive samples, 8 true positives, 1.643% precision**; development Brier **0.00006777**, versus baseline **0.00007069**.
- Hydrological logistic: **123 false positives, 3 true positives, 2.381% precision**, with reduced detection.

Hydrological HGB reduced false-positive samples by **20.6%** versus Existing HGB in this same-data comparison, but remained far below 20% precision. Selection AP still marginally favored Existing HGB (0.357630 versus 0.356458), so threshold-block diagnostics do not authorize selecting Hydrological HGB. Every candidate had **no qualifying threshold** under the unchanged precision/recall requirements. The threshold block still contains only **three events and nine positive samples**.

Changes relative to the previous run are not a controlled causal estimate of rainfall recovery: usable sample/event support changed. None of these development comparisons is independent warning validation. The existing failed independent status, 20% precision floor, recall criteria and Brier acceptance rules remain unchanged. The already-inspected 2026 warning final test was not reused.

The first warning rerun failed because OpenBLAS could not allocate thread memory. It completed successfully with BLAS/OMP threads limited to one; the failed attempt is not counted as a successful evaluation.

## Integration, checks and files

SHA-256 verification confirms **1,344 protected artifact/policy/validation files unchanged**, including accepted level artifacts and existing warning validation. Existing Taehwa artifacts, monitoring, APIs and React ML Analysis were preserved. This is artifact integrity and regression evidence, not a fresh operational certification or deployment claim.

Actual executed tests:

- Backend `npm test`: **362 passed, zero failed**, with local HTTP test access allowed.
- Python `python -m unittest discover -s ml -p 'test_*.py' -v`: **43 passed, zero failed**. The 13 scientific-upgrade tests were rerun after the final tail-diagnostic addition and passed.
- Frontend `npm test`: **41 passed**, plus `node --test tests/*.test.js`: **7 passed**. The extra command covers the existing JavaScript test file omitted by the package's `.mjs` glob; **48 frontend tests passed in total**.
- Python compilation and Node syntax checks passed for the changed runners/collectors. Recovered-observation read-back had zero mismatches; protected-file verification had zero changes.

Implementation files changed or added in this follow-up:

- `backend/ml/level_development_upgrade.py`: robust development mode, persistence fallback checks, error-tail diagnostics and regime RMSE summaries.
- `backend/ml/test_scientific_upgrade.py`: causal hydrological features, RMSE-aware CV, high-water gate and extreme-target retention regressions.
- `backend/scripts/probe-scientific-archives.js`: historical AWS entitlement test using the actual existing key.
- `backend/scripts/recover-priority-rainfall.js`: bounded official-event/storm-prioritized recovery and provider-identity preservation.
- `backend/tests/priority-rainfall.test.js`: schema/identity/time/interval checks and missing-versus-zero regression tests.
- `backend/scripts/verify-scientific-followup.py`: repeatable read-only observation/artifact verification and paired summary.

Remaining requirements are authentic missing rainfall/operating history, verified directed upstream and basin mappings, travel-time/operations evidence, and a genuinely untouched evaluation. No new production model was promoted and no validated forecasting-accuracy gain is claimed.
