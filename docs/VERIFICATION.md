# Verification evidence and live release gates

Date: **2026-10-12**. Evidence is scoped to this implementation environment, not an externally deployed service.

## Latest completed automated evidence

Executed `npm run format && npm run verify && npm run test:e2e -- --max-failures=1 && npm audit` successfully on the finalized application source.

| Check                        | Exact outcome                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| TypeScript                   | Passed (`tsc --noEmit`, also repeated by build)                                                             |
| Vitest                       | **83 passed, 0 failed, 0 skipped; 10 files passed**, 23.83 seconds                                          |
| Standalone PostgreSQL subset | **4/4 passed**; measured server version **PostgreSQL 16.14**, actual network `pg` driver                    |
| Production frontend build    | Passed; 1695 modules, JS 479.00 kB / 144.63 kB gzip, CSS 72.24 kB / 14.30 kB gzip                           |
| Playwright                   | **10 passed, 0 failed, 0 skipped**, about 1.2 minutes; five cases each on desktop and iPhone-sized Chromium |
| Dependency audit             | **0 vulnerabilities** reported                                                                              |

The ten browser cases comprise six real management/privacy journeys and four explicitly MOCK microphone/provider-response lifecycle cases. The four PostgreSQL tests are included within the 83, not additional tests. Total automated test cases: **93 passed**. Vite reported only nonfatal upstream Zod PURE-comment annotation warnings. Final `npm run format:check` and `git diff --check` both passed. Two final SDK/WSS regression cases were added after the ten-browser run; `npm run verify` was rerun successfully with 83 tests, and the rebuilt frontend/CSS hashes were identical to the browser-tested artifacts.

No live providers were contacted and no real calls were placed by these suites.

## Test types and what they prove

| Suite                         | Scope and limitations                                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `time.test.ts`                | Pure timezone, quiet/pause/calendar-day and DST scheduling behavior                                                                                                                                                                                                                        |
| `playback.test.ts`            | Audio playback marks, interruption point, clear and truncation state; no actual telephone sound                                                                                                                                                                                            |
| `store.test.ts`               | Real PGlite SQL persistence, restart, CRUD, dependencies/recurrence, deduplication/contradictions, actual deletion/export and ownership                                                                                                                                                    |
| `conversation.test.ts`        | Explicit scripted AI + real database tools, summaries, idempotency, approval boundaries and persisted outcomes; not real model personality/performance                                                                                                                                     |
| `scheduler.test.ts`           | Explicit mock phone + real durable jobs, claim/lease recovery, consent/quiet/pause/caps, uncertainty and no retry; not actual phone ringing                                                                                                                                                |
| `api.test.ts`                 | Actual Fastify request/response/auth/CSRF/rate/CRUD/privacy behavior against an isolated real database; providers disabled/mocked                                                                                                                                                          |
| `adapters.test.ts`            | Actual SDK/adapter contract logic with intercepted HTTP and a real local mock WebSocket peer: Responses `store:false`, tool-output ordering, PCMU negotiation/canceled audio and actual Twilio SDK creation/recording/duration/live-switch/termination parameters; not real OpenAI service |
| `telephony.test.ts`           | Actual Twilio signature generation/validation, known-number/PIN gate, wrong account/identity denial, one-use token, canonical HTTPS/WSS signatures and real local signed WS transport carrying mock μ-law frames, interruption and status replay/uncertainty; no Twilio account traffic    |
| `postgres.test.ts`            | **Standalone actual PostgreSQL 16 via network `pg`**, not PGlite: schema/migrations/JSONB/dependencies/retrieval, rollback, RLS under an untrusted role, native row locks and single claims                                                                                                |
| `safety.test.ts`              | Embedded exclusive lock, credential protection, source continuity/cascade, uncertain termination with mocked HTTP, erasure guards, filtering/limits/retention and production HTTPS/cookie policy via simulated trusted proxy                                                               |
| `tests/e2e/companion.spec.ts` | Real Chromium UI against isolated persisted management data; desktop 1440×1000 and iPhone 16 Pro-sized 402×874/3× touch viewport; plus explicitly MOCK microphone permission/provider-response cancellation cases                                                                          |

Neither an HTTP mock nor a local signed WebSocket proves Twilio accepts the public URL, OpenAI produces intelligible audio, the actual owner phone rings, a real device microphone works, production HTTPS is valid, or invoice estimates are accurate.

## Reproduce safely

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

The browser helper prepares Chromium and Linux libraries from npm, avoiding blocked browser CDNs. A compatible `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is optional. Tests use disposable directories/database schemas, synthetic owners and explicit mock transports; the main owner's private database is not seeded.

`TEST_DATABASE_URL` may select a **dedicated test PostgreSQL database**, with permissions to create/drop a temporary schema/role. The suite does not blanket-reset a supplied database but is not intended for production. Its local default starts/stops a real ephemeral PostgreSQL 16 server. Role/schema cleanup runs after the suite.

Playwright uses port 8081 and refuses to silently reuse another server. The main preview is separate on 8080. A timeout can leave children if a runner is forcibly killed; inspect/stop only the identified disposable test server before rerunning. Do not kill or open the main database indiscriminately.

## Browser journeys

The management journey performs real setup/login, project creation, task creation/project assignment, reload persistence, completion, memory creation/correction/reload, schedule creation, persisted pause and overview rendering. It asserts no page JavaScript errors/horizontal overflow.

The status/theme/search journey checks honest absent-provider states, a real persisted dark palette, project search and Escape. Tests can create their own search fixture when run independently. Unauthenticated reads/mutations return 401 and private navigation shows sign-in/setup.

The two explicitly MOCK voice lifecycle cases cover a late microphone permission after navigation and a delayed provider creation after cancellation. They assert local track stopping/no reopening and a termination request without a retry. They **do not** test physical audio, real provider SDP, or native iOS behavior.

Generated evidence is ignored, not committed personal data:

- `.data/e2e-results.json`: current browser run results.
- `.data/screenshots/overview-desktop.png` and `overview-iphone-16-pro-sized.png`: synthetic test-record overview.
- `.data/screenshots/status-dark-desktop.png` and `status-dark-iphone-16-pro-sized.png`: honest unconfigured-provider dark status.
- `test-results/`: failure traces only, disposable.

Mobile and dark screenshots were inspected during implementation. An iPhone-sized **Chromium** viewport is not an iPhone/Safari or hardware/accessibility certification.

## Failures found and corrected during implementation

- Accessible field labels initially included help text, preventing exact setup/password locators; fixed explicit input IDs, labels and described help rather than weakening accessibility assertions.
- Repeated normal dashboard loads initially hit an overly low general rate limit in the combined mobile run; adjusted the general limit while preserving stricter auth/critical-route limits.
- A new Twilio SDK transport test initially expected a boolean recording field before the SDK's form serialization; corrected its assertion to the actual wire value `Record="false"`. Production code already correctly disabled recording.
- A new telephony test wrongly required the word `audio` in valid Stream TwiML; corrected the assertion, which also resolved its missing-token cascade.
- A forcibly timed-out initial browser runner left a disposable server; the identified child was terminated and subsequent tests use an isolated clean server.
- Review added canceled-response suppression, stale queued-tool handling, microphone cancellation generation, credential guards, unknown-outcome retention, owner-row locking and source history/erasure protections.

These are recorded defects/resolutions, not hidden failed evidence. Always distinguish historical failed attempts from the final passing run.

## Explicitly not executed / not verified

These are release gates, **not automated tests marked skipped and claimed passing**:

- Actual OpenAI text model, embeddings, realtime speech/SDP/audio/tool responses and latency under a live account.
- Real Twilio incoming/outgoing phone calls, signed public provider upgrades/callbacks, real μ-law intelligibility and interruption heard on a phone.
- Missed/declined/quiet/pause/limit behavior and uncertain provider outcomes against live telephony.
- Physical iPhone 16 Pro/Safari microphone, background interruptions, autoplay, changing networks and audio routing.
- Public HTTPS/domain/proxy, Supabase/production-role exposure, independent penetration test and provider/account recording/retention settings.
- External deployment, Docker build/runtime, hosted CI execution, backup/PITR restoration and sustained-load/HA behavior.
- Verified current provider pricing, real invoice reconciliation or any paid upgrade/purchase.
- External calendar/message/third-party/financial executors; intentionally absent and non-executable.

## Manual live verification matrix

Every billable test needs explicit owner authorization, controlled budgets and a suitably connected HTTPS deployment. Do not run it automatically from this sandbox.

| Test                  | Evidence needed before a pass                                                                                 | Current result                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Text and stored tools | Actual provider request plus changed persistent record and post-restart retrieval                             | AWAITING CONFIGURATION/AUTHORIZATION |
| Browser voice         | Real microphone, intelligible playback, barge-in, tool record, bounded end and actual session accounting      | AWAITING CONFIGURATION/LIVE TEST     |
| Incoming phone        | Actual owner call, signed callbacks, PIN denial/pass and no private context before pass                       | AWAITING CONFIGURATION/LIVE TEST     |
| Outgoing phone        | Explicit consent and schedule; actual single ring/call, correct identity/PIN, status/duration and persistence | AWAITING CONFIGURATION/LIVE TEST     |
| Interruption          | Owner interrupts speech; hears prompt stop; marks/clear/truncate preserve correct context                     | AWAITING LIVE TEST                   |
| Voice controls        | Actual stored today/week/project/once-daily changes and no subsequent unauthorized dispatch                   | AWAITING LIVE TEST                   |
| Missed/declined       | Authorized unanswered test; no automatic replacement call or duplicate after restart                          | AWAITING LIVE TEST                   |
| Restore/outage        | No duplicate real call, unknown retained/reconciled and safe limits under failures                            | AWAITING HOSTED/LIVE TEST            |
| iPhone                | Actual Safari/device/permissions/sound/background/network behavior                                            | NOT EXECUTED                         |
| Billing               | Match returned usage/estimates to real provider charges and correct configured rates                          | NOT EXECUTED                         |

Record true pass/fail/blocked outcomes, timestamp, deployment version and private provider IDs in the owner's operations log. Configuration alone must never turn this table into passing evidence.

## Verified local preview

Latest process: `krona-companion-e2a638e5`, port 8080 bound to `0.0.0.0`. The latest dashboard root, `/healthz` and `/readyz` returned 200. `/api/auth/status` measured `initialized:false, setup_available:true`. Unauthenticated `/api/tasks` and `/docs/readme` returned 401. Startup reported embedded PostgreSQL and both live switches **false**. No fake owner/records were seeded. This is the Arena development preview, not an external production deployment. Docker is not installed here; Docker/Compose execution remains unexecuted.
