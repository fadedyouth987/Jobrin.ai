# UI/UX Audit — 2026-09-11 (revision 2: page-by-page architecture-honesty pass)

Scope and method: every page in `src/pages` and the app shell was read in full and checked against the ground-truth documents (`AI_RECEPTIONIST_ARCHITECTURE.md`, the system prompt built in `server/ai/receptionistCall.ts::buildSystemPrompt`, `README.md`, `AI_RECEPTIONIST_SETUP.md`, `COMPETITIVE_FEATURE_AUDIT.md`) and the actual server gates in `server/routes/*` and `server/ai/*`. This revision asks, per page: what does it claim, is the claim true right now, is it reachable, does it expose required human-approval surfaces, does it explain zeros, and is demo content aligned with what the AI may actually do. Severity tags: blocker / P1 / P2 / P3. Revision 1's findings are folded in; items fixed in this pass are marked ✅ **fixed**.

## What is already strong (verified this pass)

- Truth-in-UI is real, not decorative: unshipped features appear in nav with honest "soon" badges, Coming-Soon pages say outright "a design commitment, not a working feature", and `ModulePage` "does not fake external actions".
- Provider claims are computed, not hardcoded: Integrations, Capability Map, Billing, Onboarding and the Dashboard all read live `readiness` from the server (`/api/integrations` returns real configured/connected state).
- Approval surfaces exist and are audited: Approvals rows are actually created by the automation runner with `ai_action_id`, decisions record `decided_by`/`decided_at` + audit trail.
- Business Brain enforces "never live until approved": candidate memories are visibly pending and only deterministic promotion rules + owner decisions (confirm/challenge/archive) change influence; Knowledge documents gate the AI's allowed facts (`approved: true` is the only thing the system prompt sees).
- Empty states across the app explain what will appear and the steps to make it appear.
- Customer-facing surfaces are honest: the public quote page says "No payment is taken on this page", the public booking page says the business will confirm details, and the payment outcome page correctly says payment is only recorded after Stripe confirms.
- Australian conventions throughout (en-AU, AUD, GST lines on documents).
- Notifications are implemented and readable (list/read-all/read-one, unread badge in the shell), not a dead table as the competitive audit of 5 Sep suggested.

## Page-by-page findings

### Public home (`PublicHome.tsx`)

1. **Claims:** hero demo conversation — receptionist says "Sorry to hear that! **I can book one of our plumbers for an emergency callout.** What suburb are you in?"; ops card: "takes messages, **suggests bookings** and transfers…"; workflow step 1: "…captures the details and creates the job request."
2. **Truth:** booking is Phase 2, gated "after pilot validation"; `allow_booking` defaults to false; the system prompt forbids promising technician availability and the deployed engine is fail-closed message-take. The booking sentence in the hero demo is a correctness bug, not a copy nit. The demo's closing card ("Message taken — callback task created") is accurate — the fix is to the middle bubble only. The ops-card "suggests bookings" is Phase-2 gated and needs softer wording. Workflow step 1 is Phase-1-true (lead intake + job request). — **blocker, ✅ fixed**
3. **Reachable:** yes (`/`). **Zero-context:** n/a. **Demo honesty:** see above; trust items ("AI drafts — you approve") are true.
4. **Other:** footer has no contact path beyond legal links (P3, ✅ fixed with a contact/support link; no ABN exists in the repo — do not fabricate one); anchor links `#product/#ai/#security` hide under the sticky header (P3, ✅ fixed via global `scroll-margin-top`).

### Pricing (`PricingPage.tsx`)

Claims: AUD/month plans, 14-day free trial, "Founding trades" offer with **no contact CTA** — dead end. Missing GST statement for Australian B2B pricing (P1, ✅ fixed: GST line + founding offer now links to /support). Truth check: plan catalogue matches `shared/plans.ts` and server entitlements; "provider connections required" disclaimer present and true.

### Public legal pages, auth, MFA, password pages

Auth: PKCE OAuth + email, honest security footer, 12-char minimum. No capability overclaims; auth-page "Answers your business line 24/7" is a marketing product pitch — acceptable at marketing layer since the in-app truth is gated (P3 note). MFA/password pages: functional, honest. No issues.

### Public quote page (`PublicQuotePage.tsx`) & public booking page (`PublicBookingPage.tsx`)

Both are real, working customer flows (accept/decline; slot peek + submit + notification row on booking). Booking success copy: "The business has your booking and will confirm any details" — accurate (booking is a request → appointment + notification; the business confirms). No overclaims. Reachable by URL by design.

### Onboarding wizard (`OnboardingPage.tsx`)

1. **Claims:** six ordered stages; resume-progress from server.
2. **Truth:** step completion is real (server `onboarding_progress` rows; business-profile PUT marks `business` complete). Two real bugs: **no back navigation** (steps only advance; the stepper is not clickable) and **data loss on refresh** — typed-but-unsaved answers (especially the Services step, which only saves on submit) are lost if the save fails or the tab closes. (P1, ✅ fixed: completed steps clickable + Back buttons; localStorage draft module hydrates partial answers, with unit test.)
3. **Reachable:** yes (`/onboarding` from auth + dashboard checklist). **Zero-context:** provider checks card honestly shows Stripe/Twilio/email/OpenAI readiness. **Demo:** none.

### Dashboard (`/app`, `DashboardPage.tsx`)

Claims: "live snapshot… links straight to the record". True (metrics/attention/today from `/api/dashboard`). Setup checklist items map to real gates (Stripe config, Twilio integration rows, email readiness). Gaps: "Revenue this month" shows $0 with no hint that nothing can be recorded until Stripe is connected — the zero-context pattern (P2, ✅ fixed: `StatCard` gained a reusable `pendingNote` affordance; dashboard explains zeros for revenue/AI actions). Reachable; nav labels `/app` as "Command Centre" while the page title is "Today" and the real Command Centre lives at `/app/command` (P2 labelling, ✅ fixed: nav renamed "Today", Command Centre added to nav).

### Command Centre (`/app/command`, `CommandCentrePage.tsx`)

Deterministic reports over stored records, approval-required flag surfaced. **Dead-route finding confirmed:** reachable only via the Capability Map link — absent from sidebar and palette (P1, ✅ fixed: added to AI Admin nav + palette).

### Inbox (`InboxPage.tsx`)

Claims: real-time inbound SMS, consent-checked replies, private notes. True: conversations/messages via API, outbound send requires consent purpose `support`, consent checkbox records a consent row, notes are workspace-private, 10s polling. Empty state correctly says "Once your business SMS number is connected…" (P3 none). Reachable.

### Notifications (`NotificationsPage.tsx`)

1. **Claims:** "new leads, online bookings, messages taken by the AI receptionist and approvals waiting."
2. **Truth:** the notifications surface (list/read/read-all + unread badge) is implemented — the competitive audit's "unused table" note is outdated. Coverage was verified against the actual write sites: `crm.ts` (lead.created), `receptionistCall.ts` (receptionist message-take) and `public.ts` (online booking) all already call the best-effort `writeNotification` helper — three of the four promised alert types were real. The one genuine gap was automation approvals: the runner created approval rows without notifying. (P1, ✅ fixed: `runner.ts` now raises `automation.approval_needed` via the same helper, so all four alert types on the page copy can actually appear.)
3. Reachable (nav + bell). **Zero-context:** empty state present. 

### Customers / Leads / Customer detail

Real CRUD, honest copy ("capture one automatically when they text your business number" — true: receptionist message-take creates the customer). Leads table rows don't link anywhere because no lead detail page exists — flagged P3 (row-link opportunity, tracked). Customers table rows don't link to the detail page — P1 quick-win, ✅ fixed (row links).

### Schedule (`SchedulePage.tsx`)

Week view of real jobs + appointments; unscheduled list; double-book guard copy matches server slot logic. No issues. Reachable.

### Jobs + Job detail

Guided workflow is real; status ladder enforces real next steps server-side (tests confirm false completion jumps rejected). Job detail shows checklists, signatures, time, materials, quotes/invoices/payments with canAdvance logic blocking "invoiced" without invoices and "paid" with balance outstanding — exemplary honesty. Jobs table rows didn't link to the job (P1, ✅ fixed).

### Quotes / Invoices (`FinancialDocumentsPage.tsx`)

Fail-closed copy verified against code: draft creation "Sending will remain disabled until email delivery and public document security are connected"; send results honestly report `not_configured`/`no_customer_email`; GST computed server-side; payment links idempotent. No rows links needed beyond actions (row is the action surface) — status filter chips + search missing (P1, ✅ fixed). Mobile card layout added ✅.

### Payments / Appointments (`OperationsListPage.tsx`)

Rows previously not clickable and no filters — payments rows say nothing about which invoice they belong to beyond the row itself (P1, ✅ fixed: rows link to their invoices/schedule; filter chips + search; mobile cards). "Payments appear here automatically" is true (Stripe webhook settlement).

### Field operations (Time & Materials, Recurring jobs, Assets)

Real endpoints, real forms; Recurring page cadences + statuses honest; assets page "Schedule recurring maintenance" step points to recurring page. Minor: RecurringJobsPage "next due" wording — verified cadence stored; reminder delivery depends on automations (honest copy: reminders need automations provider). No changes needed beyond a P3 note.

### AI Receptionist (`ReceptionistPage.tsx` + `server/routes/receptionist.ts`)

1. **Claims:** four technical readiness checks; "go-live switch unlocks when every check above is green **and a test call has succeeded**"; toggles describe phase-gated behaviours accurately (booking "only happens with the caller's confirmation", SMS "only with recorded consent", recording "only after the caller agrees").
2. **Truth:** the enabled gate in `PUT /api/receptionist` is purely technical (Twilio + OpenAI + HTTPS + engine attached). The architecture's go-live checklist items 4–6 — business profile completeness, recording/privacy consent status, phase-1 test pass status and **owner sign-off after reviewing evidence** — have no UI and no auditable record anywhere. Worse, the switch copy asserts a test call must have succeeded while nothing tracks test-call success: the page currently claims a gate it does not have. — **blocker, ✅ fixed in this pass** (see "Go-live review implemented").
3. **Approval surfaces:** Learning inbox is Phase 4 per the architecture and correctly not claimed anywhere. Business Brain candidates and Knowledge approval cover AI-change review (verified reachable).
4. **Zero-context:** readiness rows show "Ready." or the fix — good. **Demo:** "Try it in text mode" is a real, audited, metered preview (`/simulate`) — matches the engine; not demo-fake content.

### Automations / Approvals / Operator log

Safe-autopilot copy verified against `AUTOMATION_EXECUTABLE_TOOLS` (business.report etc. only) and runner behaviour (atomic claim, retries, dead-letter, approval rows with `ai_action_id`). Approvals decisions audited. No issues. Approvals now also raise a notification (✅).

### Business Brain / Knowledge

BusinessBrainPage: evidence, confidence, promotion rules, owner decisions — matches architecture §"learning with approval" (Phase 4 correctly not advertised). Knowledge: approval flag is the single gate for AI retrieval (verified in `fetchCallContext`). No issues.

### Capability map / Coming soon

Capability map states are computed from live readiness (openai/twilio/stripe) and match the architecture's phase gates; it links the Command Centre. Coming-soon pages are explicit design commitments. The 8 "soon" sidebar placeholders remain duplicated with the capability map (P2 consolidation option — tracked, not done, per "don't hide roadmap" constraint).

### Marketing SMS / Reviews / Analytics

Marketing page is a model of honesty (snapshot → consent/suppression counts → owner approval → batched sends). Reviews/analytics descriptions match server reality (queued requests; source→lead→job→payment attribution). No issues.

### Hiring / Integrations / Team / Billing / Settings / Security

Hiring: management-only, consent versioning, "a manager always makes the hiring decision" — matches hard boundary (no auto-selection). Integrations: configured/connected/roadmap distinction is honest; roadmap providers visibly unavailable. Billing: usage meters vs limits server-enforced; Stripe-unconfigured state explained inline (✅ trial-lapse banner added so the silent redirect has context). Settings/security: accurate list of real boundaries.

### AI receptionist — demo/example content sweep (brief item 6)

- Public home hero demo: overclaimed booking (✅ fixed).
- Auth page: product-level pitch, acceptable (P3).
- Onboarding preview: none.
- Empty states: none simulate AI actions.
- No demo anywhere shows the AI quoting a price, promising a technician by name, or confirming a booking post-fix.

## Go-live review (implemented in this pass)

- New pure module `server/ai/receptionistReadiness.ts` evaluates the architecture's checklist: technical deps + business profile complete + approved knowledge present + transfer number set (+ recording consent prompt when recording is on) + owner sign-off present.
- `GET /api/receptionist` returns the computed checklist and the latest sign-off (who/when/note).
- `POST /api/receptionist/go-live-signoff` (owner only, sensitive auth, note required) records an auditable `approvals` row (`resource_type: 'receptionist.go_live'`, `decided_by`, `decided_at`) plus an audit event — a reviewable record, not a hidden flag.
- `PUT /api/receptionist` now fails closed with `RECEPTIONIST_SIGNOFF_REQUIRED` unless an approved sign-off exists when enabling.
- The receptionist page shows the checklist with per-item fixes, the sign-off card, and gates the switch on full readiness.

## Fixed in this pass (summary)

1. Go-live checklist + auditable owner sign-off (server + UI + tests).
2. Hero demo + ops-card demo copy aligned to message-take reality.
3. Command Centre reachable from nav/palette; dashboard nav label corrected to "Today".
4. Notification coverage verified across leads, bookings, receptionist message-takes; automation approvals now also raise a notification (the one real gap).
5. Row links + status filter chips + text search + mobile card layout on operational lists; customers/jobs table row links.
6. Lazy-loaded heavy app pages (AppShell chunk shrinks; only public pages were lazy before).
7. Pricing page: GST statement + founding-offer contact link.
8. Onboarding: back navigation + localStorage draft persistence (tested) — no more silent data loss on refresh.
9. Trial-lapse banner on Billing; silent redirect now explained.
10. Reusable zero/pending explanation (`StatCard` `pendingNote`) used on dashboard.
11. Accessibility: focus-visible rings on shared controls; aria-labels on icon-only buttons (theme, bell, security, logout, search, menu).
12. Public home anchors no longer hide under the sticky header; the footer already links Support (contact channel) — no ABN was fabricated, as none exists in the repo yet.

Also fixed: `tests/bookingNotifications.test.ts` anchored its slot window to a fixed historical Sunday, which made it a time bomb (it passed at 07:52 and failed every run after 17:00 Friday, because `generateBookingSlots` filters out past instants). The window is now anchored to the next Sunday, strictly in the future; the assertions are unchanged in intent.

## Tracked follow-ups (not silently dropped)

- Sidebar "coming soon" consolidation into the Capability Map (P2; explicitly allowed but not done to avoid removing roadmap visibility this pass).
- Notifications for approvals list real events but the Notifications page has no deep-link navigation to the source record yet.
- Auth-page "24/7 answering" headline is a marketing product pitch; consider an "once unlocked" qualifier at launch copy review.
- Phase-1 "100 scripted scenarios" evidence store (test-call console results) is out of scope for the UI; sign-off currently records the owner's review, per architecture item 6's wording.
- Table pagination for very large datasets (P3).
- Dark mode for the marketing site (P3).

## Verification

- `npm run typecheck` — pass (after fixing `Set` generic inference in the new filter bars and an accidental duplicate import in the shell)
- `npm test` — **84/84 pass**: 67 existing + 17 new (receptionist go-live readiness ×4, onboarding draft persistence ×4, UI honesty contracts ×9). One pre-existing time-dependent test (`bookingNotifications`) was fixed, not deleted.
- `npm run build` — pass