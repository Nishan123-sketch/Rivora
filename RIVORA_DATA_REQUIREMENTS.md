# Rivora Official Hydrological Data Requirements

**Project:** Rivora – Weather and Flood Risk Forecasting  
**Location:** `D:\Capstone\WeatherForecasting`  
**Purpose:** Precise specification of official government data requirements, access endpoints, missing datasets, and required administrative actions.  
**Security Notice:** In compliance with security guidelines, this document contains no private API keys, credentials, or secret tokens.

---

## 1. Overview of Data Architecture Priorities

To transition the Rivora hydrological forecasting engine from an experimental research prototype into a comprehensive nationwide operational platform, specific authentic datasets must be acquired from authorized Korean government agencies.

The acquisition sequence is prioritized as follows:
* **Priority A:** WAMIS & HRFCO — Basin-wide water levels, upstream hydrological gauge networks, and datum history.
* **Priority B:** KMA — Radar-derived precipitation grids and archived short-to-medium range precipitation forecasts.
* **Priority C:** K-water — Upstream multi-purpose dam and barrage operational discharge records.
* **Priority D:** Flood Control Centers — Complete historical flood warning bulletins and official threshold effective dates.

---

## 2. Detailed Dataset Specifications

### Dataset 1: Basin-Wide Catchment & Radar Precipitation Grids
* **Official Provider:** Korea Meteorological Administration (KMA) & WAMIS
* **Official Documentation / Portal:**  
  KMA API Hub: `https://apihub.kma.go.kr/apiList.do`  
  WAMIS Open Data: `https://www.wamis.go.kr:8080/wamis/openapiPage.do`
* **Applicable Stations:** All 789 monitored river stations nationwide.
* **Required Dates:** 2022-01-01 to Present (Hourly resolution).
* **Hydrological Justification:**  
  Currently, models rely on nearest AWS point rainfall ($\le 25\text{ km}$). A single lowland rain gauge at a bridge cannot capture heavy precipitation falling across upstream mountain catchments. Catchment-average rainfall is essential to prevent false alarms during local showers and to detect rising floodwaters caused by upstream precipitation.
* **Status:** Optional for observation-only models; **Essential** for reliable rainfall-driven flood warning classifiers.
* **Existing Access Status:** Public API access available; registered KMA API Hub key required for radar grids.
* **Action Required:** Register for KMA API Hub radar precipitation grid service (`API_HUB_RADAR`) and provide the API service key in the server configuration.
* **Can Implementation Continue Without It?** **Yes.** Physical water-level forecasts function effectively with observation-only Ridge/ElasticNet and nearest AWS rainfall proxies.

---

### Dataset 2: Upstream Multi-Purpose Dam Discharge Records
* **Official Provider:** K-water (Korea Water Resources Corporation)
* **Official Documentation / Portal:**  
  Public Data Portal (data.go.kr) / K-water Water Resources Information System: `https://www.water.or.kr`
* **Applicable Stations:** Downstream gauges on dam-regulated rivers:
  - Han River: Downstream of Soyang Dam and Chungju Dam.
  - Nakdong River: Downstream of Andong Dam and Imha Dam.
  - Geum River: Downstream of Yongdam Dam and Daecheong Dam.
* **Required Dates:** 2022-01-01 to Present (Hourly discharge rate $\text{m}^3/\text{s}$, inflow, and spillway gate status).
* **Hydrological Justification:**  
  Major river rises in South Korea are heavily influenced by dam gate operations. Distinguishing between sudden river rise caused by dam spillway releases versus natural runoff is necessary to eliminate false flood warnings downstream.
* **Status:** **Essential** for dam-regulated reach accuracy; Optional for unregulated tributaries.
* **Existing Access Status:** Public Data Portal OpenAPI (`K-water Dam Operation Information`).
* **Action Required:** Request open API subscription on Data.go.kr for "K-water Multi-purpose Dam Real-time Operation Data" and supply endpoint configuration in `.env`.
* **Can Implementation Continue Without It?** **Yes.** The existing system evaluates downstream river levels directly from observed gauge height differences.

---

### Dataset 3: Complete Historical Warning Bulletins (Han & Nakdong Basins)
* **Official Provider:** Han River Flood Control Center (HRFCO) & Nakdong River Flood Control Center
* **Official Documentation / Portal:**  
  HRFCO Open Data API: `https://www.hrfco.go.kr/web/openapiPage/reference.do`  
  Nakdong River Flood Control Center: `https://www.nakdongriver.go.kr`
* **Applicable Stations:** Monitored gauges in the Han River basin (Seoul, Gyeonggi, Gangwon) and Nakdong River basin (Gyeongbuk, Gyeongnam).
* **Required Dates:** 2022-01-01 through 2025-12-31.
* **Hydrological Justification:**  
  Complete coverage intervals (where every issuance and cancellation is confirmed) currently exist only for the Geum River basin (39 intervals). Complete archives for Han and Nakdong are required to increase positive storm-event counts and provide nationwide verified negative coverage.
* **Status:** **Essential** to retrain the official warning-issuance classifier.
* **Existing Access Status:** HRFCO API key configured in backend (`HRFCO_SERVICE_KEY`).
* **Action Required:** Run historical query-end backfill scripts for Han and Nakdong:
  ```powershell
  npm run ml:history:fetch -- 20230715 20230716 20240718 20240719 20250718 20250719
  ```
* **Can Implementation Continue Without It?** **Yes.** The system safely maintains the `INDEPENDENT_TEST_ACCEPTANCE_FAILED` status and withholds probabilities without blocking working water-level forecasts.

---

### Dataset 4: Historical Vertical Datum & Station Relocation History
* **Official Provider:** WAMIS / Ministry of Environment
* **Official Documentation / Portal:**  
  WAMIS Station Metadata: `https://www.wamis.go.kr:8080/wamis/openapi/wkw/wl_dubobs`
* **Applicable Stations:** Stations flagged with `REFERENCE_OR_MEASUREMENT_REVIEW_REQUIRED` (e.g., Yongdam Bridge, Station ID 3009, Code 1022640).
* **Required Dates:** Complete station history (datum zero elevation relative to Incheon Mean Sea Level, datum adjustments, and sensor relocations).
* **Hydrological Justification:**  
  Yongdam Bridge records water levels around $89.92\text{ m}$ (representing elevation above sea level, EL.m) while its published flood warning thresholds are $13.7\text{ m}$ (gauge zero height). Without official zero-elevation conversion documents, direct stage comparison cannot be performed without risking dangerous misclassification.
* **Status:** **Essential** to enable flood-stage comparisons on held stations; Optional for the 772 verified stations.
* **Existing Access Status:** Station metadata partially documented in WAMIS.
* **Action Required:** Verify the historical zero-elevation offset ($GDT$) for station `1022640` against WAMIS station registry documents before lifting the reference hold.
* **Can Implementation Continue Without It?** **Yes.** Yongdam Bridge is safely held as `NOT_ASSESSED`, preventing false flood alerts.

---

## 3. Summary of Administrative Actions for User

| Action Item | Provider | Complexity | Priority | Blocks Water-Level Predictions? |
| :--- | :--- | :---: | :---: | :---: |
| **1. Backfill Han & Nakdong Storm Dates** | HRFCO API | Low (Run script) | High | No (Affects Warning ML only) |
| **2. Subscribe to K-water Dam Operations API** | Data.go.kr | Medium (Online request) | Medium | No |
| **3. Obtain KMA Catchment Radar API Key** | KMA API Hub | Medium (Online request) | Medium | No |
| **4. Resolve Yongdam Bridge Elevation Datum** | WAMIS | Low (Manual document audit)| Low | No (Station held safely) |
