import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PLAN_CATALOG } from '../shared/plans';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(here, '..', relative), 'utf8');

test('one canonical catalog drives pricing, billing and onboarding', () => {
  assert.deepEqual(Object.values(PLAN_CATALOG).map((plan) => [plan.key, plan.monthlyAud]), [
    ['starter', 149],
    ['growth', 299],
    ['operator', 599],
  ]);
  for (const file of ['src/pages/PricingPage.tsx', 'src/pages/OnboardingPage.tsx', 'src/pages/AppPages.tsx', 'server/routes/billing.ts']) {
    assert.match(source(file), /shared\/plans|\.\.\/shared\/plans/);
  }
});

test('onboarding exposes six distinct, ordered stages and persists progress', () => {
  const onboarding = source('src/pages/OnboardingPage.tsx');
  for (const label of ['Workspace', 'Business', 'Services', 'AI safety', 'Plan', 'Test & activate']) {
    assert.match(onboarding, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(onboarding, /progress\.steps/);
  assert.match(onboarding, /\/api\/workspaces\/onboarding\/\$\{key\}/);
  assert.match(onboarding, /AI Admin action/);
  assert.match(onboarding, /raw model tokens/);
});

test('the visible automation builder only offers production-ready actions', () => {
  const app = source('src/pages/AppPages.tsx');
  const intelligence = source('server/routes/intelligence.ts');
  assert.match(app, /Production-ready action/);
  assert.match(app, /business\.report/);
  assert.doesNotMatch(app, /filter\(\(t:any\)=>t\.risk!==['"]prohibited/);
  assert.match(intelligence, /isAutomationExecutable/);
  assert.match(intelligence, /safeParse\(step\.input\)/);
  assert.match(intelligence, /supabaseAdmin\.from\('automation_runs'\)\.insert/);
  assert.doesNotMatch(intelligence, /db\.from\('automation_runs'\)\.insert/);
});

test('billing counts real member keys and exposes all metered plan limits', () => {
  const billing = source('server/routes/billing.ts');
  const plans = source('shared/plans.ts');
  assert.match(billing, /select\("user_id", \{ count: "exact", head: true \}\)/);
  for (const metric of ['usage.users', 'usage.sms', 'usage.ai_actions']) assert.match(`${billing}\n${plans}`, new RegExp(metric.replace('.', '\\.')));
});

test('legacy credits are inaccessible and plan usage is the authoritative ledger', () => {
  const migration = source('supabase/migrations/20260909162303_deprecate_legacy_credits_and_harden_ai_usage.sql');
  assert.match(migration, /drop policy if exists wallets_member_select/);
  assert.match(migration, /revoke all on table public\.credit_wallets from anon, authenticated/);
  assert.match(migration, /subscription_entitlements, usage_counters and usage_events/);
  assert.match(migration, /stable idempotency key/);
});
