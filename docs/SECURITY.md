# Security, privacy and limitations

This is a production-oriented implementation, **not a completed independent security certification**. Production deployment, real provider behavior and penetration testing remain release gates. Do not use it for medical diagnosis/treatment, emergency response or autonomous financial/contract decisions.

## Authentication and scope

- Single-owner bootstrap requires a private one-time token, consumed transactionally. There is no open registration or seeded production account.
- Passwords and phone PINs use salted scrypt (`N=32768`, `r=8`, `p=1`); the application never stores plaintext passwords/PINs.
- Sessions are random 256-bit bearer tokens, stored as HMAC-SHA256 hashes with the server secret, with seven-day expiry. Logout/password change invalidate stored sessions. Rotate secrets intentionally; rotation requires signing in again.
- Production cookies are host-only `__Host-`, Secure, HttpOnly, SameSite=Strict. Preview-only development CHIPS cookies support Arena iframe authentication; they are not the production policy.
- Write APIs require an authenticated session, matching CSRF token and accepted Origin when provided. Non-browser clients still need the session/CSRF token. There is no permissive cross-origin API.
- General API rate limits are 600 requests/minute/IP to accommodate actual dashboard refreshes. Login, setup, PIN changes, reauthentication, approvals, erasure and voice creation have tighter separate limits. Edge/DDoS protection is still necessary; in-memory HTTP rate counters are not a shared multi-replica limiter.
- Every private route/linked-record operation checks owner scope. Parameterized SQL and strict Zod schemas exclude model-generated SQL/column names and arbitrary payload fields.
- Production startup requires external PostgreSQL and HTTPS origins; non-HTTPS requests are rejected except internal health/readiness. Only enable trusted proxy handling behind a locked-down TLS proxy.

## Telephone access

Twilio HTTP signatures are checked against the configured canonical public URL and the configured account SID. Incoming/outgoing phone identities must match the exact owner/provisioned assistant numbers. Spoofable caller ID is never sufficient.

DTMF PIN verification precedes private context retrieval, conversation creation or AI tools. Attempts are persistent: at most three per call and ten total attempts over a rolling day. A successful PIN mints a 60-second, single-use token bound to that actual call SID; its hash is stored, and consumption is transactional. WebSocket upgrade signature, stream/call identity, audio format/rate/channels and bounded frames are checked separately.

Phone verification is earned by a signed, correctly authenticated incoming call. Changing the owner number resets verification and outgoing consent; active/unknown phone calls must first be resolved. Outgoing calls never use a model-provided destination.

A six-digit PIN is not a passkey/MFA replacement for highly sensitive web actions. High-impact external approval requires dashboard password reauthentication and exact scope authorization. Keep the PIN private, avoid reused/sequential values, and do not speak it into AI audio. Twilio necessarily processes DTMF/webhooks and may retain independent diagnostic metadata; review provider console/debug retention.

## Action authorization

Risk is server-defined, not whatever the model claims:

- **Low:** internal note/task/project/memory/check-in management within the owner account.
- **Confirmation:** message, calendar event or third-party calling proposal; dashboard review of exact destination/content/time/scope.
- **High:** money, agreements or private information disclosure; exact action scope, unexpired approval, password reauthentication and explicit `AUTHORIZE`.

There is no general web/shell executor. Only `note.create` has an executable internal adapter. All external proposals remain non-executable with a clear 501 response. Approval is not success and unrelated earlier consent is not reused as permission. Future executors require legal/consent safeguards and idempotency/unknown-outcome tests before activation.

## Recording, transcripts and summaries

The application never requests automatic conversation audio recording (`record:false` for outbound calls); incoming TwiML contains no recording verb. No audio files are saved. Real AI necessarily receives audio/text to perform the service. Independently confirm provider/account workflows do not enable recording or unexpected retention.

Raw transcript retention is **off by default**. When enabled, it stores text under the owner/conversation, not audio. Disabling retention deletes existing retained message rows. Summaries are a separate option and are labeled assistant interpretations, not verified facts. Conversation and metadata policies are documented below.

Credential-pattern detection blocks recognizable passwords/PINs/API keys in typed chat and memory before provider submission/persistence, and redacts recognizable strings in retained transcripts/summaries. **This is heuristic defense in depth, not comprehensive PII/DLP.** Live spoken audio reaches the provider before a transcript exists; redaction cannot retroactively unsend it. Do not enter or speak credentials into ordinary conversations.

## Retrieval and correction

Memory has explicit confidence/provenance; differing facts with the same specific subject form a contradiction group rather than silently overwriting verified history. The owner can select a confirmed correction and mark other conflicting records outdated. Model-created memories cannot choose `confirmed` through the remember tool.

Disabled categories are excluded from **stored memory retrieval and embedding indexing**. Project/task records, communication settings and conversation summaries are separate context domains. Category exclusion does not remove every mention of that subject in those independent records or erase already-sent provider context. End active sessions and edit/delete related records when changing privacy intent. Turning off summary generation does not automatically erase old summaries.

Sensitive memories are not sent for embedding indexing; marking a previously indexed memory sensitive clears its stored embedding. Optional semantic retrieval has a bounded candidate scan and is off by default. Model-facing context/receipts contain excerpts and confidence, never embedding vectors. Export/dashboard preserve full stored records.

Deleting a memory removes its actual database row and associated embedding, not merely a visibility flag. It does not automatically rewrite other task notes, conversation summaries or provider copies that separately mention the fact.

## Deletion and retention

- Memory deletion removes the actual stored record/vector.
- Conversation deletion removes that conversation, optional message rows, tool receipts and association rows. Independently created long-term memories/tasks can remain, with source links set null where appropriate. Call metadata can remain without its removed summary.
- Account erasure requires password plus `DELETE ALL PERSONAL DATA`, blocks active/**unresolved** voice tracking and deletes the owner with cascading personal records, settings, credentials and sessions. Bootstrap stays consumed so deletion cannot expose open account takeover; an authorized operator must intentionally re-enable setup.
- Active/unknown voice records cannot be erased via their conversation to evade budgets/reconciliation. Retention also preserves such unresolved tracking.
- Conversation retention defaults to 90 days and is configurable 1–365. Cleanup runs on startup/hourly; application text caches are evicted for deleted conversations. Expired sessions/tokens/PIN-attempt records, old webhook receipts and 90-day audit/usage records are cleaned according to their code policies. Long-term memory/tasks/projects/schedules and call metadata remain until deleted by owner/account erasure.

**SQL row deletion is not guaranteed secure erasure of old database pages, WAL, replicas or backups.** Encrypt storage/backups and configure their expiry. Managed PostgreSQL/Supabase backups, Twilio call/DTMF/diagnostic records and OpenAI processing/retention follow independent provider policies. `store:false` is not a contractual zero-retention guarantee. Provider-side deletion, legal retention, API-key revocation, environment/secrets removal and physical host destruction are separate operator actions. The application cannot claim to purge third-party backups or invoices.

## Logging and monitoring

Logs omit request query strings, credential headers and sensitive payloads; unexpected failures log a code/request ID rather than upstream bodies. Audits contain operation metadata, not memory/conversation/PIN text. Logging infrastructure, proxy access logs, provider dashboards and trace artifacts still need operator privacy review. Do not upload real personal traces as public CI artifacts.

`/healthz` proves process liveness, `/readyz` proves a database query. Neither proves AI/audio/telephone availability. System Status separates configured/disabled/unconfigured from real database/worker health and records the timestamp of accepted provider events without asserting an end-to-end live call was verified.

## Reliability and spending boundary

Owner-row locks serialize paid reservations/settings mutations. Job occurrence/version uniqueness, leases, atomic claims and idempotent tool/event receipts prevent ordinary duplicate processing. Ambiguous provider creates are never automatically retried. A signed matching callback may settle a known actual call; otherwise manual reconciliation is required. Unknown outcomes retain concurrency and cost estimates, including across midnight/restarts.

Maximum-duration and local microphone timers supplement provider controls; an outage can prevent confirmed remote termination. Application spend/token/request controls use conservative estimates and returned usage, **not an infallible invoice-level hard cap**. Configure provider billing/fraud/geographic controls and reconcile actual invoices before relying on the estimates. Existing protective call termination/lookups remain allowed when the new-call switch is off, provided credentials exist.

## Remaining security gates

Actual public TLS/proxy behavior, production roles/Supabase exposure, remote backup restore, provider retention and billed usage, physical mobile microphone/permissions, independent penetration testing, cross-replica voice affinity and comprehensive adversarial prompt/data testing are unverified. Start with one replica and low limits. There is no public email password-reset/MFA/passkey integration; lost-account recovery is an authorized infrastructure operator task, not an open endpoint. Do not weaken phone/signature/origin/CSRF gates to make live tests pass.
