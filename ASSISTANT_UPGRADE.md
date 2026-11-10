# Rivora Assist implementation

Approved Stage 0 plan implemented on 7 November 2026. Existing dashboards, authentication and alert delivery flags are preserved. No paid service was purchased.

## What changed

The assistant now routes ordinary conversation separately from factual monitoring questions. A greeting performs no measurement queries. Factual answers use bounded parameterized SELECT queries and deterministic evidence rendering rather than letting a language model invent readings. Station ambiguity produces a clarification question. Wind speed, rainfall, temperature, humidity, exact-time observations, daily historical summaries, stored weather forecasts, saved experimental level predictions and model evaluation are supported.

Current observations, historical records, weather forecasts, experimental river forecasts, verified stage comparisons and issued official warnings remain separate. Unknown official coverage never means no warning. Seven-day weather forecasts require a fresh stored snapshot; no seven-day river model is supplied. Optional tables being absent or stale cannot create values. Nearby weather stations are named; they are not measurements at the river gauge.

Read path: UI -> validated chat route -> intent/location routing -> read-only evidence queries -> deterministic factual answer -> buffered SSE metadata/text. Casual conversation -> bounded local/provider call -> conservative live-condition screening -> response. This screening is a safeguard, not a guarantee against every possible model error. The current local model remains small and is not equivalent to ChatGPT.

## API and evidence

Existing POST /api/chat and /api/chat/stream use the new route by default. Set ENABLE_ASSISTANT_V2=false and restart to restore the legacy answer route. GET /api/chat/status remains available.

Evidence carries status, evidence_type, station ID/name, metric/value/unit, observed/issued/valid/retrieved times, source, freshness, missing fields and limitations. Observation timestamps have the Seoul offset. Historical dates and model metadata retain their recorded meaning. Actual database/provider failures produce a generic error rather than a fabricated answer. Factual SSE output is buffered until retrieval completes. Requests have a 20-second deadline, two concurrent work slots and 20 requests/minute/IP. Emergency templates bypass model concurrency slots. Already running MySQL queries cannot be forcibly cancelled by AbortController; abort checks occur before/after each bounded query.

## Private optional history

GET/POST /api/chat/conversations and GET/PATCH/DELETE /api/chat/conversations/:id plus POST /api/chat/conversations/:id/messages require the existing JWT middleware. Every operation checks token-derived ownership. Message appends recheck ownership under a transaction lock. Requests cannot select a different owner. Anonymous monitoring chat remains accessible. Saving begins only after a signed-in user selects New chat. Signed-in messages are not written into browser session storage. Saved evidence is not currently persisted with messages; reopened chats retain message text only.

Two additive tables are created: assistant_conversations and assistant_messages. Startup retries the idempotent migration. Existing tables are not dropped. Delete hides the selected chat immediately; soft-deleted data remains until administrative cleanup. The maintenance command `node assistant-retention.js` in backend removes chats deleted more than 30 days ago and inactive chats older than 90 days, together with their messages. Schedule this command operationally to enforce retention; it is not silently enabled by this upgrade. The language model cannot invoke maintenance or send emails.

Conversation text is sent to the configured language provider for ordinary conversation. Current deployment uses the configured local provider. Switching to a cloud provider changes the disclosure boundary and requires the operator to review that provider's policies. No message content or private account records are included in application diagnostics added here.

## Emergency guidance

Fixed English/Korean flood guidance is stored in backend/config/assistant-emergency.json with authority, source URL and review date. It works without database/model access. The South Korean rescue number and inundation guidance were checked against the National Disaster Safety Portal on 7 November 2026. This is reviewed software content, not emergency-response certification. Follow official instructions.

## Setup, verification and rollback

No new runtime dependency is required. Install existing backend/frontend dependencies, run the server and sign in to use saved history. All configured secrets remain in backend/.env and are excluded from source packages. The migration is additive; take normal database backups before production changes. Rollback uses ENABLE_ASSISTANT_V2=false. Personal history tables may remain unused; do not drop them to roll back a response change.

Tests: backend/tests/assistant-v2.test.js supplies 50 named evidence, forecast, ambiguity, outage, privacy and emergency acceptance cases. assistant-history-http.test.js checks cross-owner GET/PATCH/DELETE/message denial and owner rename/delete behavior using isolated fixtures. Public API checks and real-data latency results are retained in docs/verification. Measurements are individual samples, not production P95 promises. The unchanged full backend/frontend suites, frontend lint and production build must also pass before handover.

## Limits

English factual answers are most complete. Korean intent recognition, clarifications, conceptual explanations and immediate-danger templates are provided; several detailed data summaries remain English. General conversation quality depends on the configured model. No paid model, vector database, model training or extra live-data importer runs in a chat request. Only the approved methodology document is available to project-document lookup. Exact-time queries require exact stored observations. Complete official-warning coverage and a validated event model are still needed before reporting future warning probabilities. Local Express/MySQL/private-model deployment is supported; static hosting alone cannot provide live database-backed chat.
