-- Phase 1 guarantees: every answered call ends in exactly one lead and at
-- most one owner alert, whichever call-end path runs, how often, or how
-- concurrently. See migration 20261106010000_receptionist_call_outcomes.sql.

\ir _fixtures.sql

-- Runs a statement as service_role (the server's key) and returns its first
-- column as text, or 'error: ...'. Effects persist (unlike the browser probes).
create function jobrin_test.as_service(query text) returns text language plpgsql as $$
declare result text;
begin
  execute 'set local role service_role';
  begin
    execute query into result;
  exception when others then
    result := 'error: ' || sqlerrm;
  end;
  execute 'reset role';
  return result;
end $$;

create function jobrin_test.record(ws text, sid text, extra text default '') returns text language sql as $$
  select jobrin_test.as_service(format('select public.record_receptionist_call_lead(%L, %L%s)::text', jobrin_test.id(ws), sid, extra))
$$;

-- Calls exactly as the signed /voice webhook creates them.
insert into public.calls (workspace_id, provider, provider_call_id, direction, from_number, to_number, status) values
  (jobrin_test.id('ws_a'), 'twilio', 'CA-first',    'inbound', '+61412345678', '+61290000001', 'in_progress'),
  (jobrin_test.id('ws_a'), 'twilio', 'CA-known',    'inbound', '+61400000999', '+61290000001', 'in_progress'),
  (jobrin_test.id('ws_a'), 'twilio', 'CA-withheld', 'inbound', '',             '+61290000001', 'in_progress'),
  (jobrin_test.id('ws_a'), 'twilio', 'CA-callback', 'inbound', 'anonymous',    '+61290000001', 'in_progress'),
  (jobrin_test.id('ws_a'), 'twilio', 'CA-race',     'inbound', '+61411111111', '+61290000001', 'in_progress'),
  (jobrin_test.id('ws_b'), 'twilio', 'CA-bravo',    'inbound', '+61422222222', '+61290000002', 'in_progress');
insert into public.customers (workspace_id, display_name, phone, normalized_phone, source)
values (jobrin_test.id('ws_a'), 'Known Customer', '+61400000999', '+61400000999', 'manual');

-- ---------------------------------------------------------------------------
-- Only the server may call these functions.
-- ---------------------------------------------------------------------------
do $$
declare actor text; outcome text;
begin
  foreach actor in array array['owner_a', 'anon'] loop
    outcome := jobrin_test.write_as(actor, format($q$select public.record_receptionist_call_lead(%L, 'CA-first')$q$, jobrin_test.id('ws_a')));
    perform jobrin_test.expect(format('%s cannot call record_receptionist_call_lead', actor), outcome like 'denied:%', outcome);
    outcome := jobrin_test.write_as(actor, format($q$select public.claim_alert_delivery(%L, gen_random_uuid(), 'owner_new_lead', '+61400000000')$q$, jobrin_test.id('ws_a')));
    perform jobrin_test.expect(format('%s cannot call claim_alert_delivery', actor), outcome like 'denied:%', outcome);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- One lead per call, details merged, owner's stage preserved.
-- ---------------------------------------------------------------------------
do $$
declare first_id text; again text; detailed text; lead public.leads%rowtype; n integer;
begin
  -- A hang-up with nothing captured still produces the job.
  first_id := jobrin_test.record('ws_a', 'CA-first');
  perform jobrin_test.expect('a call with no captured details still creates a lead', first_id ~ '^[0-9a-f-]{36}$', first_id);
  select * into lead from public.leads where id = first_id::uuid;
  perform jobrin_test.expect('the bare lead is titled as a missed call and linked to its call and caller',
    lead.title = 'Missed call' and lead.call_id is not null and lead.customer_id is not null and lead.stage = 'new' and lead.source = 'receptionist',
    format('(title=%s call=%s customer=%s stage=%s)', lead.title, lead.call_id, lead.customer_id, lead.stage));

  again := jobrin_test.record('ws_a', 'CA-first');
  perform jobrin_test.expect('recording the same call again returns the same lead', again = first_id, format('(%s vs %s)', again, first_id));

  detailed := jobrin_test.record('ws_a', 'CA-first', $x$, p_caller_name => 'Sam Lee', p_suburb => 'Parramatta', p_job_type => 'Burst pipe', p_urgency => 'Emergency', p_note => 'Water everywhere under the sink'$x$);
  select * into lead from public.leads where id = first_id::uuid;
  perform jobrin_test.expect('captured details merge into the same lead',
    detailed = first_id and lead.title = 'Burst pipe - Parramatta' and lead.suburb = 'Parramatta' and lead.job_type = 'Burst pipe'
      and lead.urgency = 'emergency' and lead.description = 'Water everywhere under the sink' and lead.source_detail ->> 'caller_name' = 'Sam Lee',
    format('(title=%s urgency=%s description=%s)', lead.title, lead.urgency, lead.description));

  -- A later partial update must not wipe what was captured earlier, and a
  -- repeated note is not appended twice.
  perform jobrin_test.record('ws_a', 'CA-first', $x$, p_urgency => 'not-a-level', p_note => 'Water everywhere under the sink'$x$);
  perform jobrin_test.record('ws_a', 'CA-first', $x$, p_note => 'Also the hot water is off'$x$);
  select * into lead from public.leads where id = first_id::uuid;
  perform jobrin_test.expect('later updates keep earlier details and append new notes once',
    lead.suburb = 'Parramatta' and lead.urgency = 'emergency'
      and lead.description = E'Water everywhere under the sink\nAlso the hot water is off',
    format('(urgency=%s description=%s)', lead.urgency, replace(lead.description, E'\n', ' / ')));

  -- The owner starts working the job; a late call-end path must not reset it.
  update public.leads set stage = 'contacted' where id = first_id::uuid;
  perform jobrin_test.record('ws_a', 'CA-first');
  select * into lead from public.leads where id = first_id::uuid;
  perform jobrin_test.expect('a late call-end never resets the owner''s stage', lead.stage = 'contacted', format('(stage=%s)', lead.stage));

  select count(*) into n from public.leads where call_id = lead.call_id;
  perform jobrin_test.expect('exactly one lead exists for the call', n = 1, format('(%s)', n));
  select count(*) into n from public.customers where workspace_id = jobrin_test.id('ws_a') and normalized_phone = '+61412345678';
  perform jobrin_test.expect('exactly one customer exists for the caller', n = 1, format('(%s)', n));
end $$;

-- ---------------------------------------------------------------------------
-- Caller matching.
-- ---------------------------------------------------------------------------
do $$
declare v_id text; customer uuid;
begin
  v_id := jobrin_test.record('ws_a', 'CA-known');
  select customer_id into customer from public.leads where id::text = jobrin_test.record('ws_a', 'CA-known');
  perform jobrin_test.expect('a returning caller is matched to their existing customer',
    customer = (select c.id from public.customers c where c.workspace_id = jobrin_test.id('ws_a') and c.normalized_phone = '+61400000999'),
    format('(customer=%s)', customer));

  v_id := jobrin_test.record('ws_a', 'CA-withheld');
  select customer_id into customer from public.leads where id::text = v_id;
  perform jobrin_test.expect('a withheld number still creates a lead, with no customer', v_id ~ '^[0-9a-f-]{36}$' and customer is null, format('(%s, customer=%s)', v_id, customer));

  v_id := jobrin_test.record('ws_a', 'CA-callback', $x$, p_callback_number => '0412 999 888'$x$);
  select customer_id into customer from public.leads where id::text = v_id;
  perform jobrin_test.expect('an Australian callback number given on a withheld call becomes the customer''s number',
    (select normalized_phone from public.customers where public.customers.id = customer) = '+61412999888', format('(customer=%s)', customer));
end $$;

-- ---------------------------------------------------------------------------
-- Tenant binding: a lead can only be attached to the workspace's own call.
-- ---------------------------------------------------------------------------
do $$
declare outcome text;
begin
  outcome := jobrin_test.record('ws_a', 'CA-bravo');
  perform jobrin_test.expect('workspace A cannot record a lead against workspace B''s call', outcome like 'error:%Unknown call%', outcome);
  outcome := jobrin_test.record('ws_a', 'CA-does-not-exist');
  perform jobrin_test.expect('an unknown call is refused', outcome like 'error:%Unknown call%', outcome);
  perform jobrin_test.expect('workspace B has no leads from A''s attempts',
    not exists (select 1 from public.leads where workspace_id = jobrin_test.id('ws_b')));
end $$;

-- (B's call id is resolved here, as the database owner: a subquery inside the
-- probe would run under RLS, see nothing, and test a NULL instead.)
select jobrin_test.expect_denied('owner A cannot link a lead to workspace B''s call', 'owner_a',
  format($q$insert into public.leads (workspace_id, call_id, title) values (%L, %L, 'cross-link')$q$,
    jobrin_test.id('ws_a'), (select id from public.calls where provider_call_id = 'CA-bravo')));

-- ---------------------------------------------------------------------------
-- Alert claims: once per (lead, kind); browser can read, never write.
-- ---------------------------------------------------------------------------
do $$
declare v_lead uuid; first_claim text; second_claim text; n integer; seen integer; outcome text;
begin
  select id into v_lead from public.leads where workspace_id = jobrin_test.id('ws_a') and job_type = 'Burst pipe';
  first_claim := jobrin_test.as_service(format($q$select public.claim_alert_delivery(%L, %L, 'owner_new_lead', '+61400000000')::text$q$, jobrin_test.id('ws_a'), v_lead));
  second_claim := jobrin_test.as_service(format($q$select coalesce(public.claim_alert_delivery(%L, %L, 'owner_new_lead', '+61400000000')::text, 'null')$q$, jobrin_test.id('ws_a'), v_lead));
  select count(*) into n from public.alert_deliveries where lead_id = v_lead;
  perform jobrin_test.expect('the first claim wins and a repeat claim gets nothing',
    first_claim ~ '^[0-9a-f-]{36}$' and second_claim = 'null' and n = 1, format('(first=%s second=%s rows=%s)', first_claim, second_claim, n));

  seen := jobrin_test.count_as('owner_a', format('select count(*) from public.alert_deliveries where id = %L', first_claim));
  perform jobrin_test.expect('the owner can see their workspace''s alert deliveries', seen = 1, format('(%s)', seen));
  seen := jobrin_test.count_as('owner_b', format('select count(*) from public.alert_deliveries where id = %L', first_claim));
  perform jobrin_test.expect('another workspace cannot see them', seen <= 0, format('(%s)', seen));
  outcome := jobrin_test.write_as('owner_a', format($q$update public.alert_deliveries set status = 'pending' where id = %L$q$, first_claim));
  perform jobrin_test.expect('the browser cannot reset a delivery (to trigger a resend)', outcome like 'denied:%' or outcome = '0', outcome);
  outcome := jobrin_test.write_as('owner_a', format($q$delete from public.alert_deliveries where id = %L$q$, first_claim));
  perform jobrin_test.expect('the browser cannot delete a delivery (to trigger a resend)', outcome like 'denied:%' or outcome = '0', outcome);
  outcome := jobrin_test.as_service(format($q$select public.claim_alert_delivery(%L, %L, 'owner_new_lead', '+61400000000')::text$q$, jobrin_test.id('ws_b'), v_lead));
  perform jobrin_test.expect('an alert cannot be claimed for another workspace''s lead', outcome like 'error:%', outcome);
end $$;

select jobrin_test.expect_denied('a malformed owner alert number is rejected', 'owner_a',
  format($q$update public.receptionist_profiles set owner_alert_number = '0412 345 678' where workspace_id = %L$q$, jobrin_test.id('ws_a')));

-- ---------------------------------------------------------------------------
-- A real race: both call-end paths run at the same moment on separate
-- connections (WebSocket close and Twilio's /voice/complete).
-- ---------------------------------------------------------------------------
create extension if not exists dblink;
do $$
declare conn text; a text; b text; claim_a text; claim_b text; n integer; claims integer;
begin
  conn := format('host=%s port=%s dbname=%s user=postgres', split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_database());
  perform dblink_connect('race_a', conn);
  perform dblink_connect('race_b', conn);
  perform dblink_exec('race_a', 'set role service_role');
  perform dblink_exec('race_b', 'set role service_role');
  -- Each side records the lead and claims the alert in one transaction, like the server does.
  perform dblink_send_query('race_a', format($q$select public.record_receptionist_call_lead(%1$L, 'CA-race')::text || '|' || coalesce(public.claim_alert_delivery(%1$L, public.record_receptionist_call_lead(%1$L, 'CA-race'), 'owner_new_lead', '+61400000000')::text, 'null')$q$, jobrin_test.id('ws_a')));
  perform dblink_send_query('race_b', format($q$select public.record_receptionist_call_lead(%1$L, 'CA-race')::text || '|' || coalesce(public.claim_alert_delivery(%1$L, public.record_receptionist_call_lead(%1$L, 'CA-race'), 'owner_new_lead', '+61400000000')::text, 'null')$q$, jobrin_test.id('ws_a')));
  select r into a from dblink_get_result('race_a') as t(r text);
  select r into b from dblink_get_result('race_b') as t(r text);
  perform dblink_disconnect('race_a');
  perform dblink_disconnect('race_b');
  claim_a := split_part(a, '|', 2);
  claim_b := split_part(b, '|', 2);
  select count(*) into n from public.leads l join public.calls c on c.id = l.call_id where c.provider_call_id = 'CA-race';
  select count(*) into claims from public.alert_deliveries d join public.leads l on l.id = d.lead_id join public.calls c on c.id = l.call_id where c.provider_call_id = 'CA-race';
  perform jobrin_test.expect('concurrent call-end paths produce one lead and exactly one alert claim',
    split_part(a, '|', 1) = split_part(b, '|', 1) and n = 1 and claims = 1 and ((claim_a = 'null') <> (claim_b = 'null')),
    format('(a=%s b=%s leads=%s claims=%s)', a, b, n, claims));
end $$;
