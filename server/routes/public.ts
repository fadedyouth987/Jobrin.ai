import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { asyncRoute } from '../security';
import { rateLimit } from 'express-rate-limit';
import { TimerFreeMemoryStore } from '../rateLimitStore';
import { supabaseAdmin } from '../supabase';

// Public customer-facing document links. Capability is the unguessable token in
// the URL; only its SHA-256 hash is stored, so a database leak cannot reveal
// live links. These routes never require a user session and return the minimum
// fields a customer needs to review the quote — never internal notes.

export function hashShareToken(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export const quoteDecisionTransitions: Record<string, string[]> = {
  sent: ['accepted', 'declined'],
  viewed: ['accepted', 'declined'],
};

export function canDecideQuote(from: string, to: string) {
  return (quoteDecisionTransitions[from] ?? []).includes(to);
}

export const publicRateLimit = rateLimit({
  store: new TimerFreeMemoryStore(),
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const router = Router();
router.use(publicRateLimit);

function linkNotFound(res: { status: (code: number) => { json: (body: unknown) => unknown } }) {
  return res.status(404).json({ error: 'LINK_NOT_FOUND' });
}

router.get('/quotes/:token', asyncRoute(async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return linkNotFound(res);

  const { data: quote, error } = await supabaseAdmin
    .from('quotes')
    .select('id,workspace_id,quote_number,status,subtotal_cents,gst_cents,total_cents,deposit_cents,expires_at,terms,sent_at,accepted_at')
    .eq('public_token_hash', hashShareToken(token))
    .maybeSingle();
  if (error || !quote) return linkNotFound(res);

  const [itemsResult, profileResult] = await Promise.all([
    supabaseAdmin.from('quote_items').select('description,quantity,unit_price_cents,gst_rate,sort_order').eq('workspace_id', quote.workspace_id).eq('quote_id', quote.id).order('sort_order'),
    supabaseAdmin.from('business_profiles').select('trading_name,phone,email,website').eq('workspace_id', quote.workspace_id).maybeSingle(),
  ]);
  if (itemsResult.error || profileResult.error) return res.status(500).json({ error: 'QUOTE_LINK_READ_FAILED' });

  // Mark the quote as viewed exactly once, without blocking the customer view.
  if (quote.status === 'sent') {
    await supabaseAdmin.from('quotes').update({ status: 'viewed', viewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', quote.id).eq('workspace_id', quote.workspace_id).eq('status', 'sent');
    await supabaseAdmin.from('audit_logs').insert({
      workspace_id: quote.workspace_id, action: 'quote.customer_viewed', entity_type: 'quote', entity_id: quote.id, details: { via: 'public_link' },
    });
    quote.status = 'viewed';
  }

  res.json({
    quote: {
      quote_number: quote.quote_number,
      status: quote.status,
      subtotal_cents: quote.subtotal_cents,
      gst_cents: quote.gst_cents,
      total_cents: quote.total_cents,
      deposit_cents: quote.deposit_cents,
      expires_at: quote.expires_at,
      terms: quote.terms,
      sent_at: quote.sent_at,
      accepted_at: quote.accepted_at,
    },
    items: itemsResult.data ?? [],
    business: profileResult.data ?? {},
  });
}));

router.post('/quotes/:token/decision', asyncRoute(async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return linkNotFound(res);
  const parsed = z.object({ decision: z.enum(['accepted', 'declined']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_FAILED' });

  const { data: quote, error } = await supabaseAdmin
    .from('quotes')
    .select('id,workspace_id,status,accepted_at,quote_number')
    .eq('public_token_hash', hashShareToken(token))
    .maybeSingle();
  if (error || !quote) return linkNotFound(res);

  // Idempotent: a repeated accept/decline returns the current state instead of
  // erroring or double-recording.
  if (['accepted', 'declined'].includes(quote.status)) {
    return res.json({ status: quote.status, acceptedAt: quote.accepted_at });
  }
  if (!canDecideQuote(quote.status, parsed.data.decision)) {
    return res.status(409).json({ error: 'QUOTE_NOT_DECIDABLE', status: quote.status });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('quotes')
    .update({ status: parsed.data.decision, accepted_at: parsed.data.decision === 'accepted' ? now : null, updated_at: now })
    .eq('id', quote.id).eq('workspace_id', quote.workspace_id)
    .in('status', ['sent', 'viewed'])
    .select('status,accepted_at').single();
  if (updateError || !updated) return res.status(409).json({ error: 'QUOTE_DECISION_CONFLICT' });

  await supabaseAdmin.from('audit_logs').insert({
    workspace_id: quote.workspace_id, action: `quote.customer_${parsed.data.decision}`, entity_type: 'quote',
    entity_id: quote.id, details: { via: 'public_link', quote_number: quote.quote_number },
  });

  res.json({ status: updated.status, acceptedAt: updated.accepted_at });
}));

export default router;