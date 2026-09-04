# Run Jobryn on Windows (PowerShell)

Open PowerShell in the extracted Jobryn folder.

## 1. Check Node/npm

```powershell
node --version
npm.cmd --version
```

Use Node.js 22 or newer.

## 2. Create your private environment file

```powershell
Copy-Item .env.example .env
notepad .env
```

Fill in the Supabase and Stripe values from your own accounts. Never upload or commit `.env`.

## 3. Install dependencies

```powershell
npm.cmd install
```

This creates `package-lock.json`. Commit that lockfile before a production deployment, then use `npm.cmd ci` on future clean installs.

## 4. Apply Supabase migrations

In your Supabase project's SQL editor, run these files **in order**:

```text
supabase/migrations/0001_jobryn_core.sql
supabase/migrations/0002_saas_roles_and_plans.sql
supabase/migrations/0003_revenue_os_core.sql
supabase/migrations/0004_subscription_and_tenant_invariants.sql
supabase/migrations/0005_least_privilege_rbac.sql
supabase/migrations/0006_usage_metering.sql
```

Use a new/staging Supabase project first.

## 5. Configure Supabase Auth

Set your local Site URL to:

```text
http://localhost:3000
```

Allow redirect URLs:

```text
http://localhost:3000/auth/callback
http://localhost:3000/reset-password
```

Enable email/password, then configure Google and GitHub providers. Microsoft/Azure and Apple are supported by the frontend once enabled/configured in Supabase.

For production, require email confirmation and use the production HTTPS domain/redirect URLs.

## 6. Configure Stripe

Create recurring Prices for Starter, Growth and Operator and copy the Price IDs into `.env`.

For local webhook testing with Stripe CLI:

```powershell
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the displayed `whsec_...` signing secret into `.env` as `STRIPE_WEBHOOK_SECRET`.

## 7. Verify source

```powershell
npm.cmd run security:check
npm.cmd run typecheck
```

## 8. Start Jobryn

```powershell
npm.cmd run dev
```

Open:

```text
http://localhost:3000
```

## Production

Before taking payments/customer data:

```powershell
npm.cmd run verify
```

Then complete the staging checklist in `PRODUCTION_SETUP.md`.
