-- Cross-workspace isolation and privilege tests, run against every migration
-- applied to a throwaway PostgreSQL (scripts/test-db.mjs). Each probe runs as
-- the real browser role (`authenticated` / `anon`, with the JWT claims
-- PostgREST would set) inside a subtransaction that is always rolled back, so
-- a probe that wrongly succeeds is reported and leaves no trace.
--
-- Output lines start with PASS or FAIL; the runner fails on any FAIL.


\ir _fixtures.sql

-- The same receptionist-journey records in both workspaces (seeded as the
-- database owner, which bypasses RLS).
do $$
declare ws text; w uuid; customer uuid; lead uuid; conversation uuid;
begin
  foreach ws in array array['ws_a', 'ws_b'] loop
    w := jobrin_test.id(ws);
    insert into public.customers (workspace_id, display_name, phone, normalized_phone, source)
      values (w, 'Caller ' || ws, '+61400000' || right(ws, 1), '+61400000' || right(ws, 1), 'receptionist') returning id into customer;
    insert into jobrin_test.ids values ('customer_' || ws, customer);
    insert into public.leads (workspace_id, customer_id, title, source) values (w, customer, 'Burst pipe', 'receptionist') returning id into lead;
    insert into jobrin_test.ids values ('lead_' || ws, lead);
    insert into public.calls (workspace_id, provider, provider_call_id, direction, from_number, status)
      values (w, 'twilio', 'CA' || ws, 'inbound', '+61400000001', 'completed');
    insert into public.notifications (workspace_id, type, title) values (w, 'receptionist.call_handled', 'Call handled');
    insert into public.conversations (workspace_id, customer_id) values (w, customer) returning id into conversation;
    insert into public.messages (workspace_id, conversation_id, channel, direction, sender_type, body)
      values (w, conversation, 'sms', 'inbound', 'customer', 'Can someone come today?');
    insert into public.receptionist_profiles (workspace_id) values (w) on conflict do nothing;
    insert into public.workspace_phone_numbers (workspace_id, phone_number)
      values (w, case ws when 'ws_a' then '+61290000001' else '+61290000002' end);
    insert into public.ai_actions (workspace_id, tool_name, risk_level, requested_by, actor_type, input, status)
      values (w, 'message.take', 'low', 'receptionist', 'receptionist_voice', '{}', 'completed');
    insert into public.audit_logs (workspace_id, action) values (w, 'test.seeded');
    insert into public.knowledge_documents (workspace_id, title, source_type) values (w, 'Call-out fee', 'faq');
    insert into storage.objects (bucket_id, name) values ('jobrin-assets', w::text || '/logo.png');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Sanity: each owner sees their own data (so the zero counts below are
--    not vacuous).
-- ---------------------------------------------------------------------------
do $$
declare t text; n integer;
begin
  foreach t in array array['customers','leads','calls','notifications','conversations','messages','receptionist_profiles','workspace_phone_numbers','knowledge_documents','workspace_members','subscriptions','business_profiles'] loop
    n := jobrin_test.count_as('owner_a', format('select count(*) from public.%I where workspace_id = %L', t, jobrin_test.id('ws_a')));
    perform jobrin_test.expect(format('owner A can read own %s', t), n >= 1, format('(saw %s)', n));
  end loop;
  n := jobrin_test.count_as('staff_a', format('select count(*) from public.leads where workspace_id = %L', jobrin_test.id('ws_a')));
  perform jobrin_test.expect('staff in A can read A leads', n >= 1, format('(saw %s)', n));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Read isolation sweep: EVERY public table with a workspace_id column.
-- ---------------------------------------------------------------------------
do $$
declare t text; n integer; leaks text[] := '{}'; checked integer := 0;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'workspace_id' order by 1
  loop
    checked := checked + 1;
    n := jobrin_test.count_as('owner_a', format('select count(*) from public.%I where workspace_id = %L', t, jobrin_test.id('ws_b')));
    if n > 0 then leaks := leaks || format('%s (owner A saw %s of B)', t, n); end if;
    n := jobrin_test.count_as('staff_a', format('select count(*) from public.%I where workspace_id = %L', t, jobrin_test.id('ws_b')));
    if n > 0 then leaks := leaks || format('%s (staff A saw %s of B)', t, n); end if;
    n := jobrin_test.count_as('outsider', format('select count(*) from public.%I', t));
    if n > 0 then leaks := leaks || format('%s (outsider saw %s)', t, n); end if;
    n := jobrin_test.count_as('anon', format('select count(*) from public.%I', t));
    if n > 0 then leaks := leaks || format('%s (anon saw %s)', t, n); end if;
  end loop;
  perform jobrin_test.expect(format('no cross-workspace reads across %s workspace tables (owner, staff, outsider, anon)', checked), cardinality(leaks) = 0, array_to_string(leaks, '; '));
end $$;

do $$
declare n integer;
begin
  n := jobrin_test.count_as('owner_a', format('select count(*) from public.workspaces where id = %L', jobrin_test.id('ws_b')));
  perform jobrin_test.expect('owner A cannot read workspace B itself', n <= 0, format('(saw %s)', n));
  n := jobrin_test.count_as('anon', 'select count(*) from public.workspaces');
  perform jobrin_test.expect('anon cannot list workspaces', n <= 0, format('(saw %s)', n));
  n := jobrin_test.count_as('owner_a', format('select count(*) from public.profiles where id = %L', jobrin_test.id('owner_b')));
  perform jobrin_test.expect('owner A cannot read owner B profile', n <= 0, format('(saw %s)', n));
  n := jobrin_test.count_as('owner_a', format('select count(*) from storage.objects where name like %L', jobrin_test.id('ws_b')::text || '/%'));
  perform jobrin_test.expect('owner A cannot read workspace B files', n <= 0, format('(saw %s)', n));
  n := jobrin_test.count_as('owner_a', format('select count(*) from storage.objects where name like %L', jobrin_test.id('ws_a')::text || '/%'));
  perform jobrin_test.expect('owner A can read own workspace files', n >= 1, format('(saw %s)', n));
  -- RPC with a client-supplied workspace id must re-check membership.
  n := jobrin_test.count_as('owner_a', format('select count(*) from public.get_workspace_access_state(%L)', jobrin_test.id('ws_b')));
  perform jobrin_test.expect('get_workspace_access_state refuses another workspace', n = -1, format('(returned %s)', n));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Write isolation: owner A attacking workspace B.
-- ---------------------------------------------------------------------------
select jobrin_test.expect_denied('owner A cannot insert a lead into B', 'owner_a',
  format($q$insert into public.leads (workspace_id, title) values (%L, 'planted')$q$, jobrin_test.id('ws_b')));
select jobrin_test.expect_denied('owner A cannot update B lead', 'owner_a',
  format($q$update public.leads set title = 'hijacked' where id = %L$q$, jobrin_test.id('lead_ws_b')));
select jobrin_test.expect_denied('owner A cannot delete B lead', 'owner_a',
  format($q$delete from public.leads where id = %L$q$, jobrin_test.id('lead_ws_b')));
select jobrin_test.expect_denied('owner A cannot move own lead into B', 'owner_a',
  format($q$update public.leads set workspace_id = %L where id = %L$q$, jobrin_test.id('ws_b'), jobrin_test.id('lead_ws_a')));
select jobrin_test.expect_denied('owner A cannot link own lead to B customer', 'owner_a',
  format($q$insert into public.leads (workspace_id, customer_id, title) values (%L, %L, 'cross-link')$q$, jobrin_test.id('ws_a'), jobrin_test.id('customer_ws_b')));
select jobrin_test.expect_denied('owner A cannot add themselves to B', 'owner_a',
  format($q$insert into public.workspace_members (workspace_id, user_id, role, status) values (%L, %L, 'owner', 'active')$q$, jobrin_test.id('ws_b'), jobrin_test.id('owner_a')));
select jobrin_test.expect_denied('owner A cannot claim a B phone number route', 'owner_a',
  format($q$update public.workspace_phone_numbers set workspace_id = %L where workspace_id = %L$q$, jobrin_test.id('ws_a'), jobrin_test.id('ws_b')));
select jobrin_test.expect_denied('owner A cannot write files into B folder', 'owner_a',
  format($q$insert into storage.objects (bucket_id, name) values ('jobrin-assets', %L)$q$, jobrin_test.id('ws_b')::text || '/planted.png'));
select jobrin_test.expect_denied('outsider cannot insert into any workspace', 'outsider',
  format($q$insert into public.customers (workspace_id, display_name) values (%L, 'planted')$q$, jobrin_test.id('ws_a')));
select jobrin_test.expect_denied('anon cannot insert leads', 'anon',
  format($q$insert into public.leads (workspace_id, title) values (%L, 'planted')$q$, jobrin_test.id('ws_a')));

-- Blind writes (no WHERE clause, constant SET) skip the SELECT-policy
-- visibility check that protects targeted writes, so an over-broad UPDATE/DELETE policy only shows
-- up here. Compare rows affected with the ground truth of the attacker's own
-- rows: anything more means another tenant's rows were touched.
do $$
declare t text; own integer; outcome text; leaks text[] := '{}'; checked integer := 0;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'workspace_id' order by 1
  loop
    checked := checked + 1;
    execute format('select count(*) from public.%I where workspace_id = %L', t, jobrin_test.id('ws_a')) into own;
    -- A constant assignment: reading a column would re-impose SELECT policies.
    outcome := jobrin_test.write_as('owner_a', format('update public.%I set workspace_id = %L', t, jobrin_test.id('ws_a')));
    if outcome ~ '^\d+$' and outcome::integer > own then leaks := leaks || format('%s update (owner A touched %s, owns %s)', t, outcome, own); end if;
    outcome := jobrin_test.write_as('owner_a', format('delete from public.%I', t));
    if outcome ~ '^\d+$' and outcome::integer > own then leaks := leaks || format('%s delete (owner A touched %s, owns %s)', t, outcome, own); end if;
    outcome := jobrin_test.write_as('outsider', format('update public.%I set workspace_id = %L', t, jobrin_test.id('ws_b')));
    if outcome ~ '^\d+$' and outcome::integer > 0 then leaks := leaks || format('%s update (outsider touched %s)', t, outcome); end if;
    outcome := jobrin_test.write_as('anon', format('delete from public.%I', t));
    if outcome ~ '^\d+$' and outcome::integer > 0 then leaks := leaks || format('%s delete (anon touched %s)', t, outcome); end if;
  end loop;
  perform jobrin_test.expect(format('no blind cross-workspace update/delete across %s workspace tables', checked), cardinality(leaks) = 0, array_to_string(leaks, '; '));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Privilege escalation inside a workspace and server-owned state.
-- ---------------------------------------------------------------------------
select jobrin_test.expect_denied('staff cannot promote themselves', 'staff_a',
  format($q$update public.workspace_members set role = 'owner' where workspace_id = %L and user_id = %L$q$, jobrin_test.id('ws_a'), jobrin_test.id('staff_a')));
select jobrin_test.expect_denied('staff cannot add members', 'staff_a',
  format($q$insert into public.workspace_members (workspace_id, user_id, role, status) values (%L, %L, 'admin', 'active')$q$, jobrin_test.id('ws_a'), jobrin_test.id('outsider')));
select jobrin_test.expect_denied('owner cannot grant themselves a paid plan', 'owner_a',
  format($q$update public.subscriptions set status = 'active', plan = 'operator' where workspace_id = %L$q$, jobrin_test.id('ws_a')));
select jobrin_test.expect_denied('owner cannot change plan entitlements', 'owner_a',
  format($q$update public.subscription_entitlements set enabled = true where workspace_id = %L$q$, jobrin_test.id('ws_a')));
select jobrin_test.expect_denied('owner cannot change the product surface', 'owner_a',
  format($q$update public.workspaces set product_surface = 'full' where id = %L$q$, jobrin_test.id('ws_a')));
select jobrin_test.expect_denied('owner cannot change feature overrides', 'owner_a',
  format($q$update public.workspaces set feature_overrides = '{"quotes_invoices": true}' where id = %L$q$, jobrin_test.id('ws_a')));

do $$
declare outcome text;
begin
  outcome := jobrin_test.write_as('owner_a', format($q$update public.workspaces set name = 'Alpha Plumbing & Gas' where id = %L$q$, jobrin_test.id('ws_a')));
  perform jobrin_test.expect('owner can still rename their workspace', outcome = '1', format('(%s)', outcome));
  outcome := jobrin_test.write_as('owner_a', format($q$insert into public.leads (workspace_id, title) values (%L, 'own lead')$q$, jobrin_test.id('ws_a')));
  perform jobrin_test.expect('owner can create a lead in their own workspace', outcome = '1', format('(%s)', outcome));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Receptionist-first surface defaults.
-- ---------------------------------------------------------------------------
do $$
declare surface text;
begin
  select product_surface into surface from public.workspaces where id = jobrin_test.id('ws_a');
  perform jobrin_test.expect('a newly created workspace starts receptionist-first', surface = 'receptionist', format('(%s)', surface));
end $$;
