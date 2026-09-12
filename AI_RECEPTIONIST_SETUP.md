# Jobrin.ai AI receptionist setup

Read [AI_RECEPTIONIST_ARCHITECTURE.md](./AI_RECEPTIONIST_ARCHITECTURE.md) before enabling this feature. It is the source of truth for the per-call Durable Object design, tool boundaries, rollout gates and required launch controls.

## Configured in admin UI

These settings exist and are safe to prepare, but a switch does not make the corresponding action callable by the live model:

- Tenant-isolated receptionist profile, custom name, greeting, tone, instructions, voice provider, voice and language.
- Warm-transfer, message-taking, booking, follow-up SMS and recording/consent controls.
- Booking remains gated to Phase 2 and follow-up SMS to Phase 3. Warm transfer is an initial-release capability in the architecture, but its runtime tool is not implemented yet.

## Callable at runtime

- Phase 1 currently exposes only the `take_message` function to the live receptionist model. It creates a lead used as the callback task after the model captures the reason and contact details.
- Approved-information answers run without a tool from the active workspace context.
- Booking, warm transfer, follow-up SMS and Stripe Checkout are not registered in the live receptionist's model tool list. Entries for `appointment.book` and `message.send_template` in the separate operator registry do not expose them to a phone call.
- Signed Twilio voice/completion webhooks, per-call Durable Object routing, call rows and safe speech on OpenAI failure are present. DTMF actions, durable reconnect recovery and the documented ConversationRelay outage route are still gaps listed below.

## Go-live lock: code versus process

The current `PUT /api/receptionist` lock is narrower than the seven-item architecture checklist. It code-checks a syntactically configured Twilio account/auth token/E.164 number, an OpenAI key, an HTTPS public URL and an attached conversation engine. It does not record a successful real call or verify the full checklist, so passing the lock is not production sign-off.

| Architecture checklist item | Current enforcement |
| --- | --- |
| 1. ConversationRelay access and one Australian Twilio number mapped to exactly one workspace | **Partly code-enforced.** The lock validates Twilio credential/number shape. Unique workspace mapping, Australian assignment and ConversationRelay account access are process-only and not yet enforced by the lock. |
| 2. Staging Worker Durable Object binding and separate staging secrets | **Process-only.** Wrangler declares a staging Durable Object binding, but the live lock does not inspect a staging deployment or secret separation. |
| 3. HTTPS plus signed webhook/WebSocket handshake passing a real Twilio call | **Partly code-enforced.** HTTPS and an attached engine are checked. HTTP webhook routes verify Twilio signatures and the WebSocket upgrade validates the signed call token, but the upgrade does not currently verify `X-Twilio-Signature`. A successful real handshake/test call is not persisted or checked by the lock. |
| 4. Complete business profile, approved knowledge, conduct, service area, hours, transfer rule and escalation wording | **Process-only.** Field schemas enforce basic types and lengths, not semantic completeness or approved supporting records. Not yet enforced by the lock. |
| 5. Recording/privacy notice, retention, Australian legal review and explicit residency decisions | **Process-only.** Not yet enforced by the lock. |
| 6. Phase 1 tests pass and business owner signs off after transcript review | **Process-only.** No test-run/sign-off record is checked by the lock. |
| 7. Staging sign-off before production | **Process-only.** Deployment scripts exist, but the application lock does not prove promotion from signed-off staging. |

Items 1, 3, 4 and 5 contain code-enforceable facts that remain tracked gaps. Until durable readiness evidence is added and checked, operators must treat all process-only rows as mandatory manual gates, not optional guidance.

## Provider and hosting steps still required

1. Store the Supabase service role, least-privilege Stripe key, Stripe webhook secret and Price IDs as Cloudflare Worker Secrets.
2. Store the Twilio Account SID, Auth Token and E.164 Twilio number as server secrets. Never use `VITE_` for these.
3. Store `OPENAI_API_KEY` as a server secret.
4. Deploy staging with `npm run cf:deploy:staging`; deploy production only after all required Worker Secrets and provider tests pass.
5. Set `APP_URL=https://jobrin.ai` and `CORS_ORIGINS=https://jobrin.ai,https://www.jobrin.ai`.
6. Complete Twilio Conversation Relay onboarding and accept its AI/ML addendum.
7. Set the Twilio number's POST Voice URL to `https://jobrin.ai/api/twilio/voice`.
8. Verify the implemented `/api/receptionist/conversation` Worker route and one-Durable-Object-per-call binding in staging. Its short-lived call token is validated before Durable Object routing; complete the remaining reconnect and handshake-hardening gaps below before relying on it in production.
9. Complete the canonical test catalogue in [AI_RECEPTIONIST_ARCHITECTURE.md § Phase 0/1 testing](./AI_RECEPTIONIST_ARCHITECTURE.md#phase-01-testing). Do not maintain a shorter duplicate list here.

## Product pattern

The design uses the strongest common ideas from Smith.ai, Goodcall and Dialzara: custom greetings and voices, approved business knowledge, service-aware intake, one question at a time, qualification, booking, warm transfers, message fallback, call summaries and configurable follow-up. Jobrin.ai adds tenant isolation, explicit consent and a test-before-live lock.

## Safety rules

- Never collect card details in an AI conversation. Stripe-hosted Checkout is generated only by authenticated server-side subscription or invoice-payment flows; it is not a receptionist model tool.
- Do not record without disclosure and affirmative consent.
- Never invent prices, availability, policies or completed actions.
- Do not make marketing calls or messages without recorded consent and suppression checks.
- Escalate emergencies, threats, safety-critical cases and requests for a person.

## Known gaps — tracked, not yet implemented

No matching repository issue links were found; these entries are the current in-repository tracking record and should be replaced with issue links when issues are opened.

| Gap | Status | Evidence / required outcome |
| --- | --- | --- |
| Deterministic idempotency key for receptionist tool calls | **Not started** | The architecture defines the derivation, but the live `take_message` path does not persist a turn/action ledger or use that key. Stripe invoice Checkout has separate backend idempotency and does not close this gap. |
| Per-workspace concurrency, per-caller rolling-hour limit, maximum call duration and turn count | **Not started** | No gateway/session enforcement was found. Implement the configurable ceilings and graceful callback wrap-up defined by the architecture. |
| Durable Object hibernation/reconnect behavior | **Not started** | A reconnect creates a new in-memory session; persisted turn/action recovery, fresh-token reissue flow and the caller acknowledgment are not implemented. |
| WebSocket handshake signature verification | **In progress** | The upgrade validates a short-lived signed call token before Durable Object routing, but does not verify `X-Twilio-Signature` as required by the architecture. This remains a production blocker. |
| ConversationRelay outage fallback | **Not started** | The voice route has safe wording when the profile/OpenAI/HTTPS prerequisite is absent, but no ConversationRelay health failure path performs the specified direct transfer or voicemail/callback fallback. |
| Full seven-item go-live readiness evidence | **Not started** | The current lock checks four runtime prerequisites only. Add durable, audited readiness records for the code-enforceable checklist facts and require them when enabling live answering. |
