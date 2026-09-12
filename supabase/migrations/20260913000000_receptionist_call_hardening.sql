-- A policy-controlled receptionist action is unique per call and turn. This
-- is the durable second line of defence behind the Durable Object turn ledger.
create unique index if not exists leads_receptionist_idempotency_unique
  on public.leads (workspace_id, (source_detail ->> 'receptionist_idempotency_key'))
  where source = 'receptionist'
    and source_detail ? 'receptionist_idempotency_key';
