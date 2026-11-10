# Rivora water-level reference audit — 7 November 2026

## A. Root cause

Yongdam Bridge, internal ID 3009 / official code 1022640, was classified Severe because `risk-engine.evaluate` compared 89.92 directly with the fourth published stage, 22.3. Its `reference_source` contained `WAMIS:1022640;DATUM:CONFIRMED;GDT:92.13;PRIMARY:SAME_ROW_STAGE_AND_THRESHOLDS`.

The importer treated a gauge-zero metadata value (`gdt`) or matching readings as sufficient datum confirmation. `stageEvidence` / `twoStageEvidence` trusted the resulting token. Neither a gauge-zero elevation nor two matching numbers independently establishes the reference and effective dates of both measurement and threshold fields. This was an unsupported compatibility assertion, not an arithmetic error.

**89.92 was not invented by the frontend.** Both independently fetched official services returned it. Its underlying hydrological validity and reference remain unresolved. The repair preserves the observation and abstains from classification; it does not subtract 92.13 or apply another guessed correction.

## B. Independent official verification

Evidence was retrieved on 2026-11-07 around 23:11 KST (14:11 UTC). Exact retrieval timestamps and raw responses are in `verification/Official_Water_Verification.json`.

- [WAMIS station metadata](http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_obsinfo?obscd=1022640&output=json): code 1022640, 포천시(용담교), river 한탄강 / Hantangang, `gdt: 92.13`. The English metadata name retains an older locality name; code and Korean station identity match.
- [WAMIS hourly observations](http://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_hrdata?obscd=1022640&startdt=20261107&output=json): latest returned record `ymdh: 2026110723`, `wl: 89.92`, meaning 7 November 2026 23:00 KST under the application's documented WAMIS hour-ending convention. Water-level display unit is metres. The JSON record does not independently document the vertical reference.
- [HRFCO water-level page](https://www.hrfco.go.kr/sumun/waterlevelList.do), JSON POST endpoint `/servlet/sumun/wlList.do`, requested `ymdhm=202611072300`: same code/name, `wl: 89.92`, `gdt: 92.13`, `seawl: 182.05`. The returned row's own timestamp is null; the requested timestamp must not be represented as an independently supplied timestamp. WAMIS provides the explicit hourly timestamp above.

The relationship 89.92 + 92.13 = 182.05 is visible in the response, but is not a substitute for authoritative field/reference documentation. In particular it does not establish that 89.92 is a sea-level elevation or that subtracting the gauge zero is valid. An older government-hosted annual statistics document lists this gauge and a 92.130 reference value, but historical metadata does not certify a 2026 observation/reference relationship. No conversion was applied.

Pipeline: `wamis-client.mapReadings` reads `wl`, applies numeric/missing-value parsing, maps `ymdh` to a KST wall-clock string, and performs no elevation conversion. `river-importer.importGauge` stores the number in `water_readings.water_level`; it now also stores the exact public WAMIS request URL for future imports. Official reconciliation can also insert the official list's `wl` without conversion. MySQL returned 89.920. `risk-engine.assessStation` supplies that number and the thresholds to `evaluate`; the frontend formats metres. Existing history and database values were not deleted or corrected by this audit.

## C. Threshold verification

The independently fetched HRFCO row for the same station code contains `attwl: 9.5`, `wrnwl: 13.7`, `almwl: 18`, `srswl: 22.3`, and `fstnyn: N`. Thus 13.7 and 18 are present in the official station-specific published fields. This is a published-threshold gauge, not a currently designated warning station according to that response. The application labels these Caution / Alert rather than claiming an issued advisory or warning.

**Direct comparability with the current `wl` has not been independently established.** An official field reference, applicable station datum/version, effective dates and any documented conversion are still required. Accordingly the UI shows **Not assessed**, retains 89.92 m and the published levels, explains the compatibility gap, and links to the threshold source.

## D. Targeted code changes

- `backend/measurement-compatibility.js` and `reference-data/measurement-reference-evidence.json`: separate independently reviewed compatibility from legacy importer tokens. Exact station identity, source, units, field reference and validity interval are required. The registry intentionally contains no fabricated entries.
- `risk-engine.evaluate`: preserves readings, freshness, trends and rainfall context, but blocks threshold classifications and score fallback where reference compatibility or published thresholds are unverified. `verified-risk-evidence.evaluate` applies the same guard; publication metadata verification is separate from stage compatibility.
- `advanced-ml-service.experimentalForStation`: incompatible inputs cannot reappear as an experimental flood grade. Existing level models, reports and forecast outputs remain intact; an experimental prediction is not an issued warning.
- `reconcile-official-network.js`, `import-official-yeongsan.js`: new metadata imports mark datum as requiring independent review rather than certifying it. Catalog eligibility remains separate from compatibility; stations are retained.
- `river-importer.importGauge`: records provenance for future WAMIS observations. It does not backfill guessed provenance into old rows.
- `gauge-risk-safety.measurementType`: English dam detection uses word boundaries, so “Yongdam Bridge” is not accidentally treated as a dam. Genuine dams remain excluded.
- `ml-network-stages.snapshot`: includes observation provenance in the bulk stage overview.
- `audit-measurement-references.js`: repeatable read-only audit of every catalog-eligible station, timestamps, mapping count, missing provenance, duplicates, large relative values and compatibility.
- `frontend/src/lib/stationCategory.js`, `pages/Stations.jsx`: exhaustive Low / Moderate / High (including Severe) / Not assessed categories, consistent counts and filtering; search does not change the coverage-wide totals. Threshold source and explanation remain visible.
- `RiskBadge.jsx`, `overviewRiskMetric.js`, `risk.js`: clear abstention, no misleading numeric stage index when assessment is withheld, explicit Severe colour if a supported classification exists later.

No schema migration, observation deletion, invented datum offset, credential disclosure or email delivery was performed.

## E. Network audit

At the audit snapshot (`backend/reports/measurement-reference-audit.json`):

- 789 catalog-eligible published-threshold stations audited; the UI's 381 rivers / 223 designated stations are local catalog counts, not certified national totals.
- 0 stations with independently verified observation-to-threshold compatibility.
- 789 flagged for reference review and 789 not assessed: Low 0 + Moderate 0 + High/Severe 0 + Not assessed 789 = All 789.
- 0 duplicate official station codes among stored river stations; 0 missing/ambiguous verified river links in the audited catalog. This checks database consistency, not independent re-certification of all river names.
- 93 latest readings lacked stored observation provenance; 1 lacked a usable observation; 0 were stale or future at that snapshot.
- 1 measurement exceeded its published upper comparison level, triggering review rather than rejection: Yongdam 89.92. Large measurements were preserved.

These are snapshot results and will change as scheduled imports run. Published thresholds can be retained without treating compatibility as verified. A genuinely issued official warning remains separately visible and is not suppressed merely because a project stage comparison is withheld.

Live basin checks: Nakdong returned 399 records and Geum 40. Han succeeded during the critical-station verification but a later repeated request failed; Yeongsan failed during this audit. Failure details are in `verification/Official_Basin_Checks.json`. No unavailable response is claimed as verified, and no complete nationwide live re-verification is claimed.

## F. Executed verification

- Backend: **280 passed, 0 failed**. Regressions cover Yongdam 89.92, legacy datum-token abstention, compatible and incompatible test references, station identity, units, effective dates, official source validation, missing/stale/future readings, genuine dam exclusion, source handling, existing routes and services.
- Frontend: **28 passed, 0 failed**. Includes exhaustive category sums, Severe grouping, unavailable category, numeric index abstention, URL routing, alert labels and chart axes.
- Frontend ESLint passed. Production build passed; existing MapLibre bundle-size advisory remains.
- Real HTTP checks: `/api/risk/gauges`, `/api/risk/coverage`, `/api/risk/gauges/3009`, `/api/official-alerts`, `/api/monitoring/stations/3009/rainfall` returned 200. Cold gauges request was about 9.7 seconds; subsequent coverage/detail responses were about 31–35 ms. This is not a universal latency guarantee.
- Multiple stored basins were checked through the same canonical endpoint, including Han, Nakdong and Yeongsan; Geum was additionally checked against its live official endpoint.
- Browser proof: Yongdam retained 89.92 m, showed Not assessed and its explanation, and displayed an actual nearby 0.00 mm rainfall reading. Searching code 1022640 showed one row while counts remained All 789 / Not assessed 789. Screenshots: `Water_Audit_Yongdam.png`, `Water_Audit_Stations.png`.
- Older test expectations which allowed a datum token alone or an unvalidated history score to generate a grade were updated to require abstention. They were not promoted to independently verified fixtures.

## G. Remaining limitations and release of the guard

The authoritative interpretation/quality of Yongdam's current `wl` remains unresolved. An official response containing 89.92 is proof of what was returned, not proof that the sensor reading is valid or comparable. Do not publish Severe or Low from it pending source clarification.

Obtain independently reviewed documentation of observation reference, threshold reference, units, applicable station code, source endpoints and validity dates. Add only supported entries to `measurement-reference-evidence.json`; the validator will reject mismatches. If a source requires a datum conversion, implement it only after obtaining the official station-specific, effective-dated reference and dedicated conversion tests. The current code does not perform conversions.

The 93 missing provenance records remain preserved. The historical Taehwa chart's step between 2025 and 2026 also remains flagged visually; incomplete source/reference evidence prevents an honest automatic correction. Complete official-warning archive coverage is still absent, so a validated warning probability remains withheld. MapLibre's large bundle and cold full-network response remain performance limitations; current warning cards load independently and monitoring summaries are cached briefly.

All page integrations, authentication, alert configuration, model artifacts and historical records remain in place. No scientific validation is implied by the visual redesign.
