import { useEffect, useState } from 'react';

// Public, session-free quote page. The token in the URL is the only
// credential; nothing else about the workspace is exposed.
type PublicQuote = {
  quote: {
    quote_number: number;
    status: string;
    subtotal_cents: number;
    gst_cents: number;
    total_cents: number;
    deposit_cents: number;
    expires_at: string | null;
    terms: string;
    sent_at: string | null;
    accepted_at: string | null;
  };
  items: Array<{ description: string; quantity: number; unit_price_cents: number; gst_rate: number }>;
  business: { trading_name?: string | null; phone?: string | null; email?: string | null; website?: string | null };
};

const money = (cents: number) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

export default function PublicQuotePage({ token }: { token: string }) {
  const [data, setData] = useState<PublicQuote | null>(null);
  const [error, setError] = useState('');
  const [decided, setDecided] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/quotes/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'LINK_NOT_FOUND' : 'QUOTE_LINK_READ_FAILED');
        return response.json();
      })
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((reason: any) => { if (!cancelled) setError(reason.message || 'QUOTE_LINK_READ_FAILED'); });
    return () => { cancelled = true; };
  }, [token]);

  const decide = async (decision: 'accepted' | 'declined') => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/public/quotes/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'QUOTE_DECISION_FAILED');
      setDecided(payload.status);
    } catch (reason: any) {
      setError(reason.message || 'QUOTE_DECISION_FAILED');
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return <Frame><p className="text-sm text-slate-500">This quote link is not available. It may have expired or been replaced by a newer link — please ask the business for an updated one.</p></Frame>;
  }
  if (!data) {
    return <Frame><p className="text-sm text-slate-500">Loading your quote…</p></Frame>;
  }

  const { quote, items, business } = data;
  const currentState = decided ?? quote.status;

  if (currentState === 'accepted' || currentState === 'declined') {
    const accepted = currentState === 'accepted';
    return (
      <Frame>
        <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl ${accepted ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{accepted ? '✓' : '—'}</div>
        <h1 className="mt-4 text-2xl font-black">{accepted ? 'Quote accepted' : 'Quote declined'}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{accepted
          ? `Thank you. ${business.trading_name || 'The business'} has been notified and will be in touch to schedule the work.`
          : 'No worries — the business has been notified. You can always ask for a revised quote.'}</p>
      </Frame>
    );
  }

  if (!['sent', 'viewed'].includes(currentState)) {
    return <Frame><p className="text-sm text-slate-500">This quote is no longer open for response (status: {currentState}). Please contact the business if you need a fresh copy.</p></Frame>;
  }

  return (
    <Frame wide>
      <p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">Quote from {business.trading_name || 'the business'}</p>
      <h1 className="mt-1 text-3xl font-black tracking-tight">Quote #{quote.quote_number}</h1>
      {quote.expires_at && <p className="mt-1 text-sm text-slate-500">Valid until {new Date(quote.expires_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Work</th><th className="px-4 py-3 text-right">Amount</th></tr></thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index} className="border-t border-slate-100">
                <td className="px-4 py-3">{item.description}{Number(item.quantity) !== 1 ? ` × ${item.quantity}` : ''}</td>
                <td className="px-4 py-3 text-right font-semibold">{money(item.quantity * item.unit_price_cents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-100 text-sm">
            <tr><td className="px-4 py-2 text-slate-500">Subtotal</td><td className="px-4 py-2 text-right">{money(quote.subtotal_cents)}</td></tr>
            <tr><td className="px-4 py-2 text-slate-500">GST</td><td className="px-4 py-2 text-right">{money(quote.gst_cents)}</td></tr>
            {quote.deposit_cents > 0 && <tr><td className="px-4 py-2 text-slate-500">Deposit requested</td><td className="px-4 py-2 text-right">{money(quote.deposit_cents)}</td></tr>}
            <tr><td className="px-4 py-3 text-base font-black">Total (inc. GST)</td><td className="px-4 py-3 text-right text-base font-black">{money(quote.total_cents)}</td></tr>
          </tfoot>
        </table>
      </div>
      {quote.terms && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600"><p className="font-bold text-slate-700">Terms</p><p className="mt-1 whitespace-pre-wrap">{quote.terms}</p></div>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button disabled={busy} onClick={() => decide('accepted')} className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50">{busy ? 'Recording…' : 'Accept quote'}</button>
        <button disabled={busy} onClick={() => decide('declined')} className="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Not this time</button>
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">{business.phone ? `${business.phone} · ` : ''}Accepting tells the business you want this work to go ahead. No payment is taken on this page.</p>
    </Frame>
  );
}

function Frame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-3xl border border-slate-200 bg-white p-8 shadow-sm text-center`}>{children}</div>
    </div>
  );
}