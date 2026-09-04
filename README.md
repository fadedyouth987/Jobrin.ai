# Jobryn

**Operations platform for Australian trade and service businesses.**

Jobryn is a subscription SaaS foundation with secure authentication, workspace tenancy, CRM and field-operations modules, Stripe Billing, controlled customer communications, and an AI-assisted operations foundation.

## Included application surfaces

- Public Jobryn website and pricing
- Email/password signup, verification, recovery and login
- Google, GitHub, Microsoft/Azure and Apple-ready OAuth through Supabase
- TOTP MFA enrollment/challenge
- Workspace creation/switching and RBAC
- Guided business onboarding
- Dashboard and AI Command Centre
- Unified Inbox
- Leads and Customers
- Schedule and Jobs
- Quotes, Invoices and Payments
- Consent-first customer messaging, private team notes and controlled SMS campaigns (Growth and Operator plans)
- Automations and Reviews
- Revenue Analytics / Attribution
- Knowledge, Operator actions and Approvals
- Integrations, Team, Billing and Security settings
- Stripe subscription Checkout and Billing Portal
- Hardened Express API and PostgreSQL RLS model

## Start locally

```bash
cp .env.example .env
npm install
npm run typecheck
npm run security:check
npm run dev
```

Open `http://localhost:3000`.

Read [`PRODUCTION_SETUP.md`](./PRODUCTION_SETUP.md) before configuring Supabase, OAuth or Stripe.

## Status

This is a **provider-ready source build**, not a claim that an unconfigured archive is already production-certified. Real OAuth, Stripe and database tests require your own Supabase/Stripe credentials and staging deployment. Do not accept paying customers until the deployment gate in `PRODUCTION_SETUP.md` has passed.
