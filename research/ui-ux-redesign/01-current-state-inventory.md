# Jobrin.ai Current State Inventory

## Product baseline

Jobrin.ai is an existing React 19, TypeScript and Tailwind CSS 4 application backed by Express routes and Supabase. It uses custom components in `src/components/saas/ui.tsx`, Lucide icons, Recharts and Motion. It does not use shadcn/ui, Radix, MUI or another packaged design system.

The current source passes 64 tests, TypeScript checking, the source security check and the production build. The signed-in browser shell rendered on 12 September 2026, but both Command Centre and Inbox ended in a full-width `Failed to fetch` state. This means the application bundle and authenticated shell work while the local data connection was unavailable in that browser session.

The earlier audit findings A01–A09 have changed since 11 September. Current source repairs the job-detail relationship/result mapping, separates public-booking preview validation, uses an atomic public-booking RPC, queues automation runs through a trusted path, handles null exhaustion state, maps business-event inputs, implements `availability.check`, and resumes approval-gated runs. Migration deployment and real provider journeys remain separate release checks.

### Status key

| Status | Meaning |
|---|---|
| Working | UI and a real route/data path exist; still subject to live provider and populated-workspace testing. |
| Partial | Useful UI and backend exist, but a material part of the normal journey is absent or unverified. |
| UI only | Screen exists without the required backend workflow. |
| Backend only | Route/table exists without usable product UI. |
| Placeholder | Explicit coming-soon destination. |
| Public | Does not require a workspace session. |

## Current navigation and layout

The authenticated desktop shell uses a fixed 288 px left sidebar, a 64 px utility bar, a centred content region and grouped disclosure navigation. It exposes workspace switching, plan and role, global page search (`Ctrl/Cmd+K`), theme control, notifications, security and account identity. Mobile replaces the sidebar with a drawer and adds a four-item bottom bar for Command Centre, Inbox, Schedule and Jobs.

The visual system is coherent but basic: indigo primary actions, slate surfaces, 16 px cards, 12 px controls, a Segoe UI system font stack, light/dark variables and 44 px minimum controls. The inspected dark-mode Inbox had readable hierarchy and no overlap, but its very tall sidebar and a large error card left most of the viewport empty. Navigation contains 17 placeholders mixed with working areas, which increases scanning load.

The shared components cover cards, buttons, fields, selects, textareas, status pills, money, page intros, stat cards, setup checklists, empty states and feature status. Missing shared primitives include an accessible modal/sheet abstraction, data-grid toolbar, pagination, tabs, segmented controls, date/time picker, combobox, toast queue, form error summary, activity timeline and skeleton variants.

## Public and account routes

| Route | Surface | Current state | Data / action | Gaps and UX implications |
|---|---|---|---|---|
| `/` | Marketing home | Working, public | Static product content and interactive calculator/journey components | Deep-link scrolling requires recheck after lazy loading; claims must track capability readiness. |
| `/pricing` | Pricing | Working, public | Static plans; passes a plan query to signup | Signup does not preserve/use the plan choice. |
| `/login` | Email/social sign in | Partial, public | Supabase password auth and configured OAuth providers | Live SMTP/OAuth callback journey remains unverified. |
| `/signup` | Account registration | Partial, public | Supabase registration | Plan handoff and complete verification journey remain unverified. |
| `/auth/callback` | OAuth callback | Partial, public | Exchanges/refreshes auth state | Provider-specific success/failure testing is required. |
| `/forgot-password` | Recovery request | Partial, public | Supabase reset email | Delivery was not exercised. |
| `/reset-password` | Password reset | Partial, public | Validates recovery context and updates password | Expired/used-link and MFA interactions need end-to-end coverage. |
| `/accept-invite` | Team invitation acceptance | Partial, public/authenticated | `/api/team/invites/accept` | Existing-user invitation flow, email delivery, resend and revoke are incomplete. |
| `/mfa` | MFA challenge | Partial | Supabase AAL2 flow | Needs real enrolment/challenge/recovery testing. |
| `/onboarding` | Workspace setup | Partial | Workspaces, business profile and service creation | Used for editing existing settings but begins with blank defaults; no hours/service-area editor or true activation gate. |
| `/privacy` | Privacy | Working, public | Static legal content | Requires owner/legal review before production reliance. |
| `/terms` | Terms | Working, public | Static legal content | Requires owner/legal review before production reliance. |
| `/support` | Support | Working, public | Static support content | Confirm the actual support channel and response promise. |
| `/quote/:token` | Customer quote | Partial, public | Reads quote/items/profile; accept/decline | No durable customer hub, delivery retry, revision history or deposit collection flow. |
| `/book/:slug` | Customer booking | Source-complete, deployment-dependent | Business/services/hours, slot preview and atomic booking RPC | Requires migration 0025 in each environment, workspace timezone, capacity/resource policy, deposit policy and live concurrency test. |
| `/payment-complete` | Payment result | Partial, public | Static post-Checkout explanation | Does not poll or display the settled invoice/payment result. |
| `/payment-cancelled` | Payment cancellation | Working, public | Static cancellation explanation | Should offer a safe return to the source invoice when context exists. |

## Authenticated workspace routes

| Route | Surface | Current state | Real data / actions | Missing, disconnected or risky |
|---|---|---|---|---|
| `/app` | Command Centre | Partial | Dashboard, onboarding, billing, integrations, services; four operator commands | Live inspected session failed to fetch. Needs a useful degraded state, accurate timezone boundaries and action-oriented attention queue. |
| `/app/command` | Operator command | Partial, unlisted | `/api/operator/command` for overdue invoices, today’s jobs, attribution and quote follow-up | Hidden from primary nav; command set is narrow and should be presented as supported actions, not open-ended AI. |
| `/app/inbox` | Customer conversations | Partial | Conversations, messages, notes, consent recording and outbound SMS | Local runtime failed to fetch. SMS provider/consent journeys unverified; no general email inbox. |
| `/app/notifications` | Notifications | Partial | List, mark one read, mark all read | Resource links and per-user read semantics need completion. |
| `/app/customers` | Customers list | Partial | List/search/create customers | No update/archive, server pagination or robust duplicate handling UI. |
| `/app/customers/:id` | Customer detail | Partial | Addresses, leads, jobs, quotes, invoices, payments and calls | Read-heavy; no contact/address correction, activity composer or focused mobile actions. |
| `/app/leads` | Lead pipeline | Partial | List/create and stage update | Board movement exists as controls rather than a complete drag/drop record workflow; no detail route, owner, next action or loss reason UI. |
| `/app/schedule` | Schedule & Dispatch | Partial | Jobs plus date-ranged appointments; job rescheduling | No complete staff/resource lane model, drag/drop conflict preview, unscheduled queue, route/map or workspace-timezone display policy. |
| `/app/jobs` | Jobs list | Partial | List/create jobs | Fixed fetch limit, no server paging/filtering or saved views. |
| `/app/jobs/:id` | Job detail | Partial | Correctly mapped appointment, customer, time, materials, quotes, invoices and payments; status/schedule/time/material actions | Photos, checklists, signatures, timer stop, material delete and report endpoints are not exposed here. |
| `/app/quotes` | Quote list and creator | Partial | List/create/send/share/convert | No quote detail/builder route, client preview, revision flow, visible void action or delivery retry. |
| `/app/invoices` | Invoice list and creator | Partial | List/create/send and Checkout link | No dedicated detail route, resend path, stored active checkout session or confirmed business payout model. API and RLS role intent must stay aligned. |
| `/app/payments` | Payments list | Partial | Payment records linked to customers/invoices | No payment detail, reconciliation exceptions, refund/credit-note surface or business payout status. |
| `/app/assets` | Customer assets | Partial | List/create; backend also supports patch | Edit, archive, job/service-history linking and mobile scan/search are absent. |
| `/app/marketing` | Marketing SMS | Partial | Campaign create, prepare, approve and send | Requires live provider/consent/opt-out/failure testing; audience preview and delivery diagnostics need clearer UI. |
| `/app/automations` | Automation list/builder/runs | Partial | Create, activate/pause/archive, manual run and run history | Builder still saves sparse step inputs; event/cron coverage and exactly-once execution need real scenario testing. |
| `/app/approvals` | AI approvals | Partial | List and approve/reject with resumed/terminal run logic | Needs richer action context, before/after diff, expiry and post-decision outcome trail. |
| `/app/brain` | Business Brain | Partial | Memory list/detail/evidence/usage/decisions, settings, feedback, metrics | Learning is not yet visibly embedded in job/quote/inbox work; recovery/provider tests remain. |
| `/app/knowledge` | Knowledge | Partial | List/create and initial approval flag | No detail/edit/version/approve-existing/archive, file or website ingestion, or retrieval testing surface. |
| `/app/operator` | AI action log | Working as read-only | AI actions list | Needs links back to source records and more useful failure diagnostics. |
| `/app/operator/phone` | Receptionist overview | Deployment-dependent | Receptionist profile/calls/knowledge and status summaries | Requires migration 0024 and provider/signing/AI configuration in every environment. |
| `/app/operator/phone/configure` | Receptionist identity/config | Deployment-dependent | Profile upsert for greeting, escalation, limits and policies | Owner/admin and sensitive-auth gated; live persistence must be verified. |
| `/app/operator/phone/handling` | Receptionist call handling | Deployment-dependent | Profile handling rules | No live call proof yet. |
| `/app/operator/phone/knowledge` | Receptionist knowledge | Partial | Reads knowledge documents | Shares incomplete knowledge maintenance limits. |
| `/app/operator/phone/test` | Receptionist simulation | Partial | `/api/receptionist/simulate` | Simulation cannot substitute for signed live Twilio tests. |
| `/app/operator/phone/calls` | Call list/detail | Deployment-dependent | Calls, transcript, outcome, turn count and AI actions | Needs migration/provider readiness, pagination and recording policy. |
| `/app/operator/phone/insights` | Call insights | Partial | Client-computed recent-call summaries | Limited by 50-call fetch and missing long-range server aggregation. |
| `/app/reviews` | Reviews | Backend-start only | Reads `review_requests` | Requests are queued but no delivery worker, customer submission flow or external review sync exists. ⚠️ BACKEND GAP |
| `/app/analytics` | Reports & attribution | Backend-start only | Reads `revenue_attributions` | No application write/reconciliation path creates attribution from settled revenue. ⚠️ BACKEND GAP |
| `/app/hiring` | Hiring pipeline | Partial | Roles, candidates, applications, notes and human-controlled stage changes | Management access is enforced; lacks job-board publishing, candidate detail and retention controls. |
| `/app/integrations` | Integration status | UI/backend mismatch | Lists status; Twilio activation backend exists | Buttons are disabled; Google Calendar, accounting and Meta connection flows are absent. |
| `/app/team` | Team | Partial | Members and manual setup-link invitations | No email send, existing-user linking, resend/revoke, role change or removal. |
| `/app/billing` | Subscription billing | Partial | Status, Stripe Checkout and customer portal | Requires live Prices/secrets/webhooks; Operator plan is by arrangement. Invoice payouts are a separate unresolved model. |
| `/app/settings` | Business/services settings | Broken edit journey | Links back to onboarding | Existing values are not loaded before edit; service update/archive and hours/areas controls absent. |
| `/app/settings/security` | Security | Partial | MFA/security state and guidance | Needs completed MFA management, session/device visibility and role-aware recovery. |
| `/app/capabilities` | Capability map | Working, unlisted | Registry of ready/setup/soon features | Must be the single source for navigation and marketing status to prevent drift. |

## Placeholder routes

All resolve through `/app/coming-soon/:feature`: GPS dispatch/live ETA, job checklist badges, PDF documents, standalone time/materials, checklist/forms workspace, recurring jobs/agreements, supplier purchasing, AI post-work recaps, voicemail transcription, call recordings, spam screening, multiple numbers, customer portal, automated review requests, accounting sync, Zapier/webhooks/API and deployment health. Some overlap with existing backend-only job completion features; the capability registry should distinguish “backend available, UI missing” from “not built.”

## Backend surfaces without complete UI

| Capability | Existing source | Needed product surface |
|---|---|---|
| Job photos | `/api/operations/jobs/:id/photos` | Job media gallery with capture/upload, progress, captions and authorised removal. |
| Job checklists | `/api/operations/jobs/:id/checklists` | Template picker, critical-item completion and offline-aware mobile flow. |
| Job signatures | `/api/operations/jobs/:id/signatures` | Consent text, signature capture, immutable receipt and authorised view. |
| Job report data | `/api/operations/jobs/:id/report` | Printable/exportable completion report. |
| Stop/correct time | `PATCH /jobs/:id/time/:entryId` | Persistent running timer and correction form. |
| Delete material | `DELETE /jobs/:id/materials/:materialId` | Manager-only correction with confirmation and audit feedback. |
| Asset edit | `PATCH /api/assets/:id` | Asset detail/edit and service history. |
| Twilio activation | `POST /api/integrations/twilio/activate` | Enabled Connect/Manage action with setup health. |
| Customer portal session storage | `customer_portal_sessions` | Secure client hub routes and token/session lifecycle. ⚠️ BACKEND GAP for full portal content. |

## Cross-cutting findings

1. Every server query reviewed scopes by `workspace_id` and protected routes derive workspace membership before use. UI must continue sending workspace context only as a selection hint; the server remains authoritative.
2. Lists still cap results: customers 100, leads 200, jobs/quotes/invoices/payments 300, calls 50 and attribution 1,000. Client-side search cannot recover records beyond those caps.
3. Shared data hooks do not consistently cancel or version requests during fast workspace switches, so stale content can appear under the next workspace even when backend isolation is correct.
4. Dates and “today” boundaries are inconsistent between workspace timezone, browser timezone, server timezone and a hard-coded Adelaide notification format.
5. Error feedback is technically honest but often replaces the whole work surface. Core pages need retained context, retry state and a clear explanation of what remains safe to do.

## Evidence and limits

This inventory is based on current repository routes, migrations, API handlers, the 11 September audit evidence, current tests/build and a read-only visual check of the signed-in shell. No customer record, message, booking, payment, invitation or provider action was created. Production provider configuration, migration history and deployed runtime behavior still require a staging release audit.
