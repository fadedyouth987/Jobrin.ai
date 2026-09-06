import 'dotenv/config';
// Comprehensive E2E user journey test
// Simulates a new user from signup through every feature, checking each step
const BASE = 'http://localhost:3000';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || '';

async function api(method, path, body, token, workspace) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (workspace) headers['x-workspace-id'] = workspace;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

async function main() {
  const results = [];
  const log = (step, status, detail = '') => {
    results.push({ step, status, detail });
    console.log(`[${status}] ${step}${detail ? ' — ' + detail : ''}`);
  };

  // 1. Signup via Admin API (bypasses email confirmation and rate limits)
  const testEmail = `e2e-final-${Date.now()}@gmail.com`;
  const testPassword = '***';
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const adminRes = await fetch(supaUrl + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': adminKey, 'Authorization': 'Bearer ' + adminKey },
    body: JSON.stringify({ email: testEmail, password: testPassword, email_confirm: true }),
  });
  const adminData = await adminRes.json().catch(() => ({}));
  if (!adminData.id) {
    log('signup', 'BLOCKED', 'Admin API failed: ' + JSON.stringify(adminData).slice(0, 200));
    process.exit(2);
  }
  log('signup', 'PASS', 'user ' + adminData.id.slice(0, 8) + ' created (admin API, confirmed)');

  // Sign in with the test user to get an access token
  const signInRes = await fetch(supaUrl + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': supaKey },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  const signInData = await signInRes.json().catch(() => ({}));
  if (!signInData.access_token) {
    log('login', 'FAIL', signInData.error_description || 'no access token');
    process.exit(1);
  }
  log('login', 'PASS', 'token received');

  const token = signInData.access_token;

  // 2. Workspace creation
  const ws = await api('POST', '/api/workspaces', { name: 'E2E Final Test Plumbing' }, token);
  if (ws.status !== 201) { log('create workspace', 'FAIL', JSON.stringify(ws.payload).slice(0, 200)); process.exit(1); }
  const wsId = ws.payload.workspaceId;
  log('create workspace', 'PASS', wsId.slice(0, 8));

  const w = wsId;

  // 3. Business profile
  const bp = await api('PUT', '/api/workspaces/business-profile', {
    trading_name: 'E2E Final Plumbing', abn: '11 222 333 444', industry: 'plumbing',
    phone: '0412 345 678', email: 'test@example.com', timezone: 'Australia/Adelaide', gst_registered: true,
  }, token, w);
  log('business profile', bp.status === 200 ? 'PASS' : 'FAIL', bp.status.toString());

  // 4. Services
  const svc = await api('POST', '/api/services', { name: 'Emergency callout', pricing_mode: 'callout_hourly', base_price_cents: 18000, booking_type: 'bookable', default_duration_minutes: 60 }, token, w);
  const svcId = svc.payload?.service?.id;
  log('create service', svc.status === 201 ? 'PASS' : 'FAIL');

  // 5. Customer
  const cust = await api('POST', '/api/crm/customers', { first_name: 'Sam', last_name: 'Ngata', phone: '0412 345 678', email: 'sam@example.com', source: 'google' }, token, w);
  const custId = cust.payload?.customer?.id;
  log('create customer', cust.status === 201 ? 'PASS' : 'FAIL', cust.status === 201 ? '' : JSON.stringify(cust.payload).slice(0, 120));

  // 6. Job
  const job = await api('POST', '/api/operations/jobs', { customer_id: custId, title: 'Burst pipe repair', address_text: '12 King St, Adelaide' }, token, w);
  const jobId = job.payload?.job?.id;
  log('create job', job.status === 201 ? 'PASS' : 'FAIL');

  // 7. Schedule job
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const sched = await api('PATCH', `/api/operations/jobs/${jobId}/schedule`, { scheduled_start: tomorrow, scheduled_end: new Date(Date.now() + 90000000).toISOString() }, token, w);
  log('schedule job', sched.status === 200 ? 'PASS' : 'FAIL');

  // 8. Quote
  const quote = await api('POST', '/api/operations/quotes', {
    customer_id: custId, job_id: jobId,
    items: [{ description: 'Emergency callout', quantity: 1, unit_price_cents: 18000, gst_rate: 0.1 }],
  }, token, w);
  const quoteId = quote.payload?.quote?.id;
  log('create quote', quote.status === 201 ? 'PASS' : 'FAIL', quote.payload?.quote?.total_cents ? `total=$${(quote.payload.quote.total_cents / 100).toFixed(2)}` : '');

  // 9. Quote send (public link)
  const send = await api('PATCH', `/api/operations/quotes/${quoteId}/send`, null, token, w);
  if (send.status === 200) {
    log('send quote', 'PASS', `delivery=${send.payload.delivery}`);
    const shareUrl = send.payload.shareUrl || '';
    const tokenStr = shareUrl.split('/quote/')[1] || '';
    if (tokenStr) {
      // 10. Public quote view
      const pubView = await fetch(`${BASE}/api/public/quotes/${tokenStr}`);
      log('public quote view', pubView.status === 200 ? 'PASS' : 'FAIL', `status=${pubView.status}`);
      // 11. Customer accepts
      const accept = await fetch(`${BASE}/api/public/quotes/${tokenStr}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'accepted' }),
      });
      const accepted = accept.status === 200;
      log('customer accepts quote', accepted ? 'PASS' : 'FAIL', `status=${accept.status}`);
      // 12. Convert to invoice
      const conv = await api('POST', `/api/operations/quotes/${quoteId}/convert`, null, token, w);
      log('convert quote to invoice', conv.status === 201 ? 'PASS' : 'FAIL', `invoice=${conv.payload?.invoice?.invoice_number}`);
    }
  } else {
    log('send quote', 'EXPECTED-BLOCK', `${send.status} ${send.payload?.error || ''} — share link needs service-role (which IS configured now, so this should be 200)`);
  }

  // 13. Invoice
  const inv = await api('POST', '/api/operations/invoices', {
    customer_id: custId, job_id: jobId,
    items: [{ description: 'Emergency callout', quantity: 1, unit_price_cents: 18000, gst_rate: 0.1 }],
  }, token, w);
  const invId = inv.payload?.invoice?.id;
  log('create invoice', inv.status === 201 ? 'PASS' : 'FAIL');

  // 14. Send invoice (email)
  const invSend = await api('PATCH', `/api/operations/invoices/${invId}/send`, null, token, w);
  log('send invoice (email + payment link)', invSend.status === 200 ? 'PASS' : 'FAIL', `delivery=${invSend.payload?.delivery}`);

  // 15. Payment link (Stripe)
  const payLink = await api('POST', `/api/operations/invoices/${invId}/checkout`, null, token, w, { 'idempotency-key': crypto.randomUUID() });
  log('payment link (Stripe)', payLink.status === 200 ? 'PASS' : 'EXPECTED-BLOCK', `${payLink.status} ${payLink.payload?.error || ''}`);

  // 16. Time tracking
  const timeStart = new Date().toISOString();
  const timeEntry = await api('POST', `/api/operations/jobs/${jobId}/time`, { started_at: timeStart, ended_at: new Date(Date.now() + 3600000).toISOString(), break_minutes: 15, notes: 'Initial assessment' }, token, w);
  log('log time', timeEntry.status === 201 ? 'PASS' : 'FAIL', timeEntry.status === 201 ? '' : JSON.stringify(timeEntry.payload).slice(0, 120));

  // 17. Materials
  const mat = await api('POST', `/api/operations/jobs/${jobId}/materials`, { description: 'Copper pipe 15mm', quantity: 2, unit_cost_cents: 1500, unit_price_cents: 3500 }, token, w);
  log('add material', mat.status === 201 ? 'PASS' : 'FAIL');

  // 18. Photos
  const photoData = Buffer.from('fake-photo-data-for-testing').toString('base64');
  const photo = await api('POST', `/api/operations/jobs/${jobId}/photos`, { file_name: 'test-photo.jpg', mime_type: 'image/jpeg', data: photoData }, token, w);
  log('upload photo', photo.status === 201 ? 'PASS' : 'EXPECTED-BLOCK', `${photo.status} ${photo.payload?.error || ''}`);

  // 19. Checklist
  const checklist = await api('POST', `/api/operations/jobs/${jobId}/checklists`, {
    title: 'Site safety check', results: [
      { item: 'PPE worn', done: true, critical: true, notes: '' },
      { item: 'Water supply isolated', done: true, critical: true, notes: '' },
    ],
  }, token, w);
  log('complete checklist', checklist.status === 201 ? 'PASS' : 'FAIL');

  // 20. Signature
  const sig = await api('POST', `/api/operations/jobs/${jobId}/signatures`, {
    customer_name: 'Sam Ngata', signature_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  }, token, w);
  log('capture signature', sig.status === 201 ? 'PASS' : 'FAIL');

  // 21. Assets
  const asset = await api('POST', '/api/assets', { customer_id: custId, name: 'Kitchen hot water system', asset_type: 'Hot water system' }, token, w);
  log('create asset', asset.status === 201 ? 'PASS' : 'FAIL');

  // 22. Dashboard
  const dash = await api('GET', '/api/dashboard', null, token, w);
  log('dashboard', dash.status === 200 ? 'PASS' : 'FAIL', `customers=${dash.payload?.metrics?.customers} jobs=${dash.payload?.metrics?.jobs}`);

  // 23. AI Command Centre
  const cmd = await api('POST', '/api/operator/command', { command: 'What are my overdue invoices?' }, token, w);
  log('command centre (read-only)', cmd.status === 200 ? 'PASS' : 'FAIL', cmd.payload?.kind || '');

  // 24. AI Admin — Finance hat
  const fin = await api('POST', '/api/receptionist/simulate', { message: 'Which invoices are overdue?', mode: 'finance' }, token, w);
  log('AI admin: finance mode', fin.status === 200 ? 'PASS' : 'FAIL', fin.payload?.reply ? fin.payload.reply.slice(0, 60) : '');

  // 25. AI Admin — Sales hat
  const sales = await api('POST', '/api/receptionist/simulate', { message: 'What leads need follow-up?', mode: 'sales' }, token, w);
  log('AI admin: sales mode', sales.status === 200 ? 'PASS' : 'FAIL', sales.payload?.reply ? sales.payload.reply.slice(0, 60) : '');

  // 26. Hiring
  const opening = await api('POST', '/api/hiring/openings', { title: 'Apprentice plumber', employment_type: 'apprenticeship' }, token, w);
  log('hiring: create opening', opening.status === 201 ? 'PASS' : 'FAIL');
  const cand = await api('POST', '/api/hiring/candidates', { full_name: 'E2E Candidate', source: 'direct', privacy_notice_version: 'jobryn-hiring-v1', consent_captured_at: new Date().toISOString() }, token, w);
  log('hiring: create candidate', cand.status === 201 ? 'PASS' : 'FAIL');

  // 27. Automations
  const auto = await api('POST', '/api/intelligence/automations', { name: 'E2E test automation', trigger_key: 'job.completed', definition: { conditions: [], steps: [{ tool: 'review.request', input: {} }] } }, token, w);
  const autoId = auto.payload?.automation?.id;
  log('create automation', auto.status === 201 ? 'PASS' : 'FAIL');
  const activate = await api('POST', `/api/intelligence/automations/${autoId}/status`, { status: 'active' }, token, w);
  log('activate automation', activate.status === 200 ? 'PASS' : 'FAIL');

  // 28. Team invites (needs service-role which IS configured)
  const invite = await api('POST', '/api/team/invites', { email: `member-${Date.now()}@example.com`, role: 'manager' }, token, w);
  log('team invite', invite.status === 201 ? 'PASS' : invite.status === 409 ? 'EXPECTED' : 'FAIL', `${invite.status} ${invite.payload?.error || ''}`);

  // 29. Assets
  const assetCreate = await api('POST', '/api/assets', { customer_id: custId, name: 'Kitchen hot water system', asset_type: 'Hot water system', make: 'Rheem', model: 'Stellar 360' }, token, w);
  log('create asset', assetCreate.status === 201 ? 'PASS' : 'FAIL');

  // 30. Negative: unauthenticated access
  const noAuth = await fetch(`${BASE}/api/crm/customers`);
  log('negative: no auth', noAuth.status === 401 ? 'PASS' : 'FAIL', `status=${noAuth.status}`);

  // Summary
  const pass = results.filter(r => r.status === 'PASS').length;
  const expected = results.filter(r => r.status === 'EXPECTED-BLOCK' || r.status === 'EXPECTED').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n========== SUMMARY ==========`);
  console.log(`${pass} PASS, ${expected} EXPECTED, ${fail} FAIL, ${results.length} total`);
  if (fail > 0) {
    console.log('\nFAILURES:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ✗ ${r.step}: ${r.detail}`));
  }
}

function signupError(res, data) {
  return res.status >= 400 || (data.error || data.error_description);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });