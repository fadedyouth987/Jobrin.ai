# Jobryn Foundation Status — v0.1

## Completed in this foundation pass

- Canonical product/package renamed to Jobryn.
- Firebase client and Firestore service removed from the active codebase.
- Supabase browser auth client added for email/password, Google OAuth, reset and sign-out.
- Supabase server helpers added for bearer-token authentication and workspace membership enforcement.
- PostgreSQL migration added for profiles, workspaces, memberships/RBAC, campaigns, campaign assets, credit wallets, immutable credit transactions, subscriptions, Stripe webhook events, audit logs and private asset storage.
- Row Level Security added to tenant-facing tables using workspace membership and role checks.
- Atomic `reserve_credits` database function added with idempotency support.
- Stripe subscription checkout, customer portal and signed webhook skeleton added to the Express API.
- API hardening started with Helmet, CORS, request-size limits, rate limiting and removal of `x-powered-by`.
- Paid AI routes now require authentication + workspace membership and return `503 AI_NOT_CONFIGURED` instead of fake success when Gemini is absent.
- Campaign OS browser `localStorage` persistence replaced with authenticated Supabase `workspace_module_state` persistence.
- Fake successful webhook delivery and fake GDPR export URLs removed; those routes now return explicit `501` until their secure implementations exist.
- Health route no longer claims production certification.

## Not yet complete / release blockers

1. UI still boots from demo `initialData.ts`; real workspace onboarding/hydration must replace it.
2. Plan and credit purchase modals still mutate React state; they must call the real Stripe endpoints.
3. Subscription webhook mapping needs end-to-end Stripe CLI testing and plan entitlement allocation.
4. Campaign assets outside Campaign OS still use in-memory React state and need Supabase repositories.
5. Campaign OS module state is securely persisted but still transitional JSON; CRM, agents, pages, email flows and client portals need normalized tables.
6. Social OAuth/publishing is not implemented.
7. Secure outbound webhook worker is not implemented.
8. Background job queue/worker and retries are not implemented.
9. GDPR export, deletion and retention jobs are not implemented.
10. Email provider integration is not implemented.
11. Automated RLS isolation, billing, webhook and API tests are not yet present.
12. Dependencies could not be installed in the current execution environment because the npm registry repeatedly timed out, so a full TypeScript build could not be completed here.

## Release rule

No feature is marked production-ready until its persistence, authorization, billing/entitlement behaviour, error handling, external integration and automated tests all pass.
