# Yongdam and network validation audit — 8 November 2026

## 1. Verified finding and limits of root-cause attribution

Yongdam's 89.92 was not introduced by a frontend conversion or guessed by the risk engine. The official HRFCO hourly response for code 1022640 returns `wl: "89.92"` at 2026110716, and at 15:00 and 17:00. The saved WAMIS-origin database row at 2026-11-07 16:00:00 KST has water_level 89.920, reading_id 3581481. The native ten-minute HRFCO response independently continued to report 89.92 on 8 November. Station 3009 is 포천시(용담교), coordinates 38.123889/127.271944, corresponding to official code 1022640.

The unsafe historical Severe label is explained by comparing the reported number with the published four-stage values without independent physical-reference/quality verification: 89.92 exceeds the stored severe stage 22.3. The old importer-authored `DATUM:CONFIRMED;GDT:92.13;PRIMARY:SAME_ROW_STAGE_AND_THRESHOLDS` token is not independent evidence of comparability. Current reconciliation already writes REQUIRES_INDEPENDENT_REVIEW instead, and the current risk engine already withholds this gauge.

This audit does NOT prove an upstream elevation-versus-gauge-height mix-up, a sensor failure, or an incorrect official threshold. The physical cause of the anomalous reported number remains unresolved. Those hypotheses must not be presented as verified root causes.

## 2. Correct interpretation of 89.92 m

The defensible description is **the official feed's reported WL value, in the API's water-level field**. The documented schema describes WL in metres; GDT is separately described as EL.m. The official chart uses a stage axis for WL/ATT/WRN/ALM/SRS and a distinct elevation treatment involving GDT. This supports the intended stage-field semantics, but does not establish that this particular telemetry value is a physically valid gauge-relative reading.

There is no station-specific evidence establishing that 89.92 is instead an absolute elevation. No subtraction/addition of 92.13, decimal adjustment, clamping, fabricated substitute or historical observation update was performed. Display remains 89.92 m with Not assessed and an explicit reference/validity review note.

## 3. Threshold verification

A fresh official waterlevel/info response identifies:

- Station: 1022640, 포천시(용담교), Pocheon, Yeongbuk-myeon, Jail-ri.
- GDT: 92.13 (separate zero-elevation metadata).
- ATTWL 9.5; WRNWL 13.7; ALMWL 18; SRSWL 22.3; PFH 22.3.
- FSTNYN N: published-threshold gauge, not designated flood-warning station.

The database matches the official caution 13.7 and alert 18 values and station code. Official chart/schema evidence supports intended gauge-stage units, but the actual observation's physical validity/reference is unresolved; therefore direct risk comparison is not approved. Published caution/alert stages are not issued warnings.

Public references: [HRFCO API reference](https://www.hrfco.go.kr/web/openapiPage/reference.do), [official water-level page](https://www.hrfco.go.kr/sumun/waterlevelList.do), [official chart implementation](https://www.hrfco.go.kr/js/sumun/wl/wl_popup.js).

Native API endpoint templates are recorded with {service-key}; credentials and private response links are excluded from evidence. Current metadata and hourly/latest responses succeeded after one metadata retry. Live station-popup and reference-page fetches failed during this audit; earlier retained reference documentation and the freshly retrieved official chart were used only for schema interpretation. No missing page content was invented. The chart SHA256 is 897ff43823e1ec226b098c9fc4fb513faa6990e804483607f2ba687cec3f7105.

## 4. Actual observation-to-display trace

1. Official HRFCO hourly JSON: wlobscd=1022640, ymdhm=2026110716, wl=89.92. Original WAMIS wl_hrdata row is stored with a code/date-specific source URL.
2. `wamis-client.js:mapReadings` maps wl to waterLevel, using the supplied observation timestamp. `river-importer.js:importGauge` stores it as water_level; no datum conversion is applied.
3. `hrfco-water-history.js:fetchHourlyHistory` validates the response code and maps wl unchanged. `hrfco-live-water.js:reading/run` preserves legitimate numeric values and supplied KST timestamps; current imports use INSERT IGNORE.
4. `risk-engine.js:assessStation/evaluate` retains water_level and requires compatible reference evidence before stage classification. Review hold produces level=null, score=null, NOT_ASSESSED, fresh observation status and a reason.
5. `/api/risk/unified` returns this result with separate observed-stage and official-warning fields. Current Yongdam official warning status is UNKNOWN, not asserted safe.
6. `Stations.jsx` displays the raw reading, freshness, Not assessed and review explanation. `stationCategory.js` includes an explicit unassessed bucket. Browser evidence shows all these fields.

## 5. Network audit and counts

Read-only database audit: 862 registered river gauges. The published-threshold catalog contains 789. The other 73 are 54 without eligible thresholds and 19 excluded dams/reservoirs; none are silently counted in the 789.

Current category partition: 783 Low + 0 Moderate + 0 High/Severe + 6 Not assessed = 789. Database audit and live unified API agree. There are zero duplicate external station codes, zero duplicate station/timestamp observation groups found, zero missing observation source URLs, zero stale/missing/future catalog observations at the audit snapshot, and zero non-unique river-link mappings. These findings concern stored identities and current observations, not a certification of every historical datum epoch.

A separate fresh official metadata check matched the caution/advisory and alert/warning numeric values for all 789 station codes, with no discrepancies. Matching numbers do not establish physical observation compatibility. Exact-point compatible certificates exist for 783 current readings; they do not authorize historical/future readings. Yongdam alone is flagged for a value above published alert stages; that is a review flag, not proof the reading should be rejected.

The six withheld gauges are:
- 1568 / 1021650: Pilseung, special evacuation/border controls.
- 2947 / 1018680: Jamsu, special submersion/traffic controls.
- 3009 / 1022640: Yongdam, unresolved observation validity/reference.
- 3490 / 6003620, 3491 / 6001650, 3492 / 6002670: no matched independent point-reference certificate.

The earlier 789/787/0/1 figures leave one station outside the shown named buckets. No timestamped original API payload accompanies that snapshot, so the historical station cannot be identified conclusively. Current counts are calculated from actual rows and explicitly include Not assessed. A regression fixture reproduces the 787 Low + 1 Severe + 1 unassessed composition without assuming it was the exact historical composition. Severe is included in the High filter.

## 6. Every code file changed in this audit

- `backend/measurement-reference-verifier.js`: require the observation's station code, not just metadata identity, before issuing a point certificate; reject non-official public HTTPS threshold hosts; explain the unresolved Yongdam hold without claiming a confirmed elevation conversion.
- `backend/measurement-compatibility.js`: an unresolved production review hold wins even if an obsolete certificate remains on disk. Explicit injected fixtures still permit testing genuinely compatible large readings; no arbitrary numeric cutoff is added.
- `backend/audit-measurement-references.js`: include all registered gauges with LEFT JOIN, preserve station IDs when thresholds are absent, report excluded gauges, duplicate observation groups and a complete category sum.
- `backend/official-warning-priority.js`: identify a retained reading without a classification as Not assessed rather than No data; issued-warning priority and separate fields remain intact.
- `backend/tests/reference-verifier.test.js`: add wrong-observation-code and non-official-source regression tests.
- `backend/tests/measurement-compatibility.test.js`: add missing-threshold and obsolete-certificate/review-hold regressions; retain incompatible references, wrong identities, stale/future readings and unmodified large observations.
- `frontend/tests/station-category.test.mjs`: reproduce the reported 789-row composition with an explicit unassessed bucket and require totals to reconcile.

No other application code, schema or historical records were changed by this audit. Generated evidence and this report are additional artifacts.

## 7. Tests and ML preservation

Baseline requested: 298 backend, 8 Python ML, 29 frontend. Actual reruns: **302 backend / 8 Python ML / 30 frontend passed**, plus frontend lint. Four backend tests and one frontend test were added. Initial npm launcher attempts failed before executing tests; all suites were subsequently run successfully using direct Node/Python entry points with bounded worker memory. No unrun production build is claimed for this backend-only application correction.

SHA256 comparison confirms `ml/advanced_warning.py`, its Python tests, frozen `warning_split_policy.json` and `advanced-warning-validation.json` are byte-for-byte unchanged. Database counts remain 493 warning records, 307 issuances and 40 complete coverage intervals. The model still has 490,609 usable samples and 81 events, with 43 training / 27 validation / 11 retrospective-test events, and reason INSUFFICIENT_CALIBRATION_OR_THRESHOLD_EVENTS. No retraining, changed purge, threshold relaxation, new fabricated coverage, calibrated flood probability or test-set tuning occurred.

## 8. Unresolved official evidence

Station-specific confirmation from the responsible authority is still needed for the physical validity, measurement reference and effective datum of Yongdam's reported WL value. Its thresholds are matched metadata, not proof that the anomalous telemetry can be compared. Jamsu/Pilseung require their own operating-control interpretation. Three Jeju gauges still lack matched point-reference certificates. Current source availability and these limits are preserved in the evidence files.
