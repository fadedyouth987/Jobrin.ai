# Jobrin.ai AI receptionist setup

Read [AI_RECEPTIONIST_ARCHITECTURE.md](./AI_RECEPTIONIST_ARCHITECTURE.md) before enabling this feature. It is the source of truth for the per-call Durable Object design, tool boundaries, rollout gates and required launch controls.

## Implemented now

- Tenant-isolated receptionist profiles with Row Level Security.
- Custom receptionist name, greeting, tone, instructions, provider, voice and language.
- Warm transfer and idempotent callback/message capture.
- Signed ConversationRelay WebSocket gateway, scoped call tokens and one hibernating SQLite-backed Durable Object per call.
- AI-processing disclosure at the start of every live call; no transcript retention or recording in Phase 0.
- Signed Twilio inbound voice and completion webhooks.
- Call records associated with one workspace and provider call ID.
- Safe fallback speech whenever live AI is unavailable.
- A go-live lock: settings can be prepared, but live calls cannot be enabled until the signed WebSocket engine passes a real test call.

## Provider and hosting steps still required

1. Store the Supabase service role, least-privilege Stripe key, Stripe webhook secret and Price IDs as Cloudflare Worker Secrets.
2. Store the Twilio Account SID, Auth Token and E.164 Twilio number as server secrets. Never use `VITE_` for these.
3. Store `OPENAI_API_KEY` as a server secret.
4. Deploy staging with `npm run cf:deploy:staging`; deploy production only after all required Worker Secrets and provider tests pass.
5. Set `APP_URL=https://jobrin.ai` and `CORS_ORIGINS=https://jobrin.ai,https://www.jobrin.ai`.
6. Complete Twilio Conversation Relay onboarding and accept its AI/ML addendum.
7. Set the Twilio number's POST Voice URL to `https://jobrin.ai/api/twilio/voice`.
8. Configure the staging Worker secrets and apply the Supabase migrations before testing. The gateway validates `X-Twilio-Signature` against the exact `wss://` URL and validates a short-lived, workspace-bound call token.
9. Test FAQ, new lead, urgency, transfer, after-hours, interruption, provider failure and a forced mid-call reconnect before unlocking live calls. Booking, follow-up SMS and recording are deliberately unavailable until their dedicated policy, consent and retention flows are complete.

## Product pattern

The design uses custom greetings and voices, approved business knowledge, service-aware intake, one question at a time, qualification, warm transfers and message fallback. Jobrin.ai adds tenant isolation, explicit AI-processing disclosure and a test-before-live lock. Controlled booking, SMS follow-up, recording and retained summaries are later rollout phases.

## Safety rules

- Never collect card details in an AI conversation. Send Stripe-hosted Checkout instead.
- Every call starts with an AI-processing disclosure. Do not record or retain transcripts during Phase 0.
- Never invent prices, availability, policies or completed actions.
- Do not make marketing calls or messages without recorded consent and suppression checks.
- Escalate emergencies, threats, safety-critical cases and requests for a person.
