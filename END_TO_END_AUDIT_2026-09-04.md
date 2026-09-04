# Jobryn end-to-end audit — 4 September 2026

Scope: full codebase and architecture review of `app/` — every server route, all pages, all 19
migrations, security layer, CI, Docker, Cloudflare worker, environment handling, plus local
execution of the project's own verification gates. This report supersedes
`END_TO_END_AUDIT_2026-08-28.md` as the current state of the build.

## Verification performed (all passing locally, 4 Sep 2026)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm test` | 38/38 pass |
| `npm run security:check` | pass (77 source files scanned) |
| `npm run build` | clean (Vite client bundle + `dist/server.cjs`) |
| `npm audit --omit=dev --audit-level=high` | could not complete locally (registry latency); enforced on every push by CI |

The test suite includes the safety contracts that matter most: AI receptionist stays
fail-closed, hiring never auto-selects, Stripe webhook signatures verify against the raw
body before claiming events, outbound SMS requires consent and suppression checks, tenant
membership uses the authenticated user client plus RLS, and safe autopilot never executes
prohibited or approval-required tools.

## Architecture as verified

- React 19 + Vite SPA with lazy-loaded authenticated shell; public first paint stays lean.
- Express 5 API as the trusted application boundary; 14 routers all mounted in `server.ts`.
- Supabase Postgres (RLS everywhere), Auth (email/password, PKCE OAuth, TOTP MFA), Storage.
- Stripe Billing: hosted checkout, portal, signed webhooks, idempotent event claiming,
  canonical subscription re-fetch, service-role-only invoice payment settlement.
- Twilio: signature-validated inbound webhooks, per-number tenant routing, consent-first
  SMS with STOP/START handling, suppression list, approval-gated campaign batches.
- Business Brain: `outbox_events` queue processed by an atomic-claim worker with exponential
  backoff and dead-lettering; runs locally every 15 s and on the Cloudflare 5-minute cron.
- Deployment paths: Cloudflare Worker (`worker.ts` via `cloudflare:node`, staging + prod
  envs in `wrangler.jsonc`) and Node (`node-server.ts`, Dockerfile on node:22-alpine, non-root).
- CI (`GitHub Actions`, Node 22): typecheck, security scan, tests, npm audit, build.

## Wiring verified

- All 47 tables referenced by server routes exist in migrations `0001`–`0019`. No orphan
  endpoints, no dead frontend calls, no mock-data pages. Every navigation route renders a
  real, working page; `ModulePage` remains only as the 404 fallback.
- Tenant isolation is four layers deep: JWT verification → RLS-based membership check →
  role middleware → subscription/entitlement gates, plus cross-tenant reference triggers
  in the database and tenant-scoped storage policies.
- Production boot fails closed: HTTPS origins, key formats, wildcard-CORS rejection.
- Financial document totals (subtotal/GST) are calculated server-side, not trusted from
  the browser. Job status transitions are guarded (an invoice must exist before "invoiced",
  balances must be settled before "paid").
- Campaign send requires owner/admin role plus AAL2 (`REQUIRE_AAL2_SENSITIVE` is true in
  the production worker vars) and per-batch send is capped (max 100, default 25).
- The AI receptionist is correctly hard-locked: `PUT /api/receptionist` rejects
  `enabled:true` with 409, readiness hardcodes `conversationRelay: false`, no WebSocket
  server exists in `node-server.ts` or `worker.ts`, and a test asserts the lock.

## Deliberately unavailable until configured (correctly not faked)

- Stripe checkout/webhooks, Twilio SMS/Voice, Gemini/OpenAI AI generation: provider keys
  absent locally. Local `.env` contains only publishable Supabase values.
- Email delivery, calendar sync, accounting sync, review delivery, social publishing.
- Durable background execution for automations (schema + queue rows exist; executor does not).
- Live voice answering (signed ConversationRelay WebSocket not implemented).

## Gaps found (ordered by importance)

1. **Version control is empty.** `main` has zero commits; everything is staged but never
   committed, and git is blocked by a dubious-ownership mismatch (sandbox user vs Kay).
   For the primary income source this is the top operational risk. Actions: fix
   `safe.directory`, make the initial commit, add a private remote, push.
2. **Quotes cannot leave draft.** No send/accept flow, no customer-facing approval link,
   no quote→invoice conversion button (the API already accepts `quote_id` on invoices).
   Related: no "mark invoice sent" and no email delivery, so a created document cannot
   reach the customer except by manually copying an invoice payment link.
3. **No team invite flow.** Team page is read-only; there is no endpoint or UI to add
   members to an existing workspace. Core feature for a multi-tenant SaaS.
4. **Automation execution engine missing.** Manual runs insert `automation_runs` rows but
   nothing processes that queue. Schema, triggers, policies and UI are ready; only the
   executor is absent (the Cloudflare cron already runs every 5 minutes).
5. **Lead pipeline is display-only.** `PATCH /api/crm/leads/:id/stage` exists but the
   kanban has no drag-and-drop or stage buttons.
6. **Command Centre is deterministic, not AI.** Four hardcoded question patterns with
   read-only queries and approval-gated proposals. The Operator tool registry, ai_actions
   logging and approvals tables are unused by it. Natural v2: an LLM planner behind the
   existing approval gates and tool risk levels.
7. **Housekeeping.** `recharts` and `three` appear unused in `src` (removal should shrink
   the 425 KB index chunk — verify before deleting). Supabase leaked-password protection
   still requires manual enablement in the dashboard. `npm audit` should be run locally
   at least once.

## Recommended sequence

**P0 — before any paying customer**
1. Initial git commit + private remote backup.
2. Enable leaked-password protection in the Supabase dashboard.
3. Staging Supabase project + Stripe test keys; run the documented billing test list.
4. Quote send/accept flow and quote→invoice conversion.
5. Team member invites.

**P1 — high revenue value**
- Email delivery (transactional provider) for quote/invoice links and notifications.
- PDF generation for quotes/invoices.
- Lead drag-and-drop staging.
- Automation executor on the existing cron.
- Google Calendar two-way sync (`sync_status` column already exists).
- Customer edit/archive UI (soft delete already exists in schema).

**P2 — plugins and differentiators (schema already waiting)**
- Customer portal (`customer_portal_sessions` table exists).
- Public booking page (`service_areas`, `business_hours` exist).
- Technician time and materials (`technician_profiles`, `job_time_entries`, `job_materials` exist).
- Stripe Connect for trade businesses collecting their own customer payments.
- Xero/MYOB/QuickBooks invoice export.
- AI quote assistant powered by Business Brain memories and approved services.
- Signed ConversationRelay WebSocket + human handoff to unlock the receptionist.

## Standing rules unchanged

- No production deployment has occurred or is authorised. Staging must use a separate
  Supabase project and separate provider credentials.
- The AI receptionist stays disabled until the signed real-time conversation layer and a
  safe human handoff are implemented and tested.
- AI remains advisory; consequential actions stay approval-gated.

## Addendum — 4 Sep 2026: gap closures implemented (code-complete)

The following were built and verified the same day (typecheck 0 errors, 49/49 tests,
security scan 82 files, build clean):

- **Quote send/accept/convert**: `PATCH /api/operations/quotes/:id/send` issues a
  SHA-256-hashed public link (raw token only in the URL), marks the quote sent and emails
  the customer when transactional email is configured. `POST /api/operations/quotes/:id/link`
  re-issues a link (invalidating the old one). `PATCH /api/operations/quotes/:id/void`
  (owner/admin/manager) kills the link. Customers accept or decline at
  `/quote/:token` via `server/routes/public.ts` (unauthenticated, rate-limited,
  hash-addressed, audited with a null actor, idempotent decisions).
  `POST /api/operations/quotes/:id/convert` creates an invoice from an accepted quote and
  blocks duplicates.
- **Invoice send**: `PATCH /api/operations/invoices/:id/send` marks an invoice sent and,
  when email is configured, emails the customer — including a Stripe-hosted payment link
  when Stripe is configured (idempotent per invoice balance).
- **Transactional email**: `server/providers/email.ts` (Resend REST, no SDK), fail-closed
  via `EMAIL_API_KEY`/`EMAIL_FROM`; absent config never pretends to send.
- **Team invites**: `POST /api/team/invites` (owner/admin, AAL2 when enforced,
  service-role required) invites via Supabase Admin API, inserts the membership,
  and only the owner can create another admin.
- **Automation executor**: `server/automation/runner.ts` claims `automation_runs`
  atomically, retries with exponential backoff, dead-letters exhausted runs, records
  `automation_attempts`, executes safe tools (customer lookup, quote draft from approved
  services, review-request staging, business report) and routes policy-controlled and
  approval-required tools into `ai_actions` + `approvals` (run status `waiting`).
  Prohibited or unknown tools are never executed. Wired to the Cloudflare cron and a
  local 30 s interval alongside the Business Brain worker.
- **Lead stage controls**: advance/lost buttons on the pipeline cards.
- **Migration `0020_public_document_links.sql`**: partial indexes for `public_token_hash`
  lookups (needs applying to the connected project).

Still requiring operator credentials/accounts (cannot be finished in code):
Stripe keys and Price IDs, Twilio account and number, Gemini/OpenAI keys, Supabase
service-role key (now also gates invites), Supabase leaked-password protection toggle,
and production deployment verification (domain, CD, monitoring, backup/rollback drills).
The voice receptionist remains deliberately locked pending the signed ConversationRelay
layer plus a tested human handoff.