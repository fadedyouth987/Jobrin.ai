# Receptionist-first redesign: plan mapped to the code

Date: 2026-11-06 · Branch: `claude/jobrin-receptionist-redesign-1l2o05` · Base: `959a18c`

This maps the "Jobrin Receptionist-First Redesign Plan" (7 Nov 2026) onto the
current repository. The plan was written without the repo. This document
records what already exists, what has to change, and where. Each status was
checked by reading the code at the commit above. "Verified" means it was run.
"Read" means it was checked by inspection only. Anything that depends on live
Supabase, Twilio or Stripe has **not** been tested against those services.

Baseline at `959a18c`: `npm run typecheck` passed, `npm test` passed
(173/173), and `npm run security:check` passed.

---

## 1. Answers to the plan's open questions

**Where is the repo?** `fadedyouth987/Jobrin.ai`. It is a React 19 + Vite
SPA (`src/`) and an Express API (`server/`). The API runs either on Node
(`node-server.ts`, Docker) or as a Cloudflare Worker (`worker.ts`,
`wrangler.jsonc`). The database is Supabase Postgres, with 38 migrations in
`supabase/migrations/`.

**How much of the voice pipeline already exists?** Nearly all of the
transport, and very little of the "call → job → alert" outcome:

| Piece | Status | Where |
| --- | --- | --- |
| Signed inbound voice webhook; workspace derived from the dialled number | Exists (read) | `server/routes/receptionist.ts` `webhookRouter.post('/voice')`, `twilioSignatureGuard` in `server/routes/communications.ts` |
| Multiple numbers per workspace | Exists | `workspace_phone_numbers` (migration `20260914010000`), `server/phoneNumbers.ts` |
| Short-lived HMAC call token bound to CallSid + workspace + number | Exists, unit-tested | `issueCallToken` / `verifyCallToken` in `server/ai/receptionistCall.ts` |
| ConversationRelay WS: Twilio `wss://` signature + token check | Exists on **Cloudflare only** | `worker.ts` `handleConversationUpgrade`, `validateTwilioWebSocket` in `server/providers/twilio.ts` |
| One Durable Object per CallSid with SQLite call state | Exists | `server/ai/receptionistDO.ts`, `wrangler.jsonc` |
| Virtual-receptionist disclosure at the start of every call | Exists | `/voice` builds `disclosure` + greeting |
| Recording | Deliberately blocked (a call with `recording_enabled` is refused) | `/voice` |
| Abuse limits (concurrent calls, calls per caller per hour, max minutes/turns) | Exists | `/voice`, `ReceptionistSession` |
| Warm transfer | Exists (DO `end-session` handoff → `/voice/complete` `<Dial>`) | `receptionistDO.ts`, `/voice/complete` |
| Go-live lock (owner sign-off + every dependency real) | Exists | `PUT /api/receptionist`, `server/ai/receptionistReadiness.ts` |
| Text-mode "simulate" of the same engine | Exists | `POST /api/receptionist/simulate` |
| **A job for every call** | **Missing.** A lead is created only when the model chooses the `take_message` tool. A hang-up creates nothing. | `recordMessageTake` in `receptionistCall.ts` |
| **One job per call** | **Missing.** The idempotency key is per turn (`receptionist:<CallSid>:message:<turn>`), so two message-takes in one call produce two leads. | same |
| Structured capture (suburb, job type, urgency) | Missing; only free text in `leads.description` | same |
| **Owner SMS alert** | **Missing**; only an in-app `notifications` row | `writeNotification` |
| **Caller confirmation SMS** | Missing | — |
| Call summary / transcript retained | Off. The DO calls `finalize(false)`, so the summary is discarded. | `receptionistDO.ts` `webSocketClose` |
| Test-call button | Missing (only the text simulator) | — |
| AU number provisioning / regulatory bundle | Missing; numbers are entered manually | `server/routes/integrations.ts` |

**Real cost per call minute:** not measurable from the repo. Usage metering
exists (`usage.ai_actions`, migration `0006`), but there is no per-call cost
column. Add `calls.cost_cents` (see §3) and measure it on test calls.

**Which trade and city go first:** this is a business decision. Nothing in
the code depends on it.

---

## 2. Phase 0: safe foundation, mapped

| Plan item | Current state | Action |
| --- | --- | --- |
| Audit the repo | Done (this document) | — |
| **Invite flow end to end** | The old bugs are gone: the route uses `inviteUserByEmail` and `invite.data.user.id`, with no `createUser`/`email_confirm`. **Three new defects were found and fixed in this branch** (see §6). | Remaining: inviting someone who **already has a login** returns `EMAIL_ALREADY_REGISTERED`. That blocks one person working in two workspaces, and it blocks you as a platform admin if you also hold a login. Needs a pending-invitation table plus an accept step (P1). |
| RLS / tenant isolation on receptionist tables | RLS is enabled on `calls`, `leads`, `customers`, `receptionist_profiles`, `workspace_phone_numbers`, `notifications`. Same-workspace FK triggers come from `0004`. The API re-checks membership from the JWT (`requireWorkspace` in `server/supabase.ts`); the `x-workspace-id` header is **not** trusted on its own. | There is **no executable two-workspace isolation test**. All existing tests are source-contract tests. Add an integration suite that runs against a staging Supabase project (needs credentials). |
| Twilio webhook + WS signature validation | HTTP webhooks: yes. Cloudflare WS: yes (`wss://` form). **Node/Docker WS (`server/ws/receptionistSocket.ts`): call token only, no Twilio signature check.** | Add `validateTwilioWebSocket` to the Node upgrade handler, or document that Docker is not a supported voice runtime (P1). |
| Stripe webhook verification, idempotency, trial, failed payment | Raw-body `constructEvent`, a `claim_stripe_webhook_event` lease RPC, canonical subscription re-fetch, `invoice.payment_failed` → `past_due` with grace (`server/routes/billing.ts`) | Keep. Re-test in Stripe test mode with the new prices (§4). |
| Feature flags per workspace; hide the "Hide" areas | **No per-workspace flags.** Entitlements are per plan (`shared/plans.ts`) and are enforced server-side through `requireActiveSubscription('<key>')`. Navigation is a static list (`src/app/workspaceNavigation.tsx`). | See §5. |

---

## 3. Data model: plan vs existing tables

Several table names in the plan **already exist with a different meaning**.
Do not create them as new tables.

| Plan table | Existing reality | Recommended change (new migration, no data loss) |
| --- | --- | --- |
| `jobs` (captured call inbox) | `public.jobs` already exists as **field-service jobs** (`0003`), with links to appointments, invoices and time/materials | Use **`leads`** as the "Jobs" inbox. It already has `stage` (`new/contacted/booked/won/lost/…`), `estimated_value_cents`, `lost_reason` and `customer_id`. Add `call_id uuid references calls`, `suburb text`, `job_type text`, `urgency text check (…)` and a `unique (workspace_id, call_id)` index for one job per call. In the UI, label it "Jobs"; the table stays `leads`. |
| `calls` | Exists (`0003`), with `unique (workspace_id, provider, provider_call_id)`, `summary`, `transcript`, `recording_url`, `duration_seconds`, `missed`, `outcome`, `turn_count` | Add `cost_cents`, `recording_consent boolean`. The CallSid key already exists per workspace. |
| `workspace_numbers` | `workspace_phone_numbers` exists, with per-number overrides | Add `forwarding_status`, `forwarding_verified_at`, `regulatory_bundle_status`. |
| `workspace_features` | Missing | New table (or `workspaces.feature_overrides jsonb`), read together with the plan entitlements (§5). |
| `notifications` (outbound send log, unique per job + type) | `public.notifications` exists as the **in-app notification feed** | Add a new **`alert_deliveries`** table with `unique (workspace_id, lead_id, kind)` and status/provider id. Do not overload `notifications`. Outbound SMS also lands in `messages` (unique on provider message id). |
| `audit_log` | `public.audit_logs` exists (`0001`), written through `writeAudit` | Reuse it. |

---

## 4. Offer and pricing → Stripe/entitlements

`shared/plans.ts` has `starter` $149, `growth` $299 and `operator` $599. The
Stripe price IDs come from `STRIPE_PRICE_STARTER/GROWTH/OPERATOR`
(`.env.example`), and the mapping is enforced server-side in `billing.ts`.

- Add the plan keys `catcher` ($299), `receptionist` ($549) and `followup`
  ($799), with entitlements `receptionist.answer`, `receptionist.faq`,
  `receptionist.transfer`, `receptionist.booking_suggest`,
  `receptionist.booking_confirm` and `receptionist.followup_sms`.
- **Keep** the existing keys while any workspace is subscribed to them. A
  migration and the webhook must keep accepting the old prices.
- The setup fee: one-off Stripe price added as a second line item in Checkout
  (`mode: 'subscription'` supports a one-time line item on the first invoice).
- The trial already exists (14 days, `0009_backfill_workspace_trials.sql`).

---

## 5. Hide, don't delete: how to implement it here

1. Server: add `getWorkspaceFeatures(workspaceId)` = plan entitlements merged
   with `workspace_features` overrides, using the existing `requireActiveSubscription`.
2. Expose it on the existing workspace/billing summary the shell already loads.
3. `src/app/workspaceNavigation.tsx`: add an optional feature key per `NavItem`
   and filter it in `visibleWorkspaceGroups()`, which already filters by role.
4. Default **off** for: Pipeline, Quotes/Invoices/Payments, Field Operations,
   Automations, Marketing/Reviews, Hiring, Purchasing, Reports & attribution,
   Integrations other than phone, the coming-soon pages and AI Admin chat. Default **on** for:
   Jobs (leads), Calls, Receptionist (profile + Business Brain subset), Team, Billing and Settings.
5. Hiding in the nav does not secure anything. A hidden area's API stays
   gated by its existing entitlement. Nothing is deleted.

The plan's four tabs map onto existing pages:

| Tab | Build from |
| --- | --- |
| Jobs | `LeadsPage` (`src/pages/AppPages.tsx`) + `GET /api/crm/leads`, filtered and sorted for "needs attention", with the weekly card on top |
| Calls | `GET /api/receptionist/calls` (exists). A new page is needed. |
| Receptionist | `ReceptionistPage` + `ServicesSettingsPage` + `BusinessBrainPage` (approved facts only) |
| Settings | `TeamPage`, `BillingPage`, `SettingsPage`, number forwarding (new) |

---

## 6. Fixed in this branch

**fix(auth): repair the workspace invitation acceptance flow**

1. **Invitees could not join.** The browser client uses `flowType: 'pkce'`.
   An admin invite cannot carry a PKCE verifier, so Supabase's default
   template lands on `/set-password#access_token=…`, and auth-js 2.114 rejects
   that on a PKCE client. The page only handled `?code=`, so every invite
   showed "invalid or expired".
2. **A password could be changed for the wrong account.** When the link
   failed, the page fell back to `getSession()`, which returns whoever is
   already signed in. An owner opening an invite (or an expired one) in
   their own browser got a "Finish joining" form that would change **the
   owner's** password.
3. **An invitee could be orphaned.** If the membership insert failed after
   Supabase had already created and emailed the user, every retry returned
   `EMAIL_ALREADY_REGISTERED`. The route now deletes the user it just created.
   It also no longer returns raw database error text.

Files: `src/lib/emailLink.ts` (new, pure parser), `src/lib/supabase.ts`
(`establishSessionFromEmailLink`), `src/pages/PasswordPages.tsx`,
`server/routes/team.ts`, `tests/inviteFlow.test.ts`.

The page now accepts both the default template (hash tokens → `setSession`)
and the recommended one (`token_hash` → `verifyOtp`). It rejects links of the
wrong type, removes one-time tokens from the URL, and never reuses an
existing session for an invite. The reset page keeps its existing behaviour.
It now also tolerates the client having already exchanged the PKCE code,
which is the same tolerance `AuthCallbackPage` has.

**Verification:** I built the SPA against a mocked Supabase Auth API and
drove `/set-password` and `/reset-password` in Chromium through 8 scenarios.
The original `HEAD` passed 1 of 8. This branch passes 8 of 8.

**Supabase dashboard configuration (needed in each environment):**
- Auth → URL Configuration → Redirect URLs must include `<APP_URL>/set-password`.
- Recommended: Auth → Email Templates → *Invite user*, link
  `{{ .SiteURL }}/set-password?token_hash={{ .TokenHash }}&type=invite`.
  The default template also works now.

This has not been tested against a live Supabase project. A real invite email
round-trip is still needed on staging.

---

## 7. Phase 1–3, mapped to files

**Phase 1: missed-call catcher**
- `receptionistCall.ts`: replace the per-turn key with a single
  `receptionist:<CallSid>` lead per call. In `finalize()`, *always* upsert
  that lead (even after a hang-up with only a caller number) keyed on
  `(workspace_id, call_id)`. Extend `TAKE_MESSAGE_TOOL` with `suburb`,
  `job_type` and `urgency`.
- New `server/alerts/ownerAlerts.ts`: after the lead upsert, insert into
  `alert_deliveries (lead_id, kind='owner_new_job')`. Send only if that
  insert won, which makes retries safe. Send from the workspace's own number
  (`workspace_phone_numbers`), not the global `TWILIO_PHONE_NUMBER` that
  `sendSms` uses today.
- The caller confirmation SMS is transactional. It still goes through the
  consent/suppression check already used in `communications.ts`.
- The DO already finalizes on WS close. Also finalize from `/voice/complete`
  so that a dropped WebSocket still yields a job. Both paths are idempotent
  through the unique key.
- The 20-scripted-call gate: extend `smoke-ws.mts` / `e2e-full-journey.mts`.

**Phase 2:** FAQ answering is already constrained to approved context (`fetchCallContext`).
Calendar read has **no Google/Outlook code at all**, so it is new work.
`availability.check` exists for internal schedules (`server/automation/runner.ts`).

**Phase 3:** The automation runner already has atomic claims, retries and
dead-lettering (`server/automation/runner.ts`). Reuse it for reminders and
follow-ups rather than building a second worker.

---

## 8. New findings (recorded, not fixed here)

| Priority | Finding | Location |
| --- | --- | --- |
| P0 (gate) | No executable cross-tenant isolation test; all current tests are source-contract tests | `tests/` |
| P1 | The Node/Docker ConversationRelay upgrade skips Twilio signature validation (token only) | `server/ws/receptionistSocket.ts` |
| P1 | Inviting an existing Jobrin user is impossible (`EMAIL_ALREADY_REGISTERED`) | `server/routes/team.ts` |
| P1 | Members are inserted `active` before the invitee accepts; there is no pending state, revoke or resend | `server/routes/team.ts`, `workspace_members.status` |
| P1 | Receptionist leads are per turn, not per call; there is no lead on hang-up and no owner SMS | `server/ai/receptionistCall.ts` |
| P1 | `sendSms` always sends from the global `TWILIO_PHONE_NUMBER` | `server/providers/twilio.ts` |
| P2 | There is no platform-admin role, so the setup console needs one (checked server-side and audit-logged) | — |
| P2 | `ResetPasswordPage` treated "code verifier missing" as fatal even after a successful auto-exchange (fixed as part of §6) | `src/pages/PasswordPages.tsx` |

## 9. Next recommended task

**Phase 0, feature flags + navigation (§5),** then **Phase 1, one job and one
owner SMS per call (§7)**, together with the migration in §3. The
cross-tenant integration test suite should be written as soon as a staging
Supabase project's credentials are available. It gates any real client data.
