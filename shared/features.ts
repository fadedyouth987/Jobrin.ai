// Receptionist-first redesign: which product areas a workspace SHOWS.
//
// "Hide, don't delete": areas outside the receptionist journey stay in the
// codebase and can be switched back on per workspace. This is purely about
// what the app presents. It is not an access control — every API route keeps
// its own role and plan-entitlement checks, so a hidden area is exactly as
// secure as a visible one.
//
// Stored on public.workspaces (product_surface, feature_overrides), written
// only by trusted server code / SQL; see migration
// 20261106000000_workspace_product_surface.sql.

export type ProductSurface = 'receptionist' | 'full';

export const PRODUCT_SURFACES: readonly ProductSurface[] = ['receptionist', 'full'];

// Areas that can be hidden. Anything not listed here (Today, Inbox, Leads,
// Customers, Schedule, AI Receptionist, Business Brain, Knowledge, Approvals,
// Integrations, Team, Billing, Settings) is always shown: the receptionist
// needs it to answer calls, or the owner needs it to run the account.
export const HIDEABLE_AREAS = {
  field_jobs: {
    label: 'Field jobs & operations',
    paths: ['/app/jobs', '/app/time-materials', '/app/assets', '/app/recurring-jobs', '/app/purchasing'],
  },
  quotes_invoices: {
    label: 'Quotes, invoices & payments',
    paths: ['/app/quotes', '/app/invoices', '/app/payments'],
  },
  automations: {
    label: 'Automations',
    paths: ['/app/automations'],
  },
  ai_admin: {
    label: 'AI Admin chat & Operator log',
    paths: ['/app/admin-chat', '/app/command', '/app/capabilities'],
    // Exact: the AI Receptionist lives beneath it at /app/operator/phone.
    exactPaths: ['/app/operator'],
  },
  marketing: {
    label: 'Marketing SMS & reviews',
    paths: ['/app/marketing', '/app/reviews'],
  },
  hiring: {
    label: 'Hiring',
    paths: ['/app/hiring'],
  },
  reports: {
    label: 'Reports & attribution',
    paths: ['/app/analytics'],
  },
  roadmap: {
    label: 'Coming-soon previews',
    paths: ['/app/coming-soon'],
  },
} as const satisfies Record<string, { label: string; paths: readonly string[]; exactPaths?: readonly string[] }>;

export type HideableArea = keyof typeof HIDEABLE_AREAS;
export const HIDEABLE_AREA_KEYS = Object.keys(HIDEABLE_AREAS) as HideableArea[];

// Default visibility per surface. The receptionist surface hides every
// hideable area; the full surface shows everything (today's behaviour).
const SURFACE_DEFAULTS: Record<ProductSurface, Record<HideableArea, boolean>> = {
  receptionist: Object.fromEntries(HIDEABLE_AREA_KEYS.map((key) => [key, false])) as Record<HideableArea, boolean>,
  full: Object.fromEntries(HIDEABLE_AREA_KEYS.map((key) => [key, true])) as Record<HideableArea, boolean>,
};

export type WorkspaceFeatures = {
  surface: ProductSurface;
  areas: Record<HideableArea, boolean>;
};

// Unknown or malformed values fall back to the full product: a bad flag
// should never make working features disappear.
export function normalizeSurface(value: unknown): ProductSurface {
  return value === 'receptionist' ? 'receptionist' : 'full';
}

export function resolveWorkspaceFeatures(surface: unknown, overrides: unknown): WorkspaceFeatures {
  const resolvedSurface = normalizeSurface(surface);
  const areas = { ...SURFACE_DEFAULTS[resolvedSurface] };
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
      if (key in areas && typeof value === 'boolean') areas[key as HideableArea] = value;
    }
  }
  return { surface: resolvedSurface, areas };
}

export const FULL_PRODUCT_FEATURES: WorkspaceFeatures = resolveWorkspaceFeatures('full', {});

// The hideable area an app path belongs to, or null if it is always shown.
// `paths` match the path itself and anything beneath it (e.g. /app/jobs/<id>);
// `exactPaths` match only themselves.
export function areaForPath(path: string): HideableArea | null {
  for (const key of HIDEABLE_AREA_KEYS) {
    const area: { paths: readonly string[]; exactPaths?: readonly string[] } = HIDEABLE_AREAS[key];
    if (area.exactPaths?.includes(path)) return key;
    if (area.paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return key;
  }
  return null;
}

export function isPathVisible(path: string, features: WorkspaceFeatures | null | undefined): boolean {
  const area = areaForPath(path);
  if (!area) return true;
  return (features ?? FULL_PRODUCT_FEATURES).areas[area];
}
