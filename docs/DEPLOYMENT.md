# Deployment and activation checklist

**Current release gate: IMPLEMENTED - AWAITING CONFIGURATION AND LIVE TESTING.**

No hosting account, paid resource, domain, telephone number, live request or real call was provisioned during development. These instructions are preparation, not proof of deployment. The Docker definition itself has not been built/run in this sandbox.

## 1. Choose appropriate infrastructure

- [ ] A long-lived Node.js 22+ container/process, initially **one replica**; no request-only/serverless worker.
- [ ] Persistent PostgreSQL, version 16 locally tested, or a compatible Supabase PostgreSQL connection.
- [ ] A public hostname you control, valid HTTPS certificate and reverse proxy that supports WSS and long-lived audio connections.
- [ ] Outbound HTTPS/WSS access to OpenAI and Twilio, DNS and your database. The Arena development sandbox's network allowlist excludes these provider hosts; configure/test them outside it.
- [ ] Encrypted database/storage/backups, firewall/private database networking, documented backup retention and a tested restore.
- [ ] Secrets in the platform secret manager or a private environment file; never commit keys, paste provider credentials into chat, or expose them in frontend environment variables.
- [ ] Agreed provider/hosting billing limits before enabling paid operation.

The browser and API should share one public origin. Browser requests are relative; any separately hosted frontend must proxy `/api` to the Node service rather than pointing client code at localhost.

## 2. Configure a management-only production deployment

Start from `.env.production.example`, not a populated development environment. Supply:

| Variable            | Requirement                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`          | `production`                                                                                                        |
| `DATABASE_URL`      | Server-side PostgreSQL URI; URL-encode the password                                                                 |
| `DATABASE_SSL`      | `true` for a remote hosted DB with a verifiable certificate; private local Docker bridge example uses `false`       |
| `PUBLIC_BASE_URL`   | Actual `https://host`, with no path/credentials/query/trailing slash                                                |
| `DASHBOARD_ORIGIN`  | Actual HTTPS browser origin, normally the same                                                                      |
| `SESSION_SECRET`    | Independently generated random secret, at least 32 characters; rotation invalidates existing HMAC-hashed sessions   |
| `SETUP_TOKEN`       | Independently generated, private one-time bootstrap token, at least 24 characters, or generate via the operator CLI |
| `TRUST_PROXY`       | `true` only if all backend traffic passes through a trusted TLS proxy and direct backend access is blocked          |
| `ENABLE_LIVE_AI`    | Keep `false`                                                                                                        |
| `ENABLE_LIVE_CALLS` | Keep `false`                                                                                                        |

Generate each independent random value locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Do not use the same value for all secrets. Production APIs/dashboard reject non-HTTPS requests, except internal `/healthz` and `/readyz`. A trusted reverse proxy must set the correct forwarded protocol. Never allow arbitrary public clients to spoof trusted forwarding headers by directly reaching the backend port.

### Supabase notes

Use the direct PostgreSQL connection or a supported transaction/session connection suitable for the Node process. Migrations require schema/table/index/role-grant permissions. Set verified TLS and the appropriate CA using your platform's trust configuration. Do not disable certificate verification to make an error disappear.

Krona does not implement Supabase Auth; it uses its own single-owner cookie sessions. RLS denies anonymous/untrusted table access, while the private backend connection is trusted and owner-scoped. Do not put a service-role/database key in the frontend or enable broad public REST policies. Actual Supabase deployment/roles/TLS are **not yet verified**.

### Container example, only on infrastructure you authorize

```bash
cp .env.production.example .env
# Edit all placeholders, exact hostname and secrets privately.
chmod 600 .env
# These steps download/build images and may consume hosting resources; run only when authorized.
docker compose build
docker compose up -d
```

The example supplies PostgreSQL, an unprivileged app container and Caddy HTTPS/WSS. It publishes only ports 80/443; database and app ports remain private. Configure DNS and permit certificate issuance. Volumes must survive container replacement. Do not deploy with placeholder database passwords or run test servers publicly.

For an existing container platform, build the app image, configure its environment/secrets and database, and use the platform's HTTPS proxy instead of the local Caddy example. Verify forwarded headers and timeouts explicitly.

## 3. Bootstrap and verify the private management app

- [ ] Start with a backed-up, intentionally selected database. Migrations run at application startup.
- [ ] Check `/healthz` and `/readyz` through the actual public HTTPS host.
- [ ] Create your account using the private one-time token and a unique long password.
- [ ] Confirm a second setup is denied and unauthorized API reads/writes return 401.
- [ ] Verify production cookie is `__Host-krona`, HttpOnly, Secure, SameSite=Strict; CSRF/origin checks reject cross-origin writes.
- [ ] Create/edit task/project/memory/schedule records; restart the deployment and verify actual persistence.
- [ ] Exercise export and deletion using non-sensitive test records. Check backup/provider-retention notices.
- [ ] Verify System Status reports the actual PostgreSQL mode and recent scheduler heartbeat; absent providers remain unconfigured/disabled, not healthy.
- [ ] Test intended mobile browsers, keyboard controls, reduced motion and error recovery.

`npm run setup:token` is an operator tool, not an account bypass. It refuses to replace an existing owner and can intentionally re-enable setup only after no owner exists. With PGlite, stop the backend first. In production, run maintenance/bootstrap tooling through an authorized private operator session, not a public route.

## 4. Configure and authorize live AI tests

- [ ] Obtain an OpenAI API key and verify account billing/limits, supported models and voices.
- [ ] Configure `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_REALTIME_MODEL` and, optionally, `OPENAI_EMBEDDING_MODEL`.
- [ ] Verify current prices in your actual account. Supply positive `AI_INPUT_USD_PER_MILLION`, `AI_OUTPUT_USD_PER_MILLION`, and a conservative effective `AI_VOICE_USD_PER_MINUTE` including context/transcription overhead.
- [ ] Set provider-level billing protection and conservative application budgets.
- [ ] Obtain explicit owner authorization for paid testing, then set `ENABLE_LIVE_AI=true`.
- [ ] Verify one actual text request, tool mutation, summary and retrieval after restart.
- [ ] Verify one actual browser conversation and its end/unknown-state handling, including real microphone permission, speaker playback, interruption and physical iPhone/Safari behavior.
- [ ] Keep semantic search off initially. Enabling embeddings is additional paid processing and needs separate cost/privacy review.

No API key is delivered to the browser. A browser voice session still sends selected private context and audio to the configured provider. Do not speak passwords/PINs/API keys into live AI.

## 5. Configure and authorize telephone tests

- [ ] Provision or use an authorized Twilio **voice-capable** number; understand rental and usage charges. No purchase is automated here.
- [ ] Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and positive `TWILIO_USD_PER_MINUTE`/AI voice estimates.
- [ ] Configure account fraud/geographic permissions and review jurisdictional AI/telephone/privacy obligations. Verify recording is disabled in both the application and provider account/workflows.
- [ ] Configure the number's incoming voice webhook, **POST**: `https://YOUR_HOST/twilio/incoming`.
- [ ] Configure the number's call status callback, **POST**: `https://YOUR_HOST/twilio/status` for inbound terminal outcomes. The outbound SDK also attaches its own intent-bound status callback.
- [ ] Ensure the proxy preserves public webhook paths/query parameters and allows `wss://YOUR_HOST/voice/media` upgrades. Do not bypass signature verification to debug a mismatch.
- [ ] Authorize the specific live test/billing and set `ENABLE_LIVE_CALLS=true` in production.
- [ ] Save the owner's real E.164 phone number through Settings.
- [ ] Set a nontrivial 6–12 digit phone PIN using dashboard password confirmation.
- [ ] Place a real **incoming** call from the owner phone. Confirm the AI disclosure, wrong-PIN denial, correct-PIN connection and no private context before authentication.
- [ ] Verify authenticated incoming access marks the owner phone verified. This cannot be toggled into existence by the UI.

Caller ID alone is not authentication. A signed request/account match does not replace the PIN. Signed stream status errors and call outcomes should appear as real records, not successful simulated calls.

## 6. Authorize one outgoing check-in

- [ ] Owner explicitly opts into outgoing AI calls in Settings after incoming verification.
- [ ] Confirm timezone (initial default America/New_York), quiet hours, pause, daily attempt limit, maximum minutes and estimated budget.
- [ ] Create one non-recurring schedule outside quiet hours, with the test window explicitly authorized.
- [ ] Verify the actual phone rings once; authenticate; talk naturally and interrupt mid-response.
- [ ] Create/update a real test task/project through voice; verify persisted values in the dashboard and after service restart.
- [ ] Say “don't call me again today,” “pause for a week,” “only once a day,” or “stop checking on that project”; verify the actual stored changes.
- [ ] Test no-answer/decline with permission. Verify no automatic redial, accurate terminal callback and no duplicate dispatch after restart.
- [ ] Reconcile any uncertain intent against Twilio before scheduling replacements. Never falsely confirm “not placed.”

Changes prevent future dispatches but cannot unring a previously dispatched call. Use Call History termination for an existing known provider call. Third-party calling and other external executors remain disabled throughout this checklist.

## 7. Release decision

Record actual timestamps, provider call IDs (privately), outcomes, durations, evidence, actual bill discrepancies and failed/skipped tests in `docs/VERIFICATION.md` or your private operations log. Obtain an independent production security review and backup restore validation.

Do not describe live components as operational until incoming, outgoing, interruption, recovery, device behavior, consent and billing have been verified on the **actual deployment**. Configuration is not live testing.
