# Jobryn billing test setup

This is a **test-mode only** configuration. Do not copy these values into a
live environment or create live products until launch review is complete.

## Test catalogue

| App plan | Stripe product | Test Price ID | Monthly price |
| --- | --- | --- | --- |
| `starter` | Jobryn Starter | `price_1UBaqSCzRQMl5tFrL3eY5ibJ` | $149 AUD |
| `growth` | Jobryn Growth | `price_1UBaqhCzRQMl5tFr7UmVZPTR` | $299 AUD |
| `operator` | Jobryn Operator (inactive) | `price_1UBaqlCzRQMl5tFrKQth36fR` | $599 AUD |

The founding offer is test code `JOBRYNFOUNDING`: $50 AUD off Jobryn Starter
for the first three months. It is restricted to ten first-time customers.

## Test environment variables

Store the restricted test-mode Stripe key and webhook signing secret in the
deployment provider's encrypted secret store. Never commit either value.

```dotenv
STRIPE_PRICE_STARTER=price_1UBaqSCzRQMl5tFrL3eY5ibJ
STRIPE_PRICE_GROWTH=price_1UBaqhCzRQMl5tFr7UmVZPTR
STRIPE_PRICE_OPERATOR=price_1UBaqlCzRQMl5tFrKQth36fR
```

Keep `STRIPE_PRICE_OPERATOR` out of a self-service production rollout until
the Operator plan is intentionally activated and its value is validated.

## Before a test webhook is created

1. Deploy a staging-only Worker with a secret `STRIPE_WEBHOOK_SECRET`.
2. Create one **test-mode** Stripe webhook to:
   `https://jobryn-staging.nexgen-studio.workers.dev/api/billing/webhook`
3. Subscribe only to events handled by the app:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Use the signing secret Stripe shows once, then run a Checkout test and
   confirm the subscription and entitlement snapshot change in Supabase.

Do not point a test webhook at `jobryn.org`, and do not configure a live
webhook before the staging test passes.

## Customer Portal checklist

Create one test-mode Customer Portal configuration in Stripe Dashboard:

- Allow payment method updates.
- Allow cancellation at the end of the billing period.
- Allow switching between Jobryn Starter and Jobryn Growth only.
- Keep Jobryn Operator out of the portal until it is publicly offered.
- Keep promotional-code entry enabled for the founding offer.

## Tax

`automatic_tax` is deliberately not enabled. Before live billing, confirm GST
registration, product tax code and inclusive/exclusive price treatment with an
accountant, then configure the matching live-mode Stripe Tax registration.
