-- Quote-to-invoice conversion (POST /operations/quotes/:id/convert) used to
-- check "does an active invoice already exist for this quote" with a
-- SELECT ... limit(1) and then a separate INSERT. Two near-simultaneous
-- requests could both pass the check and both insert, creating two
-- invoices for one quote. A partial unique index makes the database the
-- single source of truth: the route now attempts the insert directly and
-- treats a 23505 unique_violation as "already invoiced".
--
-- invoices.status values (see 0003_revenue_os_core.sql):
--   'draft','sent','viewed','part_paid','paid','overdue','void','refunded'
-- Only 'void' is treated as "not active" by the existing route logic
-- (.neq('status','void')), so the index mirrors that exact condition.
create unique index if not exists invoices_quote_id_active_idx
  on public.invoices(quote_id)
  where quote_id is not null and status != 'void';
