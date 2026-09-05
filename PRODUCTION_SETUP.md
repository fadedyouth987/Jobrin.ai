# Jobrin.ai SaaS — Production Setup

This repository is the secure SaaS foundation for Jobrin.ai. It includes the public website, authenticated application shell, Supabase-backed multi-tenant data model, OAuth/password authentication, MFA UI, Stripe subscription billing, hardened API middleware and normalized CRM, hiring, operations and communications records.

## 1. Local prerequisites

- Node.js 22+
- A Supabase project
- A Stripe account
- OAuth applications for the providers you enable

Copy `.env.example` to `.env` and fill in your own values. Never commit `.env`.

```bash
npm install
npm run typecheck
npm run security:check
npm run dev
```

## 2. Supabase

Apply migrations in order:

1. `supabase/migrations/0001_vantory_core.sql` (historical compatibility name)
2. `supabase/migrations/0002_saas_roles_and_plans.sql`
3. `supabase/migrations/0003_revenue_os_core.sql`
4. `supabase/migrations/0004_subscription_and_tenant_invariants.sql`
5. `supabase/migrations/0005_least_privilege_rbac.sql`
6. `supabase/migrations/0006_usage_metering.sql`
7. `supabase/migrations/0007_secure_invoice_payment_settlement.sql`
8. `supabase/migrations/0008_twilio_tenant_routing.sql`
9. `supabase/migrations/0009_backfill_workspace_trials.sql`
10. `supabase/migrations/0010_harden_asset_storage.sql`
11. `supabase/migrations/0011_member_subscription_access.sql`
12. `supabase/migrations/0012_ai_receptionist_configuration.sql`
13. `supabase/migrations/0013_field_service_and_safe_autopilot.sql`
14. `supabase/migrations/0014_business_brain_memory.sql`
15. `supabase/migrations/0015_business_brain_advisor_hardening.sql`
16. `supabase/migrations/0016_complete_new_foreign_key_indexes.sql`
17. `supabase/migrations/0017_trade_hiring_pipeline.sql`
18. `supabase/migrations/0018_communications_hub.sql`
19. `supabase/migrations/0019_deployment_hardening.sql`

Use the browser publishable/anon key only in `VITE_*` variables. The service-role key belongs on the server only.

### Cloudflare staging and build configuration

Create a **separate Supabase project** for staging before using `wrangler --env staging`. Staging must have its own `SUPABASE_URL`, publishable key, service-role key, Stripe test-mode credentials and Twilio test or sub-account credentials. Do not point staging at production data or live payment and phone providers.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are public browser build values, not Wrangler runtime secrets. Supply the staging pair to the build runner before `npm run cf:dry-run` or `npm run cf:deploy:staging`; supply the production pair before `npm run cf:deploy:production`. The commands fail closed if either value is absent.

Set every runtime provider value separately for each Worker environment. In particular, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, Stripe credentials and provider keys with `wrangler secret put`. For example, `wrangler secret put SUPABASE_URL --env staging` sets only the staging endpoint; omit `--env staging` for production. This prevents a staging deployment from sharing production database access by configuration inheritance.

The scheduled Business Brain processor runs every five minutes on Cloudflare. Keep `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` as Worker secrets; do not set them as `VITE_*` variables. Its database outbox uses atomic claims and idempotency, but it still needs a staging exercise before it can be relied on operationally.

### Authentication

In Supabase Authentication:

- enable email/password
- require email verification in production
- configure the production Site URL
- allow `https://jobrin.ai/auth/callback` and `https://jobrin.ai/reset-password`
- enable Google and GitHub as the first OAuth providers
- optionally enable Azure/Microsoft and Apple
- configure provider client IDs/secrets in Supabase, never in the browser
- enable a strong password policy, CAPTCHA/bot protection and leaked-password protection where your plan supports it
- configure production SMTP before accepting customers; the default mail sender is only for testing

The frontend uses PKCE and exchanges the OAuth code at `/auth/callback`.

### MFA

Jobrin.ai supports TOTP enrollment under **Settings → Security**. Set `REQUIRE_AAL2_SENSITIVE=true` in production once owner/admin MFA onboarding is ready. Sensitive billing actions are then rejected unless the session has AAL2.

## 3. Stripe Billing

Create three recurring Stripe Prices matching Jobrin.ai's plans:

- Starter
- Growth
- Operator

Put the server-side Price IDs in:

```env
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_GROWTH=price_...
STRIPE_PRICE_OPERATOR=price_...
```

Never accept a Stripe Price ID from the browser. The API accepts a Jobrin.ai plan key and maps it to the trusted server-side Price ID.

Create a Stripe webhook endpoint:

```text
https://jobrin.ai/api/stripe/webhook
```

Subscribe at minimum to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `invoice.payment_succeeded`

Store the signing secret as `STRIPE_WEBHOOK_SECRET`. Webhook signatures are verified against the raw request body before processing. Events are claimed by database event ID and subscription state is applied through a service-role-only database function.

Jobrin.ai uses Stripe-hosted Checkout and Billing Portal. Raw card details do not pass through Jobrin.ai.

## 4. Production environment

Minimum production variables:

```env
NODE_ENV=production
APP_URL=https://jobrin.ai
CORS_ORIGINS=https://jobrin.ai,https://www.jobrin.ai
TRUST_PROXY=1

VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_STARTER=...
STRIPE_PRICE_GROWTH=...
STRIPE_PRICE_OPERATOR=...

REQUIRE_AAL2_SENSITIVE=true
REQUIRE_EMAIL_VERIFICATION=true
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.7-flash
```

Use a managed secrets store on your host. Do not place secrets in `VITE_*` variables or source control.

## 5. Security controls already implemented

- Supabase session verification server-side with `auth.getUser`
- workspace membership check on protected tenant routes
- server-side role checks
- PostgreSQL Row Level Security
- same-workspace foreign-reference guards
- database-level double-booking exclusion
- 14-day trial and server-side subscription/entitlement enforcement
- owner/admin/manager/staff model
- per-request IDs
- Helmet security headers and production CSP
- explicit CORS allowlist
- global and billing rate limiting
- bounded JSON/form body sizes
- Zod request validation in protected write paths
- API responses marked `no-store`
- Stripe raw-body signature verification
- database-backed webhook event claiming and idempotent subscription-state application
- no browser exposure of Stripe/Supabase privileged keys
- TOTP MFA UI and AAL2 enforcement support
- audit records for privileged actions
- normalized tenant-scoped operational tables
- intentionally disabled fake social publishing/trend endpoints instead of pretending providers are connected

## 6. Deployment gate

Do not call a deployment production-ready until these pass against the real Supabase and Stripe projects:

```bash
npm ci
npm run typecheck
npm run security:check
npm test
npm run build
```

After the first successful install, commit the generated `package-lock.json` and use `npm ci` for repeatable CI/deployments.

Then verify in staging:

- email signup/verification/reset
- Google OAuth
- GitHub OAuth
- MFA enrollment/challenge
- two unrelated workspaces cannot read/write each other's data
- owner/admin/staff permission boundaries
- Stripe Checkout success/cancel
- Stripe Billing Portal
- duplicate Stripe webhook delivery
- subscription upgrade/downgrade/cancellation
- expired/invalid access tokens
- malformed/oversized API bodies
- CORS from an untrusted origin
- rate-limit responses
- database backup and restore
- incoming and outbound Twilio SMS, including STOP/START and a deliberately interrupted campaign send
- verify `jobrin.ai` and `www.jobrin.ai` resolve over HTTPS before switching Stripe or Twilio to live mode

A real security review and dependency vulnerability scan are still required before accepting customer financial/business data.

## 7. What is intentionally provider-dependent

The following require external credentials/services and therefore cannot be fully activated from source code alone:

- OAuth providers
- Stripe billing
- outbound email
- SMS/telephony
- Google Calendar sync
- social publishing
- production AI calls

The UI exposes integration health rather than faking a successful connection.
