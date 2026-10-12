# Architecture and trust boundaries

## Runtime

One long-lived TypeScript/Fastify process serves the built React/Vite dashboard, authenticated JSON APIs, Twilio HTTP callbacks, a signed telephone media WebSocket, browser SDP exchange and the durable scheduler. A request-only serverless deployment is unsuitable for audio connections and worker continuity.

Production uses the `pg` network driver against PostgreSQL or a compatible Supabase PostgreSQL connection. Development can use disk-backed PGlite, guarded by an exclusive filesystem lock and process-local transaction mutex. PGlite is not a hosted database or an HA production substitute. Production configuration rejects a missing `DATABASE_URL` or non-HTTPS public/dashboard origins.

Migrations are ledgered with checksums and run under a PostgreSQL advisory transaction lock. Previously applied migrations must not be rewritten. Add a new numbered migration. The application starts only after migration succeeds; backups and staging rollout precede production schema changes.

## Data domains

The single owner has an account, hashed credentials, hashed opaque sessions and validated settings. Owner-scoped domains include:

- Projects, tasks, dependencies and next recurring task instances.
- Memories with content hash, confidence, provenance, source conversation, subject-based contradictions, sensitivity and optional embedding.
- Conversations, optional messages, summaries and project/task conversation associations.
- Schedules, versioned job occurrences, dispatch intents/calls, status event receipts, PIN attempts and one-use voice tokens.
- Action proposals, exact scope hashes, approvals, results, tool idempotency receipts, audit metadata and usage reservations.
- Browser voice sessions, provider call IDs, duration limits, costs and uncertain outcomes.

Foreign keys implement actual deletion/cascade behavior. RLS has no permissive public policies; anonymous/untrusted roles cannot read records. The trusted backend's database owner can bypass RLS, so every application operation also checks owner IDs and validates linked records. Do not expose the backend's database/service credentials to the browser or enable broad Supabase REST grants.

## Text conversation

1. Cookie session and, for writes, origin/CSRF checks authenticate the owner.
2. The engine retrieves bounded memory/project/task excerpts and a few actual summaries, not an entire history. Memory confidence and summary interpretations remain labeled. Raw embedding vectors are never included in prompts.
3. A spending/token/request envelope is persisted before a paid request.
4. OpenAI Responses receives the personality, relevant context, recent turns and validated tool definitions with `store:false` and SDK retries disabled.
5. Requested tools validate arguments, owner scope and conversation ownership. Owner-row serialization protects settings/budgets and record changes; tool IDs plus argument hashes make repeats idempotent.
6. Database mutations commit before a success receipt is returned. Bounded receipts describe actual persistence, not fictional action outcomes. If response generation fails after a committed mutation, the owner receives an explicit list of operations that succeeded, without automatic retry.
7. Usage is settled from returned tokens; summary generation is a separate guarded request. Failed/unknown reservations stay conservative. Raw transcripts are only stored when enabled.

The model is not a source of authorization or verified facts. Owner-reported task completion is separate from the model's interpretation of a conversation. There is no shell, arbitrary HTTP executor or direct financial tool.

## Telephone path

```text
Owner's phone
  → Twilio HTTPS voice webhook
  → validate Twilio signature/account and exact owner/bot numbers
  → collect DTMF PIN with persistent per-call/rolling limits
  → verify salted PIN hash
  → mint 60-second, one-use, call-bound stream token
  → signed WSS media upgrade + transactional token consumption
  → retrieve private context only after authentication
  → OpenAI native PCMU realtime session
  ↔ validated tools / database transactions / usage records
  → call summary and signed terminal status
```

Both Twilio and the realtime session use mono μ-law at 8 kHz. Native `audio/pcmu` support avoids an unnecessary resampling conversion. The websocket checks encoding/rate/channels, message/frame sizes, timestamps, identity, one-use token, heartbeat/backpressure and session duration. Audio is forwarded, not recorded to a file.

For interruption, outgoing chunks carry playback marks. Incoming speech triggers Twilio `clear`, realtime cancellation and truncation at the actually played point. Late canceled audio is suppressed. Tool outputs precede continuation; stale queued tool work is not started after interruption. Interruption cannot undo an already committed database operation.

Signature verification uses the configured public canonical URL, not untrusted forwarded host values. HTTP callbacks require the configured Twilio account. The upgrade accepts the equivalent HTTPS/WSS canonical signature forms; both are restricted to the same configured host/path, and neither substitutes for the call-bound stream token/PIN.

## Browser voice

An authenticated/CSRF-protected backend reserves a session and sends the owner's SDP offer and bounded context to OpenAI. The browser receives the SDP answer, not the API key. Audio flows through native WebRTC; a server-side realtime sideband performs tools, usage handling and failure/duration controls.

The client stops microphone tracks, closes peer/data/audio resources, and requests provider termination on stop/navigation. An attempt generation prevents late microphone permission or delayed SDP responses from reopening a canceled session. Autoplay failure offers an explicit enable-sound gesture. Server timers and a persistent expiry sweep supplement client timers.

A creation timeout/5xx, missing provider identifier or failed termination is **unknown**, not successful/ended. Unknown rows keep concurrency and conservative cost protection. Dashboard password-confirmed manual reconciliation requires the owner to check the provider console; it is explicitly not a live automated verification. A network or provider outage can prevent confirmed remote termination, so account-level billing limits remain necessary.

## Durable dispatch

Jobs are stored in the database rather than in `setTimeout`. Workers claim due pending/blocked occurrences with `FOR UPDATE SKIP LOCKED`, leases and version checks. Paid dispatch first locks the owner and verifies current consent, verified phone/PIN, quiet hours, pause, request/token/spending/concurrency and daily attempt limits. A persistent call intent is committed before the SDK side effect.

Twilio creation has no assumed application idempotency guarantee. The SDK sends a creation request at most once per intent and never automatically retries an ambiguous write. A crash/timeout moves dispatch to `unknown`; it cannot be silently redialed. A correctly signed matching callback can settle uncertainty. Otherwise the authenticated owner reconciles against the provider console. Missed/busy/declined calls do not generate an immediate replacement call.

Rescheduling increments the schedule version and cancels old pending/claimed/blocked jobs. Task completion/cancellation and project completion/archive disable linked future check-ins. Owner preferences and dispatch share a first row lock to avoid lost consent/settings updates. A change cannot unring an already dispatched call; use call termination controls for an in-progress provider call.

## Extensibility without a universal executor

`ConversationProvider`, `TelephoneProvider` and `RealtimeConnection` separate provider transport from owner data logic. Test implementations live in `tests/`; the default application always selects real adapters.

Actions have server-defined risk, typed payload, immutable exact scope hash, expiry, explicit dashboard approval, rejection and audit. Only internal `note.create` executes today. External kinds have no executor and return 501. A future integration must implement allowlisting, resource/destination checks, legal/consent review, action-specific confirmation, idempotency and unknown-outcome reconciliation before enabling execution. Do not replace this with model-selected URLs or model-provided risk ratings.
