# Security Policy — Jobryn

## Secrets

Never commit `.env`, Stripe secret keys, webhook secrets, OAuth client secrets, Supabase service-role keys or AI provider keys. Browser code may use only Supabase publishable/anon credentials.

## Tenant isolation

Every tenant-owned record carries `workspace_id`. Protected API routes verify the authenticated user and workspace membership server-side. Database RLS is the second enforcement boundary. New tables and routes are not complete until both checks exist and cross-tenant tests pass.

## Authorization

Do not trust workspace IDs, roles, plan names, prices or resource ownership sent by the browser. Derive and verify them on the server. High-risk owner/admin actions can require AAL2 MFA.

## Payments

Jobryn subscription card collection uses Stripe-hosted Checkout. Billing management uses Stripe Billing Portal. Stripe webhook signatures must be verified using the original raw request body. Financial state changes must be idempotent and transaction-safe.

## AI

AI models must not have database credentials. They act through an allowlisted tool layer with permission checks, schema validation, execution/cost limits, audit records and human approval for risky actions.

## Vulnerability reporting

Do not include customer data, credentials or exploit payloads containing live secrets in a report. Reproduce issues in a test workspace where possible.
