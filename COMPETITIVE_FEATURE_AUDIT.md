# Competitive Feature Audit

**Updated:** 10 September 2026

**Scope:** Publicly documented product capabilities for 15 trade and field-service products, compared with the current Jobrin.ai repository and architecture documents.

> Public product pages change, regional packaging differs, and some capabilities are sold only on particular plans or as add-ons. Re-verify every competitor feature, price, plan boundary, and regional availability before using this audit in roadmap, sales, or investment decisions.

This is a feature audit, not a full product trial or legal/compliance review. A feature is treated as evidenced only when it appears in the linked public material. “Not found” means that the reviewed public sources did not establish an equivalent capability; it does not prove that a competitor lacks a private, beta, partner-delivered, differently named, or newly released implementation.

## Market patterns

| Pattern | Public evidence | Implication for Jobrin.ai |
|---|---|---|
| AI phone reception is moving into field-service suites | [ServiceM8 Phone](https://www.servicem8.com/au/phone), [Housecall Pro CSR AI](https://www.housecallpro.com/features/ai-team/csr-ai/), [Workiz Genius Answering](https://www.workiz.com/features/genius-answering/), and [QuoteIQ Virtual Call Team](https://myquoteiq.com/features/virtual-call-team/) describe AI answering, qualification, booking, or follow-up capabilities (all accessed 10 Sep 2026). | Receptionist quality alone will not remain a durable differentiator. Consent, operational context, safe escalation, and downstream workflow execution matter more. |
| Photo- and voice-assisted quoting is becoming practical | [QuoteIQ AI Estimator](https://myquoteiq.com/ai-estimator/), [BuildFolio AI Quote](https://build-folio.com/features/ai-quote/), [FieldFrame](https://www.fieldframeapp.com/), and [FieldQuote](https://fieldquote.ai/) describe photo, voice, or combined inputs that produce editable estimates or quotes (all accessed 10 Sep 2026). | Jobrin.ai should treat multimodal capture as a high-value owner workflow, with explicit review before anything becomes binding. |
| AI is spreading across the workflow rather than remaining a single assistant | [QuoteIQ AI](https://myquoteiq.com/ai/) spans estimating, calls, messaging, campaigns, and reviews; [Workiz’s Genius overview](https://help.workiz.com/hc/en-us/articles/22777577796241-Genius-AI-overview) spans answering, messaging, and in-product assistance (both accessed 10 Sep 2026). | Jobrin.ai’s advantage must come from coherent context, controls, and handoffs across the whole job lifecycle. |
| Drafting and scheduling assistance are becoming baseline features | [ServiceM8’s feature overview](https://www.servicem8.com/nz/feature-overview) documents AI email writing, invoice generation, scheduling, quoting, and CRM assistance (accessed 10 Sep 2026). | Generic AI writing or scheduling should be positioned as workflow support, not the product’s sole AI distinction. |
| Self-service booking, portals, routing, and integrations remain table stakes | [Jobber’s feature catalogue](https://www.getjobber.com/features/), [Housecall Pro’s field-service overview](https://www.housecallpro.com/field-service-management-software/), [Workiz Online Booking](https://www.workiz.com/features/online-booking/), and [ServiceM8 accounting integrations](https://support.servicem8.com/help-center/topics/accounting-integrations) document these operational capabilities (all accessed 10 Sep 2026). | Closing core workflow gaps is necessary even where those features are not differentiators. |

## Where Jobrin.ai already matches or leads

- **Consent and suppression controls:** The repository documents Australian calling-window rules, opt-out handling, suppression checks, quiet hours, recording disclosures, and auditability as one operating system. An equivalent combined control set was not established in the reviewed public competitor sources listed in Notes (accessed 10 Sep 2026). This is not a claim about competitors’ private implementations or legal compliance.
- **Receptionist safety boundary:** The architecture separates model conversation from controlled business actions, prohibits binding live prices, and requires deterministic checks and approval paths for sensitive actions.
- **Business-context memory:** The Business Brain’s evidence promotion, provenance, contradiction handling, and owner confirmation form a more explicit operational-memory design than anything established in the reviewed public competitor sources listed in Notes (accessed 10 Sep 2026). This does not establish that competitors have no internal memory systems.
- **Revenue attribution:** Jobrin.ai connects calls, leads, quotes, invoices, payments, and campaign activity. A directly equivalent end-to-end attribution model was not established in the reviewed public competitor sources listed in Notes (accessed 10 Sep 2026).
- **Approval-aware automation:** The proposed automation model distinguishes safe execution from actions that require human approval, rather than treating generated content as permission to act.

## Gaps worth closing (ranked: revenue impact, adjusted for build and dependency risk)

The primary ranking axis is expected revenue impact: faster conversion, higher collection rates, stronger retention, or lower revenue leakage. Ordering is then adjusted for delivery risk, external dependencies, security exposure, and liability. Existing schema or partial implementation is only an effort signal; it does not make an item strategically important or low-risk by itself.

### Tier 1 — Highest revenue impact

1. **Finish quote-to-pay and invoice-to-pay**

   Public evidence: [Jobber](https://www.getjobber.com/features/) and [Housecall Pro](https://www.housecallpro.com/field-service-management-software/) document customer-facing quote approval, invoicing, and payment workflows (accessed 10 Sep 2026).

   Jobrin.ai opportunity: complete the current Stripe-backed payment journey, truthful delivery states, receipts, reconciliation, and recovery from failures.

   **Tool boundary resolved:** Current Checkout-link creation is authenticated and server-side. The receptionist model cannot create a Checkout session, choose an amount, or send a Checkout link during a call. Completing this backend/UI flow therefore does not require expanding the model’s tool surface or relaxing the prohibition on live binding prices.

   **Build risk:** provider configuration, email/PDF state consistency, idempotent session creation, webhook replay and ordering, expired links, partial payment states, and reconciliation. “Code exists” must not be represented as “ready” until those dependencies and failure paths are verified.

2. **Add photo- and voice-assisted quote drafting**

   Public evidence: [QuoteIQ](https://myquoteiq.com/ai-estimator/) accepts photos plus typed or voice descriptions; [BuildFolio](https://build-folio.com/features/ai-quote/) creates reviewable itemised quote options from photos; [FieldFrame](https://www.fieldframeapp.com/) combines voice notes and photos; [FieldQuote](https://fieldquote.ai/) supports voice-dictated quote creation (all accessed 10 Sep 2026).

   Jobrin.ai opportunity: let an authenticated owner or staff member attach job evidence, dictate scope, receive an editable draft, and explicitly approve it before sending.

   **Accuracy and liability risk:** images can hide defects or scale, speech can be mistranscribed, and generated scope or price can be wrong. Preserve source media and transcripts, expose uncertainty, constrain suggestions to the price book and business rules, keep every field editable, and require owner review before the quote becomes customer-facing or binding.

   **Receptionist boundary:** this is a separate asynchronous, owner-approved workflow. It does not permit the receptionist to improvise or communicate a binding price during a live call.

3. **Complete real-time online booking and availability**

   Public evidence: [Tradeify](https://tradeify.app/features) advertises a public booking page; [Workiz Online Booking](https://www.workiz.com/features/online-booking/) describes real-time calendar availability, deposits, self-service, and smart dispatch (both accessed 10 Sep 2026).

   Jobrin.ai opportunity: expose bookable service windows that respect staff, duration, travel, service area, business rules, and receptionist handoffs.

   **Build risk:** concurrent bookings, stale availability, time zones and daylight-saving transitions, travel buffers, service-area validation, deposits, rescheduling, and retry-safe reservation writes.

4. **Add recurring services and maintenance plans**

   Public evidence: [Tradify Service Reminders](https://tradifyhq21719864600.zendesk.com/hc/en-us/articles/39198159248921-Service-Reminders-Overview) documents repeat service reminders; [AroFlo Maintenance Management](https://aroflo.com/features/maintenance-management-software) documents recurring maintenance at varying frequencies (both accessed 10 Sep 2026).

   Jobrin.ai opportunity: convert completed work into recurring jobs, reminders, service plans, and forecastable revenue.

   **Build risk:** recurrence semantics, editing one versus future occurrences, skips and pauses, assignment drift, reminder idempotency, daylight-saving changes, and preserving customer consent across channels.

5. **Ship a secure customer portal**

   Public evidence: [Jobber Client Hub](https://help.getjobber.com/en/articles/client-hub-settings/) supports quote approval, appointment visibility, invoice payment, and requests; [Housecall Pro](https://www.housecallpro.com/field-service-management-software/) describes a customer portal for appointments, invoices, and payments (both accessed 10 Sep 2026).

   Jobrin.ai opportunity: give customers a single place to approve quotes, inspect appointments, pay invoices, and view shared documents.

   **Security risk:** tenant and customer scoping, guessable or leaked links, token expiry and revocation, session fixation, document authorization, audit history, and adversarial cross-customer access tests. Portal convenience must not weaken authentication or row-level isolation.

6. **Add accounting integrations and reconciliation**

   Public evidence: [ServiceM8 accounting integrations](https://support.servicem8.com/help-center/topics/accounting-integrations) and its [connection guide](https://support.servicem8.com/help-center/getting-started-guide/basic-account-set-up/connect-to-xero-quickbooks-online-or-myob) document Xero, QuickBooks Online, and MYOB connectivity, including invoice and payment synchronisation (both accessed 10 Sep 2026).

   Jobrin.ai opportunity: start with one well-supported ledger integration and an explicit reconciliation model, rather than shallow coverage of many providers.

   **Build risk:** tax and account mappings, contact matching, partial payments and credits, duplicate prevention, retries, webhook ordering, conflict resolution, backfills, provider rate limits, and a supportable reconciliation UI.

### Tier 2 — Retention and operational depth

7. **Route optimisation and technician location visibility**

   Public evidence: [Jobber](https://www.getjobber.com/features/) documents routing, maps, nearest-technician visibility, and GPS tracking (accessed 10 Sep 2026).

   Jobrin.ai opportunity: improve dispatch efficiency and give customers controlled arrival visibility.

   **Build risk:** mobile background-location permissions, battery use, sparse or inaccurate GPS, employee privacy, retention rules, customer-link expiry, and clear on/off-duty boundaries.

8. **Inventory, purchase orders, and supplier workflows**

   Public evidence: [AroFlo’s purchase-order guidance](https://help.aroflo.com/articles/?_escaped_fragment_=hg%2Foffice-add-purchase-order-items) documents assigning stock to users, storage, and tasks; [simPRO Inventory Management](https://www.simprogroup.com/features/track-inventory) describes stock, purchase orders, and supplier catalogues (both accessed 10 Sep 2026).

   Jobrin.ai opportunity: connect used materials to job profitability and replenishment without turning the first release into a full ERP.

9. **Evidence packs and document management**

   Public evidence: [Tradeify](https://tradeify.app/features) describes job evidence packs with GPS, photos, signatures, and checklists; [FieldFrame](https://www.fieldframeapp.com/) describes photo capture and Google Drive organisation alongside generated estimates (both accessed 10 Sep 2026).

   Jobrin.ai opportunity: produce a customer- and dispute-ready job record with permissions, timestamps, and exportable evidence.

10. **Time and materials capture tied to profitability**

    Jobrin.ai opportunity: record staff time, travel, materials, variations, and write-offs against a job, then compare estimate, actual cost, invoice, and collected revenue. This ranks below quote-to-pay because it primarily improves margin visibility and operational control after demand is won.

11. **Review request and response workflow**

    Public evidence: [Workiz Reputation Management](https://www.workiz.com/features/genius-marketing/reputation-management/) describes review requests and AI-suggested responses that the user can review, edit, and post (accessed 10 Sep 2026).

    Jobrin.ai opportunity: trigger review requests after eligible completed jobs, suppress ineligible recipients, centralise responses, and attribute reviews to source workflows.

12. **AI writing across operational messages**

    Public evidence: [ServiceM8’s feature overview](https://www.servicem8.com/nz/feature-overview) documents AI email writing and other AI-assisted administrative content (accessed 10 Sep 2026).

    Jobrin.ai opportunity: draft quote follow-ups, appointment messages, invoice reminders, review requests, and campaign copy using Business Brain context.

    **Consent and suppression boundary:** every drafted SMS must pass the same deterministic recipient, consent, opt-out, suppression, quiet-hours, and audit checks specified for receptionist Phase 3 before it can be sent. Human review is valuable, but a human clicking Send is not a substitute for those controls.

### Tier 3 — Strategic extensions

13. **Add an in-app capability map**

    Create a “What Jobrin.ai can do” tour that lists each automated capability and its current on/off or setup state. This is the product-surface fix for valuable features that exist but are not discoverable.

14. **Activate the notification centre**

    Use the existing notification foundation for owner alerts covering new leads, pending approvals, overdue invoices, and calls handled, with clear read state and actionable destinations.

## Notes

- Housecall Pro’s field-service overview labels CSR AI as an add-on rather than establishing that it is included in every plan ([source](https://www.housecallpro.com/field-service-management-software/), accessed 10 Sep 2026).
- AgentZap’s United States page publicly lists a **US$109/month** plan at the time of review ([source](https://agentzap.ai/locations/united-states), accessed 10 Sep 2026). Re-verify price, inclusions, taxes, and availability before comparison or publication.
- Jobrin.ai’s included receptionist capability may be a packaging advantage where competitors charge separately, but that conclusion requires current plan-by-plan validation. Public pages alone do not establish total cost of ownership.
- Workiz documents online booking and smart-dispatch behaviour ([source](https://www.workiz.com/features/online-booking/), accessed 10 Sep 2026). Jobrin.ai’s architectural foundations are not equivalent to a working customer-facing booking flow until availability, reservation, and failure handling are wired end to end.
- Financing belongs here as a potential positioning choice, not as a sourced claim that competitors broadly omit it or that the Australian market necessarily requires it.
- Deep integrations can be more defensible than a long checklist. Start with the accounting, calendar, communications, and payments workflows that close the most revenue leakage.
- **[Strategic positioning — needs input from product/leadership]** The intended position between low-cost solo-operator software and heavier field-service suites is not established by the reviewed public sources or by repository price constants alone. Add the agreed target customer, price/value posture, and explicit non-goals here before using the audit externally.
- **Reviewed-source set (all accessed 10 Sep 2026):** [ServiceM8](https://www.servicem8.com/nz/feature-overview), [Housecall Pro](https://www.housecallpro.com/field-service-management-software/), [Workiz](https://help.workiz.com/hc/en-us/articles/22777577796241-Genius-AI-overview), [QuoteIQ](https://myquoteiq.com/ai/), [BuildFolio](https://build-folio.com/features/ai-quote/), [FieldFrame](https://www.fieldframeapp.com/), [FieldQuote](https://fieldquote.ai/), [Jobber](https://www.getjobber.com/features/), [Tradeify](https://tradeify.app/features), [Tradify](https://www.tradifyhq.com/), [AroFlo](https://aroflo.com/features/maintenance-management-software), [simPRO](https://www.simprogroup.com/features), [Fergus](https://fergus.com/features/team-management/), [Fixlify](https://fixlify.app/features), and [Trady](https://landing.trady.jobs/). AgentZap was reviewed separately for the pricing note above.
