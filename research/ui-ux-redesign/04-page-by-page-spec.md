# Jobrin.ai Page-by-Page Specification

## Shared behavior

All authenticated queries derive tenant access on the server and scope records to the verified workspace. Every page supports loading, empty, partial error, permission denied and success states inside its working region. Lists use server pagination. Workspace switching clears bound data before requesting the next workspace. Desktop record previews become full-screen sheets on mobile.

Roles in this document follow the current model: owner, admin, manager, staff and viewer where present. Final visibility must match both API checks and RLS policies.

## 1. Command Centre — `/app`

- **Purpose:** Show what needs action today across the revenue lifecycle.
- **Primary action:** Resolve the highest-priority attention item.
- **Layout:** Compact header; Today/Attention tabs; left two-thirds attention queue; right third today’s schedule and revenue snapshot. Setup checklist appears only until complete.
- **Data:** `/api/dashboard`, `/api/workspaces/onboarding`, `/api/billing/status`, `/api/integrations`, `/api/services`; records from jobs, appointments, conversations, quotes, invoices, approvals and automation runs when dashboard aggregation is extended.
- **States:** Skeleton by region; first-run checklist; partial-provider warning; retained last-safe view with retry; subscription/permission states.
- **Interactions:** Open preview rail, mark notification/read task complete only when supported, run one of the four explicit operator commands, quick create.
- **Mobile:** Today’s assigned jobs first for staff; attention queue first for office roles; no metric-card grid.
- **Permissions:** Staff sees their operational scope. Owner/admin sees financial/setup risks. Server controls all visibility.
- **Gaps:** Dashboard endpoint needs a true cross-module attention aggregate, workspace timezone boundaries and paged source queries. Current browser session failed to fetch.

## 2. Inbox & Enquiries — `/app/inbox`

- **Purpose:** Turn inbound customer communication into a resolved reply, lead or job.
- **Primary action:** Reply or triage the selected conversation.
- **Layout:** Three panes on wide screens: filtered conversation list, conversation thread, customer/context rail. Two-stage list → thread on mobile.
- **Data:** conversations: `id, subject, status, handling_mode, last_message_at, assigned_user_id, customer_id`; customer display name/phone/email; messages: channel, direction, purpose, sender type, body, status and delivery timestamps; internal notes.
- **States:** Empty with number/integration setup; thread skeleton; delivery failed with retry guidance; consent/suppression blocked; provider disconnected; permission denied.
- **Interactions:** Search/filter unread/assigned/channel, reply by SMS, add note, record consent, link/create lead or job after backend support, claim/assign after backend support.
- **Mobile:** Sticky reply action, thread text at 16 px, customer actions in a bottom sheet; never squeeze three panes.
- **Permissions:** Members may read within RLS; current send/note/consent API allows owner/admin/manager/staff. Viewer is read-only.
- **Gaps:** No email inbox, assignment/update endpoints, lead/job conversion action, pagination or provider-tested delivery. ⚠️ BACKEND GAP for assignment and conversion.

## 3. Lead Pipeline — `/app/leads`

- **Purpose:** Move a real enquiry from new to booked/won or a recorded closed outcome.
- **Primary action:** Set the next action or advance the lead.
- **Layout:** Table/board toggle; pinned filters; stage columns with count and value; preview rail with customer, source, value, age and activity.
- **Data:** leads `id, customer_id, title, stage, source, estimated_value_cents, created_at` plus customer display name; stage endpoint.
- **States:** First lead, no filtered results, stale lead attention, optimistic move pending, conflict/failure rollback, permission denied.
- **Interactions:** Keyboard/pointer stage move, inline next action after schema support, create lead, open customer, bulk assign/archive only after APIs exist.
- **Mobile:** Stage tabs and vertical cards; move-stage menu rather than horizontal drag dependency.
- **Permissions:** Create/move for owner/admin/manager/staff; viewer reads.
- **Gaps:** No lead detail route, owner, next-action date, activity composer, loss reason, update/archive or server pagination. ⚠️ BACKEND GAP.

## 4. Customers — `/app/customers`, `/app/customers/:id`

- **Purpose:** Maintain the single customer record and its complete service/revenue history.
- **Primary action:** Find or safely update a customer.
- **Layout:** List with search/filter and preview rail. Full detail: facts rail; activity centre; related leads/jobs/quotes/invoices/payments/calls at right or in tabs.
- **Data:** customers `first_name,last_name,display_name,phone,email,source,tags,lifetime_value_cents,last_activity_at`; customer_addresses; related records from `/api/crm/customers/:id`.
- **States:** Empty, no matches, possible duplicate, partial related-data error, deleted/not found, permission denied.
- **Interactions:** Create, edit/archive after API support, call/message, create lead/job/quote with customer preselected, switch site/address.
- **Mobile:** Contact actions sticky near top; sections collapse in task order; financial history remains readable as rows.
- **Permissions:** Members read; owner/admin/manager/staff create. Define edit/archive rules explicitly before adding controls.
- **Gaps:** No update/archive endpoints, address maintenance UI, server pagination or duplicate-merge workflow. ⚠️ BACKEND GAP.

## 5. Jobs — `/app/jobs`, `/app/jobs/:id`

- **Purpose:** Plan, execute and close field work with a defensible record.
- **Primary action:** Perform the next valid job-lifecycle action.
- **Layout:** List offers Today/Unscheduled/Active/Completed saved views. Detail uses persistent job command header, task tabs (Overview, Field work, Financials, Activity) and context rail.
- **Data:** jobs fields currently returned; linked customer/service/appointment; time entries; materials; quotes; invoices; payments. Additional existing endpoints provide photos, checklists, signatures and report data.
- **States:** Unscheduled, assigned without time, active, blocked, completed/ready to invoice, invoice required, paid, cancelled; per-panel loading/error; offline draft/sync state once supported.
- **Interactions:** Create/schedule/status, start/stop time, add/correct material, upload/remove photo, complete checklist, capture signature, create quote/invoice, print report.
- **Mobile:** Today opens by default; sticky Call/Directions/Timer/Status/More; field close-out checklist and offline-safe pending state.
- **Permissions:** Current write routes allow owner/admin/manager/staff with manager-only material/photo deletion; invoice rules must align with RLS.
- **Gaps:** Field completion routes are not connected to detail UI; list pagination/filtering, staff selector and printable report are incomplete. Offline persistence requires explicit design/backend work.

## 6. Schedule & Bookings — `/app/schedule`, `/book/:slug`

- **Purpose:** Match work to available time and people without conflict.
- **Primary action:** Schedule or reschedule a job.
- **Layout:** Desktop: date/view controls, staff lanes, unscheduled rail and optional map after backend support. Booking: business identity, service, available slot, customer details, review/confirm.
- **Data:** appointments fields from `/api/operations/appointments`; jobs from `/api/operations/jobs`; public business profile, services and business hours; `create_public_booking` RPC.
- **States:** No work, no capacity, slot held/taken, schedule conflict, outside hours, sync pending, provider/calendar disconnected, permission denied.
- **Interactions:** Create from slot, drag/drop with conflict preview, assign technician, reschedule with customer-notification choice after backend support; booking refreshes times after conflict.
- **Mobile:** Day agenda with staff filter; booking is single-column with large slots and persistent progress.
- **Permissions:** Members read; owner/admin/manager/staff schedule. Public users receive only safe business/service/availability data.
- **Gaps:** Workspace timezone is not consistently passed; public booking uses workspace-wide capacity rather than explicit staff/resource capacity; deposits and external calendar sync are absent. Migration 0025 must be deployed and concurrency-tested.

## 7. Quotes — `/app/quotes`, `/quote/:token`

- **Purpose:** Build a clear offer, obtain a customer decision and convert accepted scope.
- **Primary action:** Send a correct quote for approval.
- **Layout:** List plus dedicated builder/detail route. Builder: customer/job context, grouped line items, terms/expiry/deposit, sticky totals and client preview. Public quote shows business, items, GST, total, terms and decision.
- **Data:** quotes and quote_items; customer/job; business profile; current create/send/link/void/convert routes.
- **States:** Draft, sending, delivery failed, sent, viewed, accepted, declined, expired, void, already converted.
- **Interactions:** Add/reorder/edit items, service picker, autosave, client preview, send/resend, rotate link with warning, accept/decline, convert once.
- **Mobile:** Full-width line-item cards, sticky total and Save/Preview; public decision buttons stay visible without covering terms.
- **Permissions:** Creation currently owner/admin/manager/staff; void owner/admin/manager. Align send/convert with RLS before showing staff actions.
- **Gaps:** No dedicated detail/builder, revision model, delivery-attempt endpoint, preview or safe resend. Alternative option groups require schema work. ⚠️ BACKEND GAP.

## 8. Invoices — `/app/invoices`

- **Purpose:** Issue, track and collect an accurate customer balance.
- **Primary action:** Send or collect the next payable invoice.
- **Layout:** KPI strip limited to due/overdue/paid; filterable table; dedicated detail with balance, due date, items, payment/link state and event timeline.
- **Data:** invoices and invoice_items; customer/job/quote; payments; send and Checkout endpoints.
- **States:** Draft, needs delivery, due, overdue, part paid, payment processing, paid, void, delivery failed, payout pending/failed after payout model exists.
- **Interactions:** Create from job/quote, edit draft line items, preview, send/resend, copy/open payment link, record external payment only after backend support.
- **Mobile:** Amount/status/due/customer row; detail actions in sticky bar; item table becomes cards.
- **Permissions:** Financial viewing is role scoped; create/send intent must match API and RLS. Checkout requires manager or above and sensitive auth.
- **Gaps:** No invoice detail/preview/resend, one-active-session management, refund/credit note or confirmed per-business payout routing. ⚠️ BACKEND GAP for merchant payout model.

## 9. Payments — `/app/payments`

- **Purpose:** Confirm money received and resolve exceptions against invoices.
- **Primary action:** Investigate a payment that is processing, failed or unmatched.
- **Layout:** Filterable table with amount/status/customer/invoice/date; detail rail with provider timeline and reconciliation context.
- **Data:** payments `id,amount_cents,currency,status,paid_at,created_at,customer_id,invoice_id`; related customer/invoice.
- **States:** Processing, succeeded, failed, refunded, partially refunded, unmatched and payout pending when supported.
- **Interactions:** Open invoice/customer, copy reference, retry link from invoice, refund only after explicit backend/role design.
- **Mobile:** Compact amount-first rows and detail sheet.
- **Permissions:** Read according to financial role; sensitive actions manager/owner and step-up authentication.
- **Gaps:** No detail, reconciliation, refund/credit-note, payout or export endpoints. ⚠️ BACKEND GAP.

## 10. Automations — `/app/automations`

- **Purpose:** Configure and supervise safe, repeatable workflows.
- **Primary action:** Publish a valid automation with known inputs and approvals.
- **Layout:** List/status summary; builder with Trigger → Conditions → Steps → Review; run-history tab and run-detail timeline.
- **Data:** automations, automation_runs, automation_attempts, approvals and capabilities registry.
- **States:** Draft, active, paused, invalid, waiting approval, running, retrying, complete, failed, exhausted.
- **Interactions:** Choose supported trigger, map typed inputs, validate each step, set approval policy, activate/pause/archive, manual test with selected real record, inspect run.
- **Mobile:** Run monitoring and approvals only; complex builder can require tablet/desktop with clear message.
- **Permissions:** Owner/admin/manager configure/run; approval follows current role checks; execution remains trusted server-side.
- **Gaps:** Current UI stores sparse step input; complete event/cron matrix, typed mapper and real exactly-once scenarios need further work.

## 11. Reviews — `/app/reviews`

- **Purpose:** Request, track and learn from customer feedback after completed work.
- **Primary action:** Resolve a request that failed or needs manual follow-up.
- **Layout:** Summary of eligible/completed/failed; request table with customer/job/channel/status/timestamps; detail timeline.
- **Data:** review_requests exists and automation can queue records.
- **States:** Eligible, queued, sent, opened, completed, opted out, failed, suppressed.
- **Interactions:** Send/retry/cancel only after delivery infrastructure; open source job/customer; external review link only after provider choice.
- **Mobile:** Status-first rows; no dense analytics.
- **Permissions:** Management configures; staff may view job-linked state based on policy.
- **Gaps:** No delivery worker, customer response endpoint/form or external review sync. ⚠️ BACKEND GAP.

## 12. Reports & Attribution — `/app/analytics`

- **Purpose:** Explain which sources and workflows produce settled revenue.
- **Primary action:** Filter revenue to understand a decision.
- **Layout:** Persistent date/source/status filters; KPI row; revenue by source chart; matching table; reconciliation warning.
- **Data:** `revenue_attributions` currently read by `/api/intelligence/attribution`; jobs, invoices and settled payments for future reconciliation.
- **States:** No paid data, unattributed revenue, partial data, stale calculation, error and permission denied.
- **Interactions:** Change filter once for chart/table, open source payment/job, export after server support.
- **Mobile:** KPI + ranked source list; charts secondary with accessible text summary.
- **Permissions:** Owner/admin/manager; staff excluded by current shell.
- **Gaps:** No application path creates/reconciles attribution records; filters/pagination/export are incomplete. ⚠️ BACKEND GAP.

## 13. Client Portal

- **Purpose:** Give a customer one trusted place to review work, approve quotes and pay invoices.
- **Primary action:** Complete the current requested action.
- **Layout:** Branded customer header; outstanding actions first; upcoming appointments; quotes; invoices/receipts; work request after backend support.
- **Data:** Existing public quote/booking/payment surfaces and `customer_portal_sessions` table are foundations. Customer, jobs, appointments, quotes, invoices and payments require a safe portal API projection.
- **States:** Secure-link loading, expired/revoked, no outstanding actions, payment processing, permission denied and support fallback.
- **Interactions:** View appointment, approve quote, pay invoice, download receipt and request work only when each endpoint exists.
- **Mobile:** Primary target; single column, 16 px text, 44 px controls, no workspace navigation.
- **Permissions:** Token/session grants access only to the intended customer/workspace projection; links expire and revoke; never accept a client-supplied workspace/customer ID as authority.
- **Gaps:** No routed portal or complete portal API. ⚠️ BACKEND GAP.

## 14. Business Brain — `/app/brain`

- **Purpose:** Review and govern what Jobrin has learned about the business.
- **Primary action:** Confirm, reject or correct a memory.
- **Layout:** Metrics and filters, memory list, evidence/detail rail, settings tab. Contextual memory chips link here from records.
- **Data:** business_memories, memory_evidence, memory_usage_events, memory_promotion_decisions, memory_learning_settings, ai_feedback_events.
- **States:** Candidate, confirmed, challenged, rejected, expired/review due, provider unavailable, no memories.
- **Interactions:** Search/filter, inspect evidence, decide memory, edit learning policy, submit correction feedback from source workflows.
- **Mobile:** Review queue and detail sheet; settings grouped into simple toggles with explanations.
- **Permissions:** Read is workspace-scoped; owner/admin update settings; owner/admin/manager decide; feedback includes staff.
- **Gaps:** Contextual hooks across inbox/jobs/quotes and clear recovery/provider status are incomplete.

## 15. Knowledge — `/app/knowledge`

- **Purpose:** Maintain approved facts the AI may use.
- **Primary action:** Publish or correct one knowledge document.
- **Layout:** Searchable list with status/source/version; editor/detail; retrieval test panel showing cited chunks.
- **Data:** knowledge_documents and knowledge_chunks; current list/create routes.
- **States:** Draft, approved, superseded, processing, failed, empty and permission denied.
- **Interactions:** Create/edit/version/approve/archive, paste text, file/website ingestion only after backend support, test a question and inspect sources.
- **Mobile:** Read/review and small corrections; large editing on tablet/desktop.
- **Permissions:** Owner/admin/manager maintain; staff may read approved facts if required.
- **Gaps:** No detail/edit/approve-existing/archive or ingestion/retrieval-test endpoint. ⚠️ BACKEND GAP.

## 16. Templates

- **Purpose:** Reuse approved customer messages, quote terms, invoice notes, checklist forms and automation recipes.
- **Primary action:** Create or update a versioned template.
- **Layout:** Type-filtered library; preview rail; editor with variables and usage locations.
- **Data:** Checklist templates exist. Quote/invoice/message templates do not have a complete shared model.
- **States:** Draft, active, archived, invalid variable, in use and permission denied.
- **Interactions:** Duplicate, preview with a safe sample schema, publish version, archive; never fabricate customer data.
- **Mobile:** Select/apply templates; full authoring may be desktop-first.
- **Permissions:** Management authors; staff applies approved templates.
- **Gaps:** No Templates route or general template backend. ⚠️ BACKEND GAP.

## 17. Team & Workspace — `/app/team`, `/app/settings`, `/onboarding`

- **Purpose:** Maintain business identity, services, hours, service areas and authorised people.
- **Primary action:** Safely edit an existing setting or team member.
- **Layout:** Settings sub-navigation: Business, Services, Hours & booking, Service areas, Team, Roles. Forms load saved values and show last saved state.
- **Data:** workspaces, business_profiles, services, business_hours, service_areas, workspace_members, profiles and onboarding_progress.
- **States:** Loading existing values, unsaved, saving, saved, conflict, invitation pending/expired/revoked and permission denied.
- **Interactions:** Edit business; add/edit/archive service; hours/areas; invite/resend/revoke; role change/remove with confirmation after backend support.
- **Mobile:** Single-column forms, sticky Save only when dirty, address inputs grouped clearly.
- **Permissions:** Business settings owner/admin/manager where current route allows; sensitive team changes owner/admin with recent MFA.
- **Gaps:** Settings currently reopens blank onboarding; services lack update/archive; hours/areas editor and full team lifecycle are absent. ⚠️ BACKEND GAP.

## 18. Integrations — `/app/integrations`

- **Purpose:** Connect providers and show whether each capability is actually healthy.
- **Primary action:** Complete or repair one supported connection.
- **Layout:** Supported integrations first; each row shows connection, capability, last check and Manage action; unavailable items live in Capability Map.
- **Data:** integrations table; `/api/integrations`; Twilio activation route; provider-specific status fields when added.
- **States:** Not configured, connecting, connected, degraded, action required, disconnected and unavailable.
- **Interactions:** Activate/manage/disconnect only where backed; run non-destructive health check; open setup guide.
- **Mobile:** Stacked rows with clear status and one action.
- **Permissions:** Owner/admin connect; management may view health; credentials never appear in browser data.
- **Gaps:** Current buttons are disabled; only Twilio activation backend exists. Google Calendar, accounting and Meta have no connection flow. ⚠️ BACKEND GAP.

## 19. Billing & Subscription — `/app/billing`

- **Purpose:** Understand and manage the Jobrin subscription.
- **Primary action:** Start or manage the current plan.
- **Layout:** Current plan/status/trial, entitlement summary, price choices, billing-portal action and payment-result feedback.
- **Data:** subscriptions and subscription_entitlements; Stripe Checkout/status/portal/webhook routes.
- **States:** Trial, active, past due with grace, cancelled, incomplete, Checkout return pending, configuration unavailable.
- **Interactions:** Start Checkout, manage in Stripe portal, refresh post-Checkout state.
- **Mobile:** Plans stack; current plan and deadline remain first.
- **Permissions:** Owner/admin with sensitive auth for Checkout/portal.
- **Gaps:** Requires verified Prices/secrets/webhooks and full test lifecycle. Business invoice payment routing is separate and unresolved.

## 20. AI Receptionist — `/app/operator/phone/*`

- **Purpose:** Configure, test and supervise safe call handling.
- **Primary action:** Review readiness before activation or inspect a call that needs attention.
- **Layout:** Overview/readiness, Configure, Handling, Knowledge, Test, Calls and Insights tabs. Readiness checklist blocks “active” claims until every dependency passes.
- **Data:** receptionist_profiles, calls, ai_actions, knowledge documents and integration status.
- **States:** Not configured, setup incomplete, test ready, active, degraded, call in progress, completed, escalated, failed.
- **Interactions:** Save profile with recent auth, simulate, inspect transcript/actions, activate Twilio from Integrations, filter calls.
- **Mobile:** Call list/detail and urgent settings; long configuration forms grouped into steps.
- **Permissions:** Owner/admin configure; manager simulate/review; staff visibility based on call/customer policy.
- **Gaps:** Migration 0024 and signing/provider/AI credentials must be deployed; live call, webhook, concurrency and fallback tests remain.

## 21. Notifications & Operator Log — `/app/notifications`, `/app/operator`

- **Purpose:** Notifications direct people to work; Operator Log explains AI/system actions.
- **Primary action:** Open the affected record or resolve a failure.
- **Layout:** Priority/Other list for notifications; filterable chronological event table for AI actions.
- **Data:** notifications and ai_actions with resource/call links.
- **States:** Unread/read, no priority items, failed action, partial details, permission denied.
- **Interactions:** Mark read, mark all read, open source record; filter actions by status/tool/date; inspect failure context.
- **Mobile:** One-column list and full-screen detail.
- **Permissions:** Workspace-scoped; privileged technical details limited to management.
- **Gaps:** Reliable deep links, per-user read model, pagination and source-record correlation need completion.

## 22. Hiring — `/app/hiring`

- **Purpose:** Run a private, human-decided hiring pipeline for the business.
- **Primary action:** Record the next reviewed candidate decision.
- **Layout:** Openings summary, candidate create forms and stage board; future candidate detail rail.
- **Data:** job_openings, candidates and candidate_applications.
- **States:** No roles, no candidates, consent missing, active stages, rejected/withdrawn/hired, permission denied.
- **Interactions:** Create role/candidate/application, add notes, move valid stages, reject/withdraw; every hiring decision remains human.
- **Mobile:** Stage tabs and candidate cards; sensitive notes remain readable and access controlled.
- **Permissions:** Management only under current policies.
- **Gaps:** Candidate detail, job-board publishing, invite/interview scheduling and retention/deletion controls are incomplete.

## 23. Security — `/app/settings/security`, `/mfa`

- **Purpose:** Protect account access and explain current assurance level.
- **Primary action:** Complete or manage MFA.
- **Layout:** Security status, MFA factors, recent sessions/devices after backend support, recovery guidance and sensitive-action requirements.
- **Data:** Supabase auth session/AAL and factor APIs; no secrets or recovery codes in logs.
- **States:** MFA not enrolled, challenge required, AAL2 active, expired session, recovery required, provider error.
- **Interactions:** Enrol/challenge/remove factor with confirmation, sign out other sessions after backend support.
- **Mobile:** Single-column guided flow with large code inputs.
- **Permissions:** Current authenticated user; workspace role does not grant access to another user’s auth settings.
- **Gaps:** Complete factor-management and session/device endpoints need verification or implementation. ⚠️ BACKEND GAP for session/device management.
