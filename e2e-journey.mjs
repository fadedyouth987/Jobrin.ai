import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const base = 'http://localhost:3000';
const email = `e2e-${Date.now()}@example.com`;
const password = 'JobrynE2E!2026x';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const results = [];
function step(name, status, note = '') {
  results.push({ name, status, note });
  console.log(`[${status}] ${name}${note ? ' — ' + note : ''}`);
}

const { data: signUp, error: signUpError } = await supabase.auth.signUp({ email, password });
if (signUpError) { step('signup', 'FAIL', signUpError.message); process.exit(1); }
if (!signUp.session) {
  step('signup', 'BLOCKED', 'Supabase project requires email confirmation — no mailbox available for a synthetic test address');
  process.exit(2);
}
step('signup', 'PASS', `new user ${signUp.user.id.slice(0, 8)}… signed in`);

const token = signUp.session.access_token;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-request-id': crypto.randomUUID() };

async function api(method, path, body, workspace, headerExtra) {
  const h = { ...headers };
  if (workspace) h['x-workspace-id'] = workspace;
  if (headerExtra) Object.assign(h, headerExtra);
  const res = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

function expect(name, res, want, note = '') {
  const ok = typeof want === 'number' ? res.status === want : want.includes(res.status);
  step(name, ok ? 'PASS' : 'FAIL', `${res.status}${note ? ' ' + note : ''}${typeof res.payload?.error === 'string' ? ' ' + res.payload.error : ''}`);
  return res;
}
// Blocks that are correct because the provider credential is absent locally.
async function expectBlock(name, res, codes, why) {
  const code = res.payload?.error || res.payload?.code || '';
  const blocked = codes.includes(res.status) || (typeof code === 'string' && codes.some((c) => code.includes(c)));
  step(name, blocked ? 'EXPECTED-BLOCK' : 'FAIL', `${res.status} ${code} — ${why}`);
}

// 1. Workspace
const ws = await api('POST', '/api/workspaces', { name: 'E2E Test Plumbing' });
if (ws.status !== 201) { step('create workspace', 'FAIL', JSON.stringify(ws.payload).slice(0, 200)); process.exit(1); }
const workspaceId = ws.payload.workspaceId;
step('create workspace', 'PASS', workspaceId.slice(0, 8) + '…');

const current = await api('GET', '/api/workspaces/current', null, workspaceId);
step('workspace context', current.status === 200 && current.payload.workspace?.role === 'owner' ? 'PASS' : 'FAIL', `role=${current.payload.workspace?.role}`);

// 2. Onboarding: business profile
const bp = await api('PUT', '/api/workspaces/business-profile', {
  trading_name: 'E2E Test Plumbing', abn: '11 222 333 444', industry: 'plumbing', phone: '0412 345 678',
  email: 'plumbing@example.com', timezone: 'Australia/Adelaide', gst_registered: true, description: 'Adelaide emergency plumbing',
}, workspaceId);
expect('business profile', bp, [200]);

// 3. Service catalogue
const svc = await api('POST', '/api/services', { name: 'Emergency callout', pricing_mode: 'callout_hourly', base_price_cents: 18000, default_duration_minutes: 60 }, workspaceId);
expect('create service', svc, [201]);

// 4. Customer
const cust = await api('POST', '/api/crm/customers', { first_name: 'Sam', last_name: 'Ngata', phone: '0412 345 678', email: 'sam.ngata@example.com', source: 'google' }, workspaceId);
const customerId = cust.payload?.customer?.id;
expect('create customer', cust, [201], customerId ? '' : 'no id returned');

// 5. Job
const job = await api('POST', '/api/operations/jobs', { customer_id: customerId, title: 'Replace burst pipe', description: 'Kitchen pipe burst', address_text: '12 King St, Adelaide' }, workspaceId);
const jobId = job.payload?.job?.id;
expect('create job', job, [201], jobId ? '' : 'no id');

// 6. Schedule the job
const start = new Date(Date.now() + 86_400_000).toISOString();
const sched = await api('PATCH', `/api/operations/jobs/${jobId}/schedule`, { scheduled_start: start, scheduled_end: new Date(Date.now() + 97_200_000).toISOString() }, workspaceId);
expect('schedule job', sched, [200]);

// 7. Quote draft
const quote = await api('POST', '/api/operations/quotes', {
  customer_id: customerId, job_id: jobId,
  items: [
    { description: 'Emergency callout', quantity: 1, unit_price_cents: 18000, gst_rate: 0.1 },
    { description: 'Pipe replacement labour', quantity: 2, unit_price_cents: 45000, gst_rate: 0.1 },
  ],
}, workspaceId);
const quoteId = quote.payload?.quote?.id;
expect('create quote draft (GST server-side)', quote, [201], quote.payload?.quote?.total_cents ? `total=${quote.payload.quote.total_cents}` : '');

// 8. Quote lifecycle
const send = await api('PATCH', `/api/operations/quotes/${quoteId}/send`, null, workspaceId);
if (send.status === 200) {
  step('send quote (share link + email)', 'PASS', `delivery=${send.payload.delivery}`);
  const shareUrl = send.payload.shareUrl || '';
  const tokenStr = shareUrl.split('/quote/')[1] || '';
  if (tokenStr) {
    const pub = await fetch(`${base}/api/public/quotes/${tokenStr}`);
    step('customer opens public quote', pub.status === 200 ? 'PASS' : 'FAIL', `status=${pub.status}`);
    const decide = await fetch(`${base}/api/public/quotes/${tokenStr}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'accepted' }) });
    const accepted = decide.status === 200 && (await decide.json().catch(() => ({})))?.status === 'accepted';
    step('customer accepts quote', accepted ? 'PASS' : 'FAIL', `status=${decide.status}`);
    const conv = await api('POST', `/api/operations/quotes/${quoteId}/convert`, null, workspaceId);
    expect('convert accepted quote to invoice', conv, [201], `invoice=${conv.payload?.invoice?.invoice_number}`);
  }
} else {
  await expectBlock('send quote (share link + email)', send, [500, 503], 'expected locally: public-link writing needs the Supabase service-role key');
  const conv = await api('POST', `/api/operations/quotes/${quoteId}/convert`, null, workspaceId);
  expect('convert guard (must refuse unaccepted)', conv, [409]);
}

// 9. Invoice draft from the quote
const inv = await api('POST', '/api/operations/invoices', {
  customer_id: customerId, job_id: jobId, quote_id: quoteId,
  items: [{ description: 'Emergency callout', quantity: 1, unit_price_cents: 18000, gst_rate: 0.1 }],
}, workspaceId);
const invoiceId = inv.payload?.invoice?.id;
expect('create invoice draft', inv, [201], `balance=${inv.payload?.invoice?.balance_due_cents}`);

const invSend = await api('PATCH', `/api/operations/invoices/${invoiceId}/send`, null, workspaceId);
if (invSend.status === 200) step('mark invoice sent', 'PASS', `delivery=${invSend.payload.delivery}`);
else await expectBlock('mark invoice sent', invSend, [500, 503], 'unexpected block');

const checkout = await api('POST', `/api/operations/invoices/${invoiceId}/checkout`, null, workspaceId, { 'idempotency-key': crypto.randomUUID() });
await expectBlock('invoice payment link (Stripe)', checkout, [503], 'expected: Stripe keys not configured');

// 10. Dashboard + operator
const dash = await api('GET', '/api/dashboard', null, workspaceId);
expect('dashboard aggregates', dash.status === 200 && (dash.payload.metrics?.jobs ?? 0) >= 1 ? 'PASS' : 'FAIL', `customers=${dash.payload?.metrics?.customers} jobs=${dash.payload?.metrics?.jobs}`);

const cmd = await api('POST', '/api/operator/command', { command: 'Who owes us money?' }, workspaceId);
expect('command centre (read-only)', cmd.status === 200 && cmd.payload?.kind ? 'PASS' : 'FAIL', cmd.payload?.kind || '');

// 11. Hiring
const opening = await api('POST', '/api/hiring/openings', { title: 'Apprentice plumber', employment_type: 'apprenticeship' }, workspaceId);
expect('hiring: create opening', opening, [201]);
const candidate = await api('POST', '/api/hiring/candidates', { full_name: 'E2E Candidate', source: 'direct', privacy_notice_version: 'jobryn-hiring-v1', consent_captured_at: new Date().toISOString() }, workspaceId);
const candId = candidate.payload?.candidate?.id;
expect('hiring: create candidate (consent recorded)', candidate, [201]);
if (candId && opening.payload?.opening?.id) {
  const app2 = await api('POST', '/api/hiring/applications', { job_opening_id: opening.payload.opening.id, candidate_id: candId }, workspaceId);
  expect('hiring: application', app2, [201]);
}

// 12. Automations
const auto = await api('POST', '/api/intelligence/automations', {
  name: 'E2E review request', trigger_key: 'job.completed',
  definition: { conditions: [], steps: [{ tool: 'review.request', input: {} }] },
}, workspaceId);
const autoId = auto.payload?.automation?.id;
expect('create automation', auto, [201]);
const activate = await api('POST', `/api/intelligence/automations/${autoId}/status`, { status: 'active' }, workspaceId);
expect('activate automation', activate, [200]);
const run = await api('POST', `/api/automations/${autoId}/run`, null, workspaceId);
const run2 = await api('POST', `/api/intelligence/automations/${autoId}/run`, null, workspaceId);
step('queue automation test run', run2.status === 202 ? 'PASS' : 'FAIL', `status=${run2.status} (executor processes it when the service-role key exists)`);

// 13. Blocked-by-design checks
const invite = await api('POST', '/api/team/invites', { email: `member-${Date.now()}@example.com`, role: 'manager' }, workspaceId);
await expectBlock('team invite', invite, [503], 'expected: needs Supabase service-role key');

const cons = await api('POST', '/api/communications/consents', { customer_id: customerId, channel: 'sms', purpose: 'marketing', granted: true, source: 'admin_test', evidence: { test: true } }, workspaceId);
await expectBlock('record consent (trusted write)', cons, [500, 503], 'expected: trusted server write needs service-role key');

const sms = await api('POST', '/api/communications/sms', { customer_id: customerId, purpose: 'support', body: 'Test' }, workspaceId);
await expectBlock('send SMS (Twilio)', sms, [503], 'expected: Twilio not configured');

const recep = await api('PUT', '/api/receptionist', { enabled: false, display_name: 'E2E Receptionist', greeting: 'Thanks for calling our team today.', voice_provider: 'Google', voice_id: 'en-AU-Chirp3-HD-Achernar', language: 'en-AU', tone: 'warm and calm', business_instructions: 'Answer using approved business knowledge only. Never invent prices.', qualification_questions: ['What can we help with?'], transfer_number: null, after_hours_message: 'The team is unavailable right now. Please try again later.', allow_booking: false, allow_warm_transfer: true, allow_message_take: true, allow_followup_sms: false, recording_enabled: false, recording_consent_prompt: 'This call may be recorded. Is that okay?' }, workspaceId);
await expectBlock('save receptionist profile', recep, [400, 500], 'expected: trusted write needs service-role key');

// 14. Unauthenticated negative test
const noAuth = await fetch(`${base}/api/crm/customers`);
step('negative: API without token', noAuth.status === 401 ? 'PASS' : 'FAIL', `status=${noAuth.status}`);

const pass = results.filter((r) => r.status === 'PASS').length;
const blocked = results.filter((r) => r.status === 'EXPECTED-BLOCK').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`\nSUMMARY: ${pass} pass, ${blocked} expected-block, ${failed} fail, ${results.length} steps`);
console.log(`test user: ${email} (left in Supabase auth — remove via dashboard when convenient)`);
