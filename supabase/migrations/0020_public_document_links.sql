-- Public document links are addressed by the SHA-256 hash of the share token.
-- Without an index every link open would scan the table, so add partial
-- indexes for live links. Additive only: no policies, grants or data change.

create index if not exists quotes_public_token_hash_idx
  on public.quotes (public_token_hash)
  where public_token_hash is not null;

create index if not exists invoices_public_token_hash_idx
  on public.invoices (public_token_hash)
  where public_token_hash is not null;