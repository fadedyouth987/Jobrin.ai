# Jobrin.ai Design System Specification

## Design direction

Jobrin should feel calm, exact and operational: bright neutral canvases, strong text contrast, compact but breathable data surfaces and one restrained blue accent. “Futuristic” should come from fast interaction, connected context, excellent state feedback and clean data presentation rather than neon effects or decorative motion.

The same tokens and components apply to the public site, authenticated workspace, customer quote/booking experiences and future portal. Density may change by context, but typography, states, controls and language remain consistent.

## Foundations

### Colour tokens

Use semantic variables in components; do not place raw palette classes throughout feature pages.

| Token | Light | Dark | Use |
|---|---:|---:|---|
| `canvas` | `#F5F7FA` | `#0B1220` | Page background |
| `surface` | `#FFFFFF` | `#111B2E` | Cards, sidebar, dialogs |
| `surface-subtle` | `#F0F3F7` | `#18243A` | Grouped regions, hover, inset panels |
| `surface-raised` | `#FFFFFF` | `#1A2740` | Menus, sheets, overlays |
| `border` | `#D7DEE8` | `#34435A` | Default separators |
| `border-strong` | `#AAB6C6` | `#52627A` | Selected/interactive boundaries |
| `text` | `#172033` | `#F3F6FB` | Main text |
| `text-muted` | `#526177` | `#B9C5D6` | Secondary text |
| `text-subtle` | `#6B778B` | `#93A4BA` | Metadata; still meet WCAG AA at normal sizes |
| `accent` | `#2458D3` | `#7EA2FF` | Primary actions, links, focus |
| `accent-hover` | `#1D46AA` | `#A7BEFF` | Hover/pressed |
| `focus` | `#2F6FED` | `#8AAEFF` | 3 px focus ring with 2 px offset |
| `success` | `#087A55` | `#65D8AE` | Confirmed/complete/paid |
| `warning` | `#9A5A00` | `#F6BD60` | Attention/due/waiting |
| `danger` | `#B42318` | `#FF8A80` | Failed/overdue/destructive |
| `info` | `#175CD3` | `#8DB4FF` | Neutral guidance/setup |

### Lifecycle status tokens

Status must never rely on colour alone. Every badge includes a text label and, in dense contexts, a shape/icon distinction.

| Business state | Semantic token | Label examples |
|---|---|---|
| Enquiry | `info` | New enquiry, Awaiting reply |
| Qualified | `accent` | Qualified, Quote needed |
| Quoted | violet derived token | Draft quote, Sent, Viewed, Accepted, Declined, Expired |
| Booked | cyan derived token | Scheduled, Confirmed |
| In field | `warning` | On the way, In progress, Waiting on customer |
| Completed | teal derived token | Work complete, Ready to invoice |
| Invoiced | blue derived token | Draft invoice, Due, Part paid |
| Paid | `success` | Paid, Settled |
| Overdue/failed | `danger` | Overdue, Delivery failed, Payment failed |
| At risk | orange derived token | Stalled, Conflict, Needs review |
| Cancelled/archived | neutral | Cancelled, Void, Archived |

### Typography

Use `Inter Variable` when it can be self-hosted with a checked-in licence and asset; otherwise retain `Segoe UI Variable`, `Segoe UI`, Arial, sans-serif. Numeric tables use tabular numerals. IDs, phone numbers and timestamps may use the same font with tabular settings; reserve monospace for technical logs.

| Style | Desktop | Mobile | Weight / line height |
|---|---:|---:|---|
| Display | 40 px | 32 px | 700 / 1.1 |
| Page title | 32 px | 28 px | 700 / 1.15 |
| Section title | 22 px | 20 px | 650 / 1.25 |
| Card title | 17 px | 17 px | 650 / 1.35 |
| Body | 16 px | 16 px | 400 / 1.55 |
| Compact body | 14 px | 14 px | 400 / 1.5 |
| Label | 13 px | 13 px | 600 / 1.35 |
| Metadata | 12 px | 12 px | 500 / 1.4 |

Do not render essential content below 12 px. Keep prose to 68 characters per line; table content can be denser.

### Spacing and grid

Use a 4 px base unit. Component spacing: 4, 8, 12, 16, 20, 24, 32, 40 and 48 px. The main desktop container is fluid up to 1,440 px. Standard page padding is 32 px desktop, 24 px tablet and 16 px mobile.

Breakpoints:

- `compact`: 0–639 px. One column, bottom navigation, full-screen sheets, sticky field actions.
- `medium`: 640–1023 px. One/two columns, navigation drawer, side sheets up to 480 px.
- `wide`: 1024–1439 px. Persistent 248 px sidebar, 12-column grid.
- `large`: 1440 px and above. Persistent 264 px sidebar, maximum content width 1,440 px; dense schedules may use full width.

Touch targets are at least 44 × 44 px. Adjacent destructive and primary actions have at least 8 px separation.

### Radius, elevation and borders

Use 8 px for controls, 12 px for cards, 16 px for dialogs/sheets and a full pill only for statuses/toggles. Nested surfaces should reduce radius rather than stack multiple identical rounded cards.

- Level 0: border only.
- Level 1: `0 1px 2px rgb(16 24 40 / 0.06)` for cards.
- Level 2: `0 8px 24px rgb(16 24 40 / 0.12)` for menus and sticky rails.
- Level 3: `0 20px 48px rgb(16 24 40 / 0.18)` for modal dialogs.

Dark mode uses borders and luminance separation instead of stronger shadows.

### Motion

Motion communicates cause and state:

- Hover/focus: 100 ms.
- Menu/sheet/dialog: 160 ms in, 120 ms out.
- Reorder/drag settlement: 180 ms.
- Toast: 180 ms with no bouncing.
- Easing: `cubic-bezier(.2,.8,.2,1)` for entry and `cubic-bezier(.4,0,1,1)` for exit.

Respect `prefers-reduced-motion`. Never animate numeric totals on load, loop decorative effects or delay an action for animation.

## Layout system

### Page anatomy

1. Breadcrumb or concise lifecycle context.
2. Page title and one-sentence purpose.
3. Primary action at top right on desktop and sticky bottom action on compact screens.
4. Optional attention strip when there is real actionable work.
5. Filter/view toolbar.
6. Main working surface.
7. Empty/loading/error state inside the affected region.

Metrics appear only when they change a decision. Pages should not begin with four generic metric cards by default.

### Responsive tables

Desktop tables use sticky headers, row selection, sortable columns, server pagination and a persistent filter summary. Columns have minimum and preferred widths; text truncates only when a preview/detail remains available.

On compact screens, use purpose-built list rows rather than horizontally scrolling the whole desktop table. Each row shows identity, status, next action and two context fields. Bulk selection becomes an explicit selection mode.

### Record detail

Desktop uses:

- 240–280 px facts rail: customer, site, contact, owner, status.
- Flexible centre: current work, documents, activity.
- 320–380 px related/attention rail where space permits.

Below 1,200 px, collapse the right rail into tabs. On mobile, order content as current status → next action → contact/site → today’s task → timeline → related financials.

## Core component inventory

| Component | Required behavior |
|---|---|
| App shell | Role-aware grouped nav, workspace switch, search, sync/offline indicator, responsive drawer and bottom destinations. |
| Page header | Purpose, breadcrumb, primary action, permission-safe overflow actions. |
| Attention row | Reason, severity, age, linked record and one next action. |
| Data table | Server sort/filter/page, selection, column visibility, row preview, skeleton, empty/error and count. |
| Mobile record row | 44 px target, status, identity, two facts and swipe-free action menu. |
| Record preview sheet | Resizable desktop rail, full-screen mobile, next/previous, deep-link and close with focus restoration. |
| Kanban board | Keyboard and pointer movement, counts/totals, horizontal scroll, collapsed empty columns, server-confirmed status updates. |
| Scheduler | Day/week, staff/resource lanes, unscheduled rail, conflict preview, timezone label, touch-safe reschedule and live sync state. |
| Quote/invoice builder | Customer/job context, searchable service items, inline quantity/price/GST, totals, terms, autosave status, preview and role-aware send. |
| Status badge | Central label/tone/icon map with accessible name. |
| Activity timeline | Chronological actor/action/result with filters and related links. |
| Global search/command | Search records and supported create/navigation actions; exact shortcut hints and no invented AI capability. |
| Notification centre | Priority/Other, read/unread, snooze only if persisted, direct resource link and bulk mark read. |
| Empty state | Explains what belongs here and presents one real next step. |
| Skeleton | Mirrors final layout without excessive shimmer; announced once to assistive tech. |
| Inline error | Keeps safe context, names the affected region and provides retry. |
| Toast | Confirms reversible success or failure; action remains visible in the page when consequential. |
| Form field | Label, optional/required indicator, hint, inline error and error-summary link. No placeholder-only labels. |
| Combobox | Server search, keyboard navigation, loading/no-result states and create-new only where authorised. |
| Confirm dialog | Names the record and effect; required for destructive or irreversible operations. |
| Sync state | Local draft/pending/synced/failed with timestamp; required before offline field work. |

## Navigation model

### Desktop

Use a persistent sidebar with a maximum of seven visible top-level work areas:

1. Command Centre
2. Inbox
3. Schedule
4. Work: Leads, Customers, Jobs, Assets
5. Money: Quotes, Invoices, Payments
6. Automate: Receptionist, Automations, Approvals, Business Brain, Knowledge
7. Manage: Reports, Marketing, Hiring, Integrations, Team, Billing, Settings

Coming-soon pages do not appear in daily navigation. Surface them in Capability Map or a roadmap page. Owner/admin configuration stays under Manage. Staff receive only authorised destinations, and direct routes still render an explicit permission state.

### Mobile

Office default: Today, Inbox, Schedule, More. Field default: Today, Jobs, Inbox, More. The central create action opens only authorised, real record types. Preserve browser back behavior and deep links.

### Workspace switching

The switcher shows business name, role and environment if relevant. Switching immediately clears workspace-bound content, cancels/version-checks outstanding requests and displays a bounded loading state. The server verifies membership for every request; no component trusts a client-supplied workspace ID by itself.

## Contextual Business Brain

Business Brain remains a governance destination for memory review and settings, but its useful output appears where decisions occur:

- Inbox: relevant customer preference and prior issue, with source and confidence.
- Lead: suggested next action based on explicit interaction history.
- Job: service history, customer access preference and confirmed business rule.
- Quote: approved pricing rule or explicit warning that pricing is advisory.
- Automation: proposed trigger/input mapping and policy conflict.

Every memory chip states its source, scope, status and confidence. Users can inspect evidence, correct it or report it. Sensitive memories never appear outside authorised roles. AI suggestions use “Suggested” language and show whether the action still requires approval.

## Content and formatting rules

- Use Australian English.
- Money displays as `A$1,234.50` when ambiguity exists and `$1,234.50` within an explicitly AUD workspace.
- Quotes and invoices state whether totals include GST; line items retain the stored GST rate.
- Dates use `12 Sep 2026` in dense UI and `12 September 2026` in documents. Inputs use a date picker with `DD/MM/YYYY` guidance.
- Times show `9:30 am` and the workspace zone (`ACST`, `AEST`, etc.) where ambiguity exists.
- Australian phone inputs accept common formatting and display a normalized example without hard-coding the country for future workspaces.
- Error text says what failed, whether data was saved and what the user can do next.

## Accessibility acceptance standard

Target WCAG 2.2 AA. All workflows must support keyboard navigation, visible focus, 200% text zoom, reduced motion, screen-reader names, status announcements and non-colour cues. Dialogs trap and restore focus. Drag/drop always has an equivalent menu or keyboard operation. Charts include text summaries and table access. Test at 320 px width with long names and at desktop widths without overlap, clipped controls or hidden focus targets.
