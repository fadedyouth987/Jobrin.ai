import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FULL_PRODUCT_FEATURES, HIDEABLE_AREAS, HIDEABLE_AREA_KEYS, areaForPath, isPathVisible, normalizeSurface, resolveWorkspaceFeatures,
} from '../shared/features';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const receptionist = resolveWorkspaceFeatures('receptionist', {});

test('the receptionist surface hides every hideable area; full shows them all', () => {
  for (const key of HIDEABLE_AREA_KEYS) {
    assert.equal(receptionist.areas[key], false, key);
    assert.equal(FULL_PRODUCT_FEATURES.areas[key], true, key);
  }
});

test('the receptionist journey stays visible on the receptionist surface', () => {
  for (const path of ['/app', '/app/inbox', '/app/notifications', '/app/leads', '/app/customers', '/app/customers/0a000000-0000-4000-8000-00000000000a',
    '/app/schedule', '/app/operator/phone', '/app/operator/phone/calls', '/app/brain', '/app/knowledge', '/app/approvals',
    '/app/integrations', '/app/team', '/app/billing', '/app/settings', '/app/settings/security', '/app/settings/services']) {
    assert.equal(isPathVisible(path, receptionist), true, path);
  }
});

test('hidden areas cover their detail pages, and the phone receptionist is not mistaken for the Operator log', () => {
  assert.equal(areaForPath('/app/jobs'), 'field_jobs');
  assert.equal(areaForPath('/app/jobs/0a000000-0000-4000-8000-00000000000a'), 'field_jobs');
  assert.equal(areaForPath('/app/coming-soon/gps-dispatch'), 'roadmap');
  assert.equal(areaForPath('/app/operator'), 'ai_admin');
  assert.equal(areaForPath('/app/operator/phone'), null);
  // Prefix matching is by path segment, not by string prefix.
  assert.equal(areaForPath('/app/jobsite'), null);
  for (const path of ['/app/jobs', '/app/quotes', '/app/invoices', '/app/payments', '/app/automations', '/app/admin-chat',
    '/app/marketing', '/app/reviews', '/app/hiring', '/app/analytics', '/app/purchasing', '/app/coming-soon/voicemail']) {
    assert.equal(isPathVisible(path, receptionist), false, path);
  }
});

test('per-workspace overrides switch single areas back on; junk is ignored', () => {
  const features = resolveWorkspaceFeatures('receptionist', { quotes_invoices: true, made_up_area: true, hiring: 'yes', automations: null });
  assert.equal(features.areas.quotes_invoices, true);
  assert.equal(features.areas.hiring, false);
  assert.equal(features.areas.automations, false);
  assert.ok(!('made_up_area' in features.areas));
  assert.equal(resolveWorkspaceFeatures('full', { marketing: false }).areas.marketing, false);
  assert.deepEqual(resolveWorkspaceFeatures('receptionist', ['quotes_invoices']).areas, receptionist.areas);
});

test('unknown, missing or malformed settings fail open to the full product', () => {
  assert.equal(normalizeSurface(undefined), 'full');
  assert.equal(normalizeSurface('RECEPTIONIST'), 'full');
  assert.equal(normalizeSurface(42), 'full');
  assert.deepEqual(resolveWorkspaceFeatures(null, null), FULL_PRODUCT_FEATURES);
  assert.equal(isPathVisible('/app/quotes', undefined), true);
  assert.equal(isPathVisible('/app/quotes', null), true);
});

test('every navigation entry is either always shown or belongs to exactly one hideable area', async () => {
  const nav = await source('src/app/workspaceNavigation.tsx');
  const hrefs = [...nav.matchAll(/\['(\/app[^']*)'/g)].map((match) => match[1]);
  assert.ok(hrefs.length > 30, 'parsed the navigation table');
  for (const href of hrefs) {
    const owners = HIDEABLE_AREA_KEYS.filter((key) => {
      const area: { paths: readonly string[]; exactPaths?: readonly string[] } = HIDEABLE_AREAS[key];
      return area.exactPaths?.includes(href) || area.paths.some((prefix) => href === prefix || href.startsWith(`${prefix}/`));
    });
    assert.ok(owners.length <= 1, `${href} is claimed by ${owners.join(', ')}`);
  }
  // Spot-check that the receptionist surface leaves a usable app.
  const visible = hrefs.filter((href) => isPathVisible(href, receptionist));
  for (const required of ['/app/leads', '/app/operator/phone', '/app/team', '/app/billing', '/app/settings']) {
    assert.ok(visible.includes(required), required);
  }
});

test('the shell filters every menu and the router by the workspace features', async () => {
  const shell = await source('src/pages/AppShell.tsx');
  assert.match(shell, /visibleWorkspaceGroups\(auth\.workspace\?\.role,features\)/);
  assert.match(shell, /visibleRail\(auth\.workspace\?\.role,features\)/);
  assert.match(shell, /visibleMobileTabs\(auth\.workspace\?\.role,features\)/);
  assert.match(shell, /routeWorkspacePage\(path,features\)/);
  // The palette is built from the filtered groups, not the raw table.
  assert.match(shell, /paletteItems: NavItem\[\] = visibleGroups\.flatMap/);
  assert.doesNotMatch(shell, /primaryRail\.map/);
  const nav = await source('src/app/workspaceNavigation.tsx');
  assert.match(nav, /if \(!isPathVisible\(path, features\)\) return <AreaHiddenPage path=\{path\}\/>;/);
});

test('the workspace list exposes features and fails open when the columns are missing', async () => {
  const route = await source('server/routes/workspaces.ts');
  assert.match(route, /select\('id,product_surface,feature_overrides'\)/);
  assert.match(route, /featuresById\.get\(workspace\.id\) \?\? FULL_PRODUCT_FEATURES/);
  // The core membership query must not depend on the new columns, or a
  // deploy ahead of the migration would empty everyone's workspace list.
  assert.match(route, /select\('role,status,workspaces\(id,name,slug,plan,owner_user_id,created_at,updated_at\)'\)/);
});

test('the product surface is server-controlled and existing workspaces keep the full product', async () => {
  const migration = await source('supabase/migrations/20261106000000_workspace_product_surface.sql');
  const addAt = migration.indexOf("add column if not exists product_surface text not null default 'full'");
  const switchAt = migration.indexOf("alter column product_surface set default 'receptionist'");
  assert.ok(addAt > 0 && switchAt > addAt, 'backfill to full happens before the default changes');
  assert.match(migration, /revoke update \(product_surface, feature_overrides\) on public\.workspaces from authenticated, anon;/);
});
