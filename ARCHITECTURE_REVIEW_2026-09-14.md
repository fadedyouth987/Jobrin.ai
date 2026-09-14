# Jobrin.ai — Structure & Architecture Review

**Date:** 2026-09-14
**Scope:** Full-stack review (frontend, API, auth, services, DB, background jobs, integrations, AI, billing, notifications, observability). Read-only — no code changed as part of this review.
**Verdict up front:** The core architecture is sound and doesn't need a rewrite. Multi-tenancy is genuinely well-enforced at the database layer (RLS + trigger-based FK tenant-checks — more mature than most SaaS at this stage). The main risks are concentration risks, not foundational ones: a few giant files doing too much, one AI code path that writes data outside the normal permission chain, and no application-layer guard against a `workspace_id` typo on the service-role DB client. All are fixable incrementally.

---

## 1. Current Architecture

```
Browser (React SPA, hand-rolled router)
   │  fetch via src/lib/api.ts (Bearer token + x-workspace-id + x-request-id)
   ▼
Express app (server.ts) — ONE codebase, TWO entry points:
   • worker.ts     → Cloudflare Workers (production) + Durable Object for live calls
   • node-server.ts → local/Docker dev, Vite middleware, `ws` package for sockets
   │
   ▼
requestId → helmet/cors (security.ts) → rate limit (rateLimitStore.ts) → body parsers
   │
   ▼
Auth middleware chain (server/supabase.ts):
   requireAuth → requireWorkspace → requireRole → requireActiveSubscription → requireSensitiveAuth
   │
   ▼
14 domain route files (server/routes/*.ts) — each calls Supabase directly, no service/DAO layer
   │
   ├─→ Supabase Postgres (69 tables, RLS on all, tenant-scoping triggers, business-logic RPCs)
   ├─→ server/automation/runner.ts — Postgres-backed event queue + poller (automations)
   ├─→ server/ai/* — receptionist call engine (OpenAI), business-brain memory worker
   └─→ server/providers/* — Stripe, Twilio, Resend, OpenAI adapters
   │
   ▼
Notifications: writeNotification() (in-app) · Twilio (SMS) · Resend (email) — no unified dispatcher
Observability: request-id + structured JSON error logs, ai_actions/automation_attempts audit trail;
               no Sentry, no workspace_id in error logs, sparse general logging
```

**Important boundaries:**
- **Auth boundary**: Supabase Auth (JWT) verified once per request in `requireAuth`; everything downstream trusts `req.auth`.
- **Tenant boundary**: `x-workspace-id` header → `requireWorkspace` → RLS (`private.is_workspace_member`) is the *real* enforcement point for user-initiated requests.
- **Privilege boundary**: `createUserClient` (RLS-governed) vs `supabaseAdmin` (service-role, bypasses RLS) — the second is used for stopgap tables, storage, background jobs, and AI writes, all under manual (non-RLS-backed) discipline.
- **Runtime boundary**: Workers vs Node dev server — same route code, different WS transport and job-scheduling cadence (5-min cron vs 30s/15s intervals).
- **AI boundary**: the automation-builder path *does* respect a central risk-tiered tool registry; the live-call receptionist path does *not* — it hardcodes two tools and writes via the service-role client directly (see §9).

---

## 2. Architecture Problems

Ranked by actual risk, not by how interesting they are to fix.

1. **No application-level guard against unscoped tenant queries on the service-role client.** `supabaseAdmin.from(...)` appears ~97 times across 7 route files; every one of them is manually responsible for adding `.eq('workspace_id', ...)`. RLS doesn't apply to this client. One missed `.eq()` in a future PR is a real cross-tenant data leak, not a hypothetical. This is the single highest-leverage fix available. [§5, §8 below]

2. **AI receptionist writes bypass the normal service/permission layer.** `receptionistCall.ts` inserts into `customers`/`leads`/`ai_actions` directly via `supabaseAdmin`, not through route middleware (`requireAuth`/`requireRole`) or the declared `toolRegistry.ts` risk framework that the automation runner *does* honor. Scoped to 2 low-risk tools today (`take_message`, `request_handoff`), so blast radius is currently small — but the pattern, if extended without a guard, is how an AI action skips authorization review later.

3. **`operations.ts` (730 lines) and `AppPages.tsx` (670 lines) are doing 5-6 domains' worth of work each.** Jobs, scheduling, materials, checklists, signatures, quotes, and invoices are one route file server-side; dashboard, receptionist, campaigns, billing, team, and settings are one file client-side. Nothing is broken, but change risk and merge-conflict risk both concentrate here, and onboarding a new engineer means reading a 700-line file to find one function.

4. **Corrective-migration pattern shows RLS coverage was retrofitted, not designed up front.** Four migrations in sequence (`0013 → 0021 → 0023 → 0024`) each closed the same class of gap (missing member INSERT/UPDATE policy on a newly-added table), and one migration's own comment documents a real cross-tenant bug found in testing (`customer_assets`, "the row-level workspace policy alone does not validate the referenced row's tenant"). The team's *response* to each gap was fast and well-documented — the process gap is that new tables aren't getting a tenant-isolation checklist before they ship.

5. **No workspace_id in the generic error logger**, and logging overall is sparse (7 structured log call sites in the whole server). Most route failures return a typed error code to the client with no server-side log line. Fine today at low volume; will make production incident triage slow once there's real traffic across many tenants.

6. **Duplicated data-fetching hook and duplicated existence/scope-check queries.** `useData<T>()` is defined twice, nearly identically, in `AppPages.tsx` and `OperationalDetailPages.tsx`. The `jobs`-scoped-by-workspace existence check is copy-pasted ~8 times in `operations.ts`. Neither is a bug today; both are future-bug generators.

7. **In-memory rate limiting on Workers is per-isolate, not global.** `TimerFreeMemoryStore` is a sound workaround for workerd's lack of timers, but on Cloudflare's distributed edge it means the configured limits (e.g. 30 req/10min on auth) are actually N× weaker than they read, where N is the number of active isolates. Not exploitable today at low traffic, but the number in the config is misleading.

8. **Two parallel background-job schedules for the same work** (30s/15s local `setInterval` vs 5-minute Workers cron) — worth an explicit decision that this divergence is acceptable, since it changes automation latency by an order of magnitude between environments.

None of these require touching the framework, the database engine, or the hosting model. They're all "harden what's there," not "replace what's there."

---

## 3. Recommended Architecture

Keep: Express + Cloudflare Workers/Durable Objects, Supabase/Postgres with RLS as the tenant boundary, the existing route-per-domain layout, the existing risk-tiered `toolRegistry.ts` concept, Zod validation on every route body.

Add (structurally, not by rewriting):

- **A thin tenant-scoping helper** wrapping `supabaseAdmin` calls: `scopedAdmin(workspaceId).from(table)` that either injects `.eq('workspace_id', workspaceId)` automatically for known-tenant tables or throws if a call site tries to skip it. This converts "manual discipline" into "the compiler/linter can catch it," without touching the RLS model underneath.
- **A minimal service layer for the highest-risk, highest-duplication routes only** — start with `operations.ts` (jobs/quotes/invoices) since it's both the largest file and holds financial data. Extract `getJobOrNotFound`, `getWorkspaceInvoiceOrNotFound`, etc. into `server/services/jobs.ts`, `server/services/invoices.ts`. Don't do this everywhere — most route files (85-350 lines) are fine as-is.
- **Route the receptionist's write path through the same `toolRegistry.ts` risk classification the automation runner already uses**, even for just the 2 current tools. This closes the AI-permission gap while it's cheap (2 tools) rather than after it's grown to 10.
- **Split `operations.ts`** along the domain seams it already implicitly has: `jobs.ts` (scheduling, time, materials, checklists, signatures), `quotes.ts`, `invoices.ts`. Same for `AppPages.tsx` → per-domain page files, each importing shared components instead of inlining them.

---

## 4. Suggested Directory Structure

Incremental, not a rewrite — most of this already exists in embryonic form:

```
server/
  routes/           # thin: auth, validate, call service, respond
    jobs.ts  quotes.ts  invoices.ts   # split from operations.ts
    ...(existing files unchanged: billing, communications, crm, etc.)
  services/         # NEW — the layer that's currently missing
    jobs.ts  quotes.ts  invoices.ts  scheduling.ts
    tenantScope.ts  # the scopedAdmin() helper from §3
  ai/               # existing — wire receptionistCall.ts's writes through toolRegistry
  automation/        # existing, no change needed
  providers/         # existing, no change needed

src/
  pages/
    receptionist/    # already scaffolded empty — actually move ReceptionistPage here
    dashboard/  campaigns/  billing/  team/  settings/   # split from AppPages.tsx
  hooks/            # NEW — useApiData.ts (dedupe the two useData copies)
  components/
    saas/            # existing shared UI kit, unchanged
    domain/          # NEW — extract inlined domain components (lead kanban, invoice wizard, etc.)
```

This is refactor-in-place work, doable file-by-file without a big-bang migration.

---

## 5. Data Flow

**Authenticated request:** Browser → `apiFetch()` attaches Bearer token + `x-workspace-id` → Express middleware chain resolves `req.auth` (Supabase JWT verify) and `req.workspaceId` (membership check via RLS-governed query) → route handler queries Supabase with either the user-scoped client (RLS enforces tenant boundary) or `supabaseAdmin` (manual `.eq('workspace_id', ...)` required) → response.

**Public (unauthenticated) request** (booking/quote links): `PublicBookingPage.tsx`/`PublicQuotePage.tsx` call `/api/public/...` with raw `fetch`, no session — server validates via a signed token/slug rather than membership, writes atomically through `create_public_booking()` RPC (advisory-locked to prevent double-booking).

**AI voice call:** Twilio webhook → signature-validated → workspace resolved from phone number mapping → short-lived HMAC capability token minted → WebSocket upgrade validated against that token → `ReceptionistSession` runs the call, writes leads/messages via `supabaseAdmin` directly (see §9) → `ai_actions` audit row per turn.

**Automation:** business route fires `queueAutomationRun(workspaceId, eventType, payload)` (fire-and-forget) → row lands in `automation_runs` → poller/cron claims it atomically → step classified by `toolRegistry.ts` risk tier → `automatic` executes, `approval_required` pauses into `approvals` for a human, `prohibited` is denied.

---

## 6. Authentication Model

- Identity: Supabase Auth (JWT), OAuth providers configured for Google/Microsoft/Apple sign-in (login only — no calendar/mail data sync).
- Server verifies the token once per request (`requireAuth`, `supabase.auth.getUser(token)`), attaches `req.auth`.
- MFA: AAL2 enforced for sensitive actions (`requireSensitiveAuth`, e.g. billing checkout) via `env.requireAal2Sensitive`, fail-closed in staging/production per `wrangler.jsonc`.
- Frontend: `AuthContext`/`useAuth()` holds session, user, workspace list, current workspace. Route protection lives in `AppShell.tsx`'s three separate `useEffect`s (no session → `/login`; needs MFA → `/mfa`; no workspace → `/onboarding`; bad subscription state → `/app/billing`) rather than one central guard — works, but mixes routing-guard and billing-domain logic in a layout component (see §2 item 3, frontend half).
- AI voice channel authenticates via a purpose-built short-lived signed capability token, not a user session — correct, since there's no logged-in user on a phone call.

---

## 7. Authorization Model

- Role-based: `requireRole(...)` reads `req.workspaceRole` (owner/admin/staff, resolved from `workspace_members`).
- Feature/plan-based: `requireActiveSubscription(featureKey)` checks `subscription_entitlements`, sourced from `shared/plans.ts`'s per-tier entitlement map — one definition, consistently applied.
- Usage-metered: `consumeWorkspaceUsage(...)` debits counters (e.g. `usage.ai_actions`, `usage.sms`) via an atomic RPC; used consistently by both routes and the AI/automation paths, with one documented exception (automation dispatch re-checks entitlement inline since it runs outside Express middleware).
- AI tool authorization: `toolRegistry.ts` declares risk tiers per tool, enforced by the automation runner — but not yet by the live receptionist call path (§9).
- Gap: authorization for `supabaseAdmin` calls is "whatever the route handler remembered to write," not a declared policy — this is the item worth fixing first (§2 item 1).

---

## 8. Tenant Isolation Model

```
auth.users → profiles (1:1) → workspace_members (role, status) → workspaces → all business tables (workspace_id)
```

This is genuinely well-built:
- **RLS enabled on all 69 tables**, no `using (true)` policies found.
- **Structural FK tenant-guard**: trigger functions `private.assert_same_workspace_reference()` / `private.assert_workspace_member_reference()`, applied via metaprogrammed migration loops to ~30 FK relationships — rejects inserts/updates where a child row's `workspace_id` doesn't match its parent's, catching "known-UUID cross-tenant attach" attacks that RLS SELECT/INSERT policies alone can miss. This is above-average maturity for this stage of a SaaS.
- **Weak point**: none of the above applies to the `supabaseAdmin` (service-role) client. Recommend the `scopedAdmin()` wrapper from §3 as the concrete fix — it's a small, self-contained change that closes the one real structural gap without touching RLS or the trigger system.
- Two smaller DB-side findings from the live advisor: 4 tables have RLS enabled but zero policies (`credit_transactions`, `credit_wallets`, `stripe_webhook_events`, `usage_counters` — fail-closed, but `usage_counters` likely needs a client-read policy if the UI is meant to show usage), and 2 `SECURITY DEFINER` RPCs (`create_workspace`, `get_workspace_access_state`) are directly callable by any authenticated user — probably intentional for self-serve signup, but worth an explicit sign-off given the privilege-escalation shape.

---

## 9. AI Architecture

```
OpenAI (raw fetch, no SDK)
   ↓
ReceptionistSession (receptionistCall.ts) — 5 "hats" (receptionist/finance/sales/marketing/support),
   shared safety/escalation prompt block
   ↓
Tool permissions:
   • Automation path → toolRegistry.ts (risk-tiered, zod-validated) → enforced by automation/runner.ts ✓
   • Live-call path  → 2 hardcoded OpenAI function tools (take_message, request_handoff) → NOT routed
                        through toolRegistry.ts ✗
   ↓
Business rules / validated result:
   • Automation path: risk-classified, approval-gated where required ✓
   • Live-call path: writes directly via supabaseAdmin from within recordMessageTake — no route
     middleware, no RLS, relies on hand-audited code only
   ↓
Application action (customers/leads/ai_actions insert; notification; usage counter debit)
```

**The principle "AI must never bypass normal application permissions" is honored for automations, not yet for the live receptionist.** Current risk is low (2 tools, both low-risk: taking a message and requesting human handoff), but this is exactly the pattern to correct *before* the documented Phase 2/3 tools (`appointment.book`, `outbound_call.start`, `payment`-adjacent actions per `AI_RECEPTIONIST_ARCHITECTURE.md`) are wired in. Recommend routing the receptionist's tool execution through the same `toolRegistry.ts` classification, even trivially, before adding the next tool.

Audit trail is good: every model turn and tool execution writes to `ai_actions` (risk_level, status, approval_required, model, prompt_version) — this exists and works, it's just not yet gating the live-call path the way it gates automations.

---

## 10. Automation Architecture

Genuinely event-driven, not polling-only:

- **Trigger**: business routes fire `queueAutomationRun(workspaceId, eventType, payload)` on real events (`lead.created`, `job.completed`, `invoice.overdue`, `appointment.completed`) — fire-and-forget, non-blocking.
- **Condition evaluation**: deliberately narrow `{field, operator, value}` shape; anything more complex is logged and skipped rather than guessed at (documented as an intentional scope limit, not an oversight).
- **Execution**: atomic claim (`UPDATE ... WHERE status IN ('queued','failed') RETURNING`) prevents double-processing; exponential backoff (30·2^attempt, capped at 1hr); dead-letters to `cancelled` after max attempts.
- **Risk gating**: reuses `toolRegistry.ts` — `automatic` executes immediately, `approval_required`/ambiguous steps pause into `approvals` for a human, `prohibited` is denied outright.
- This closed a gap the team's own 2026-09-04 audit flagged ("automation execution engine missing") — now resolved and reasonably sophisticated for its scope.

Events worth formalizing into a documented, versioned list as the system grows: `lead.created`, `message.received`, `quote.created/accepted`, `job.booked/completed`, `invoice.created/paid`, `review.requested`, `customer.inactive`. Most of these already exist as `AutomationEventType` values or are one small addition away — no new architecture needed, just documentation and a couple of new event emit sites.

---

## 11. Integration Architecture

Four adapters in `server/providers/` (Stripe, Twilio, Resend, OpenAI), all following one consistent pattern: a `<provider>Configured()` predicate that regex-validates the credential *shape* before trusting it (fails closed on a placeholder/missing key rather than crashing at call time), thin wrappers around the vendor SDK/REST API, no vendor-specific branching leaking into route handlers. This is the right shape — keep it.

One inconsistency: OpenAI's actual request/response handling lives in `server/ai/receptionistCall.ts` (raw `fetch`) rather than in `providers/openai.ts` (which is just a config check) — every other provider keeps its call logic inside `providers/`. Minor, easy to align.

**No Google, Microsoft, or Meta data-sync integrations exist** (Calendar sync, Gmail, Teams, Meta messaging/ads) — only OAuth *login* via those providers. This is documented as intentionally deferred (`FOUNDATION_STATUS.md`: "deliberately not faked"), not a gap in the pattern — when these are built, they should follow the same adapter shape.

---

## 12. Logging and Monitoring

**Exists:** request-ID propagation and structured JSON error logs (`security.ts`); a genuine AI/automation audit trail (`ai_actions`, `automation_attempts`, `stripe_webhook_events`) that's better than most SaaS have this early; deliberate PII avoidance in logs (email provider responses and full Stripe payloads are not logged, by design and by comment).

**Missing:**
- `workspace_id` in the generic error logger — add this first, it's a one-line change with outsized triage value.
- General-purpose structured logging is sparse (7 call sites total) — most failures are silent server-side, visible only as a typed error code to the client.
- No error-monitoring SaaS (Sentry or equivalent) anywhere in the repo.
- No structured per-call log for the AI receptionist despite `AI_RECEPTIONIST_ARCHITECTURE.md` documenting call ID/workspace ID/event-type logging as a requirement — instrumentation hasn't caught up to the doc yet.
- Rate-limit counters are per-isolate on Workers (§2 item 7) — not a logging gap, but affects what your metrics will actually mean once you have DO/KV-backed shared counters to compare against.

---

## 13. Testing Architecture

Not covered in depth by this pass (tests/ directory exists but wasn't part of the four survey agents' scope) — flagging as a follow-up item rather than guessing. Recommend a dedicated pass once the DO NOW items below land, specifically: does the automation runner's risk-classification and idempotent-claim logic have tests, and do the tenant-isolation triggers have a regression test per the `customer_assets` bug documented in migration `0024`.

---

## 14. Migration Plan

### DO NOW
- Add `workspace_id` to the generic error logger (`security.ts` `errorHandler`) — trivial, immediate triage value.
- Confirm `authRateLimit` middleware is actually wired onto auth-sensitive routes (the backend survey couldn't confirm it's applied anywhere despite being defined).
- Add explicit read policy (or confirm intentional lock-down) for `usage_counters` — currently RLS-enabled with zero policies, likely blocking the UI from showing a workspace its own usage.

### DO BEFORE PRODUCTION (real traffic / real tenants)
- Build the `scopedAdmin()` tenant-scoping wrapper (§3, §8) and migrate the highest-risk `supabaseAdmin` call sites (communications.ts has the most, 52) onto it.
- Route the receptionist's `take_message`/`request_handoff` writes through `toolRegistry.ts` classification before adding any further AI tools (§9).
- Add the 11 missing FK indexes flagged by the live performance advisor, concentrated in the `checklist_templates`/`job_checklists`/`job_signatures` cluster.
- Add a workspace-scoped read policy for `usage_counters` if not already resolved in DO NOW.
- Decide and document whether the 30s/15s local poller cadence vs 5-minute Workers cron divergence is intentional; if not, align them.
- Add a Sentry (or equivalent) integration — at minimum for the Express error handler and the automation runner's failure path.

### DO AFTER LAUNCH
- Split `operations.ts` into `jobs.ts` / `quotes.ts` / `invoices.ts`; extract the repeated existence/scope-check queries into `server/services/`.
- Split `AppPages.tsx` into per-domain page files; extract inlined domain components (lead kanban, invoice wizard, receptionist console) into `src/components/domain/`.
- Deduplicate `useData<T>()` into `src/hooks/useApiData.ts`.
- Consolidate the 24 tables with multiple permissive SELECT RLS policies where they can be merged without changing behavior (performance, not correctness).
- Move `vector`/`btree_gist` extensions out of the `public` schema per the advisor's recommendation.
- Write the tenant-isolation regression test suggested in §13, anchored on the `customer_assets` bug.

### OPTIONAL FUTURE IMPROVEMENTS
- Consider a shared-counter (DO/KV-backed) rate limiter if Workers traffic grows enough that per-isolate limits become meaningfully weaker than configured.
- Consider a formal event-catalogue doc (versioned list of `domain.event` names) once more automation triggers are added — not needed yet at current scale.
- Build Google Calendar / Microsoft / Meta data-sync adapters using the same `providers/` pattern, when those features are actually prioritized (no architectural prep needed now — the pattern already generalizes).
- Revisit the 40 "unused indexes" flagged by the live advisor after real production traffic accumulates — the signal is meaningless on today's near-empty tables.

---

*This review builds on and does not duplicate the team's own recent audits (END_TO_END_AUDIT_2026-08-28/09-04, UI_UX_AUDIT_2026-09-11, COMPETITIVE_FEATURE_AUDIT, FOUNDATION_STATUS) — those catalogue product/UI/feature gaps; this one focuses on structural, security, and maintainability risk in the code and schema. Two findings here are new relative to prior audits: the AI tool-registry/receptionist-call divergence (§9) and the missing `supabaseAdmin` tenant-scoping guard (§2 item 1, §8).*
