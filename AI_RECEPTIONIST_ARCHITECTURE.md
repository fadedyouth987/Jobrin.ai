# Jobrin.ai AI receptionist: production architecture

## The decision

Use **Twilio ConversationRelay -> a Cloudflare Worker gateway -> one Cloudflare Durable Object per call -> Jobrin.ai's controlled business tools and Supabase**.

OpenAI is the initial language-model provider, using the server-configured `OPENAI_MODEL` through OpenAI's API. There is no second LLM provider in the initial release; if OpenAI is unavailable, the receptionist follows the deterministic transfer/message fallback instead of silently switching providers.

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
| DTMF human escape | Yes | Pressing `0` at any time requests a human transfer, independently of whether the model recognizes a spoken request; if transfer is unavailable, offer message or voicemail capture. |
| Callback request | Yes | Creates a task with a stated reason and requested time; no unsolicited marketing. |
| Booking suggestions | Yes, after pilot validation | Reads real availability and presents options. |
| Confirmed booking | Later in phase 2 | Requires caller confirmation immediately before the server-side booking tool runs. |
| Follow-up SMS | Later in phase 3 | Requires an approved transactional template and consent/suppression check. |
| Approval-gated outbound callback | Later in phase 3 | One role-approved reason, contact, time window and attempt limit per task. |

Never allow the receptionist to take card details, quote a binding price, issue refunds, make employment decisions, give emergency/safety advice, promise technician availability, or change business policy. It must hand off when unsure, when a caller requests a person, or for safety, legal, financial, complaint or urgent issues.

## The call path

```text
Caller
  -> Twilio number
  -> signed POST /api/twilio/voice (Jobrin.ai Express application)
  -> workspace is selected from the dialled Twilio number
  -> call row is created + a short-lived, signed call token is issued
  -> Twilio ConversationRelay opens WSS /api/receptionist/conversation?token=...
  -> Cloudflare Worker validates WebSocket upgrade, Twilio signature and call token
  -> Durable Object `receptionist-call:<CallSid>` accepts this one connection
  -> approved context + guarded tools
  -> Supabase records the resulting lead, appointment, callback and call summary
```

The Worker checks an invalid request before forwarding it to a Durable Object. The Durable Object uses the hibernating WebSocket API and SQLite only for short-lived call state: the call identity, turn ledger, active tool action, caller consent state and handoff state. It stores no critical state only in memory and never uses one object for every business.

If the ConversationRelay WebSocket drops, reconnection requires a fresh, short-lived signed call token bound to the same Call SID and workspace. Requiring a fresh token limits replay of a captured or expired URL while the Durable Object identity preserves the call state. On reconnect, the Durable Object reads the persisted turn/action ledger; an action recorded as in flight is retried or reconciled with the same idempotency key, never issued as a new action. The receptionist gives one short acknowledgment—“We got disconnected for a moment, but I’m back”—before resuming, because a silent resume can leave the caller unsure whether the call is still live.

If Twilio ConversationRelay is degraded or unavailable before or during setup, the signed voice webhook uses ordinary Twilio call handling to transfer directly to the workspace's configured fallback number. If that number is absent or does not answer, it falls back to standard voicemail capture and creates a callback task; it must not leave the caller in silence or a retry loop.

## Business knowledge, conduct and goals

The current `receptionist_profiles.business_instructions` field is a useful draft, but it is not enough to run a business safely. The admin setup needs structured, owner-approved records:

1. **Identity and coverage** — trading name, suburb/service area, hours, after-hours rules, emergency wording and transfer number.
2. **Services and booking rules** — what can be booked, duration, staff/calendar rules, deposits, areas and exceptions.
3. **Approved answers** — FAQs, product/service facts, warranties and pricing language. Each answer has an owner, status and review date.
4. **Code of conduct and hard boundaries** — tone, accessibility needs, complaints path, safety escalation, things it must not say or do.
5. **Follow-up policy** — acceptable reasons, permitted hours, attempt limit, approved SMS templates and consent requirements.
6. **Learning inbox** — AI-proposed improvements are never live until an authorized role approves them under the workflow below. They do not overwrite conduct, prices, policies or booking rules.

The model receives a concise, signed snapshot of only the active workspace's approved context. It does not receive raw cross-business records, secrets or unreviewed memory.

That signed context snapshot is deliberately locked for the duration of the call. An owner edit to hours, approved answers, conduct or policy during a live call affects only calls that begin after the edit is saved; calls already in progress finish against the version they started with. This makes the facts and rules governing each call reviewable and reproducible.

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
| `outbound_call.start` | Approval required | A named callback task approved by a workspace `owner` or `admin` with the receptionist-approval permission; no bulk/autonomous calling. |
| payments, refunds, pricing changes, staff permissions | Prohibited | Never exposed to the model. |

Every write tool derives its idempotency key deterministically as `SHA-256(workspace_id + ":" + call_sid + ":" + tool_name + ":" + turn_index)`, where `turn_index` is allocated and persisted by the Durable Object before execution. Retries and reconnect recovery reuse the persisted turn index and therefore the same key; the tool executor stores the key with the result and returns that result on duplicates.

Postgres row-level security is required on every multi-tenant table, with policies scoped by `workspace_id`. RLS is defense in depth alongside the tool policy layer's application-level workspace checks; it does not replace those checks or authorize the model to access Supabase directly.

Stripe Checkout is outside the receptionist model's tool surface. The current Stripe Checkout flows are server-side subscription billing and authenticated invoice-payment flows; an invoice send may attach a server-generated Stripe-hosted URL, but the model cannot create, choose an amount for, or send a Checkout link during a call.

Approval-gated actions use a common workflow. For `outbound_call.start`, a workspace `owner` or `admin` with the receptionist-approval permission approves the exact contact, reason, time window and attempt limit; pending requests have a one-business-day review target and expire automatically at the earlier of 24 hours or the start of the requested window. Phase 4 learning proposals may be approved by a workspace `owner`, `admin`, or explicitly delegated `manager`; they have a five-business-day review target and expire after 30 days. Expiry never implies approval. The audit trail records the approval request and immutable payload, prior state/version, approver user and role, decision and note, decision timestamp, expiry, and the resulting state/version.

## Security and reliability requirements

- Verify `X-Twilio-Signature` at every HTTP webhook and at the ConversationRelay WebSocket handshake using the exact public URL.
- Replace the current public `workspaceId` Relay parameter with a short-lived HMAC-signed call token bound to Call SID, workspace, dialled number and expiry. Validate the Call SID again when Twilio's `setup` message arrives.
- Keep Twilio, Supabase service-role and OpenAI credentials as Cloudflare Worker secrets only. Never expose them in Vite/browser variables or transcripts.
- Redact sensitive data before model prompts. If a caller volunteers card numbers, passwords, authentication codes or other secrets while leaving a message or lead details, scrub them before storage, operational logs and any later model-context turn; do not rely only on the rule that the receptionist must not ask for them. Do not record by default. If recording is enabled, disclose it and obtain affirmative consent before recording; configure retention, deletion and export before go-live.
- Treat caller speech, uploaded knowledge and tool outputs as untrusted data. They cannot modify system rules or tool policy.
- Persist a turn/action ledger before external tool calls and use idempotency keys. A dropped WebSocket, provider retry or duplicate status callback must not create duplicate bookings or messages.
- Set short response and tool timeouts. On failure, use Twilio's safe fallback wording and offer transfer/message capture; never claim an action succeeded without the tool result.
- Log call ID, workspace ID, event type, latency and error code—not full caller content—to operational logs. Store any retained transcript in the tenant-scoped application database under a documented retention policy.

### Abuse and cost ceilings

Limits are per-workspace configuration, with centrally enforced platform defaults when a workspace has not chosen stricter values. The provisional launch defaults, to be confirmed before Phase 1, are 5 concurrent calls per workspace, 6 calls from the same caller number in a rolling hour, 30 minutes per call and 80 caller/model turns per call. Anonymous or withheld caller numbers use an equivalent privacy-preserving caller fingerprint for the hourly limit. The gateway rejects or routes excess new calls to the configured transfer/voicemail fallback. When an active call reaches its duration or turn ceiling, the receptionist says, “I need to wrap up — let me get you a callback,” captures or confirms the callback details, persists the task and then ends cleanly rather than cutting off mid-sentence. Changes to these settings are audited, bounded by platform-wide safety maxima and take effect only for new calls.

## Rollout gates

### Phase 0 — build and test

Build the signed WebSocket gateway, per-call Durable Object, tool policy layer and test-call console. Keep `enabled=false`. Unit-test token validation and tool idempotency, and complete the canonical Phase 0/1 test catalogue below.

### Phase 1 — inbound receptionist pilot

Enable only approved-information answers, lead capture, warm transfer and callback requests. Run at least 100 scripted scenarios and real internal calls before a small opt-in pilot. Phase 1 cannot exit until the adversarial suites from Phase 0 also pass on representative PSTN calls.

#### Phase 0/1 testing

This is the single canonical receptionist test catalogue. Exercise each applicable case as a unit/integration test and as a real or representative PSTN call before Phase 1 exit:

- Approved FAQ answer and unknown-FAQ handoff/message capture.
- New-lead intake, required-detail confirmation and callback-task creation.
- Urgent and safety-sensitive language, including correct emergency wording and human escalation.
- Booking suggestion and attempted confirmation, including the Phase 1 gate that prevents runtime booking; for Phase 2 readiness, cover conflicts, stale availability and final spoken confirmation.
- Spoken transfer request, rule-triggered transfer and unavailable-transfer fallback.
- DTMF handling, including `0` at any time as the independent human escape hatch.
- After-hours behavior and configured fallback wording.
- Interruption/barge-in handling and recovery.
- Recording or follow-up consent refusal, proving no recording or message send occurs.
- OpenAI, tool-provider and ConversationRelay failure behavior, including safe transfer/message/voicemail fallback.
- Twilio `setup`, `prompt`, `interrupt`, `dtmf`, `end`, disconnect, reconnect and completion events, including a fresh reconnect token and the caller-facing reconnect acknowledgment.
- Duplicate webhook, tool retry and double-submit protection, proving one durable result for one idempotency key.
- Prompt-injection attempts delivered through caller speech or quoted third-party instructions.
- Noisy, packet-degraded and heavily accented PSTN audio, measuring recognition, clarification and safe handoff.
- Attempts to talk the model into prohibited pricing, refunds, policy changes, credential disclosure or other unavailable tools.

Use these provisional pilot targets, to be confirmed by the product and operations leads before Phase 1 begins:

| Metric | Pilot target | Response to breach |
| --- | --- | --- |
| Time to first response | p95 at or below 2.5 seconds after the caller finishes the first utterance. | Alert on any rolling-hour breach; pause enrolment and investigate after two consecutive breached windows. |
| Interruption recovery | At least 95% of barge-ins stop speech and resume appropriately within 1.5 seconds. | Alert and human-review failed samples; pause the pilot if below target for two consecutive daily reviews. |
| Missed handoffs | Below 1% of calls where the caller requested a person or an escalation rule required one. | Immediate human review of every miss; pause the pilot on any safety/urgent miss or if the rolling rate reaches 1%. |
| Unsafe attempts | Zero successful prohibited tool actions and zero disclosures that violate the approved policy. | Immediately disable live answering for the affected workspace, preserve the minimal audit evidence and require security/product sign-off before resuming. |
| Caller feedback | Average at least 4.0/5, with no more than 10% of rated calls at 1–2/5. | Review low-rated calls weekly; pause expansion if either threshold is missed for two consecutive weekly cohorts. |

### Phase 2 — controlled booking

Enable availability reading and booking only for clearly configured services. The caller hears the exact proposed date/time and says yes immediately before the booking tool runs. Test conflict, calendar failure, after-hours and double-submit cases.

### Phase 3 — follow-up

Allow customer-requested callbacks first, then role-approved outbound callbacks under the approval workflow above and compliant transactional follow-up SMS. There is no autonomous marketing campaign feature in this product phase.

### Phase 4 — learning with approval

Show suggested FAQ and workflow improvements in an approval inbox governed by the roles, audit trail, review target and expiry above. Measure rather than guess: successful resolution, transfer rate, booking completion, callback completion, corrections, negative feedback and cost per resolved call.

## Go-live checklist

1. Twilio ConversationRelay access enabled; dedicated Australian number assigned to exactly one workspace.
2. Cloudflare staging Worker has a Durable Object binding and separate staging secrets.
3. The app's public URL is HTTPS; signed inbound webhook and signed WebSocket handshake pass a real Twilio test call.
4. Business profile, approved knowledge, code of conduct, service area, hours, transfer rule and escalation wording are complete.
5. Recording/privacy notice, data retention and Australian legal review are complete for the launch business. The deployment record must name the selected Supabase project region (`[TBD before production sign-off]`) and record whether Cloudflare jurisdictional restrictions/data-localization controls cover both the Worker and Durable Object (`[TBD: enabled with named jurisdiction, or documented exception approved by legal/security]`); production stays locked until both decisions are explicit and verified against the Australian data-residency requirement.
6. All phase-1 tests pass, including failures and human handoff; a business owner signs off after reviewing test transcripts.
7. Production is deployed only after staging sign-off. The UI's existing live-answering lock remains until this checklist is satisfied.
