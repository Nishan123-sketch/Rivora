# Compact Rivora interface verification

Implemented the requested compact pass in the existing application:

- Sticky 56 px page header, smaller sidebar, cards, controls and text. Removed in-app Back buttons; page and station navigation now use real URLs with browser Back/Forward support.
- Replaced the frozen historical assessment-score chart on Overview with measured water-level history. Shared charts have time/date X axes, numeric Y axes, units, point readouts and recorded-value tables. Large discontinuities are marked and not joined as a continuous trend.
- Weather uses compact hourly/daily cards and separate temperature/rainfall charts with readable scales. Existing seven-day forecast section retained.
- Stations toolbar and rows are smaller, with 15-row incremental loading, styled search, exhaustive assessment categories and official threshold-source links.
- Alerts use hazard-first English titles, readable land/sea areas, severity and effective time. National warnings load independently of full-network comparisons; unknown project counts are not displayed as zero. Wind enrichment preserves actual matched observation times and never invents a wind speed.
- ML overview uses bulk stage queries, selected station analysis avoids a full-network scan, and the frontend briefly caches responses. Specific missing/stale input reasons replace blanket unavailable labels. No fake validation or warning probabilities were added.
- Assistant header/privacy controls are smaller and the conversation area larger. At a 1280 × 720 viewport, the verified header was about 65 px and conversation area about 389 px. Existing assistant/data access remains intact.
- The rotating WAMIS batch default increased from 24 to 48 gauges per five-minute tick, still bounded and non-overlapping. This reduces the nominal network refresh cycle; upstream failures can still delay readings.

Browser checks verified Overview, Stations, selected station, Weather, Historical, Alerts, ML and Assistant, including browser Back/Forward and chart point readouts. At the measured desktop viewport, station rows were about 78 px and the compact toolbar about 117 px before the later reference-audit explanations were added.

Current verification: 280 backend tests, 28 frontend tests, ESLint and production build pass. Exact logs and screenshots are in `docs/verification`. Existing MapLibre chunk-size warning remains. SPA hosting must route unknown application paths to `index.html` so deep links work after deployment.

Read `WATER_LEVEL_REFERENCE_AUDIT.md` for the subsequent compatibility repair. Its scientific abstention takes priority over older screenshots showing Low comparisons. A compact interface is not evidence that a datum or flood model has been validated.
