#!/usr/bin/env node
// Automated setup self-check: prints exactly what is configured, what is
// missing, and the manual dashboard actions that remain. Prints key NAMES
// only — never values.
import fs from 'node:fs';

const lines = [];
const push = (state, text) => lines.push(`${state}  ${text}`);
const ok = (text) => push('[ok]     ', text);
const todo = (text) => push('[todo]   ', text);
const info = (text) => push('[info]   ', text);

// 1. Environment
const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
} else {
  todo('.env file missing — copy .env.example to .env');
}

const envChecks = [
  ['VITE_SUPABASE_URL', 'Supabase browser URL'],
  ['VITE_SUPABASE_ANON_KEY', 'Supabase publishable key'],
];
for (const [name, label] of envChecks) {
  if (env[name] && !/YOUR_|REPLACE|missing/i.test(env[name])) ok(`${label} configured`);
  else todo(`${label} — set ${name} in .env`);
}

const serverSecrets = [
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase service-role key', 'trusted audit writes, notifications, team invites, automation executor, booking persistence'],
  ['STRIPE_SECRET_KEY', 'Stripe secret key', 'billing checkout + invoice payment links'],
  ['STRIPE_WEBHOOK_SECRET', 'Stripe webhook secret', 'payment confirmation'],
  ['STRIPE_PRICE_STARTER', 'Stripe Starter price ID', 'billing'],
  ['STRIPE_PRICE_GROWTH', 'Stripe Growth price ID', 'billing'],
  ['STRIPE_PRICE_OPERATOR', 'Stripe Operator price ID', 'billing'],
  ['TWILIO_ACCOUNT_SID', 'Twilio Account SID', 'SMS inbox + campaigns + AI receptionist'],
  ['TWILIO_AUTH_TOKEN', 'Twilio auth token', 'SMS + receptionist'],
  ['TWILIO_PHONE_NUMBER', 'Twilio business number', 'SMS + receptionist'],
  ['OPENAI_API_KEY', 'OpenAI API key', 'AI receptionist replies, AI features, Brain extraction'],
  ['EMAIL_API_KEY', 'Transactional email API key', 'quote/invoice email delivery'],
  ['EMAIL_FROM', 'Email from address', 'quote/invoice email delivery'],
];
for (const [name, label, unlocks] of serverSecrets) {
  if (env[name] && !/YOUR_|REPLACE|missing/i.test(env[name])) ok(`${label} configured`);
  else todo(`${label} — set ${name} in .env (unlocks: ${unlocks})`);
}

// 2. Manual dashboard actions
info('Supabase dashboard: apply migration supabase/migrations/0020_public_document_links.sql (SQL editor)');
info('Supabase dashboard: Authentication > Policies > enable leaked-password protection');
info('GitHub: consider flipping the repo to Private (it is currently public)');
info('Staging: create a separate Supabase project + .env.staging before any Worker deploy');

// 3. Deployment readiness (production boot fails closed without the core ones)
const coreSecrets = ['SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const missingCore = coreSecrets.filter((name) => !env[name]);
if (missingCore.length) info(`Production deploy gate: ${missingCore.join(', ')} still required (boot fails closed by design)`);

console.log('Jobrin.ai setup self-check\n');
lines.forEach((line) => console.log(line));
const todoCount = lines.filter((l) => l.startsWith('[todo]')).length;
console.log(`\n${lines.filter((l) => l.startsWith('[ok]')).length} configured, ${todoCount} to do, ${lines.filter((l) => l.startsWith('[info]')).length} manual steps`);
process.exit(0);
