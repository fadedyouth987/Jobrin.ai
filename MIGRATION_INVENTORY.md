# Jobryn migration inventory

Date: 2026-09-04

## Current architecture

- React 19 and Vite browser application.
- Express/TypeScript API is the trusted application boundary.
- Supabase Auth provides email/password, OAuth, PKCE and TOTP MFA flows.
- Supabase Postgres is already the canonical application database.
- Supabase Storage contains a private `vantory-assets` bucket. Object paths begin
  with the workspace UUID and storage policies check workspace membership/role.
- Stripe Checkout, Billing Portal and signed webhooks are handled by the server.
- Gemini calls are handled by the server; the provider key is not a browser value.

## Supabase connection state

The working copy intentionally contains only `.env.example` placeholders. Production
credentials are not stored here. The connected Jobryn.AI Supabase project was
reviewed separately on 2026-09-04; its hiring and communications migrations were
applied after a schema/RLS verification.

Browser configuration is limited to `VITE_SUPABASE_URL` and the Supabase
publishable/anon key. The service-role key, Stripe secrets and AI key are read only
by the server. Production startup validates required secret formats, HTTPS origins
and the absence of wildcard CORS.

## Tenant and revenue boundaries already present

- Tenant-owned tables carry `workspace_id` and enable RLS.
- Membership helper functions use `auth.uid()`.
- The API independently verifies the bearer token, active workspace membership and
  required role before protected operations.
- Migration `0004` adds same-workspace reference triggers to prevent cross-tenant
  foreign-key links and validates assigned users against active membership.
- Migration `0005` removes direct browser writes to provider-owned billing,
  entitlement, payment, audit and integration state.
- Stripe price IDs are mapped server-side. Webhook signatures are verified against
  the raw request body, events are claimed idempotently, and canonical subscription
  state is re-fetched from Stripe before database application.
- Usage metering is atomic and service-role-only in migration `0006`.

## Safe migration sequence

1. Rebrand user-facing and process-facing strings to Jobryn. Keep database and
   storage identifiers stable. This is the current reversible step.
2. Connect a non-production Supabase project and record its migration history.
3. Take a database backup and inventory row counts, RLS policies, grants, functions,
   triggers, storage buckets and Auth redirect URLs.
4. Apply migrations in filename order through `0018` to an empty staging project,
   or baseline an existing project before applying only missing migrations. Never
   replay them blindly against an unknown live schema.
5. Run two-user/two-workspace negative tests through both the browser client and API,
   including cross-workspace IDs in parent/child references and storage paths.
6. Run Stripe test-mode checkout, duplicate webhook, out-of-order webhook, portal,
   cancellation, past-due grace and entitlement tests.
7. Migrate the legacy storage bucket only if required: create a new private bucket,
   copy objects, compare object counts/checksums, enable equivalent policies, switch
   reads, then retain the old bucket during the rollback window.
8. Promote only after backups and the rollback verification pass.

## Rollback boundary

Migrations `0017` and `0018` add tenant-scoped tables, indexes and RLS policies;
they do not delete existing customer data. Rollback of a production schema change
requires a tested forward migration or database restore plan—never a blind drop.

## Required deployment evidence

- Staging Supabase URL and publishable key for the browser.
- Matching server-side URL, publishable key and service-role key in the hosting
  platform's secret store (never committed or sent to the browser).
- Supabase migration history or a schema dump from the connected project.
- Configured Auth site URL and allowed redirects for the Jobryn domain.
- Stripe test keys, webhook secret and trusted price IDs in server secrets.
- A successful `npm run verify` and the staging isolation/billing test results.
