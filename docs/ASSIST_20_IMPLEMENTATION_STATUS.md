# Rivora Assist 2.0 implementation status

Status: targeted improvements implemented; final eight-case live replay passed after database restart. Broad conversational acceptance remains unmeasured.

## Confirmed findings

The configured provider is llama.cpp (`llamacpp`), label `qwen3:4b`; the running local server reports `Qwen3-4B-Q4_K_M.gguf`, a 2048-token context and one inference slot. Its health endpoint returning 200 establishes connectivity, not successful generation. Assist previously allowed two concurrent handlers and cancelled project explanations after three seconds. Two small streaming probes measured first content at 4012 / 1887 ms and completion at 5136 / 6743 ms. Thus the old deadline could expire before useful output. A larger explanation later exceeded 20 seconds; semantic calls also timed out or received HTTP 503. No single cause for every failure was established.

The server was running CPU-only. The existing Qwen model now runs with 28 GPU layers on the RTX 3050 Ti; full offload failed with CUDA out-of-memory. A short GPU probe measured first content at 888 ms and completion at 2530 ms. Startup memory pressure was relieved using the existing launcher's one-time working-set release. The subsequent frontend lint and build passed. No replacement model or paid provider was installed or selected; no stronger-model comparison was completed.

## Changes

- Retained the existing chat endpoint, frontend, storage and provider.
- Added allowlisted JSON interpretation for requests the deterministic router cannot resolve. Local requests carry a JSON schema; server validation rejects unknown tools, extra keys and station names absent from user messages. Native function-calling reliability is not claimed.
- Kept numerical retrieval and response evidence deterministic. Model plans select existing retrieval paths, never SQL or arbitrary endpoints.
- Compacted prompts/history, capped local generation, extended bounded interpretation/explanation deadlines, and aligned the local handler concurrency limit with one inference slot.
- Added authenticated saved-monitoring-location retrieval. Only the auth middleware's user ID is bound to the preference query; guests cannot retrieve private preferences. The frontend now sends its existing bearer token.
- Preserved source identities in compact evidence references; retained clarification candidates and added safe handling of “the other bridge.”
- Added two-station comparisons with source timestamps and an explicit warning against subtracting incompatible absolute gauge levels.
- Labeled verified-facts responses when generation fails. A health-only frontend connection state no longer says “Ready to help.”
- Reused the existing source-controlled project knowledge from `assistant-identity.js`; no vector database was added. Previous registration/alert knowledge corrections remain in force.

## Verification

- 130 relevant backend tests passed, including semantic validation, ownership, context, data routing, generation budgets and truthful database-outage handling.
- Seven focused frontend tests passed; changed-file ESLint and production build passed. Existing large map-bundle advisory remains.
- Reusable live evaluation: `node scripts/evaluate-assist-conversation.js --model` passed 8/8 cases after the user restarted MySQL (2026-11-09 14:33 KST). Earlier outage runs passed only 1/8 and returned truthful data-unavailable errors. Final results and timings are recorded in `backend/reports/assistant20-evaluation.json`: public-data cases took 12–195 ms, informal semantic routing 4039 ms, and generated architecture explanation 7938 ms. The semantic case correctly requested station clarification; it did not invent an observation.
- Additional real conversation: Taehwa 4.74 m and Seonchon 2.3 m at 11:20 KST were returned with their station identities. Comparison refused a datum-independent danger ranking. The next official-warning question remained on Seonchon and returned UNKNOWN.
- Before: comparison routed to one station's generic summary. After: both sourced observations are returned without an unsupported level-difference interpretation.
- Before: the health check implied readiness despite a too-short generation deadline. After: connectivity, verified retrieval, database outage and generation failure are distinguished. A generated architecture explanation was also verified in the existing chat UI.

These are limited retrieval/regression evaluations, not a measured universal accuracy or hallucination rate. Streaming headers/heartbeats and final-answer events are preserved; generated output remains buffered for validation. End-user first-token streaming was not implemented. The provider first-content timings above were direct stream probes.

## Files changed in this continuation

- backend/assistant-core.js
- backend/assistant-followups.js
- backend/assistant-v2-routes.js
- backend/chat-routes.js
- backend/chat-stream.js
- backend/tests/assistant-semantic.test.js
- backend/scripts/evaluate-assist-conversation.js
- frontend/src/pages/AIAssistant.jsx
- frontend/src/lib/assistantConnection.js
- backend/reports/assistant20-evaluation.json
- docs/ASSIST_20_IMPLEMENTATION_STATUS.md

## Remaining acceptance gaps

The database blocker is resolved: the final eight-case replay retrieved real station observations and retained their source timestamps. Official-warning status remained UNKNOWN where complete fresh coverage was unavailable. Broad fluent multi-turn acceptance, sustained performance profiling, stronger-model comparison and a larger held-out conversational evaluation remain outstanding. No ChatGPT-equivalence claim is supported. Generated output remains buffered for safety validation rather than streamed token by token to the UI.
