# Jobrin.ai Build Blueprint

## Product decision

Jobrin is an AI revenue operating system for Australian service businesses. It is not a collection of admin tools. Every record must visibly move through one connected lifecycle:

`Acquire -> Enquiry -> Respond -> Qualify -> Convert -> Book -> Quote -> Job -> Invoice -> Payment -> Review -> Retain -> Reactivate -> Attribute`

The primary customer is an owner-operator or dispatcher who works from a phone or tablet between jobs. The first screen must answer three questions quickly:

1. What needs attention now?
2. Who is going where today?
3. What revenue is at risk or ready to collect?

## Stitch design direction

### Visual thesis

**The trusted field desk.** Jobrin should feel like a calm, precise operational console built for real work in vans, workshops and small offices. It uses a practical ink-blue foundation, clear white working surfaces, mineral grey structure and limited safety colours for decisions, risk and money. The character comes from lifecycle progress, operational timelines and schedule lanes rather than oversized marketing imagery or decorative dashboards.

### Design tokens

| Element | Direction |
| --- | --- |
| Primary ink | `#103B5C` deep blue for brand, primary commands and reliable system state |
| Action blue | `#1769AA` for links, active navigation and selected work |
| Revenue green | `#137A57` only for received payment, completed work and positive health |
| Attention amber | `#A76000` for waiting, due soon, confidence review and conflicts |
| Risk red | `#B42318` for overdue, failed automation and blocking errors |
| Neutrals | cool off-white canvas, white work surfaces, graphite body copy and steel dividers |
| Type | a highly legible sans serif; 16px minimum body, 14px minimum operating labels, 12px secondary metadata only |
| Spacing | 4, 8, 12, 16, 24, 32 and 48px rhythm |
| Shape | 6-8px corners for working panels; pill shapes reserved for compact statuses and filters |
| Interaction | 44px touch targets on handheld views, concise inline success feedback, no hidden irreversible action |

### Shared product language

- A persistent **Lifecycle Trail** links a contact, lead, booking, job, invoice, payment and review. Each view shows the current stage, source and next recommended action.
- An **Approval Gate** appears before the AI sends money-sensitive, customer-facing or scheduling-changing actions. It shows the proposed action, confidence, source context, risk and approve/edit/decline controls.
- The **Attention Queue** is the operational home for new enquiries, call escalations, booking conflicts, stalled quotes, overdue invoices, reviews and failed automations.
- Every data view has an intentional loading, empty, error and success state. Empty states explain the next useful action; they never masquerade as feature marketing.
- All money is formatted in AUD; documents show GST separately; dates use DD/MM/YYYY and scheduling uses the workspace's Australian timezone.

## Existing foundation

The current app already provides the right core foundation: secure sign-in and workspace roles, notifications, customer and job records, public booking, public quote and public review links, quotes/invoices/payments, field completion, AI receptionist, approvals, automations, reviews, attribution, integrations, team settings and business knowledge.

The immediate work is to make these capabilities read as one product and to replace every navigation item that currently leads to a future-state page before presenting it as an available feature. The existing schema already connects customers, leads, conversations, appointments, jobs, quotes, invoices, payments, AI actions, approvals, automations, reviews, notifications and attribution. New work should extend that model only where a user journey cannot be represented today.

## Information architecture

### Mobile navigation

Keep the fixed bottom navigation intentionally small:

| Destination | Purpose |
| --- | --- |
| Today | attention queue, field schedule and revenue exceptions |
| Inbox | AI receptionist conversations and team takeover |
| Schedule | dispatch and technician availability |
| Create | contextual menu: lead, booking, quote, job, invoice, message |
| More | CRM, jobs, money, AI admin, marketing, reports and settings |

### Desktop navigation

Keep desktop groups, but surface only complete features. Group content by the sequence in which work happens: Today, Inbox, Customers and leads, Schedule and jobs, Quotes and money, AI admin, Growth, Reports, Workspace.

## Screen inventory and acceptance standard

Every screen below needs: one primary action, mobile layout, keyboard-accessible controls, loading/empty/error/success states, and a Lifecycle Trail where the record participates in revenue delivery.

| Module | Required screens and behaviours | Delivery status |
| --- | --- | --- |
| 1. AI Receptionist | Live conversation desk; call/SMS/webchat transcript; AI confidence; human takeover; summary; escalation feed; handling rules; test console; call history and insights. | Foundation exists; consolidate into one real-time operating surface. |
| 2. CRM | Customer list with search/filter; customer profile; communication/job/payment history; addresses; tags; consent; duplicate review and merge. | List and profile exist; add merge workflow, unified timeline and lifecycle trail. |
| 3. Leads and pipeline | Lifecycle kanban; source on every lead; stage movement with confirmation; lead detail; qualification prompts; conversion to booking/quote/job. | Lead foundation exists; build a true pipeline and conversion journey. |
| 4. Bookings and calendar | Day/week/month/agenda; team lanes; availability; travel-time buffer; drag reschedule; conflict warning; public booking conversion. | Schedule foundation exists; extend route-aware assignment, alternate views and conflict resolution. |
| 5. Quotes | Quote list; builder with price book; GST breakdown; send, view, sign/accept; customer-facing quote document; accepted quote conversion. | Quote list/public link exist; build the editor and acceptance route. |
| 6. Jobs | Job list; job detail; job cards; checklist, photos, signature, time/materials; technician assignment; completion and invoice handoff. | Strong foundation exists; finish media capture and job-to-invoice handoff. |
| 7. Invoices and payments | Invoice list; builder; GST lines; send; hosted pay view; partial payment; overdue queue; payment receipt. | List/payment links exist; build edit, partial payment and collection workflow. |
| 8. Messaging | Contact-linked unified inbox; SMS/email channels; templates; delivery/read state; internal notes; team assignment. | Inbox foundation exists; unify channels, template selection and assignment. |
| 9. Automations | Visual trigger -> condition -> action editor; versioning; pause; duplicate prevention; run history; failure diagnosis and retry. | Basic automation exists; build the serious workflow editor and observability view. |
| 10. Reviews | Request sequence; delivery tracking; private feedback route; public review feed; response drafting; issue escalation. | Foundation exists; add response workflow and review performance. |
| 11. Reporting | Lifecycle funnel from source to paid/reviewed; source ROI; conversion leakage; filters; drill-through to underlying records. | Attribution table exists; replace generic reporting treatment with lifecycle analysis. |
| 12. Customer portal | Separate simple brand surface: upcoming bookings, accepted quotes, invoices, payment, messages and documents. | Not yet built; keep out of primary nav until complete. |
| 13. Team and workspace | Invite, role selection, technician availability, workspace switcher, activity and access history. | Foundation exists; complete invite outcome and availability settings. |
| 14. Business Brain | Guided knowledge editor for services, pricing boundaries, hours, policies, tone, FAQs and escalation rules; preview how AI will respond. | Foundation exists; make it feel like training a colleague, with source/confidence feedback. |
| 15. Templates | Quote, invoice, checklists, messages and automation templates; create, preview, duplicate and archive. | Partially distributed; unify into a reusable template library. |
| 16. Landing and booking tools | Branded booking/landing-page builder, source tracking, preview, publish state and conversion performance. | Public booking exists; builder and attribution controls remain. |

## Delivery sequence

### Release 1: Revenue control room

Goal: turn the current Command Centre into the daily operating surface.

- Finish the Attention Queue and Lifecycle Trail across lead, customer, job, quote and invoice records.
- Make Today show live schedule, AI escalations, booking conflicts, unsent quotes and cash at risk.
- Complete unified inbox takeover and contact context.
- Deliver the lead pipeline with source attribution and clear conversion actions.
- Ensure a customer can move from enquiry to booked job without leaving a connected record thread.

Success measure: an owner can resolve the next important item, assign today's work and see at-risk revenue in under a minute.

### Release 2: Quote-to-cash

Goal: make quotes, jobs and payment collection a dependable end-to-end flow.

- Build quote and invoice editors with GST-correct calculations and saved templates.
- Finish public quote acceptance and the customer payment experience.
- Support invoice reminders, partial payments, overdue collection states and receipts.
- Make job completion produce the next correct action: review request, invoice or follow-up.

Success measure: a quote can be created, sent, accepted, converted, completed, invoiced and paid without manual re-entry.

### Release 3: AI and automation confidence

Goal: give AI meaningful responsibility without removing human control.

- Consolidate the AI receptionist desk with summaries, confidence and clear takeover.
- Add approval policies by action type, value and customer risk.
- Build the visual automation editor, run history, safeguards and recovery from failures.
- Finish Business Brain teaching, test conversations and source-backed answers.

Success measure: every automated customer action is explainable, reversible where appropriate and auditable.

### Release 4: Retention and growth

Goal: turn completed work into repeatable revenue.

- Finish reviews, customer portal and message/template library.
- Deliver follow-up, reactivation and recurring service journeys with consent controls.
- Build the public landing/booking builder with source and conversion tracking.
- Replace simple attribution tables with a lifecycle funnel and source ROI drill-down.

Success measure: the business can identify which source generates paid work and act on churn or repeat-service opportunities.

### Release 5: Complete operational depth

Goal: finish specialist workflows without diluting the core experience.

- GPS dispatch and live ETA.
- Checklists/forms template builder.
- Voicemail, recordings, spam screening and multiple business numbers.
- Xero/MYOB/QuickBooks sync plus webhook/API integrations.
- Deployment health and operational monitoring.

Do not put these into the primary navigation until each has a complete happy path and recoverable failure state.

## State design matrix

| State | What the user sees | What they can do |
| --- | --- | --- |
| Loading | Stable page structure and concise skeletons; no layout jumps. | Continue using unrelated navigation. |
| Empty | Product-specific explanation tied to the next lifecycle action. | One relevant action, such as create lead or connect phone number. |
| Error | Plain-language cause, preserved typed input and affected record context. | Retry, edit, or contact support; never silently discard work. |
| Success | Inline confirmation and only the next useful option. | View the resulting record, undo a safe local action or continue the lifecycle. |
| AI uncertainty | Confidence and the missing evidence, rather than invented certainty. | Take over, edit the proposal or approve with context. |
| Conflict | Exact overlapping people, time and location. | Choose an alternate slot/technician or explicitly override with a reason. |

## Technical build principles

1. Keep React and the current route architecture. Use the existing Supabase model and hardened API routes before adding another persistence pattern.
2. Treat the lifecycle as a queryable record graph, not duplicated status fields across isolated modules.
3. Use server-side authorization and workspace scoping for every record action. The interface must never be the only permission boundary.
4. Use transactional conversion operations for lead -> booking/job, quote -> invoice and invoice -> payment reconciliation so duplicate clicks cannot create duplicate revenue records.
5. Design optimistic interactions carefully: move a pipeline card immediately only when the server can safely reconcile or restore it.
6. Keep customer-facing documents and portal routes visually distinct from internal operations; remove internal navigation, show business identity, GST, support/contact details and a clear secure-payment treatment.
7. Instrument lifecycle events from the beginning: source captured, enquiry received, AI escalation, booking created, quote sent/accepted, job completed, invoice paid, review requested/received and reactivation converted.

## Quality gates before each release

- No visible nav item reaches a placeholder page.
- Every primary flow is usable on a 390px-wide screen, tablet and desktop.
- All money is AUD with GST explicit on quotes and invoices.
- Dates, phone numbers, addresses and timezone behaviour use Australian conventions.
- Screen-reader labels, focus order, keyboard access and contrast have been checked.
- Permission checks, audit events and error recovery exist for customer-changing and money-changing operations.
- Populate the screen with realistic records and verify empty, loading, error and success states before considering it done.
- Type checks, security checks and production build pass for the affected release.

## Immediate next implementation slice

Build the **Revenue Control Room** as the reference surface for the rest of the product:

1. Upgrade Today into a triage board with attention queue, schedule lane, money exceptions and AI receptionist activity.
2. Add the Lifecycle Trail to customer, lead, job, quote and invoice details.
3. Replace the lead list with a source-aware pipeline and guarded conversion actions.
4. Remove or hide incomplete navigation destinations until their release is underway.

This slice makes Jobrin's central promise visible on day one and creates the shared patterns that every later module can reuse.
