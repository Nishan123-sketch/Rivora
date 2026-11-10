# Official rainfall and upstream-context requirements

Status: 9 November 2026. These are acquisition and verification requirements for the existing Rivora pipeline, not asserted upstream relationships.

## KMA AWS access: confirmed, not blocked

The existing `KMA_API_KEY` returned a genuine historical AWS record for station 152 at 2025-07-17 12:00 KST. Separate environment variable names are not a permission test. No new AWS authorization is currently needed for the tested service. The checked request is documented in `backend/reports/scientific-followup-20261109/archive-access-probe.json`.

The exact product is **방재기상관측(AWS) → AWS 시간통계 자료 조회 → 3.1.3 강수** in the [official KMA API Hub catalogue](https://apihub.kma.go.kr/apiList.do?seqApi=2&seqApiSub=239). The endpoint is `https://apihub.kma.go.kr/api/typ01/url/awsh.php`; parameters are `var=RN`, `tm=YYYYMMDDHHMM` in KST, `stn=<KMA station code>`, `help=1`, and the private `authKey`.

If access later returns an authorization denial, sign in to API Hub, locate that exact AWS hourly-statistics rainfall product, choose **API 활용신청**, confirm the application/account key and permitted request volume, and verify one historical station/hour before batch recovery. An application to ASOS, a short-term forecast service, or recent AWS minute observations does not establish this product's authorization. Do not paste keys into chat, reports or committed URLs.

Use `RN_HR1` in millimetres only when `RN_HR1_MI=-60`, with matching station and timestamp. Missing/sentinel amounts remain missing. A genuine reported 0.0 is an observation, not a fill rule. Do not substitute daily totals or moving-window maxima. Current rate/access evidence is limited to bounded requests; no unlimited quota is assumed.

Existing KMA station links are point-context links, including AUTO_NEAREST links. They are not proof that an AWS station is the same instrument as an HRFCO rainfall station. Keep observations under the original provider and gauge code. An alternative point-gauge feature needs its own development comparison; never relabel it as recovered same-gauge rainfall.

## Exact rainfall still required

Use `backend/reports/scientific-followup-20261109/after-recovery/authentic-data-gaps.csv` for every remaining station, linked rainfall code, KST start/end and missing-hour count. The audit currently finds 102,089 missing HRFCO point-rain hours. Contiguous-window count can increase when a recovered day splits a longer gap.

Request from the responsible flood control office an official **hourly rainfall historical export**, with the original `rfobscd`, observation time in KST, rainfall amount in mm, QC/missing flags, instrument operating dates and relocation history. Prioritized unsuccessful examples include gauges 30114110, 31014070, 30084010, 30134030 and 30124120 around the storm/warning dates saved in `rainfall-recovery-results.json`. Both HRFCO and WAMIS fallback outcomes are recorded. A blank response does not establish dry weather or prove that the station operated historically.

The recovered accepted-model-station gap is associated with river gauge 1018695 and rainfall gauge 10184160; only 2024-10-13 was recovered from its longer 2024-10-13 to 2025-01-10 gap. Request the remaining exact hours in the updated CSV rather than assuming that the whole range is now complete.

## Official catchment geometry and directed river connectivity

Obtain **WAMIS 수자원단위지도**, including standard-basin, middle-basin and major-basin polygons, versioned basin code tables, outlet locations and the dataset's actual CRS/units. Obtain **RIMGIS 국가하천전자지도 / 하천기본계획보고서 / 한국하천일람** for the corresponding reaches and flow-system evidence. The [National Water Management Committee's official system directory](https://www.water.go.kr/562) identifies WAMIS and RIMGIS and these holdings.

The required extract should cover the frozen cohort codes 2201670, 1001655, 1018669, 1023667, 1101620, 4005645, 4008660, 2001628, 2011640, 2018609, 2018645 and 5001625, plus warning-research gauges. Request directed reach IDs, upstream/downstream node IDs, confluence identifiers, basin outlets, catchment area, map version/effective dates and official gauge-to-reach associations. Request gauge-to-basin crosswalks when available. Those are required fields for this task, not a claim that a public endpoint already exposes every field.

Current river names, coordinate distance and shared basin membership do not establish an upstream flow path. A basin polygon alone also does not identify travel time. Before a feature is enabled, verify that the upstream gauge drains through the target reach without crossing a different branch or downstream confluence; retain evidence and effective dates. No such edge was created during this continuation.

## Station identity and historical event evidence

Request the **한국수문조사연보** station tables, rainfall records and flood-event hydrographs, with gauge operating history. The [official HRFCO water-gauge station-information dataset, ID 15117648](https://www.data.go.kr/data/15117648/fileData.do), includes station metadata and basin area; it is a metadata source, not an automatic directed upstream graph. The [ministry's yearbook announcement](https://www.mcee.go.kr/home/web/board/read.do?boardId=1756730&boardMasterId=939&menuId=10598) describes the national hydrological observation compilation.

Preserve stage-reference epochs and relocation dates. Do not transfer absolute stage values between gauges with different reference datums. Official warning issuance events identify issuance decisions; they do not prove that every high-water episode produced a warning or that every missing label is negative.

## Basin rainfall products

Investigate **기상청_관계기관통합 유역별 면적강수량**, [public-data catalogue ID 15170840](https://www.data.go.kr/data/15170840/fileData.do). The official catalogue describes area-average rainfall derived from multiple agencies' point gauges and multiple basin/administrative units, with coverage beginning August 2022. Check its actual time resolution, QC, basin-code version, observation/issuance time, revision policy and retrieval/operational availability before using it for 3h/6h forecasts.

This catalogue was published in 2026; historical coverage alone does not establish that the exact product or revision was available at a 2024/2025 forecast origin. Archived issuance/availability evidence is required for an operational backtest. No values from this product were added to the model in this continuation. If it is daily rather than hourly at the required dates, it cannot replace hourly rainfall features.

Alternatively, request the official rainfall-gauge-to-basin membership/weight table: provider-qualified rainfall code, basin ID/version, valid-from/to, area weight or Thiessen polygon, QC and aggregation method. KMA AWS IDs and HRFCO rain IDs must remain separate. An area-weighted basin rainfall total is a derived measurement with explicit coverage, not a fabricated replacement for missing gauge readings.

## Travel time, dams and weirs

Request reach-specific flood-routing parameters or documented travel-time ranges from the responsible flood control office and K-water: source/target gauge IDs, discharge or stage regime, release conditions, intervening dams/weirs, calibration storms, uncertainty and model version. Request historical dam/weir outflow, gate operations and release issuance times aligned to those reaches.

K-water's [official research entry on flood travel-time and stage prediction](https://www.kwater.or.kr/kiwe/resu/thesView.do?mngtno=A2023140&pageNo=192&s_mid=454) is evidence that such reach/operation-dependent work exists, not a nationwide travel-time lookup for Rivora. Do not apply an Imjin-specific result to Taehwa or another basin. Spatial distance divided by an assumed speed is not verified travel-time evidence.

Any data-derived lag must use training-only storm episodes, with a predefined lag range and a chronological embargo. Preserve a later untouched evaluation and document whether the upstream observation was available by the prediction origin. Until geometry, connectivity, identity and timing are verified, upstream model improvement remains **not evaluated**, and existing warning validation remains failed.
