# Jobryn Secure SaaS Build Status

## Implemented in this source build

### SaaS foundation
- React/Vite authenticated product shell
- Express/TypeScript backend
- Supabase/PostgreSQL canonical database
- workspace tenancy and workspace switching
- Owner / Admin / Manager / Staff role model
- database RLS and least-privilege grants
- cross-workspace foreign-reference rejection
- 14-day trial enforcement and plan entitlements
- API subscription enforcement (not UI-only gating)

### Authentication and account security
- email/password signup and login
- email verification-ready production enforcement
- password recovery/reset
- Google OAuth
- GitHub OAuth
- Microsoft/Azure OAuth-ready
- Apple OAuth-ready
- PKCE flow
- TOTP MFA enrollment/challenge
- optional AAL2 enforcement for sensitive billing actions

### Stripe subscription billing
- Starter / Growth / Operator plans
- server-trusted Stripe Price mapping
- Stripe-hosted Checkout
- Stripe Billing Portal
- raw-body webhook signature verification
- webhook event lease/idempotency state machine
- duplicate/in-progress webhook safety
- canonical subscription re-fetch for out-of-order events
- active/trial/past-due grace enforcement
- server-owned entitlement snapshots

### API and data security
- Helmet security headers / production CSP
- HSTS in production
- explicit CORS allowlist
- global and billing rate limiting
- bounded request sizes
- Zod validation on write routes
- remote Supabase session verification
- request IDs and safe error responses
- no privileged keys in browser variables
- no raw card handling
- audit logging through trusted server code
- database-level staff double-booking protection
- internal provider/event tables blocked from direct browser writes

### Revenue OS application surfaces
- public website
- pricing page
- signup/login/recovery/MFA
- onboarding
- dashboard
- Command Centre (controlled read/proposal mode)
- customers
- lead pipeline
- unified inbox read model
- schedule
- jobs
- quotes list
- invoices list
- payments list
- knowledge
- Operator action log
- approvals
- automations read model
- reviews read model
- revenue attribution analytics
- integration health
- team
- billing
- security/settings
- retained legacy Campaign OS route

## Deliberately not faked

The following need real external accounts/credentials and are therefore visibly provider-dependent rather than simulated as successful:

- outbound SMS / phone / Twilio
- Google Calendar OAuth and synchronization
- outbound email delivery
- social OAuth/publishing
- Xero/MYOB/QuickBooks sync
- production AI provider calls beyond the controlled current command routes
- Stripe Connect for a trade business collecting its own customer invoices
- background delivery workers for full automation execution

## Verification performed in this workspace

- source/security scanner passes
- no embedded live Stripe/Supabase secrets detected by the included scanner
- TypeScript syntax-only pass found no parser diagnostics in the new source
- direct dependency installation/full Vite build could not be completed in this sandbox because the package registry request timed out

The first real deployment gate remains: install dependencies, apply migrations to a staging Supabase project, configure Stripe/OAuth credentials, run typecheck/build, then execute tenant-isolation and billing integration tests against those real services.
