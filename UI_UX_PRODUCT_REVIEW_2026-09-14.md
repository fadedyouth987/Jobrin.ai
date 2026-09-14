# Jobrin.ai — UI/UX & Product Design Review

**Date:** 2026-09-14
**Scope:** Full application as a customer would experience it — navigation/IA, dashboard, AI Receptionist, Inbox, CRM, Pipeline, Calendar, Jobs/Quotes/Invoices/Payments, design system, accessibility, responsiveness. Read-only audit — no code changed in this pass.
**Verdict up front:** The bones are good — a real design-token layer in `index.css` (focus rings, 44px touch targets, table overflow, dark mode) applies everywhere regardless of what a page author writes, and the mobile nav (drawer + bottom bar + command palette) is already solid. The problems are concentration and inconsistency, not missing foundations: nav has 31 items across 14 groups with no way to hide what you don't use, three-plus separate places invent their own status-color logic, and the shared component kit is missing a Table/Modal/Toast/Dropdown/Skeleton — so every page quietly reimplements them slightly differently.

---

## 1. Design Principle Assessment

The requested principle — expose the most-used functionality directly, push occasional functionality into an opt-in Tools/Apps layer, let users customize their workspace — is **not implemented today**, but the substrate for it already exists:

- `CapabilityMapPage` (`/app/capabilities`, `AppPages.tsx:393-424`) already groups live/connect/soon capabilities into labeled clusters with status pills — a working prototype of a Tools/Apps grid, just not wired into navigation or made interactive.
- `COMING_SOON_FEATURES` (`AppPages.tsx:426-492`) is 13 placeholder features already shaped like marketplace tiles (title, eyebrow, description, points).
- `workspace_module_state` (DB table) stores arbitrary per-workspace module data but has no enable/disable flag — it's the wrong table for "is this tool on," but sits right next to where that table should live.
- Plan entitlements (`shared/plans.ts`) already gate *which* features a workspace can access by tier — a Tools/Apps toggle would need to sit on top of this, not replace it.

**What's missing:** a `workspace_enabled_tools` table, a toggle UI, and the nav-filtering logic to hide disabled tools. This is new work, not a redesign of existing work — see §4.

---

## 2. Current Navigation (as-is)

31 live routes across 14 groups (full list audited from `src/app/workspaceNavigation.tsx:25-90`):

Today · Command Centre · Inbox · Notifications | Customers · Leads | Schedule &amp; Dispatch | Jobs | Quotes · Invoices · Payments | Assets | AI Receptionist · Automations · Approvals · Business Brain · Knowledge · Operator log | Marketing SMS · Reviews | Hiring | Reports | Integrations | Team | Billing | Settings · Security

Plus 13 "coming soon" placeholders mixed directly into these groups, and `/app/capabilities` which is routed but **not in the nav at all**.

**Problems:**
- No way to hide anything — every workspace sees all 31 items regardless of whether they use half of them (e.g. Hiring, Assets, Marketing SMS are relevant to a subset of businesses).
- Command Centre and Dashboard (Today) overlap in purpose but are disconnected — two "home" surfaces.
- Notifications is a full nav item despite already having a header bell — redundant entry point.
- Business Brain, Knowledge, and Operator log are AI-configuration/audit surfaces that read as three separate destinations for what a user thinks of as one thing ("the AI").
- Role-based hiding (`staffRestrictedPaths`) is nav-only, not enforced at the route level — a separate finding, flagged for backend follow-up, not a UX fix.

---

## 3. Recommended Navigation

Mapping the current 31 items onto the requested 14-item primary nav:

| Primary nav item | Absorbs |
|---|---|
| **Dashboard** | Today + Command Centre (merge into one home, see §5) |
| **AI Receptionist** | `/app/operator/phone` + subtabs; add Business Brain/Knowledge/Operator log as subtabs of this, not separate top items |
| **Inbox** | Inbox (rename mental model to "SMS Inbox" until multi-channel ships, or ship multi-channel first — see §6) |
| **CRM/Customers** | Customers |
| **Pipeline** | Leads (kanban) |
| **Calendar** | Schedule &amp; Dispatch |
| **Quotes** | Quotes |
| **Jobs** | Jobs |
| **Invoices** | Invoices |
| **Payments** | Payments |
| **Automations** | Automations (+ Approvals surfaced here or on Dashboard, not standalone — see below) |
| **Analytics** | Reports &amp; attribution |
| **Tools/Apps** | Assets, Marketing SMS, Reviews, Hiring, Integrations, all 13 coming-soon placeholders |
| **Settings** | Settings, Security, Team, Billing nested as subpages |

**Items needing an explicit decision (not a clean 1:1 fit):**
- **Approvals** — time-sensitive (gates AI actions); don't bury it in Tools/Apps. Recommend a badge/count on Dashboard and/or Automations rather than a standalone nav slot.
- **Notifications** — drop as a nav item, keep as the existing header bell only.
- **Team/Billing** — nest under Settings rather than top-level groups; both are low-frequency/admin.

This takes primary nav from 14 groups/31 items down to the requested 14 single items, with Settings and Tools/Apps as the two "everything else" umbrellas.

---

## 4. Tools/Apps System — Design

**Concept:** a marketplace grid (evolve `CapabilityMapPage`, don't rebuild) where each tile represents one optional capability: Campaigns, Social posting, Website builder, Landing pages, Review management, Advanced reporting, Advanced AI tools, Client portal, Forms, additional integrations, specialist automations — plus today's existing "occasional" features (Assets, Marketing SMS, Reviews, Hiring) and the 13 coming-soon placeholders.

**Mechanics:**
- Each tile: name, one-line description, status (Available / Enabled / Requires upgrade / Coming soon), a single enable/disable toggle.
- Enabling a tool adds it to primary nav (or a "My Tools" section within Tools/Apps if the user prefers a lighter touch); disabling removes it from nav without deleting data.
- Plan entitlements still gate what *can* be enabled — a tool showing "Requires upgrade" links to Billing rather than being toggleable.
- Role matters independently of enablement: a workspace can have a tool enabled, but a staff member without the role for it (billing, team, integrations) still shouldn't see it — this needs the toggle state and `staffRestrictedPaths`-equivalent role check to both pass before a tile appears in nav.

**Data model needed (new, additive — no existing table repurposed):**
```
workspace_enabled_tools (
  workspace_id, tool_key, enabled boolean, enabled_by, enabled_at
)
```
Distinct from `workspace_module_state` (which stores a tool's *data*, not its *visibility*) — both can coexist.

---

## 5. Dashboard

**Today, the "home" experience is split across two disconnected pages** — `DashboardPage` (setup checklist, 4 stat cards, a generic "needs attention" list, today's jobs) and `CommandCentrePage` (a separate natural-language query box). Neither answers the full list the product needs to answer.

| Question | Shown today? |
|---|---|
| What needs my attention? | Partial — opaque server-driven list, no clear logic |
| What came in? | No — no new-leads/new-messages feed |
| What needs replying to? | **No** — Inbox unread state isn't surfaced here at all |
| What work is happening today? | Yes — "Today's work" job list |
| What money is outstanding? | Partial — one stat card, no aging/breakdown |
| What opportunities are at risk? | **No** — pipeline/stalled-lead data isn't reflected |
| What did AI handle? | Partial — a raw count, no specifics |
| What should I do next? | Weak proxy via "needs attention," not task-specific |

**Recommendation:** merge Command Centre into Dashboard (as a query box embedded at the top or in a side panel, not a separate nav destination), and rebuild the body as focused, purposeful sections rather than a stat-card grid:
1. **Inbox triage strip** — unread/urgent conversations needing a reply, with direct reply affordance.
2. **Today's work** — keep as-is, it already works.
3. **Money** — outstanding total broken down by overdue vs. upcoming, not one flat number.
4. **Pipeline risk** — leads stalled beyond X days, quotes awaiting response.
5. **AI activity + approvals** — what the AI did today, and a live count of actions awaiting approval (currently invisible unless you visit `/app/approvals` directly).
6. **Setup checklist** — keep, but collapse/dismiss once complete rather than presumably staying forever.

Do not add more charts — every section above should answer one specific question a business owner actually asks each morning.

---

## 6. AI Receptionist — First-Class Treatment

Current page (`ReceptionistPage`, `AppPages.tsx:207-340`) does status, tone, and capability-toggle transparency reasonably well, but is missing nearly every requested metric:

| Requested | Status |
|---|---|
| Status (on/off, live) | ✅ hero banner + pill |
| AI availability / working hours | ❌ only a free-text "after-hours message" field, no real hours-of-week control |
| Conversations handled | ❌ absent — only a raw recent-calls table, no aggregate |
| Missed opportunities | ❌ absent |
| Bookings created | ❌ absent |
| Escalations | ❌ config-only, not tracked as a metric |
| Actions awaiting approval | ❌ absent from this page (lives on a disconnected `/app/approvals`) |
| Knowledge/business-brain health | ❌ absent (separate page, no link) |
| Tone | ✅ free-text field (no presets/preview) |
| Capabilities | ✅ best-covered area — checkboxes + static disclaimer of what's off |
| Channels | ❌ page is phone-only with no channel indicator, risks implying it covers SMS/chat too |

**Recommendation:** add an outcomes strip (conversations handled / missed / bookings created / escalations, pulled from `/api/receptionist/calls` aggregates) above the existing config cards, a real working-hours grid, a pending-approvals count linking to Approvals, and either wire the existing text-mode simulator to actually preview phone behavior or relabel it "AI Admin text preview" so it stops implying it tests the phone experience. Also render the page's own load error (`query.error` is fetched but never displayed — a real bug, not just a polish item).

---

## 7. Inbox

Current page is **SMS-only** despite "Inbox" implying multi-channel — the page's own description ("Every text a customer sends") is honest about this, but the nav placement and naming will set the wrong expectation. Missing: unread indicators (present elsewhere in the app, e.g. Notifications — just not reused here), a link from a conversation to the full customer record (the data — `customer_id` — is already there, `CustomerDetailPage` already aggregates jobs/quotes/invoices/calls, this is a one-line fix), AI suggested replies, tags, and assignment.

**Recommendation, in priority order:**
1. Add "View customer record" link in the thread header — trivial, high value, data already available.
2. Add unread indicators to the conversation list.
3. Decide and commit: either build multi-channel ingestion (email/chat/social) before calling this "Inbox," or rename it "SMS Inbox" until it is multi-channel, so the nav doesn't overpromise.
4. Surface job/quote/invoice context in the right rail alongside the existing private-notes panel.

---

## 8. CRM / Customer Timeline

`CustomerDetailPage` shows four **separate, unsorted** cards (Jobs, Quotes+Invoices, Recent calls, Leads/sales history) rather than one merged chronological timeline. Notably, `JobDetailPage` *already has* a working interleaved `<Activity>` timeline component for a single job — the pattern exists in the codebase, it just wasn't reused at the customer level. Missing entirely from the customer record: SMS/message history, private notes, explicit payment records, reviews, campaign/automation events, AI call transcripts.

**Recommendation:** reuse the existing `<Activity>` component pattern from `JobDetailPage` at the customer level, feeding it messages + notes + quotes + jobs + invoices + payments + reviews + automation events + AI interactions in one chronological stream, replacing the four disconnected cards.

Also: the Customers list itself has no search/filter (every sibling list page does) and table rows aren't clickable into the detail page — both look like unfinished affordances rather than deliberate omissions, and both are cheap fixes.

---

## 9. Pipeline, Calendar, Jobs/Quotes/Invoices/Payments — Summary Findings

- **Pipeline (Leads)**: no search/filter (the one list page missing it), strictly linear stage advancement with no manual reassignment, no lead detail page — all context lives on a small kanban card, stage badges use plain text instead of the shared `StatusPill`.
- **Calendar**: appointment cards in the week grid are not clickable (dead-ends, unlike jobs which do link out); no day/month view, only week.
- **Jobs/Quotes/Invoices/Payments**: share two generic components (`FinancialDocumentsPage` for quotes+invoices, `AppointmentsPaymentsList` for appointments+payments) rather than one-per-type — reasonable reuse, but the abstraction is stretched: GST calculation is hardcoded client-side (duplicating server-side calculation, a correctness risk beyond just UX), payment rows link generically to `/app/invoices` instead of the specific invoice, and there's no detail page at all for quotes/invoices/payments (only Jobs get one).
- **Duplicate customer handling**: none exists — no merge UI, no create-time fuzzy-match warning. Real gap for a CRM.
- **Status/stage color consistency**: the shared `StatusPill` component exists, but its tone-mapping logic is reimplemented independently at least three times (`OperationalDetailPages.tsx`'s `tone()`, an inline mapping in `AppointmentsPaymentsList`, another inline mapping in `MarketingPage`) with different, sometimes contradictory status→color rules — e.g. "cancelled" can render red in one place and slate in another.

**Common recommendation:** add search/filter to Customers and Leads; make Calendar appointment cards and Customers table rows clickable; extract one shared `statusTone(status)` function used everywhere `StatusPill` is rendered; move GST/total calculation display logic to trust the server response rather than recomputing client-side.

---

## 10. Responsive Design

Core app chrome (sidebar, bottom nav, command palette) is already well-built for mobile — a real drawer with focus trap, a 4-item bottom nav bar under `lg`, global CSS breakpoints independent of per-page classes. Density of *page-level* responsive classes varies a lot: `AppPages.tsx` and `PublicHome.tsx` are heavily responsive; `IntegrationsPage.tsx` and `SchedulePage.tsx` have almost none, meaning some pages likely feel cramped or under-adapted on tablet/phone despite the chrome around them working fine. The Customers table specifically has no mobile card-fallback variant, unlike Jobs/Appointments which do (`hidden md:block` table + `md:hidden` card list pattern) — worth replicating there.

---

## 11. Design System Audit

**Strengths (genuinely above-average for this stage):**
- A real global-CSS "forced consistency" layer in `index.css` — focus-visible rings, 44px minimum touch targets on inputs/buttons/nav, automatic table horizontal-scroll wrapping, border-radius normalization inside the app shell — all apply regardless of what a page author writes, which is a much stronger guarantee than convention alone.
- Dark mode is implemented via CSS-variable overrides under a `.dark` class rather than scattered `dark:` utility classes — meaning nothing can "forget" to support dark mode, though it does mean correctness depends on which literal color classes a page happens to use.
- `lucide-react` used consistently for icons across the whole app, no mixed libraries.
- `EmptyState` component is well-designed and consistently used.

**Gaps:**
- No `Table`, `Modal/Dialog`, `Toast`, `Dropdown/menu`, or `Skeleton` component in the 14-component shared kit — every page reimplements these ad hoc (div-based pseudo-tables, expand-in-place cards standing in for modals, per-page error-banner styling that differs page to page, `Spinner` used as the only loading treatment regardless of content shape).
- Status colors are not true design tokens — `StatusPill`'s tone lookup and every duplicate tone function hardcode literal Tailwind color names rather than semantic `--color-success`/`--color-warning`/`--color-error` variables.
- No defined heading type scale — every page hand-picks `text-3xl font-black tracking-tight` (or similar) by convention/copy-paste, not enforced by a shared `Heading` component.
- `PublicHome.tsx` (marketing site) uses raw hex colors and doesn't participate in the app's radius-normalization or dark-mode override system — it's visibly a separate design language from the authenticated app.
- Accessibility `aria-`/`role` attributes are concentrated in only 4 of 18 sampled page files; most pages have none. Labels, focus rings, and touch targets are handled well at the system level, but per-page ARIA attribution (e.g. `aria-expanded` on toggles, `aria-label` on all icon-only buttons) is inconsistent.

**Recommended token additions:** `--color-success/warning/error/info` (backing a shared `statusTone()` utility), a defined `--text-h1/h2/h3` heading scale backing a `Heading` component, and the five missing components above — Table, Modal, Toast, Dropdown, Skeleton — added to `src/components/saas/ui.tsx` before any page-level redesign work, since every subsequent page fix should consume these rather than add a sixth ad hoc pattern.

---

## 12. Per-Page Summary Table

| Page | Primary problem | Top fix |
|---|---|---|
| Dashboard | Split across 2 disconnected "home" pages; doesn't show inbox/pipeline-risk/approvals | Merge with Command Centre; add triage/risk/approvals sections |
| AI Receptionist | No outcome metrics, no working-hours control, error state not rendered | Add outcomes strip + hours grid; fix error render |
| Inbox | SMS-only but named/positioned as universal; no customer-record link; no unread state | Link to customer record; add unread badges; rename or expand scope |
| Customers | No search/filter; table rows not clickable into detail; no mobile card view | Make rows clickable; add search; add mobile card list |
| Customer detail | 4 disconnected cards instead of one timeline; missing messages/payments/reviews/AI events | Reuse existing `<Activity>` pattern from Job detail |
| Pipeline (Leads) | No search/filter; no detail view; stage badges bypass `StatusPill` | Add search; use shared tone system; allow manual stage reassignment |
| Calendar | Appointment cards not clickable; week-view only | Make cards link out; add day/month toggle |
| Jobs/Quotes/Invoices/Payments | Generic components stretched (branchy conditionals); GST computed client-side; no quote/invoice/payment detail pages | Extract shared `statusTone()`; trust server totals; add detail pages |
| Navigation | 31 flat items, no hide/customize | Adopt 14-item primary nav + Tools/Apps marketplace (§3, §4) |
| Design system | Missing Table/Modal/Toast/Dropdown/Skeleton; status colors not tokenized | Add components to shared kit first, before further page redesign |

---

## 13. Suggested Implementation Order

This is a large body of work; recommend batching so nothing is broken mid-flight and each batch is independently testable:

1. **Design-system foundation** (§11) — add the 5 missing shared components + status-color tokens + heading scale. Nothing else should build on top of ad hoc patterns after this lands.
2. **Cheap, high-value fixes with no IA change** — Customers search/filter + clickable rows, Inbox customer-record link + unread state, Calendar clickable appointments, AI Receptionist error-state render + outcomes strip. These are safe, isolated, and immediately useful.
3. **Customer timeline** — reuse `<Activity>` pattern at the customer level.
4. **Dashboard/Command Centre merge** — the biggest single UX win, self-contained to one page pair.
5. **Navigation restructure + Tools/Apps marketplace** — the largest, most structurally invasive change (new DB table, nav-filtering logic, role/entitlement intersection). Do this last, once the pages it will surface/hide are already in better shape.

---

*This document is the audit only, per the "document problems, then implement" structure requested. Implementation has not started. Given the size of the navigation/Tools-Apps restructure in particular (new database table, changes to every page's entry point, a role/entitlement/enablement intersection that doesn't exist today), confirming the batch order and scope before touching code is recommended rather than assumed.*
