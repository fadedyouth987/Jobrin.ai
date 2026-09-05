# Jobrin.ai competitive feature audit — 5 September 2026

Sources: public feature pages and 2026 comparison articles for ServiceM8 (14),
Housecall Pro (CSR AI), Workiz (Genius AI), Jobber, Tradify, AroFlo, Fergus,
simPRO, QuoteIQ, FieldFrame, BuildFolio, FieldQuote, Fixlify, Trady, Tradeify.

## What the market's AI stacks actually do (2025–2026)

| Pattern | Who | What it does |
| --- | --- | --- |
| AI phone agent | ServiceM8 Phone Agent; Housecall Pro CSR AI; Workiz Genius Answering; QuoteIQ "answer your phone 24/7" | Answers calls AND books jobs, dispatches the right tech, works leads across calls/texts/email, summarises every call and notifies the owner |
| Photo → quote | QuoteIQ AI Estimator, BuildFolio, FieldFrame | Analyses property photos, produces line-itemed estimates with upsells in minutes |
| Voice → quote / job notes | FieldQuote, FieldFrame | Speak the on-site diagnosis; get a professional quote; photos auto-organised to jobs |
| Unified AI assistant | QuoteIQ AI, Workiz Genius | One AI across CRM: quote from photo, answer phone, write every text, run campaigns, request reviews |
| AI writing | ServiceM8 AI email writing, AI invoice generator | Drafts customer-facing emails/SMS and invoices |
| Smart scheduling | ServiceM8 smart scheduling suggestions, Workiz smart dispatch | Suggests/optimises schedules, self-serve rescheduling |

## Where Jobrin.ai already matches or leads

- Signed real-time AI receptionist engine (built and verified in this repo) —
  the same category as ServiceM8 Phone Agent / HCP CSR AI, but tenant-isolated
  with approval-gated actions and fail-closed defaults.
- Consent-first SMS campaigns, suppression and audit trails — stricter than most.
- Revenue attribution (source → lead → job → payment) — rare in this tier.
- Hiring pipeline with privacy consent versioning.
- Business Brain memory (evidence-driven learning) — most competitors have none.

## Gaps worth closing (ranked: revenue impact vs schema readiness)

**Tier 1 — direct revenue and the obvious "why isn't this here yet" items**

1. **Quote → customer → pay loop completion**: PDF/email delivery of quotes and
   invoices, then public quote accept (built), then invoice payment link
   (built, needs Stripe keys). Competitors make this one tap.
2. **Photo → quote / voice → quote** (QuoteIQ/FieldFrame/FieldQuote): the
   single most-marketed AI feature of 2026. Jobrin.ai has the schema (services,
   quote_items) and the storage bucket; add photos + voice-note transcription
   to quote drafts, AI-assisted line items, always owner-approved before send.
3. **Public booking page** (Tradeify, Workiz self-serve): customer-facing
   booking from available slots. Schema ready: service_areas, business_hours,
   customer_portal_sessions.
4. **Recurring jobs / service-agreement plans** (Trady service reminders,
   AroFlo scheduled maintenance): recurring visits with due windows and
   automatic reminders. Schema ready: service_agreements + automations.
5. **Customer portal** (Jobber/HCP client hub): customers view jobs, approve
   quotes, pay invoices. Schema ready: customer_portal_sessions.
6. **Xero/MYOB/QuickBooks invoice sync** (ServiceM8's #1 integration page):
   push paid invoices to the bookkeeper. Schema ready: integrations.

**Tier 2 — operational depth**

7. GPS/technician tracking + route optimisation (Jobber's differentiator).
8. Van stock / supplier ordering (AroFlo/simPRO territory — heavier build).
9. Job evidence: before/after photos attached to jobs for disputes and quotes
   (Tradeify "job evidence", FieldFrame photo organisation).
10. Time tracking (job_time_entries exists) and materials (job_materials).
11. Reviews: request after job completion (review_requests table exists) and
    AI-drafted public responses (Workiz Genius).
12. AI email/SMS drafting everywhere (ServiceM8 AI writing): quote cover notes,
    invoice chasers, review responses — always draft + human send.

**Tier 3 — the "not being explained" fix (product surface)**

13. In-app capability map: a "What Jobrin.ai can do" tour page listing every
    automated capability with its on/off state — the meta-fix for features
    not being discoverable.
14. Notification centre (notifications table exists, unused): owner alerts for
    new leads, approvals waiting, overdue invoices, calls handled.

## Notes

- Competitors sell phone AI separately (HCP CSR AI is an add-on; AgentZap
  charges US$109/mo). Jobrin.ai's included receptionist is a genuine differentiator
  once live — but HCP/Workiz go further: booking during the call and
  dispatching. Jobrin.ai's allow_booking needs availability wiring to match.
- Financing buttons ("See monthly payments") are a US pattern; in Australia,
  deposit requests + Stripe-hosted instalments are the closer fit (deposit
  fields already exist on quotes).
- The integration moat is accounting sync + Zapier-style outbox (outbox_events
  table exists) — an integration marketplace later, native Xero first.
