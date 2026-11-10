# Official river network

Verified on 2026-11-06: 789 monitored gauges, including all 223 designated flood-warning stations listed by the four regional authorities. The other 566 gauges have published reference thresholds; they are not designated warning stations.

## Reconcile station coverage

From backend, run `npm run reconcile:official`. The importer fetches the regional catalogs, verifies station codes and river metadata, checks ordered station-specific thresholds and datum evidence, and retains explicit failure reasons in reports/national-reconciliation.json. It never substitutes nearby stations' flood thresholds or invents missing levels. The official 2024 monitoring-plan supplement supplies river names only; current thresholds come from regional sources.

## Observation updates

The running backend polls official regional observation feeds every 10 minutes. The Han source uses a completed hourly interval; other regional requests use completed ten-minute intervals. Original observation timestamps and source URLs are stored. WAMIS collection remains available as an additional source. A missing current observation remains missing even when station threshold evidence is verified. Threshold comparison is not an issued official warning.

## Sources

- Han: https://www.hrfco.go.kr/sumun/waterlevelList.do (fstnyn distinguishes warning stations from other gauges)
- Nakdong: https://www.nakdongriver.go.kr/sumun/rthd.do (full gauge map and designation flag)
- Geum: https://www.geumriver.go.kr/html/flood/floodPopup.jsp (designated warning station thresholds)
- Yeongsan/Seomjin: https://www.yeongsanriver.go.kr/sumun/wlMap.do (full gauge map), cross-checked against each station's waterDetail chart
- River-name supplement: https://www.water.or.kr/upload/board/2024/03/20240320180535_1.pdf (individual page references are stored)

Yeongsan map field names are legacy names: wl_wrn is interest, wl_alm is caution/advisory, and wl_att is alert/warning. The importer follows the public UI labels and checks the individual chart instead of guessing from those field names.

The counts describe the reconciled source catalogs, not every physical river in Korea. Dams/reservoirs and stations without verifiable thresholds remain excluded from the public river-risk list. No emails are sent by reconciliation or observation refresh.
