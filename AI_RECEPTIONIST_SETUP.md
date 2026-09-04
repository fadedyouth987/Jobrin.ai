# Jobryn AI receptionist setup

Read [AI_RECEPTIONIST_ARCHITECTURE.md](./AI_RECEPTIONIST_ARCHITECTURE.md) before enabling this feature. It is the source of truth for the per-call Durable Object design, tool boundaries, rollout gates and required launch controls.

## Implemented now

- Tenant-isolated receptionist profiles with Row Level Security.
- Custom receptionist name, greeting, tone, instructions, provider, voice and language.
- Warm-transfer, message-taking, booking, follow-up SMS and recording-consent controls.
- Signed Twilio inbound voice and completion webhooks.
- Call records associated with one workspace and provider call ID.
- Safe fallback speech whenever live AI is unavailable.
- A go-live lock: settings can be prepared, but live calls cannot be enabled until the signed WebSocket engine passes a real test call.

## Provider and hosting steps still required

1. Store the Supabase service role, least-privilege Stripe key, Stripe webhook secret and Price IDs as Cloudflare Worker Secrets.
2. Store the Twilio Account SID, Auth Token and E.164 Twilio number as server secrets. Never use `VITE_` for these.
3. Store `OPENAI_API_KEY` as a server secret.
4. Deploy staging with `npm run cf:deploy:staging`; deploy production only after all required Worker Secrets and provider tests pass.
5. Set `APP_URL=https://jobryn.org` and `CORS_ORIGINS=https://jobryn.org,https://www.jobryn.org`.
6. Complete Twilio Conversation Relay onboarding and accept its AI/ML addendum.
7. Set the Twilio number's POST Voice URL to `https://jobryn.org/api/twilio/voice`.
8. Implement `/api/receptionist/conversation` with a Cloudflare Durable Object or Agent so each call has isolated WebSocket state. It must validate `X-Twilio-Signature` during the handshake.
9. Test FAQ, new lead, urgency, booking, transfer, after-hours, interruption, consent refusal and provider failure before unlocking live calls.

## Product pattern

The design uses the strongest common ideas from Smith.ai, Goodcall and Dialzara: custom greetings and voices, approved business knowledge, service-aware intake, one question at a time, qualification, booking, warm transfers, message fallback, call summaries and configurable follow-up. Jobryn adds tenant isolation, explicit consent and a test-before-live lock.

## Safety rules

- Never collect card details in an AI conversation. Send Stripe-hosted Checkout instead.
- Do not record without disclosure and affirmative consent.
- Never invent prices, availability, policies or completed actions.
- Do not make marketing calls or messages without recorded consent and suppression checks.
- Escalate emergencies, threats, safety-critical cases and requests for a person.
