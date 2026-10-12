# Krona

**Clearer thinking. Durable context. Calls on your terms.**

Krona is a single-owner, voice-first personal AI companion with a real Node backend, PostgreSQL persistence, a responsive React dashboard, OpenAI adapters, Twilio audio transport, and a durable consent-based scheduler. It is not a static dashboard or a chatbot that pretends to save records.

## Honest current status

The management application and automated test infrastructure are implemented. The live AI, browser audio, and incoming/outgoing telephone components are **IMPLEMENTED - AWAITING CONFIGURATION AND LIVE TESTING**.

- No live AI requests, real telephone calls, purchased credits, account provisioning, or external production deployment were performed during this implementation.
- Production entry points never substitute mock responses. Missing configuration produces an explicit unavailable/configuration state.
- Tests use isolated databases and **explicitly labeled mock provider transports**. These do not prove a successful real telephone conversation.
- Standalone PostgreSQL integration runs against an actual PostgreSQL server through the network `pg` driver, in addition to disk-backed PGlite tests.
- Do **not** call the system fully operational or production-ready before the deployment, privacy, billing and live verification checklists are completed.

The checkout is `varneykirk55-collab/krona`, working branch `arena/85555d7e-krona`. See [the implementation ledger](docs/PROGRESS.md) and [verification evidence](docs/VERIFICATION.md).

## What is implemented

| Area              | Actual behavior                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private dashboard | Owner setup/login, Overview, Conversation, Memory, Projects, Tasks, Call History, Scheduling, Approvals, Settings and System Status; light/dark themes, global search, mobile navigation, accessible labeled forms, loading/error/empty states                          |
| Memory            | Persistent records with confidence, source, sensitivity and project/conversation provenance; full-text retrieval, deduplication, contradiction flags, corrections, deletion, category exclusions and export; optional real provider embeddings, off by default          |
| Projects          | Objectives, milestones, progress, blockers, decisions, next action, task counts, archival and linked conversation history                                                                                                                                               |
| Tasks             | All six statuses, priorities, due dates, notes, project links, dependencies with cycle detection, recurrence after completion and source-conversation links; task completion cancels associated future check-ins                                                        |
| Conversation      | Actual OpenAI Responses tool orchestration, bounded retrieval, transactional tool receipts and persistent summaries; direct planning/executive-function assistance without medical claims                                                                               |
| Browser voice     | Authenticated OpenAI WebRTC SDP exchange, server sideband tools, microphone lifecycle cleanup, interruption events, playback-permission recovery and maximum-duration timers; uncertain creations/terminations retain limits until reconciliation                       |
| Telephone         | Twilio SDK owner-only dispatch, signed webhooks and WebSocket upgrade, DTMF PIN authentication, short-lived one-use stream authorization, native 8 kHz mono μ-law audio, playback marks/clear/truncation for barge-in, call-status persistence and missed-call handling |
| Scheduling        | Persistent jobs, transactional claims/leases, timezone/quiet hours, pauses, daily limits, versioned rescheduling, stale-job handling and no automatic redial of uncertain or missed calls                                                                               |
| Authorization     | Low-risk internal note execution; immutable scoped proposals, expiry, dashboard approval and password reauthentication for high-impact actions; **all external executors remain disabled**                                                                              |
| Operations        | Liveness/readiness endpoints, real scheduler heartbeat, audit metadata, conservative usage reservations, retention, recovery interfaces, migrations, CI definition and container/TLS deployment files                                                                   |

### Boundaries that matter

Incoming callers do not receive private context based on caller ID alone. They must match the configured owner number **and** pass the phone PIN. Outgoing calling requires an authenticated incoming verification, a PIN, explicit dashboard consent, live operator switches, pricing configuration and all applicable budgets.

No conversation recording is requested. Raw transcript retention is off by default; summaries are separately configurable. Providers necessarily process live audio/text and can have independent retention. Review [privacy and security](docs/SECURITY.md).

Approving a message, booking-like calendar entry, third-party call, contract, disclosure or spending proposal **does not execute it**. Those integrations return `EXECUTOR_NOT_CONFIGURED`; nothing is sent, booked, called or spent. Adding an executor requires a separate implementation, legal/consent review and live testing.

## Run the real management app locally

Requirements: **Node.js 22+**, npm, Linux/macOS for normal development. The packaged automated PostgreSQL/browser tests are primarily verified on Linux x64.

```bash
npm ci
cp .env.example .env
npm run setup:token
npm run build
npm run start
```

Keep the printed **one-time setup token private**. Open `http://localhost:8080`, create your own account, and choose a unique password. No sample owner, tasks, memories or call history are seeded into the main application.

**Embedded database safety:** stop the running backend before `setup:token` or `db:migrate`, because PGlite must have only one process using its directory. Its filesystem lock has a 30-second stale window after a crash. Do not delete a live lock. A second opening is rejected rather than risking corruption.

Development with hot reload uses two terminals:

```bash
npm run dev:server  # backend :8080
npm run dev         # Vite :5173, relative API proxy to the backend
```

Browser-facing requests use relative URLs, never a browser's `localhost` to reach a separate remote backend. Both web servers bind `0.0.0.0`; development accepts the actual Arena preview origin. Production is single-origin behind HTTPS and does not permit arbitrary iframe embedding.

In Arena, the existing preview serves the account setup screen and management app; it is **not a cloud production deployment**. This sandbox's outbound allowlist does not include OpenAI/Twilio or general hosting endpoints. Live provider verification requires an appropriately connected deployment outside that restricted network.

## Verify

```bash
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

`npm run verify` runs typecheck, backend tests and the production frontend build. E2E remains a separate explicit command. See [exact test scope, evidence, failures resolved and unexecuted live checks](docs/VERIFICATION.md).

The E2E runner uses a disposable test database and port 8081, with providers disabled. Its Chromium and required Linux libraries are prepared from npm packages, avoiding browser-download CDNs. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing compatible Chromium installation. **An iPhone-sized Chromium viewport is not a physical iPhone/Safari test.**

`TEST_DATABASE_URL` optionally selects a dedicated PostgreSQL test server. The standalone suite creates a unique schema and temporary role; never point it at production or use a role without the required schema/role privileges.

The hosted CI definition runs only for pull requests or an explicit manual dispatch. It does not deploy and does not run on this branch's ordinary pushes. No hosted CI result is claimed until it actually runs.

## Deploy and activate, without hidden spending

1. Deploy the long-lived Node service with PostgreSQL/Supabase, persistent storage, HTTPS, secrets and backups. Keep both live switches **off**.
2. Initialize your private owner account and verify persistence/security through [the deployment checklist](docs/DEPLOYMENT.md).
3. Obtain provider credentials privately, confirm model/voice availability and current account/country pricing, set conservative estimate variables and provider-level spending/fraud limits.
4. Explicitly authorize live AI testing; enable AI and verify one text exchange and one browser conversation on your intended devices.
5. Explicitly authorize telephone testing; configure the Twilio incoming and status callbacks, enable live calls, save your real owner number and set a phone PIN, then place a real incoming call yourself.
6. Only after successful incoming authentication, consent to outbound owner check-ins and authorize one scheduled test. Verify interruption, summaries, persistence, limits and no missed-call redial.

Deployment files are supplied: `Dockerfile`, `compose.yaml`, `Caddyfile` and `.env.production.example`. **The Docker image and external deployment have not been executed or verified in this sandbox.** Do not copy placeholder passwords into production.

## Costs and controls

There are no hard-coded promises of current provider prices. Live processing is blocked if necessary estimate variables are missing. The dashboard distinguishes estimates from invoices and records unresolved reservations conservatively.

Operating cost consists of hosting + PostgreSQL/backups + Twilio number rental + telephone usage + AI audio/text/transcription/embedding usage, plus applicable taxes/minimums. Defaults are **one outbound attempt per day, ten minutes maximum, one concurrent voice session, $5/day estimated usage, 200 AI requests and 100,000 reported AI tokens/day**. These are configurable safeguards, not a price quote or guaranteed provider billing cap. Hosted infrastructure and number-rental charges are not part of the application usage estimate.

Current provider pricing could not be verified through this environment. Use actual account/model/country rates; configure independent provider-level billing controls. No service upgrade or credit purchase is performed by the app or this assignment. See [operations and estimation](docs/OPERATIONS.md).

## Code map

- `server/migrations/`: versioned PostgreSQL schema, RLS, safety and continuity changes.
- `server/services/`: auth, ownership-aware persistence, scheduling, usage, approvals and privacy.
- `server/ai/`: personality, retrieval, actual provider adapters, tools and voice orchestration.
- `server/telephony/`: Twilio SDK, signature/PIN handlers, media transport and interruption state.
- `shared/`: validated schemas and API record types.
- `src/`: real-data dashboard and browser microphone/WebRTC client.
- `tests/`: unit, actual storage/API integration, mocked provider contracts, standalone PostgreSQL and browser E2E.
- `docs/`: [architecture](docs/ARCHITECTURE.md), [deployment](docs/DEPLOYMENT.md), [security/privacy](docs/SECURITY.md), [operations](docs/OPERATIONS.md), [verification](docs/VERIFICATION.md) and [progress](docs/PROGRESS.md).

## Remaining release gates

Live OpenAI/Twilio calls, physical iPhone/Safari microphone/audio behavior, production TLS/domain/roles, backups/restores, actual bill reconciliation, independent penetration/security review and external deployment have not been verified. Semantic search is an optional bounded candidate scan, not a claimed large-scale vector service. Multi-replica voice requires additional operational validation; start with one application replica. External messaging/calendar/third-party calling/financial executors are intentionally not connected.

Typeface credits: DM Sans and Manrope, redistributed under the SIL Open Font License; notices are preserved in `docs/licenses/`.
