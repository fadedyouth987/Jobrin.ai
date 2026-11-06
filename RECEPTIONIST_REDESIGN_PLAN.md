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
| RLS / tenant isolation on receptionist tables | **Done: database layer is tested** (`npm run test:db`, see §6b). All 77 public tables have RLS on, and 40 probes pass. Same-workspace FK triggers come from `0004`. The API re-checks membership from the JWT (`requireWorkspace` in `server/supabase.ts`); the `x-workspace-id` header is **not** trusted on its own. | Remaining: the **API layer** (service-role routes) has no executable cross-tenant test yet. That needs the Express app running against the test database. |
| Twilio webhook + WS signature validation | HTTP webhooks: yes. Cloudflare WS: yes (`wss://` form). **Node/Docker WS (`server/ws/receptionistSocket.ts`): call token only, no Twilio signature check.** | Add `validateTwilioWebSocket` to the Node upgrade handler, or document that Docker is not a supported voice runtime (P1). |
| Stripe webhook verification, idempotency, trial, failed payment | Raw-body `constructEvent`, a `claim_stripe_webhook_event` lease RPC, canonical subscription re-fetch, `invoice.payment_failed` → `past_due` with grace (`server/routes/billing.ts`) | Keep. Re-test in Stripe test mode with the new prices (§4). |
| Feature flags per workspace; hide the "Hide" areas | **Done** (§5, §6c). | Plan-driven flags (catcher / receptionist / follow-up) come with the new Stripe plans (§4). |

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

## 5. Hide, don't delete: as implemented

- **Storage:** `workspaces.product_surface` (`receptionist` | `full`) and
  `workspaces.feature_overrides` (jsonb), added in migration
  `20261106000000_workspace_product_surface.sql`. Workspaces that already
  existed were backfilled to `full`, so nothing disappears for them. Workspaces
  created afterwards start on `receptionist`. The browser cannot write either
  column; that is enforced by grants and tested.
- **Areas:** these are defined in `shared/features.ts`. The receptionist surface hides
  field jobs & operations, quotes/invoices/payments, automations, AI Admin
  chat + Operator log, marketing & reviews, hiring, reports and the coming-soon pages.
  It keeps Today, Inbox, Leads, Customers, Schedule, AI Receptionist, Business
  Brain, Knowledge (the approved FAQs the call engine reads), Approvals,
  Integrations (number setup), Team, Billing and Settings.
- **Server:** `GET /api/workspaces` returns `features` for each workspace. It
  reads the columns separately and falls back to the full product on error,
  so deploying the code before the migration cannot empty anyone's workspace list.
- **App:** the rail, the Ctrl+K palette, the phone bottom bar, the phone drawer and the
  router all filter by features. Typing a hidden URL shows a "turned off for
  this workspace" page. "Ask AI Admin" buttons disappear when AI Admin is hidden.
- **This is not an access control.** Each hidden area's API is still gated by its
  existing role and plan entitlement. Nothing is deleted.

Until the setup console exists, switch a workspace with SQL (service role):

```sql
update public.workspaces set product_surface = 'full' where slug = '<slug>';
update public.workspaces set feature_overrides = '{"quotes_invoices": true}' where slug = '<slug>';
```

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

### 6b. test(security): executable tenant-isolation suite

`npm run test:db` (`scripts/test-db.mjs`) starts a throwaway local
PostgreSQL. It applies a stub of the Supabase platform
(`tests/db/supabase-platform-stub.sql`), which mirrors Supabase's default
`GRANT ALL` to `anon`/`authenticated` so a missing revoke is caught. It then
applies **every migration**, and runs `tests/db/tenant-isolation.test.sql` as the
real `authenticated`/`anon` roles with JWT claims set. The suite covers:

- **Read sweeps** across all 74 tables that have a `workspace_id`, as owner, staff,
  outsider and anon. Workspace B's files in storage are also checked.
- **Targeted write attacks** on workspace B: insert, update, delete, move a row,
  cross-link a record, add yourself as a member, claim a phone route, upload a file.
- **Blind `UPDATE`/`DELETE` sweeps** (no `WHERE`), which bypass SELECT-policy
  visibility.
- **Privilege escalation:** staff promoting themselves or adding members; an
  owner writing billing state, entitlements or the product surface.

**I checked that the suite can fail.** I planted vulnerabilities in a
temporary migration: a cross-tenant read policy, a broad grant combined with
an over-broad UPDATE or DELETE policy, and a grant on the product surface.
Each one produced a FAIL. Plants without a matching grant were already
blocked by the existing grants or the `0004` reference triggers. The suite
also runs as a separate CI job (`database` in `.github/workflows/ci.yml`).
Note that CI only triggers on pull requests and pushes to `main`.

### 6c. feat(workspace): receptionist-first product surface

See §5. Verification:
- 9 unit tests (`tests/workspaceFeatures.test.ts`). They caught a real bug
  before commit: the Operator log path `/app/operator` was prefix-matching
  `/app/operator/phone`, which would have hidden the AI Receptionist itself.
- 16 browser checks against the built app with a mocked API: receptionist,
  full, override and "older API" modes, on desktop and phone.
- Migration semantics were checked on a real database: a workspace that
  existed before the migration stays `full`, a later one gets `receptionist`,
  the browser cannot update either column, and a re-run is harmless.

### 6d. fix(db): migrations can build a fresh database

`0026` altered `public.receptionist_configs`, a legacy table that no
migration creates. A fresh database (including any new staging project)
therefore failed at `0026`. Those two statements now run only if the table
exists. That changes nothing on a database that has the table.

### 6e. feat(receptionist): one job and one owner text per call

- **Database** (`20261106010000_receptionist_call_outcomes.sql`, additive):
  - `leads` gains `call_id`, `suburb`, `job_type` and `urgency`, with
    `unique (workspace_id, call_id)` and a cross-workspace reference trigger.
  - `receptionist_profiles.owner_alert_number` is added.
  - New `alert_deliveries` table: readable by members, written only by the server.
  - Two server-only functions:
    - `record_receptionist_call_lead` creates or merges the call's single
      lead and never resets a stage the owner has already moved.
    - `claim_alert_delivery` returns a send right exactly once.
- **Server** (`server/receptionist/callOutcome.ts`): records the lead, claims
  the alert, then texts the owner. The text goes to `owner_alert_number`, or
  the transfer number if that is unset, and is sent from the number the caller
  rang. Every outcome (sent, skipped with a reason, or failed with the Twilio
  code) is recorded. It runs from the WebSocket close in both runtimes and
  from `/voice/complete`.
- **Engine:** the `take_message` tool now captures suburb, job type and
  urgency. Existing bug fixed: the tool's `caller_name` was read as
  `callback_name`, so callers' names were never saved.
- **SMS text** (`server/receptionist/ownerAlert.ts`): limited to the GSM-7
  character set, at most 3 segments, with Australian number formatting. The
  callback number and the link to the jobs list are never cut off.
- **App:** lead cards show Emergency or Urgent, the caller's name and a
  tap-to-call number. The Receptionist settings gain the alert-number field.
  The leads list falls back to the old columns if code is deployed before the
  migration.

**Verification:**
- 27 PostgreSQL tests (`tests/db/receptionist-call-outcomes.test.sql`),
  including a **real two-connection race**. I checked that the race test can
  fail: a naive check-then-insert version produced 2 leads and 2 alerts.
- 8 orchestration tests with injected fakes (`tests/callOutcome.test.ts`).
- 10 SMS-text and wiring tests (`tests/ownerAlert.test.ts`).
- 6 browser checks of the lead cards and the settings field.
- **Not tested against live Supabase or Twilio.**

---

## 7. Phase 1–3, mapped to files

**Phase 1: missed-call catcher. Core done (§6e); remaining:**
- [x] One lead per answered call, including hang-ups, with suburb, job type and urgency captured.
- [x] One owner "new job" SMS per call, from the number the caller rang.
- [x] Both call-end paths (socket close, `/voice/complete`) are covered and idempotent.
- [ ] Caller confirmation SMS. It is transactional but still needs the
  suppression check from `communications.ts` and a per-workspace on/off switch.
- [ ] Immediate mid-call alert for `emergency` jobs. Today the alert goes at
  call end, which is usually within seconds of hang-up.
- [ ] Alert delivery status on the lead card (the data is in `alert_deliveries`).
- [ ] The 20-scripted-call gate against a live Twilio number (needs the staging
  number and credentials): hang-ups, bad audio, mid-call socket drop, duplicate webhooks.
- [ ] AU number provisioning, forwarding instructions, the setup console and the test-call button.

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
| ~~P0 (gate)~~ | ~~No executable cross-tenant isolation test~~: the database layer is now covered (§6b). The API layer is not yet. | `tests/db/` |
| P1 | The live schema has drifted from the repo: `receptionist_configs` exists only outside the migrations (§6d). All three Supabase projects are **paused**, so the live schema could not be compared | Supabase |
| P1 | The Node/Docker ConversationRelay upgrade skips Twilio signature validation (token only) | `server/ws/receptionistSocket.ts` |
| P1 | Inviting an existing Jobrin user is impossible (`EMAIL_ALREADY_REGISTERED`) | `server/routes/team.ts` |
| P1 | Members are inserted `active` before the invitee accepts; there is no pending state, revoke or resend | `server/routes/team.ts`, `workspace_members.status` |
| ~~P1~~ | ~~Receptionist leads are per turn, not per call; there is no lead on hang-up and no owner SMS~~ (fixed, §6e) | `server/ai/receptionistCall.ts` |
| P2 | `sendSms` still defaults to the global `TWILIO_PHONE_NUMBER`. Owner alerts now pass the workspace number; manual SMS and campaigns do not yet | `server/providers/twilio.ts`, `communications.ts` |
| P2 | Owner alerts are not counted against the `usage.sms` allowance. They are bounded by the per-caller hourly call limit, but cost per client needs measuring | `server/receptionist/callOutcome.ts` |
| P2 | An alert claimed just before a crash stays `pending` and is never sent. This is deliberate (a resend could double-text); it is visible in `alert_deliveries` | `alert_deliveries` |
| P2 | On a phone, the Leads page shows an explainer and three stat cards before the first job. The Phase 1 Jobs-inbox home screen should put jobs first | `LeadsPage` |
| P2 | There is no platform-admin role, so the setup console needs one (checked server-side and audit-logged) | — |
| P2 | `ResetPasswordPage` treated "code verifier missing" as fatal even after a successful auto-exchange (fixed as part of §6) | `src/pages/PasswordPages.tsx` |
| P2 | The Team page cannot show teammates' names: `profiles` RLS only allows reading your own row, but `GET /api/team` reads teammates' profiles through the user's client | `0001` `profiles_self_select`, `server/routes/team.ts` |
| P2 | The Today dashboard still presents quotes, invoices and field work. In receptionist mode, links from it land on the "turned off" page until Phase 1 replaces home with the Jobs inbox | `DashboardPage` |
| P3 | `job_recaps` and `workspace_module_state` still carry Supabase's default `anon` grants. This is inert (no policy admits anon) but is grant noise | `0001_jobrin_core.sql`, `20260914010200_job_recaps.sql` |

## 9. Next recommended task

1. **Staging, before anything else is built on these guarantees:** restore a
   Supabase project and compare its schema with the migrations (§8 drift).
   Apply `20261106000000_workspace_product_surface.sql` and
   `20261106010000_receptionist_call_outcomes.sql` **before** deploying this
   code, then make a real test call to a Twilio number. This is the first end-to-end check.
2. **The Phase 1 Jobs-inbox home screen** (§5 tabs): jobs first on a phone,
   the weekly "jobs captured / booked" card, and alert status on each job.
3. The caller confirmation SMS, with a suppression check (§7).
