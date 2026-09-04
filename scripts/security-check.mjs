import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  '.env.example',
  'server/env.ts',
  'server/security.ts',
  'server/supabase.ts',
  'server/routes/billing.ts',
  'supabase/migrations/0003_revenue_os_core.sql',
  'supabase/migrations/0004_subscription_and_tenant_invariants.sql',
  'supabase/migrations/0005_least_privilege_rbac.sql',
  'supabase/migrations/0006_usage_metering.sql',
  'supabase/migrations/0007_secure_invoice_payment_settlement.sql',
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing required security file: ${file}`);
}

const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
for (const secret of ['SUPABASE_SERVICE_ROLE_KEY=', 'STRIPE_SECRET_KEY=', 'STRIPE_WEBHOOK_SECRET=']) {
  if (!envExample.includes(secret)) throw new Error(`Missing environment placeholder: ${secret}`);
}

const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs|sql)$/.test(entry.name)) sourceFiles.push(full);
  }
}
walk(root);

const forbiddenPatterns = [
  [/sk_live_[A-Za-z0-9]+/, 'live Stripe secret'],
  [/rk_live_[A-Za-z0-9]+/, 'live Stripe restricted key'],
  [/service_role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/i, 'embedded Supabase service-role token'],
];
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(text)) throw new Error(`Possible ${label} in ${path.relative(root, file)}`);
  }
}

const billing = fs.readFileSync(path.join(root, 'server/routes/billing.ts'), 'utf8');
for (const requiredText of ['constructEvent', 'claim_stripe_webhook_event', 'apply_subscription_state', 'settle_stripe_invoice_payment', "session.payment_status !== 'paid'"]) {
  if (!billing.includes(requiredText)) throw new Error(`Stripe webhook hardening missing: ${requiredText}`);
}

const security = fs.readFileSync(path.join(root, 'server/security.ts'), 'utf8');
for (const requiredText of ['helmet(', 'rateLimit(', 'cors(']) {
  if (!security.includes(requiredText)) throw new Error(`API hardening missing: ${requiredText}`);
}

const migration = fs.readFileSync(path.join(root, 'supabase/migrations/0003_revenue_os_core.sql'), 'utf8');
for (const requiredText of ['enable row level security', 'claim_stripe_webhook_event', 'apply_subscription_state']) {
  if (!migration.toLowerCase().includes(requiredText.toLowerCase())) throw new Error(`Database hardening missing: ${requiredText}`);
}

console.log(`Security source check passed (${sourceFiles.length} source files scanned).`);
