-- Shared helpers and base fixtures for tests/db/*.test.sql. Included by each
-- test file with \ir; every test file runs in its own fresh copy of the
-- migrated database (scripts/test-db.mjs).
--
-- Probes run as the real browser roles (`authenticated` / `anon`, with the
-- JWT claims PostgREST would set) inside a subtransaction that is always
-- rolled back, so a probe that wrongly succeeds is reported and leaves no
-- trace. Results are NOTICE lines starting with PASS or FAIL.

set client_min_messages = notice;
create schema jobrin_test;

create table jobrin_test.ids (key text primary key, id uuid not null);
create function jobrin_test.id(k text) returns uuid language sql stable as $$ select id from jobrin_test.ids where key = k $$;

-- Switch to a browser role for the rest of the current (sub)transaction.
create function jobrin_test.become(actor text) returns void language plpgsql as $$
begin
  if actor = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', jobrin_test.id(actor), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

-- Runs a scalar query as `actor` and returns its integer result
-- (-1 when the query is refused outright, e.g. permission denied).
create function jobrin_test.count_as(actor text, query text) returns integer language plpgsql as $$
declare result integer;
begin
  begin
    perform jobrin_test.become(actor);
    execute query into result;
    raise exception 'jobrin_probe_done';
  exception when others then
    if sqlerrm <> 'jobrin_probe_done' then result := -1; end if;
  end;
  return result;
end $$;

-- Runs a write as `actor`; returns 'denied: <error>' or the affected row count.
create function jobrin_test.write_as(actor text, statement text) returns text language plpgsql as $$
declare affected integer; outcome text;
begin
  begin
    perform jobrin_test.become(actor);
    execute statement;
    get diagnostics affected = row_count;
    outcome := affected::text;
    raise exception 'jobrin_probe_done';
  exception when others then
    if sqlerrm <> 'jobrin_probe_done' then outcome := 'denied: ' || sqlerrm; end if;
  end;
  return outcome;
end $$;

create function jobrin_test.expect(name text, ok boolean, detail text default '') returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS %', name;
  else raise notice 'FAIL % %', name, detail;
  end if;
end $$;

create function jobrin_test.expect_denied(name text, actor text, statement text) returns void language plpgsql as $$
declare outcome text := jobrin_test.write_as(actor, statement);
begin
  perform jobrin_test.expect(name, outcome like 'denied:%' or outcome = '0', '(statement succeeded, rows affected: ' || outcome || ')');
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: two businesses, a staff member in A, and a signed-in outsider.
-- Workspaces are created through the real signup RPC.
-- ---------------------------------------------------------------------------
insert into jobrin_test.ids values
  ('owner_a',  '0a000000-0000-4000-8000-00000000000a'),
  ('owner_b',  '0b000000-0000-4000-8000-00000000000b'),
  ('staff_a',  '05000000-0000-4000-8000-00000000005a'),
  ('outsider', '0f000000-0000-4000-8000-00000000000f');
insert into auth.users (id, email)
select id, key || '@example.test' from jobrin_test.ids;

do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', jobrin_test.id('owner_a'))::text, true);
  insert into jobrin_test.ids values ('ws_a', public.create_workspace('Alpha Plumbing', 'alpha-plumbing'));
  perform set_config('request.jwt.claims', json_build_object('sub', jobrin_test.id('owner_b'))::text, true);
  insert into jobrin_test.ids values ('ws_b', public.create_workspace('Bravo Electrical', 'bravo-electrical'));
end $$;

insert into public.workspace_members (workspace_id, user_id, role, status)
values (jobrin_test.id('ws_a'), jobrin_test.id('staff_a'), 'staff', 'active');
