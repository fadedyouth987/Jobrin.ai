-- Atomically settle a Stripe-hosted invoice payment.
-- Only the server-side service role may execute this function.

create or replace function public.settle_stripe_invoice_payment(
  target_workspace uuid,
  target_invoice uuid,
  target_customer uuid,
  target_provider_payment_id text,
  target_amount_cents bigint,
  target_currency text,
  target_paid_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_invoice public.invoices%rowtype;
  inserted_payment uuid;
  new_amount_paid bigint;
  new_balance bigint;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_amount_cents <= 0 or upper(target_currency) <> 'AUD' then
    raise exception 'invalid payment amount or currency';
  end if;

  select * into locked_invoice
  from public.invoices
  where id = target_invoice
    and workspace_id = target_workspace
    and customer_id = target_customer
    and status not in ('void', 'refunded')
  for update;

  if not found then raise exception 'invoice not found'; end if;
  if target_amount_cents > locked_invoice.balance_due_cents then
    raise exception 'payment exceeds current balance';
  end if;

  insert into public.payments (
    workspace_id, customer_id, invoice_id, provider,
    provider_payment_id, amount_cents, currency, status, paid_at
  ) values (
    target_workspace, target_customer, target_invoice, 'stripe',
    target_provider_payment_id, target_amount_cents, 'AUD', 'succeeded', target_paid_at
  )
  on conflict (workspace_id, provider, provider_payment_id) do nothing
  returning id into inserted_payment;

  if inserted_payment is null then
    return jsonb_build_object('settled', false, 'duplicate', true);
  end if;

  new_amount_paid := locked_invoice.amount_paid_cents + target_amount_cents;
  new_balance := locked_invoice.total_cents - new_amount_paid;
  update public.invoices set
    amount_paid_cents = new_amount_paid,
    balance_due_cents = new_balance,
    status = case when new_balance = 0 then 'paid' else 'part_paid' end,
    paid_at = case when new_balance = 0 then target_paid_at else paid_at end,
    updated_at = now()
  where id = target_invoice and workspace_id = target_workspace;

  return jsonb_build_object('settled', true, 'duplicate', false, 'balance_due_cents', new_balance);
end;
$$;

revoke all on function public.settle_stripe_invoice_payment(uuid,uuid,uuid,text,bigint,text,timestamptz) from public, anon, authenticated;
grant execute on function public.settle_stripe_invoice_payment(uuid,uuid,uuid,text,bigint,text,timestamptz) to service_role;
