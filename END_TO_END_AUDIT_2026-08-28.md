# Jobryn end-to-end audit — 28 August 2026

## Verified working

- Supabase email authentication, password recovery, PKCE callbacks and MFA code paths are implemented.
- Browser and server use the same Supabase project and Windows development trusts the system certificate store.
- Expired API sessions refresh once and fail closed if renewal fails.
- Authenticated users are redirected away from login/signup to their workspace or onboarding.
- Workspace membership and application data use the caller JWT plus PostgreSQL RLS.
- Owner, admin, manager, staff and viewer boundaries are enforced by API middleware and database policies.
- Existing workspaces missing billing state are repaired without overwriting paid subscriptions.
- All members receive only minimal subscription access state; Stripe identifiers remain owner/admin data.
- Customer, lead, appointment, job, quote, invoice, payment, knowledge, approval and analytics routes use tenant-scoped queries.
- Invoice payment settlement is signed-webhook driven, idempotent, row locked and service-role-only.
- Stripe checkout uses hosted payment pages and does not store card data.
- Twilio callbacks require SDK signature validation and a receiving number maps to exactly one workspace.
- The private storage bucket is tenant-scoped, limited to 25 MB and restricted to approved MIME types.
- Security headers, request IDs, rate limits, no-store API responses and strict request validation are active.
- The retained Campaign OS is lazy-loaded and no longer inflates every normal application page.

## Intentionally unavailable until configured and tested

- Stripe checkout/webhooks: server key, webhook secret and Price IDs are absent locally.
- Trusted audit writes and provider-side database operations: Supabase service-role key is absent locally.
- Twilio SMS/Voice: Twilio credentials and a purchased number are absent locally; Voice receptionist is not implemented.
- AI generation: Gemini server key is absent locally.
- Transactional email, calendar, accounting, review delivery and social publishing providers are not connected.
- Durable background worker, retries and dead-letter processing are schema-only and not running.
- Hostinger continuous deployment, production domain, monitoring, backup restore and rollback drills are not verified.

These items must remain visibly disabled. They are not production-complete merely because database tables or UI placeholders exist.

## Supabase advisor review

- RLS is enabled on all public application tables.
- `stripe_webhook_events` and `usage_counters` intentionally have no user policies; service-only functions access them.
- `create_workspace`, `reserve_credits` and `get_workspace_access_state` are intentionally authenticated security-definer functions. Each validates `auth.uid()` membership and exposes a constrained operation.
- Stripe mutation functions are executable only by `service_role`.
- Leaked-password protection is disabled in the Supabase project and should be enabled in Auth settings before production.
- `vector` and `btree_gist` remain in the public schema for compatibility; moving live extensions requires a staged database maintenance plan.
- Performance advisors report unindexed foreign keys, overlapping intentional read/write policies and currently unused indexes. These are not correctness failures; index changes should follow measured production query plans.

## Verification commands

- `npm test`
- `npm run typecheck`
- `npm run security:check`
- `npm audit --omit=dev --audit-level=high`
- `npm run build`

The live Supabase migration history was verified through `member_subscription_access`, and cross-tenant access to its subscription function was explicitly denied during testing.
