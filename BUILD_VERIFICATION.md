# Jobryn Build Verification

Date: 24 August 2026 (Australia/Adelaide)

## Passed in the build workspace

- `node scripts/security-check.mjs`
  - required security modules/migrations present
  - server-side Stripe signature/idempotency hooks present
  - API Helmet/rate-limit/CORS hooks present
  - no detected embedded live Stripe secret
  - no detected embedded Supabase service-role token
- TypeScript syntax/parser scan across `src/` and `server/`
  - no TS1xxx parser diagnostics
  - no missing legacy named exports introduced by the SaaS migration
- External-import scan
  - every imported third-party package is declared in `package.json`
- Stale Bun lockfile from the original foundation was removed because the dependency set changed.

## Verification completed (2026-09-04)

The full verification suite now passes in this workspace:

```bash
npm ci
npm run typecheck   # 0 errors
npm run security:check
npm test            # 53/53 pass
npm run build       # client bundle + server.cjs
```

Additionally verified: `npm run cf:dry-run` (staging Worker bundle), a live
workerd boot test (`wrangler dev`: health, auth guard, SPA, scheduled skip)
and WebSocket receptionist smoke tests against both the Node dev server and
the workerd runtime.

The repository includes `package-lock.json`; use `npm ci` for repeatable local and CI installs.

## Provider tests still required

Real integration tests require credentials/projects owned by the deployer:

- Supabase email verification, Google OAuth, GitHub OAuth and MFA
- Stripe Checkout, Billing Portal and signed webhook replay/duplicate delivery
- RLS/cross-workspace isolation against a real Supabase database
- production HTTPS/CORS configuration
- any future Twilio, Google Calendar, email, social or accounting provider integrations

This archive is a source build with hardened implementation and deployment gates; it is not a substitute for staging/security testing with real provider accounts.
