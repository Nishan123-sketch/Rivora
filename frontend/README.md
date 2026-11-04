# Weather and Flood Risk Forecasting — React Frontend

Refactored from the user's supplied frontend ZIP. Visual styling follows the supplied 12-page Fframe PDF (blue/cyan sidebar, white monitoring cards, navigation and page layouts). Pages are individually editable under `src/pages/`.

## Run on Windows

Keep the existing Express/MySQL backend running at `http://localhost:5000`.

```powershell
cd D:\Capstone\WeatherForecasting\frontend
npm install
npm run dev
```

Open http://localhost:5173/ . Vite proxies `/api` to the backend.

## Verified integrations

- `GET /api/stations`: response `{success:true,data:[...]}`
- `GET /api/weather/latest`: response `{success:true,data:[...]}`
- `GET /api/water/latest`: response `{success:true,data:[...]}`
- `GET /api/rivers/207/prediction`: experimental Taehwa prediction

The dashboard, stations, station details, weather observations, location map, risk status, and local condition assistant use actual returned observations. No sample risk scores, fake station readings, or fabricated alerts remain. Missing fields show unavailable.

## Integration still needed (requires backend contracts)

- Forecast endpoint response fields for hourly and multi-day forecasts.
- Historical observation endpoint for real charts.
- Login and registration endpoint methods and request/response schema.
- Server-side alert rules, alert retrieval, email preferences, and email delivery.
- Verified station-specific thresholds before assigning flood danger levels.
- Map currently selects and locates stations individually on OpenStreetMap; it does not draw flood extents.

Login and registration buttons remain explicitly disabled until authentication endpoints are verified. Alert preferences are preview-only, not stored or emailed. The assistant is a data-grounded rules-based helper, not an LLM.

## Testing limitation

Production build could not be executed in the sandbox: dependencies require a platform-specific Rolldown native binding not present in the supplied Windows node_modules. Run `npm install` on Windows, then `npm run build` to verify.
