# Codex Debugging and Engineering Guide

Use this guide when investigating, reviewing or fixing Jobrin.ai. It is a practical
operating guide for this repository, not a claim that every provider is configured
in every environment.

## Purpose

Act as a senior engineer, security reviewer and SaaS reliability engineer. Trace
real execution paths and prove what works. A successful build is useful evidence,
but never enough on its own.

Fix confirmed defects in small, well-tested batches. Preserve existing user work,
never expose a secret, and never make live provider calls, payments, messages or
production data changes without the owner's explicit approval.

## Project Snapshot

| Area | Current technology |
| --- | --- |
| Client | React 19, Vite, TypeScript, Tailwind |
| API | Express 5 running from `node-server.ts` |
| Database and authentication | Supabase Postgres, Auth, Storage and RLS |
| Payments | Stripe Billing and payment links |
| Business communications | Twilio SMS and voice webhooks |
| AI | OpenAI, with approval-gated business actions |
| Hosting | Cloudflare Worker or Node/Docker |
| Tests | Node test runner with TypeScript via `tsx` |

## Protect the Project First

Before changing code, establish the repository name, current branch, working tree
status, package scripts and any existing modifications in files you intend to edit.

Never:

- mix this repository with another project;
- overwrite unrelated work, reset branches destructively or force-push;
- commit `.env` files or print provider keys, tokens or customer data;
- point staging at production data or live payment and communications providers;
- make external calls that contact real people, charge money or publish content
  without explicit approval.

## Standard Verification Order

Run the narrowest relevant checks first. For a broad change or audit, use this
order and record the result of each check:

```text
npm run typecheck
npm run security:check
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Start the local app with `npm run dev` and exercise the affected flow in a browser.
Also test failure states, not just the happy path. Run `npm run setup:check` when
investigating provider configuration, and use the staging build/dry-run commands
only with a separate staging environment.

## Environment Checklist

Do not show actual values. For every environment variable used by code, record:

| Variable | Required for | Present | Validated | Safe failure behaviour |
| --- | --- | --- | --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | browser authentication | | | |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | server Supabase client | | | |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only administrative operations | | | |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | billing and webhook verification | | | |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | SMS and voice | | | |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | AI-assisted features | | | |
| `EMAIL_API_KEY` / `EMAIL_FROM` | email delivery | | | |

Check naming consistency between `.env.example`, `server/env.ts`, deployment
configuration and documentation. Browser-exposed `VITE_*` values must only contain
public configuration. Service-role, payment, AI and Twilio credentials must remain
server-side and deployment-secret-only.

## Audit Areas

### Startup and dependencies

Check installation, typecheck, build, server startup, route mounting, imports,
missing modules and stale code paths. Trace a request from the browser to its API
route, its service/provider layer, database query and returned UI state.

### Authentication and tenancy

Jobrin is multi-tenant. Treat isolation as a launch-critical requirement.

Verify that authentication is required where expected; role checks occur in the
server as well as the UI; a member cannot read or change another workspace's data;
and direct URL/API ID changes cannot expose customers, jobs, documents, storage or
provider configurations from another workspace.

For Supabase work, inspect both server-side tenant checks and the applicable RLS
policies and migration constraints. Service-role credentials may perform privileged
operations, but must not bypass Jobrin's ownership and permission rules.

### Database

Review migrations, foreign keys, tenant IDs, required fields, unique constraints,
indexes, status transitions, audit timestamps and deletion behaviour. Look for UI
assumptions that the database does not enforce and records that could become
orphaned or cross-tenant.

### APIs and integrations

For each important route, test good input, malformed input, missing authentication,
wrong role, wrong workspace, missing records and duplicate requests. Verify useful
HTTP errors, schema validation, pagination where lists can grow, idempotency for
webhooks/financial actions and provider signature checks.

Treat all Stripe and Twilio webhooks as untrusted until their signature has been
verified against the raw request body. Respect message consent, suppression and
approval controls. Never test a live Stripe charge, message or phone call without
written approval; use test mode or mocks.

### AI and automation

Inspect model prompts, tool permissions, input/output validation, retry and timeout
behaviour, rate limits, tenant context, logging and human approval gates. AI may
draft and recommend, but it must not perform irreversible or customer-facing actions
without the application controls that authorise them.

For queues, cron and automations, verify atomic claims, retries, duplicate handling,
failed-run visibility, time zones, permissions and safe re-runs. A row being placed
in a queue does not prove an executor exists.

### Frontend and UX

Check every affected page as a customer would: reachable navigation, working primary
actions, loading/empty/error states, stale-data handling, forms, destructive-action
confirmation, keyboard access, labels, focus, contrast and mobile layout. Do not
represent an unconfigured provider, planned feature or disabled AI capability as
working.

For customer lifecycle changes, follow the full loop:

```text
Enquiry -> customer -> quote -> accepted work -> scheduled job -> invoice -> payment -> follow-up
```

At each stage, identify the created data, UI, API route, database state, notification,
automation trigger, permission and failure path.

## Evidence-Based Findings

Report confirmed issues in this format. Do not inflate severity or present a
possibility as a proven fault.

```md
### [HIGH] Short finding name

**Location:** `path/to/file.ts:line` and relevant route/function

**Problem:** What is incorrect.

**How it fails:** The reproducible execution path.

**Impact:** What a customer, workspace or operator experiences.

**Proof:** Test result, request/response, code path or browser behaviour.

**Fix:** A scoped correction.

**Regression test:** The automated or repeatable test that prevents recurrence.
```

Use these severity levels:

- `CRITICAL`: data loss, tenant escape, credential exposure or a severe active risk.
- `HIGH`: a major core workflow, security control or money-related flow fails.
- `MEDIUM`: meaningful degraded behaviour with a reasonable workaround.
- `LOW`: minor defect, maintainability issue or edge-case UX problem.
- `INFORMATIONAL`: evidence, context or a non-actionable observation.

## Fixing Rules

1. Reproduce and understand the defect before changing it.
2. Fix critical issues first, then high-impact user workflows.
3. Keep each patch within the affected domain; do not use an audit as cover for a
   broad rewrite.
4. Add or extend a regression test whenever the issue has a testable contract.
5. Re-run the relevant checks after each logical batch and repeat the browser flow.
6. State clearly what remains unconfigured, untested or dependent on provider access.

## Production-Readiness Report

Conclude a full audit with:

- Executive summary of the application's demonstrated state.
- Launch blockers, security risks, broken flows and configured-but-unavailable
  integrations.
- Changes made and tests run, including any failures or skipped areas.
- Remaining work grouped into: do now, before production, after launch and optional.
- Evidence-based 0-100 scores for frontend, backend, database, authentication,
  security, payments, integrations, AI, automations, testing, UX and overall
  production readiness.

Never give 100/100 without extensive, current evidence from code, tests and a
staging deployment that matches production configuration.

## Reference Material

Use the most recent dated audit as historical context, then verify the current code
and configuration yourself. Existing reports include `END_TO_END_AUDIT_2026-09-04.md`
and `UI_UX_AUDIT_2026-09-11.md`; they are not substitutes for current testing.
