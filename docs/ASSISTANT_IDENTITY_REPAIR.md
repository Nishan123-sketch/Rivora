# Rivora Assist identity and routing repair — 8 November 2026

Implemented directly in the existing project. No rebuild or database migration.

Root cause: the model-facing prompt did not contain the developer identity, so a pretrained Qwen response could confuse the model provider with the application developer. A second routing bug matched domain substrings: “brainstorm” matched “rain”.

Changes:
- backend/assistant-identity.js: authoritative application facts supplied by the user; Nishan developed Rivora and Rivora Assist. Direct identity questions use a deterministic answer that works without the model or database. Explicit authorship questions about a different model are not rewritten as Rivora authorship. No invented surname/contact/ownership information.
- backend/assistant-core.js: project identity routing before conversational recall/followups; emergency guidance retains priority; English domain keyword boundaries avoid accidental substring matches.
- backend/assistant-v2-routes.js: shared application identity in the conversational system prompt.
- backend/chat-routes.js: shared identity supplied to provider calls, including legacy model paths.
- backend/assistant-language.js: additional narrow domain/developer typo corrections; names, IDs, dates and numbers remain untouched.
- backend/tests/assistant-identity.test.js: 15 regression cases covering creator questions, Alibaba misattribution, typo handling, unrelated authorship, model-vendor separation, emergency precedence and condition-question routing.

Executed verification:
- Full backend suite: 341 passed, 0 failed (326 prior +15 new).
- Real running /api/chat/stream: three creator questions returned PROJECT_IDENTITY, Nishan and a completed SSE response. Timings: 164 ms cold, 13 ms and 10 ms warm.
- Real language-model response to “Tell me briefly about the Rivora application and its developer.” identified Nishan. Completed in 48.19 seconds under current CPU/background load. This confirms provider identity grounding; it does not establish fast general conversation.
- Real database question “Taehwa Bridge current water level” returned DATABASE_GROUNDED, a source timestamp and 5.02 m, plus nearby-station rainfall attribution, in 246 ms.

Evidence:
- backend/reports/system-repair/assistant-identity-live.json
- backend/reports/system-repair/assistant-identity-model-data.json
- validation/system-repair/Assistant_Identity_Tests.txt

Limitations: this is a targeted identity and question-routing repair, not a claim of universal NLP understanding. General conversational quality and latency still depend on the configured local model; the measured model response was slow. Existing scientific warning-validation and measurement-reference safeguards were not changed. No frontend source changed, so frontend lint/build were not rerun for this backend-only repair. The previous system-repair ZIP predates this identity patch; use the current project files.
