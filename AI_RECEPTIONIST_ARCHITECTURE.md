# Jobryn AI receptionist: production architecture

## The decision

Use **Twilio ConversationRelay -> a Cloudflare Worker gateway -> one Cloudflare Durable Object per call -> Jobryn's controlled business tools and Supabase**.

This is intentionally not a free-roaming chatbot and not a shared "AI brain" for all callers. A phone call is a real-time, private, operational workflow. One Durable Object, deterministically named from one Twilio Call SID, owns only that call's state. It makes call state durable through WebSocket hibernation and prevents a caller from ever sharing context with another business or caller.

ConversationRelay is the initial voice layer. It provides the telephone connection, speech recognition, text-to-speech and interruption handling. The call object streams short model responses back as Twilio `text` messages. This is simpler and safer than building a second audio transport to a speech-to-speech model. Native realtime audio can be evaluated later, after the reliable workflow is proven.

The receptionist must say it is the business's virtual receptionist. It should sound warm and natural, but must never pretend to be a human employee.

## What the receptionist can do

| Capability | Initial release | Guardrail |
| --- | --- | --- |
| General enquiries | Yes | Answers only from owner-approved business facts, services, service area, hours and policies. |
| New lead intake | Yes | Captures only the details needed to follow up; confirms the callback contact details. |
| Existing customer recognition | Yes | Matches the caller number only within the mapped workspace. |
| Warm transfer | Yes | Only to the configured number, when the caller asks or an escalation rule applies. |
| Callback request | Yes | Creates a task with a stated reason and requested time; no unsolicited marketing. |
| Booking suggestions | Yes, after pilot validation | Reads real availability and presents options. |
| Confirmed booking | Later in phase 2 | Requires caller confirmation immediately before the server-side booking tool runs. |
| Follow-up SMS | Later in phase 3 | Requires an approved transactional template and consent/suppression check. |
| Owner-approved outbound callback | Later in phase 3 | One approved reason, contact, time window and attempt limit per task. |

Never allow the receptionist to take card details, quote a binding price, issue refunds, make employment decisions, give emergency/safety advice, promise technician availability, or change business policy. It must hand off when unsure, when a caller requests a person, or for safety, legal, financial, complaint or urgent issues.

## The call path

```text
Caller
  -> Twilio number
  -> signed POST /api/twilio/voice (Jobryn Express application)
  -> workspace is selected from the dialled Twilio number
  -> call row is created + a short-lived, signed call token is issued
  -> Twilio ConversationRelay opens WSS /api/receptionist/conversation?token=...
  -> Cloudflare Worker validates WebSocket upgrade, Twilio signature and call token
  -> Durable Object `receptionist-call:<CallSid>` accepts this one connection
  -> approved context + guarded tools
  -> Supabase records the resulting lead, appointment, callback and call summary
```

The Worker checks an invalid request before forwarding it to a Durable Object. The Durable Object uses the hibernating WebSocket API and SQLite only for short-lived call state: the call identity, turn ledger, active tool action, caller consent state and handoff state. It stores no critical state only in memory and never uses one object for every business.

## Business knowledge, conduct and goals

The current `receptionist_profiles.business_instructions` field is a useful draft, but it is not enough to run a business safely. The admin setup needs structured, owner-approved records:

1. **Identity and coverage** — trading name, suburb/service area, hours, after-hours rules, emergency wording and transfer number.
2. **Services and booking rules** — what can be booked, duration, staff/calendar rules, deposits, areas and exceptions.
3. **Approved answers** — FAQs, product/service facts, warranties and pricing language. Each answer has an owner, status and review date.
4. **Code of conduct and hard boundaries** — tone, accessibility needs, complaints path, safety escalation, things it must not say or do.
5. **Follow-up policy** — acceptable reasons, permitted hours, attempt limit, approved SMS templates and consent requirements.
6. **Learning inbox** — AI-proposed improvements are never live until an owner approves them. They do not overwrite conduct, prices, policies or booking rules.

The model receives a concise, signed snapshot of only the active workspace's approved context. It does not receive raw cross-business records, secrets or unreviewed memory.

## Controlled tools

The language model never writes directly to Supabase and it cannot choose arbitrary actions. It may request a named tool; a server-side policy layer validates workspace scope, caller consent, schemas, entitlement, idempotency and current state before executing it.

| Tool | Permission | Final control |
| --- | --- | --- |
| `knowledge.search` / `service.lookup` | Automatic | Approved, active workspace data only. |
| `customer.lookup_by_caller` | Automatic | Caller number is the sole lookup key; returns minimal details. |
| `availability.check` | Automatic | Reads real schedule, booking hours and service rules. |
| `lead.capture` / `callback.create` | Policy-controlled | Confirms contact details and requested callback with caller. |
| `handoff.warm_transfer` | Policy-controlled | Caller request or defined escalation; configured target only. |
| `appointment.book` | Policy-controlled | Requires a spoken final confirmation, current availability and an idempotency key. |
| `message.send_template` | Policy-controlled | Approved transactional template plus consent and suppression check. |
| `outbound_call.start` | Approval required | A named owner-approved callback task only; no bulk/autonomous calling. |
| payments, refunds, pricing changes, staff permissions | Prohibited | Never exposed to the model. |

## Security and reliability requirements

- Verify `X-Twilio-Signature` at every HTTP webhook and at the ConversationRelay WebSocket handshake using the exact public URL.
- Replace the current public `workspaceId` Relay parameter with a short-lived HMAC-signed call token bound to Call SID, workspace, dialled number and expiry. Validate the Call SID again when Twilio's `setup` message arrives.
- Keep Twilio, Supabase service-role and OpenAI credentials as Cloudflare Worker secrets only. Never expose them in Vite/browser variables or transcripts.
- Redact sensitive data before model prompts. Do not record by default. If recording is enabled, disclose it and obtain affirmative consent before recording; configure retention, deletion and export before go-live.
- Treat caller speech, uploaded knowledge and tool outputs as untrusted data. They cannot modify system rules or tool policy.
- Persist a turn/action ledger before external tool calls and use idempotency keys. A dropped WebSocket, provider retry or duplicate status callback must not create duplicate bookings or messages.
- Set short response and tool timeouts. On failure, use Twilio's safe fallback wording and offer transfer/message capture; never claim an action succeeded without the tool result.
- Log call ID, workspace ID, event type, latency and error code—not full caller content—to operational logs. Store any retained transcript in the tenant-scoped application database under a documented retention policy.

## Rollout gates

### Phase 0 — build and test

Build the signed WebSocket gateway, per-call Durable Object, tool policy layer and test-call console. Keep `enabled=false`. Unit-test token validation and tool idempotency; test Twilio setup, prompt, interrupt, DTMF, end, disconnect and completion events.

### Phase 1 — inbound receptionist pilot

Enable only approved-information answers, lead capture, warm transfer and callback requests. Run at least 100 scripted scenarios and real internal calls before a small opt-in pilot. Monitor time-to-first-response, interruption recovery, missed handoffs, unsafe attempts and caller feedback.

### Phase 2 — controlled booking

Enable availability reading and booking only for clearly configured services. The caller hears the exact proposed date/time and says yes immediately before the booking tool runs. Test conflict, calendar failure, after-hours and double-submit cases.

### Phase 3 — follow-up

Allow customer-requested callbacks first, then owner-approved outbound callbacks and compliant transactional follow-up SMS. There is no autonomous marketing campaign feature in this product phase.

### Phase 4 — learning with approval

Show suggested FAQ and workflow improvements in an approval inbox. Measure rather than guess: successful resolution, transfer rate, booking completion, callback completion, corrections, negative feedback and cost per resolved call.

## Go-live checklist

1. Twilio ConversationRelay access enabled; dedicated Australian number assigned to exactly one workspace.
2. Cloudflare staging Worker has a Durable Object binding and separate staging secrets.
3. The app's public URL is HTTPS; signed inbound webhook and signed WebSocket handshake pass a real Twilio test call.
4. Business profile, approved knowledge, code of conduct, service area, hours, transfer rule and escalation wording are complete.
5. Recording/privacy notice, data retention and Australian legal review are complete for the launch business.
6. All phase-1 tests pass, including failures and human handoff; a business owner signs off after reviewing test transcripts.
7. Production is deployed only after staging sign-off. The UI's existing live-answering lock remains until this checklist is satisfied.
