# Official data acquisition request — Rivora — 9 November 2026

These are requests for authentic records and metadata, not permission to infer missing observations or invent warning coverage. Exact affected station IDs and ranges are supplied in the linked CSV files.

## Priority A: missing features during confirmed warning coverage

Manifest: backend/reports/scientific-upgrade-20261109/authentic-data-gaps.csv

134 contiguous windows were identified over 77 pre-2026 reviewed coverage intervals and 71 stations. Each row lists station code, linked rainfall-gauge code, data type, exact KST start/end and missing hours. Water availability uses the same backward-only 15-minute alignment as the research feature engine. Rainfall requires actual complete hourly values; cumulative/daily rainfall must not be treated as hourly rain.

Request the original hourly water-level and rainfall records for these exact ranges from the responsible flood control office / HRFCO archive. Existing links use the official HRFCO reference documentation: https://www.hrfco.go.kr/web/openapiPage/reference.do . The public page timed out during verification, so historical service availability is not asserted. The configured API key successfully retrieved recent 72-hour rain windows, but this does not prove historical bulk access permissions.

If the historical API cannot supply a listed interval, obtain an official CSV/export with station identity, units, timestamps/timezone, quality/missing flags and original source provenance. Ask whether additional historical-product approval or higher bulk quota is required. Do not share the actual key in a report or chat.

KMA alternative: use the matching historical AWS hourly rainfall product, with a verified station mapping and product-specific permission. The official API Hub lists AWS and observation products, and API requests use an issued authKey: https://apihub.kma.go.kr/apiList.do . Do not assume another weather-service key grants the same historical permissions, or replace a trained model's source without reevaluation.

## Priority B: additional authentic warning seasons

For the station codes in the coverage manifest, request complete warning/advisory issue, escalation, cancellation and affected-area histories for 2022-01-01 through 2025-12-31, including known initial state at each covered interval and an official statement of completeness. Expand to older available seasons if the authority can supply them, with coverage explicitly documented. Additional records can be imported as events without inventing completeness. A response containing a few notices is not proof of a complete negative timeline.

For every station lacking a complete season, the full requested range above is a request for evidence, not a claim the station existed or issued a warning throughout it. Confirm commissioning/designation dates. Do not automatically assign negative labels to non-designated gauges. The 2026 inspected evaluation remains retrospective and must not be reused for candidate acceptance. Freeze a genuinely future independent evaluation before viewing its outcomes; enough events, not merely elapsed days, are required.

## Priority C: datum and threshold history

Manifest: backend/reports/scientific-upgrade-20261109/datum-threshold-history-requests.csv

For each of 789 station codes and its exact stored-history period, request the official station ledger: gauge-zero changes, relocation and sensor-condition epochs, units, datum/reference, official threshold values with effective dates and revisions. Current point certificates do not establish historical epochs. Retain holds for 1022640, 1018680, 1021650 and all other existing excluded schemes until independently resolved.

The official hydrological measurement standard describes station ledgers and zero-level change records: https://law.go.kr/LSW/flDownload.do?flSeq=159632141 . This supports requesting the records, not assuming a public API automatically provides them.

## Priority D: station-specific training blockers

Manifest: backend/reports/scientific-upgrade-20261109/level-data-prerequisites.csv

The 17 rows distinguish six constant-reading reviews, six measurement/reference holds, four insufficient chronological histories and one coverage deficit. Obtain authentic available hourly records for each supplied date range, or official confirmation of instrument/commissioning constraints. Do not replace flat values with fabricated variation or request observations before the station existed as though they must be available.

Three additional currently reviewed live gauges are 1010633, 1006630 and 1101656; check the unchanged frozen artifacts against their current constant-reading behavior.

## Priority E: genuine upstream/catchment features

Request official basin boundaries, directed river/gauge topology, upstream gauge IDs, travel-time/routing context and any dam-release observations with original availability timestamps for the same station/date cohorts. Current nearest-point rain links are not established as upstream catchment rainfall. Add those inputs only when the mapping and availability are verified; no synthetic catchment weights or invented flood events.

## What is already available

The six recent HRFCO rainfall links used to restore accepted forecasts were retrieved successfully with the existing key, each with 72/72 expected hours. No new approval was required for those recent requests. All further archive/metadata approvals above remain unverified until the responsible provider confirms access. No new credentials are required merely to use the completed repairs locally.
