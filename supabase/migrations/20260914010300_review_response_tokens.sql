-- Automated review requests: delivery needs an unguessable public link for
-- the customer response page. Follows the exact convention already used for
-- quote/invoice share links (0003_revenue_os_core.sql, 0020_public_document_links.sql):
-- only the SHA-256 hash of the token is ever stored, so a database leak can
-- never reveal a live customer-facing link. Additive only: no policy or
-- grant changes needed, review_requests is already RLS-covered and granted
-- to `authenticated` (0003_revenue_os_core.sql).

alter table public.review_requests
  add column if not exists response_token_hash text,
  add column if not exists delivery_error text;

create unique index if not exists review_requests_response_token_hash_idx
  on public.review_requests (response_token_hash)
  where response_token_hash is not null;
