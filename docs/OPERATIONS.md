# Operations, recovery and cost controls

## Health and monitoring

- `/healthz`: unauthenticated, minimal process liveness; no personal data or credential/config dump.
- `/readyz`: database query readiness. It does not certify the worker, AI or telephony.
- **System Status:** authenticated measured database health, scheduler heartbeat age, provider configuration/activation, timestamps from accepted provider events and actual local usage records.
- **Scheduling:** persisted job status and error reason. `blocked` for missing configuration/consent is not a simulated successful call. A completed dispatch is not task completion.
- **Call History:** actual intents/status callbacks, outcome, provider duration and associated summary. Failed/unknown/unauthenticated calls are not relabeled successful.
- **Browser voice & recovery:** persistent active/unknown/ended sessions and password-confirmed manual reconciliation.

Deploy an external uptime check and log/error alerting under an authorized account. No Sentry, paid monitoring, cloud metrics or automatic infrastructure purchase is claimed to be connected. Logs omit sensitive payloads/query strings; also configure privacy-safe proxy/platform logs. Do not store production traces as public CI artifacts.

Start with one application replica. PostgreSQL row claims protect scheduler concurrency, but voice WebSocket affinity, rate limits, context caches, shutdown and sideband behavior require additional validation before horizontal scaling.

## Default safeguards

| Setting                       | Default             | Meaning                                                                             |
| ----------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| Outbound enablement           | Off                 | Requires signed incoming phone verification, PIN and explicit owner consent         |
| Live AI / live calls          | Off / off           | Operator activation is separate from saved credentials                              |
| Timezone                      | America/New_York    | Calendar day limits and quiet/pause behavior                                        |
| Quiet hours                   | 21:00–08:00         | Applies to proactive outgoing calls, not owner-initiated incoming access            |
| Daily outgoing limit          | 1                   | Counts attempts/intents, including uncertainty, not only answered conversations     |
| Maximum voice duration        | 10 minutes          | Client/server timers; outbound Twilio also receives a provider time limit           |
| Concurrent voice limit        | 1                   | Phone and browser sessions together; unknown outcomes retain a slot across midnight |
| Estimated daily spend         | $5                  | Soft/conservative estimate safeguard, not an invoice guarantee                      |
| AI requests / reported tokens | 200 / 100,000 daily | Text, summaries, embeddings and returned realtime usage records                     |
| Transcript retention          | Off                 | Turning off deletes existing retained message rows                                  |
| Summary generation            | On                  | Interpretation, not verified fact; existing summaries need explicit deletion        |
| Conversation retention        | 90 days             | Configurable 1–365; active/unresolved voice tracking is preserved                   |
| Semantic search               | Off                 | Genuine provider embeddings, if separately configured/authorized                    |

Billing/model-specific testing may require consciously adjusted limits. Do not raise caps merely to hide a bug or bypass an unresolved call.

## Pricing and estimation

Current account/country/model provider prices were **not independently verified** in this sandbox. Positive operator-supplied variables are required before paid processing:

- `TWILIO_USD_PER_MINUTE`: conservative effective voice rate for your route/direction.
- `AI_VOICE_USD_PER_MINUTE`: conservative effective realtime audio rate including input/output/context/transcription effects.
- `AI_INPUT_USD_PER_MILLION`, `AI_OUTPUT_USD_PER_MILLION`: chosen text model estimates; review model-specific billing and embedding differences.

Telephone/realtime billing can depend on minimums, minute rounding, cached/text/audio tokens, transcription, country and model. A single minute rate is an operational estimate, not a provider price feed or accurate tax-inclusive invoice. Include adequate buffers and verify against real authorized test usage.

A useful monthly planning formula is:

```text
host + database/backups + phone-number rental
+ telephone minutes × actual route rate
+ audio usage × actual realtime/transcription rates
+ text/summaries/embeddings billed tokens × model rates
+ taxes/minimums/other provider fees
```

No dollar operating-cost quote is justified without those inputs. The default $5/day cap would correspond to at most roughly $150 of _configured estimated_ usage in a 30-day planning example; that is a budget setting, **not expected cost**, and excludes fixed infrastructure/number charges.

Text requests reserve a byte-based conservative input envelope and bounded output before submission, then settle from returned tokens. Failed/unknown requests keep conservative reservations. Voice reserves a maximum-duration estimate with a buffer; usage/events and session duration are measured separately. Provider responses can arrive after spending has occurred, and outages can prevent confirmed termination. Configure independent provider account spend/fraud/geographic limits and reconcile actual invoices. No credits/upgrades are purchased automatically.

No live API/telephone usage was intentionally initiated during implementation. Arena/hosting plan charges, if any, are outside this application's visibility; no total platform invoice claim is made.

## Safe shutdown and restart

1. Do not run database/setup CLIs against an open PGlite directory. Stop the backend first.
2. Graceful SIGTERM/SIGINT stops the scheduler, closes media resources, attempts browser provider termination and closes the database.
3. After a crash, the PGlite lock becomes stale after 30 seconds; do not remove a live lock. Production PostgreSQL uses independent process connections.
4. On startup, migrations apply before serving requests. Abandoned claimed jobs can be recovered; dispatching side effects become uncertain, not automatically retried.
5. Persistent browser limits survive restart; expired known sessions receive protective termination attempts. Unknown creation/termination remains for manual reconciliation.
6. Confirm readiness, recent worker heartbeat, unresolved records and actual provider state before re-enabling outgoing schedules.

Keep original provider credentials available until existing calls/sessions are resolved. Removing/changing the account/project key can prevent correctly identifying or terminating older resources.

## Resolve an uncertain telephone dispatch

A timeout can mean the provider created the call but its response was lost. **Do not press retry or create a replacement schedule until checking the provider console.**

- A valid matching signed callback can automatically attach the actual SID and finalize the original intent without another create request.
- Otherwise use Call History's reconcile interface with your password.
- If a call exists, enter its actual Twilio SID; the backend looks it up and verifies both owner destination and assistant origin before saving its status/duration.
- If no call was created, explicitly confirm that fact after provider-console verification. This does not reset the day's attempt count into an unlimited-redial loop.
- If the call remains active, use termination controls and verify the terminal callback.

Turning new live calls off stops future dispatch/connection but does not disable protective management of already-known calls when credentials remain. A pause prevents future dispatch; it cannot unring an already-dispatched call.

## Resolve an uncertain browser voice session

1. Stop the browser microphone/peer connection.
2. Check OpenAI session/provider logs under the original account/project and verify no session remains active.
3. In System Status → Browser voice & recovery, select the unknown record, enter your account password and `I VERIFIED NO ACTIVE VOICE SESSION`.
4. Reconciliation is **owner manual verification**, not a fake automated API check. It frees concurrency but retains the conservative day cost estimate.

Do not clear unknown state just because the local page disappeared. Network errors can leave remote resources active. Check provider-level termination/billing controls if backend confirmation fails.

## Backups, restoration and privacy

Use encrypted PostgreSQL backups/PITR with a documented retention window and regularly test restoration into an isolated database. Do not back up populated `.env` files into ordinary source/artifact storage. Never publish development `.data`, personal exports, real transcripts or provider identifiers.

A restored backup can resurrect deleted records and consumed/stale scheduling state. Keep both live switches and outbound consent off during restoration; reconcile provider reality, cancel/review stale jobs, verify owner/auth records and deletion requests before enabling a worker. Do not let a restored old pending intent place a replacement real call without review.

SQL deletion does not guarantee zeroed disk pages/WAL/backups or third-party erasure. Follow the [privacy limitations](SECURITY.md) and provider retention policies. An export is full owner data and must be treated as confidential.

## Account and secret recovery

Password changes require current password and revoke sessions. There is no public email-reset endpoint or configured email service. If the owner loses access, an authorized infrastructure/database operator must perform documented maintenance recovery, invalidate sessions and review phone/PIN/consent under the owner's direction. Do not expose a token-reset bypass on a public route.

`npm run setup:token` deliberately refuses to replace an existing owner. After actual authorized account deletion, it can re-enable bootstrap for a new empty account. In PGlite maintenance, stop the app first. Operational environment keys/secrets are not automatically revoked by deleting application records; rotate/remove them separately.

## Troubleshooting

| Symptom                        | Check                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Setup unavailable              | Private bootstrap token absent/consumed, existing owner, or intentional deletion lock; don't bypass it                 |
| Embedded database locked       | Another app/CLI is running; stop it or wait for a stale crash lock; never open twice                                   |
| Production HTTPS error         | Actual public HTTPS/TLS proxy, trusted forwarding, private backend port and exact origins                              |
| API 401/403                    | Session expiry/rotation, correct origin and CSRF; iframe cookies may require opening preview in a top-level tab        |
| Provider unconfigured          | Correct private environment and off/on operator switches; credentials alone do not activate                            |
| Pricing required/limit reached | Positive verified estimates, actual reservations, day/timezone and unresolved sessions; do not erase uncertainty       |
| No outgoing ring               | Explicit consent, signed phone verification/PIN, pause/quiet hours, budgets, worker and job state                      |
| Invalid Twilio signature       | Exact public URL/path/query, account/token, preserved proxy routing and HTTP method; never disable validation          |
| Audio unavailable              | HTTPS/WSS, physical microphone/sound permissions, supported model/voice, stream format, provider connectivity and logs |
| Duplicate-looking data         | Review actual tool/job IDs and unknown intents before explicit retry; internal create requests can have lost responses |
