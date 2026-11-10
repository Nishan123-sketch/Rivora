# Rivora interface and live-data updates

- The light interface uses compact cards, fixed page headers, one Back button, English display names, and 15-row station loading.
- The station network includes only gauges with verified threshold evidence. Low, Moderate and High are calculated from received observations; demonstration risks are not inserted.
- Official weather warnings refresh from KMA. If the subscribed warning endpoint is unavailable, the service reads KMA's public current-warning table.
- Seven-day weather forecasts use Open-Meteo; attribution is included on About. These are weather forecasts, not seven-day river-level predictions.
- Rivora Assist answers monitoring questions directly from the database. General conversation uses the portable local Llama 3.2 1B model under `.local`, excluded from git. The backend starts the local CPU runtime automatically when `LLM_PROVIDER=llamacpp` and its executable/model are present. It listens only on loopback port 11434. This small model has limited general reasoning ability.
- Water-level changes use the nearest observation within 30 minutes of the requested interval. The River Monitoring page displays the actual number of minutes between readings.
- Email preferences were removed from navigation. Automatic alert generation and email delivery remain disabled during testing.

Run the backend and frontend as before. MySQL must be running. The backend must remain running for automatic imports and alert refreshes; frontend refresh alone cannot collect observations while the backend is stopped.
