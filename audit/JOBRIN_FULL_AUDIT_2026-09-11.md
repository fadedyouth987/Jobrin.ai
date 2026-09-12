# Jobrin.ai — full implementation and readiness audit

**Audit date:** 11 September 2026, Australia/Adelaide. Checks ran on 10 September UTC.

**Overall assessment:** Jobrin.ai has a substantial application foundation, but it is not ready to be described as a fully working, connected operations platform. The application builds and its existing tests pass. Several important journeys nevertheless contain confirmed breaks, and several advertised capabilities stop at a screen, database record, or provider setup requirement.

This is an audit report, not a repair release. No production data, provider configuration, account permissions, or application source was changed during this audit.

## What was checked

- Current local frontend and server, including the ongoing changes already in the workspace.
- Public and authenticated route definitions, navigation, form handlers, backend handlers, and provider calls.
- An inventory of **103 frontend API references and 114 backend route handlers**. Counts include repeated references, dynamic paths, and webhook handlers; they are not a count of working features.
- Read-only schema, policy, privilege, constraint, migration-history, and advisor checks on the Supabase project matching the local configuration: **Jobryn.AI**.
- The local running server and public pages in the browser. Desktop, 390-pixel pricing, and 320-pixel homepage checks used the existing dark theme.
- Existing test suite, type checking, source security checks, production build, and production dependency vulnerability scan.

**Limits:** the private browser remained signed out at the last check. Private-page findings are based on code and live database metadata, not a completed signed-in customer journey. No real emails, SMS, phone calls, payments, refunds, account creation, or business-record changes were performed. The deployed `https://jobrin.ai` site could not be inspected through the web tool, so its current release and runtime secrets remain unverified. Local missing settings must not be presented as proof that production has the same missing settings.

## Verified results

| Check | Result | What it establishes |
|---|---|---|
| Existing automated tests | **58 passed, 0 failed** | Covered unit behaviours and source assertions pass. Does not establish complete journeys. |
| Type checking, security scanner, production build | **Passed** | Current source compiles and passes the project's checks. |
| npm production dependency audit | **0 reported vulnerabilities** | No known vulnerabilities reported for this installed production dependency tree at audit time. |
| Local health endpoint | HTTP 200, **PRE_PRODUCTION** | Server is running. Provider readiness flags are mostly false. |
| Four private APIs without a session | HTTP 401, `AUTH_REQUIRED` | Workspaces, customers, receptionist, and billing reject unauthenticated requests. |
| Invalid public booking/quote links | HTTP 404 | Invalid examples fail closed; these endpoints can also mask configuration/database failures as “not found.” |
| Public browser pages | Home, pricing, signup, login, recovery and invalid reset-link state inspected | Forms and primary pages render; recovery email delivery was not exercised. |
| Responsive public layout | No horizontal document overflow in the sampled sizes | This is not a whole-app, all-content, all-theme accessibility certification. |
| Database RLS | Enabled on all **71 public base tables** | Row-level security is enabled; actual policies and grants still need feature-specific review. |

## Fix these first

1. Repair the job-detail database query and its incorrectly assigned results.
2. Align the receptionist database structure with the current code.
3. Repair booking availability loading and make booking creation atomic.
4. Finish automation queueing, triggering, inputs, execution and approval resumption.
5. Decide and implement how each business receives its invoice payments.
6. Connect the necessary server providers and expose usable integration controls.
7. Repair existing-business settings so editing starts from saved values.
8. Run a real test-workspace journey through customers, jobs, quotes, invoices, payments and role permissions before release.

**Priority meanings:** P1 = blocks a core workflow or needs resolution before using the affected capability with customers. P2 = significant missing capability, reliability or usability issue. P3 = polish or operational improvement. A P1 here is not a claim that an exploit or financial loss has occurred.

## Confirmed faults and unfinished connections

### A01 — P1: Opening a job queries a nonexistent database field

**Evidence:** `server/routes/operations.ts:70` filters appointments by `job_id`. The connected database has no `appointments.job_id`; the relationship is represented by `jobs.appointment_id`. The handler treats the resulting query error as `JOB_RELATED_READ_FAILED`.

**Impact:** a valid job can be listed but its detail page cannot load. This blocks scheduling, time/material logging and financial context accessed through that page.

**Needed:** load the correct appointment relationship and handle a job with no appointment. **Acceptance:** an existing job opens with and without a linked appointment, and an unrelated appointment is not shown.

### A02 — P1: Job-detail results are assigned to the wrong fields

**Evidence:** `server/routes/operations.ts:69` destructures results as appointments, quotes, invoices, time entries, materials. The actual query order is appointments, time entries, materials, quotes, invoices.

**Impact:** after A01 is repaired, quotes can contain time entries, invoices can contain materials, and the time/material panels can receive financial documents. Payment lookup uses the wrong IDs too.

**Needed:** correct the result mapping and use explicit result names/types. **Acceptance:** a fixture containing one appointment, quote, invoice, time entry and material appears in the correct five sections, with the invoice's payment attached.

### A03 — P1: Current receptionist code is ahead of the connected database

**Evidence:** the database lacks the new receptionist pricing/escalation/limit fields, `calls.outcome`, `calls.turn_count`, call snapshots and `ai_actions.call_id`. These are defined in `supabase/migrations/0024_receptionist_phase1_runtime.sql` and used by `server/routes/receptionist.ts:48`, `:57` and `:69`.

**Impact:** saving the expanded profile fails; the call list requests missing columns; call-detail action lookup and live-call persistence cannot be treated as operational.

**Needed:** review and apply the missing schema change through the normal deployment process, then verify grants and test saves and calls. The audit did not apply it.

### A04 — P1: Public booking cannot load available times

**Evidence:** `src/pages/PublicBookingPage.tsx:34` sends `{peek:true, service_id}`. `server/routes/public.ts:214` requires customer name and phone before handling a peek. It also constructs and validates a date before the branch intended to permit missing `slot_start`.

**Reproduction:** the local endpoint returned **400 `VALIDATION_FAILED`** for the exact preview payload shape. The schema rejection occurs before the business lookup, so adding provider credentials alone will not fix it.

**Needed:** a separate read-only availability endpoint or a discriminated request schema that validates preview requests separately. **Acceptance:** selecting a service returns times without requiring contact details or a chosen time.

### A05 — P1: Public booking creation lacks an atomic reservation

**Evidence:** `server/routes/public.ts:214` checks availability, then creates customer/appointment/job records in separate operations. Appointment and job inserts run in parallel with no rollback. Neither insert links the two records or assigns a staff member. The database's appointment exclusion constraint applies only when `assigned_user_id` is non-null.

**Impact:** concurrent requests can reserve the same unassigned slot. Partial failures can leave an appointment or job behind while the customer sees an error. A retry can add another record.

**Needed:** one transactional booking operation, explicit capacity/resource ownership, an idempotency key, and a persisted job–appointment relationship. Also apply workspace booking activation/subscription rules and an explicit deposit policy; the current public route does not enforce those. **Acceptance:** simultaneous attempts for the same capacity produce one booking and one useful conflict response; interrupted requests leave no orphan records.

### A06 — P1: “Run automation” uses a database identity forbidden to queue work

**Evidence:** `server/routes/intelligence.ts:121` inserts an automation run through `createUserClient`. The connected database reports `authenticated` has **no INSERT privilege** on `automation_runs`, matching the earlier security migration.

**Impact:** the manual Run button cannot queue the run even after service credentials are added.

**Needed:** a trusted, authorised queue operation with tenant, role, plan and tool validation. Do not simply open unrestricted browser writes to an internal queue. **Acceptance:** a permitted manager can queue one run; an unauthorised member cannot.

### A07 — P1: The runner excludes ordinary queued runs

**Evidence:** `server/automation/runner.ts:99` uses `.neq('state->>exhausted','true')`. New manual state contains only source/requester. A read-only database expression confirmed that a missing JSON flag compared this way yields NULL, not true.

**Impact:** ordinary new runs are filtered out before processing. This is separate from A06.

**Needed:** a null-safe predicate or a real exhausted column/default. Verify new, retryable and exhausted cases. PostgreSQL documents the relevant [NULL comparison behaviour](https://www.postgresql.org/docs/current/functions-comparison.html).

### A08 — P1: Automation triggers and step inputs are not connected

**Evidence:** the form in `src/pages/AppPages.tsx:231` saves every selected step with `input:{}`. The runner needs fields such as `jobId`, `customerId` and `serviceIds`. No business-event/cron dispatcher populating `automation_runs` was found; the only application queue insertion found is the manual Run route. Saved conditions and schedule expressions are not evaluated by the runner. `availability.check` is offered in the tool registry but has no automatic executor case.

**Impact:** “job completed,” “new lead,” and other trigger choices do not establish automatic execution. Some workflows remain invalid even if manually queued.

**Needed:** event-to-run dispatch, scheduled-run generation, validated input mapping from the triggering record, condition evaluation and supported-tool filtering. **Acceptance:** completing a test job produces one correctly populated review step; unsupported tools cannot be configured as executable.

### A09 — P1: Approval records do not resume execution; retries can repeat steps

**Evidence:** `server/routes/intelligence.ts:56` updates the approval record only. The runner reads queued/failed runs, not waiting runs, and has no approved-step resumption path. A failed attempt restarts its step loop without using completed-step checkpoints; running work also has no lease-expiry recovery.

**Impact:** an approved action remains unperformed. A later failure can cause earlier draft/queue actions to repeat on retry. A crash can strand running work.

**Needed:** a durable run/step state machine, approval-to-step linkage, per-step idempotency, resumable checkpoints and expired-lease recovery. **Acceptance:** approve, reject, retry and worker-crash tests each produce the intended result exactly once.

### A10 — P1: Business invoice payments have no per-business payout connection

**Evidence:** `server/routes/operations.ts:557` and `:610` create payment Checkouts using the single server Stripe account. They do not specify a connected account or a transfer destination. No Connect onboarding/account mapping flow was found. The subscriptions implementation is a separate flow.

**Impact:** turning on the current invoice payment feature does not establish that funds reach the individual trade business. In this code path, the platform Stripe account creates the charge.

**Needed:** agree the intended merchant/payment model, implement the appropriate business onboarding and routing, and test settlement to the intended account. This is a software wiring finding, not legal or tax advice. Stripe's [destination-charge documentation](https://docs.stripe.com/connect/destination-charges) explains one possible platform-to-business routing model; it is not a recommendation to adopt that model without deciding requirements.

### A11 — P1: Invoice permissions disagree between the API and database

**Evidence:** invoice create/send and quote-conversion routes permit staff in `server/routes/operations.ts`. Connected invoice and invoice-item write policies permit only owner/admin/manager.

**Impact:** staff can encounter available actions that the database rejects. Quote conversion is affected because it creates an invoice.

**Needed:** choose the intended permission model and align navigation, buttons, API checks and RLS. **Acceptance:** owner, manager, staff and viewer journeys each show and allow only their intended actions.

### A12 — P1: Business settings reopen blank rather than loading saved details

**Evidence:** both Business profile and Services & pricing in `src/pages/AppPages.tsx:408` go to `/onboarding`. `src/pages/OnboardingPage.tsx:13` initialises blank/default business fields and never loads `/api/workspaces/current` before saving them. The backend business-profile route upserts the submitted fields.

**Impact:** “edit settings” behaves like first-time setup and can replace existing information with defaults or blanks if saved.

**Needed:** dedicated edit screens that load existing values, preserve unchanged fields, and support service updates. **Acceptance:** reopening settings shows the saved record; changing one field leaves every other field intact.

### A13 — P2: Integration buttons are permanently disabled

**Evidence:** `src/pages/AppPages.tsx:184` renders `SecondaryButton disabled` without a click handler for every integration, including connected ones. `server/routes/integrations.ts:16` implements Twilio activation, but there is no frontend reference to that endpoint. Only list and Twilio activation handlers exist in this router.

**Impact:** the instructions say keys unlock Connect, but the buttons never unlock. Users cannot activate the Twilio number or manage connections from these cards. Google Calendar, accounting and Meta do not have their advertised connection flows.

**Needed:** wire the supported activation action, add meaningful health checks and management controls, and label unimplemented OAuth/sync products as unavailable.

### A14 — P2: Field completion has server endpoints but no usable screen

**Evidence:** job photo upload/list/delete, checklists, signatures and report-data handlers exist in `server/routes/operations.ts:211–303`. The routed `OperationalDetailPages.tsx` does not call them. The time-entry stop and material-delete endpoints also have no corresponding UI call in the route inventory.

**Impact:** a user cannot use these backend capabilities through the website. A time entry with no end time can be created without an in-app way to stop it. The report endpoint returns data, not a printable document.

**Needed:** job-detail controls for photos, checklist completion, signature capture, timer stop/corrections, material corrections and print/export. Complete A01/A02 first.

### A15 — P2: Basic record maintenance is incomplete

**Evidence:** CRM customer routes offer list/detail/create but no customer update/archive. Services offer list/create but no update/archive. Knowledge offers list/create but no content detail/edit/approve-existing/delete. Assets have a PATCH endpoint but the current screen only creates/lists. Quote voiding exists in the API but is not exposed in the financial-document actions.

**Impact:** users can add incorrect/outdated information without a normal correction flow. Knowledge copy promises updating/version history that its current screen cannot provide.

**Needed:** scoped edit/archive actions, appropriate confirmation and audit records, plus quote/invoice detail and revision workflows. Make correction permissions explicit.

### A16 — P2: Team onboarding is only partly finished

**Evidence:** `server/routes/team.ts:83` generates a setup link but deliberately does not email it. Existing registered emails are rejected with a message that account linking is not available. No team role-change, removal, invitation-resend or revoke endpoint was found.

**Impact:** initial invites need secure manual handoff; an existing Jobrin.ai user cannot join through this invite flow; normal team maintenance/offboarding has no complete in-app journey.

**Needed:** existing-user membership invitations, scoped acceptance, resend/revoke, role changes and member removal. Email invitations require an explicitly configured and tested delivery path.

### A17 — P2: Failed document delivery cannot be retried normally

**Evidence:** quote and invoice Send handlers mark the document sent before attempting email. The same handlers reject documents that are no longer draft. Delivery status is returned, but a failed email has no separate resend path. The quote “Get customer link” action generates a fresh token and invalidates the previous link.

**Impact:** a send failure can leave a sent document that cannot be emailed again through the same action. Obtaining a quote link can invalidate an earlier customer link without the label explaining that consequence.

**Needed:** separate document state from delivery attempts, support retry/resend, and make link rotation explicit. Distinguish provider acceptance from delivered/bounced mail.

### A18 — P2: Invoice payment-link creation is duplicated

**Evidence:** email sending creates Checkout under an `invoice-send:` idempotency key; the payment-link button uses `invoice-checkout:`. Both charge the balance read at creation. The latter reuses the same key for that invoice balance without checking whether its returned session is expired.

**Impact:** the code can create two independent sessions for one balance, contrary to the comment suggesting duplicate charging is prevented. Link renewal after expiry also needs verification. Database webhook deduplication does not itself cancel another live Checkout.

**Needed:** one stored active payment session per payable balance/version, consistent reuse/expiry handling and stale-session invalidation. Test duplicate links, concurrent payment attempts and expired links in Stripe test mode.

### A19 — P2: Revenue attribution displays records nobody in this application creates

**Evidence:** attribution routes read `revenue_attributions`; no application write path or database function inserting these records was found. The payment-settlement code does not build attribution records.

**Impact:** “which source made money” can remain empty even after payments, unless records are supplied outside the reviewed application.

**Needed:** define source attribution rules and create/reconcile attribution records from settled payments and linked jobs/leads. Test that one known-source payment appears exactly once.

### A20 — P2: Reviews stop at queued records

**Evidence:** the runner's `review.request` creates a queued row. No review delivery worker, customer review form, submission handler or external review sync was found. The Reviews screen is a read-only list.

**Impact:** configuring SMS/email alone does not make the promised request-and-response cycle run.

**Needed:** finish triggering, consent checks, delivery, customer response capture and review status handling. Align the current copy with the implemented scope until then.

### A21 — P2: Business Brain has no feedback connection from normal workflows

**Evidence:** `server/routes/businessBrain.ts:37` accepts feedback and queues extraction, and the worker processes it. No frontend call to `/api/business-brain/feedback` was found. Job duration, quote editing and message correction screens do not submit feedback to that endpoint.

**Impact:** the learning pipeline has an input endpoint but normal user activity does not feed it. Provider credentials alone do not complete the learning loop.

**Needed:** explicitly authorised feedback capture in the relevant workflows, followed by evidence-backed candidate review and observable processing. Validate retry/recovery before relying on the worker.

### A22 — P2: Receptionist preview eventually exceeds its own API limits

**Evidence:** `ReceptionistWorkspace.tsx:214` sends the full accumulated history. `server/routes/receptionist.ts:94` allows at most 16 history messages, each at most 1,000 characters.

**Impact:** after nine successful caller/reply exchanges, the tenth request sends 18 prior messages and is rejected. A long generated reply can make a later request fail earlier.

**Needed:** bound history and text consistently on the client/server, keep the relevant context, and explain limits. Test a conversation longer than ten exchanges.

### A23 — P2: Some errors are shown as empty or successful states

**Evidence:** Reviews, Analytics and Approvals do not render their `query.error` states. Several server queries ignore secondary errors, including memory metrics, call action history and report sections. Public booking/quote lookup failures can be returned as “not found.” Audit writes do not check the returned insert error.

**Impact:** an outage can look like no work/no revenue, a missing link, or a completed operation with no audit record.

**Needed:** visible retryable error states, checked database results, useful operator diagnostics and a distinction between missing data and failed access. Test deliberately unavailable dependencies.

### A24 — P2: Public section links can miss their destination

**Evidence:** browser test at 390px: Pricing → mobile menu → Product navigated to `/#product`, but after rendering the Product section remained approximately 1,628px below the viewport top; header bottom was about 70px. The homepage is lazy-loaded, so the anchor target is absent during initial navigation.

**Needed:** scroll to the hash once the requested route/content has rendered, with the sticky-header offset. Test direct deep links and cross-page links to Product, AI and Security.

### A25 — P2: Booking and scheduling do not consistently use the business timezone

**Evidence:** the public booking route calls slot generation without loading/passing the saved business timezone and formats notifications in Australia/Adelaide. Browser schedule/date formatting uses the viewer's local timezone; dashboard/command “today” uses server-local midnight.

**Impact:** a business outside Adelaide, or a staff member viewing from another timezone, can see mismatched times/day boundaries. The setting currently offers multiple Australian zones.

**Needed:** a single workspace timezone policy applied to availability, inputs, display, reports and day/month boundaries, with DST tests.

### A26 — P2: Lists silently stop at their fetch limits

**Evidence:** customers cap at 100, leads at 200, jobs/invoices/payments at 300, calls at 50, and attribution at 1,000. Most related screens have no server pagination or “more results” mechanism. Schedule loads the capped job list; customer selectors use the capped customer collection.

**Impact:** older customers can disappear from selectors and scheduled jobs can be absent from the board as a business grows. Client-side searching cannot find records that were never loaded.

**Needed:** server pagination/filtering, total counts, explicit loading of scheduled date ranges and searchable customer pickers. Test beyond every limit.

### A27 — P2: Workspace data requests can race

**Evidence:** the shared `useData` helper in `src/pages/AppPages.tsx:9` has one unmount flag, not cancellation/versioning per request or workspace. Earlier requests can resolve after a newer workspace request and overwrite its data.

**Impact:** rapid workspace switching can display stale records under the newly selected workspace. This is a presentation/isolation concern; it does not establish unauthorised backend access.

**Needed:** cancel/version requests and clear workspace-specific state during switching. Test deliberately delayed responses from two workspaces.

### A28 — P2: Some launch and navigation promises have no destination

**Evidence:** no privacy, terms or support/contact routes are defined in `src/App.tsx`, and they are absent from the inspected public navigation/signup. The founding-customer offer says “ask us” without a contact action. Pricing passes `?plan=...`, but signup does not consume or preserve that choice. Onboarding labels do not match their displayed steps and there is no implemented “Test & activate” completion gate.

**Needed:** add the intended policy/support destinations and plan handoff, correct setup progress, and make activation reflect completed checks. Review the policy content with the appropriate business owner; this audit does not assert a legal compliance result.

### A29 — P2: Source migrations and the connected database are not reproducibly aligned

**Evidence:** migration history ends at `deployment_hardening`, but effects corresponding to later public-token indexes, time/material policies, field-completion tables and asset policies are present. Conversely, receptionist Phase 1 fields are absent. The field-completion source migration grants update/delete on signatures/checklists, while the live database currently denies those privileges.

**Impact:** blindly replaying local files can change security behaviour that is already hardened in the database. A fresh installation may behave differently from the current project.

**Needed:** reconcile schema, grants and migration history with an audited baseline/diff. Preserve the live protection on signatures/checklists and verify an empty staging install reproduces the intended result.

### A30 — P2: Time-entry database writes are broader than the API's ownership rule

**Evidence:** the API restricts stopping a time entry to its owner or management. Live `job_time_entries` INSERT/UPDATE policies check workspace membership only, and authenticated UPDATE privilege is enabled.

**Impact:** a signed-in member using the direct database API is not subject to the same “own entry or manager” rule. Tenant-reference triggers exist, so this is an intra-workspace authorisation mismatch, not proof of cross-workspace access.

**Needed:** align row policies/column restrictions with the intended entry-owner/manager model. Test direct Data API access as well as the Express endpoint.

## Module-by-module coverage

“Wired” below means a real handler/data path exists, not that the full live workflow passed.

| Area | Current implementation | Still needed / qualification |
|---|---|---|
| Public home / pricing | Render and navigate; mobile menu works | A24/A28; support/policy links; copy aligned to actual readiness |
| Email login/signup | Supabase calls wired; forms render | Real account, verification, expiry, recovery and SMTP tests |
| Social login | Provider helper and conditional buttons exist | Enable only configured providers; OAuth callback tests; no social buttons shown in current local form |
| MFA / recovery / invitation acceptance | Screens and handlers exist | End-to-end token/AAL2/invite tests; no password changed in audit |
| Workspace creation | Authenticated RPC and trial logic exist | Real test-workspace creation/resume; visible handling of workspace-load errors |
| Business/services setup | Saves business and creates service | A12/A15; load existing data; service maintenance; hours/areas editor |
| Dashboard / Command Centre | Data queries and four command patterns | Commands are restricted read/proposal logic, not a general executor; accurate readiness checklist and timezone |
| Customers / leads | List/create, customer detail and lead stages | A15/A26; correction/archive, contact/address maintenance, pagination |
| Schedule / dispatch | Jobs/appointments displayed; job dates editable | A01/A25/A26; staff assignment control, appointment lifecycle, actual capacity handling |
| Job details | Status, time/material and document UI exists | A01/A02 block reliability; field-completion UI missing |
| Photos / checklists / signatures / report | Backend-only endpoints | A14; UI, immutable evidence rules, actual print/export |
| Assets | List/create UI; backend PATCH | Edit/service-history workflow not completed in the UI |
| Quotes | Create, send link, customer decision, conversion | A11/A17; revisions, preview/detail, void action and delivery retries |
| Invoices / payments | Create/send/Checkout/webhook settlement | A10/A11/A18; business payout model, retries, multi-link/async-method tests |
| Public booking | Page and handlers exist | A04/A05/A25; hours setup, booking link discovery, deposits/capacity/activation |
| Unified Inbox | Conversation list/detail, notes, consent and SMS send | Provider setup and delivery tests; no general email inbox integration |
| Marketing SMS | Create/prepare/approve/batch send | Live consent/opt-out/failure/retry tests; provider and usage configuration |
| AI Receptionist | Config, preview, calls and signed voice runtime | A03/A13/A22; Twilio activation, HTTPS, signing/AI/database credentials and live call tests |
| Receptionist booking/SMS/recording | Explicitly rejected in Phase 1 | Intentionally unavailable, not solved by adding credentials |
| Automations / approvals | Builder, queue API, runner and decision screen | A06–A09; complete execution lifecycle |
| Reviews | Read-only records and queued-request tool | A20; delivery and customer response flow |
| Revenue attribution | Read-only reports | A19; attribution creation/reconciliation |
| Knowledge | List/create with initial approval checkbox | A15; editing, approval changes, retrieval verification, file/website ingestion |
| Business Brain | Memory review/settings, feedback API and worker | A21; workflow input hooks, provider setup and recovery tests |
| Integrations | Status cards; Twilio activation backend | A13; real Connect/Manage actions and provider health |
| Team | List and new-user setup links | A16; existing users, delivery, revocation and offboarding |
| Billing | Subscription Checkout, portal and webhook logic | Server secrets/Prices; test subscription lifecycle; Operator remains “by arrangement” in UI |
| Notifications | Read/list/read-all endpoints | Privileged writes; record deep links and intended per-user read semantics |
| Settings/security | Navigation and MFA controls | Complete editable settings, operational security controls and clear role-aware actions |

### Explicitly unfinished navigation

Seventeen currently listed navigation destinations are labelled coming soon: GPS dispatch/live ETA; job checklist badges; PDF quotes/invoices; standalone time/material log; checklist/forms workspace; recurring jobs/agreements; supplier purchasing; AI post-work recaps; voicemail transcription; call recordings; spam screening; multiple phone numbers; customer portal; automated review requests; Xero/MYOB/QuickBooks; Zapier/webhooks/API; deployment health/monitoring.

These are placeholder destinations, not broken URLs. Some overlap with partially implemented job-detail APIs. The feature registry also retains an older assets placeholder even though `/app/assets` now exists. Use one capability registry so labels, navigation, implementation status and marketing stay aligned.

## Configuration still required locally

The setup script reports **12 missing values**, and an additional check found the receptionist signing secret absent:

| Provider/setup | Missing server settings | Capabilities affected |
|---|---|---|
| Trusted database access | `SUPABASE_SERVICE_ROLE_KEY` | Public links/bookings, trusted audit and notifications, invites, queue processing and provider handlers |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_OPERATOR` | Subscription Checkout, portal, invoice payment links and settlement |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | SMS and phone answering; number must also be associated with the workspace |
| AI | `OPENAI_API_KEY` | Receptionist replies and Business Brain extraction |
| Transactional mail | `EMAIL_API_KEY`, `EMAIL_FROM` | Resend-backed quote/invoice delivery; this is separate from Supabase authentication SMTP |
| Signed voice context | `RECEPTIONIST_SIGNING_SECRET` | Required for production signed call context |

Also verify: public HTTPS callback URLs, provider webhooks, authenticated redirect URLs, production auth SMTP, per-environment secrets, billing Prices matching the advertised offer, and actual worker scheduling. A key being present is not proof that it is valid or the provider workflow is working. Keep server secrets out of browser variables and reports; use the deployment platform's secret store and least-privilege credentials.

The setup script itself is stale: it names launch migrations only through 0022 and omits the signing secret. It exits successfully even when settings are missing. Treat it as a checklist, not a release gate.

## Security and operational observations

- **Positive:** all public tables have RLS enabled; private API samples require authentication; Stripe signature verification and idempotent settlement are implemented; Twilio signatures, consent checks, role checks and production secret checks are present in source. These still require live negative/role tests.
- **Confirmed advisor warning:** leaked-password protection is disabled. Review enabling it in Supabase and test the chosen password policy. [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- **Advisor warnings needing review, not automatic vulnerability claims:** `vector` and `btree_gist` are installed in the public schema; two intentionally privileged RPCs are callable by authenticated users. Verify their intended checks rather than removing functionality blindly. [Extension schema guidance](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [privileged function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- **Expected informational findings:** four server-owned/legacy tables have RLS but no policies. That is deny-by-default for ordinary clients, not evidence of public exposure.
- **Performance follow-up:** the advisor reports uncovered field-completion foreign keys, duplicate permissive policies and unused indexes. Add justified indexes and consolidate policies after correctness work; do not delete indexes merely because this lightly exercised project has not used them. [Foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [policy guidance](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).
- **PWA/deployment follow-up:** `index.html` registers its service worker through an inline script, while the Node production CSP allows only self-hosted scripts. Verify registration under actual production headers. The cache uses cache-first behaviour for scripts/styles without restricting them to hashed build assets; do not use that worker to cache development source indefinitely. Production Cloudflare static-asset headers were not verified.
- **Reliability follow-up:** no complete operational screen for worker failures/dead letters, restore verification, or provider outage monitoring is exposed. Verify scheduled workers and backups in a separate staging environment.
- **Evidence gap:** most existing tests assert code patterns or isolated functions. They did not catch A01/A02/A04/A06/A07. The current CI build does not prove deployed secrets, applied migrations, signed-in journeys or provider behaviour.

## Repair order and completion tests

| Order | Work package | Completion evidence required |
|---|---|---|
| 1 | Database/source alignment and job detail | Reviewed schema diff; reproducible staging migrations; real job opens with correctly mapped records |
| 2 | Booking | Service → available time → single reservation; timezone, concurrency, retry and partial-failure tests |
| 3 | Automation/approvals | Real trigger → queued run → valid inputs → action → approval/rejection → resumed/completed run; crash/retry deduplication |
| 4 | Payments and communications | Correct recipient business receives a test payment; signed webhook settlement; email/SMS failure/retry and consent tests |
| 5 | Settings and record maintenance | Existing records load, edit safely, and remain consistent; role tests for staff/viewer/manager/owner |
| 6 | Finish disconnected screens | Field completion, integration activation, team lifecycle, review delivery and Brain feedback usable through UI |
| 7 | Whole-product release audit | Desktop/mobile/200% text, light/dark, keyboard, long names, populated tables, empty/error states, correct links and no clipped actions |
| 8 | Staged deployment gate | Separate test providers/database; production headers and worker bindings; secret readiness; backup/restore evidence; domain smoke test |

Do not mark this work complete just because the build is green. The release evidence should include a test workspace running: account verification → workspace setup → customer → lead → scheduled job → time/materials → quote → customer acceptance → invoice → test payment → correct settlement/attribution, plus role restrictions, expired sessions and deliberate provider failures.

## Saved audit evidence

- `audit/route-inventory.json` — frontend/backend route references.
- `audit/evidence-summary.json` — browser measurements, schema findings and check summary.
- `audit/http-checks.json` — local health and unauthenticated/invalid-link responses.
- `audit/booking-contract-check.json` — reproducible availability-request mismatch.
- `audit/test-results.txt` — all 58 test results.
- `audit/verification.txt` — full type/security/build verification output.
- `audit/dependencies.json` — npm production dependency audit.

Source locations in this report refer to the local audit snapshot and can move after repairs. Current provider dashboards, production runtime settings, populated private-page behaviour and real delivery remain separate verification tasks.
