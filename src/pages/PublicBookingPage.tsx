import { useEffect, useState } from 'react';

// Public booking page — customers pick a service and a time, and the booking
// lands straight in the business's schedule. No login; the slug is the key.
type Service = {
  id: string; name: string; description: string | null;
  default_duration_minutes: number | null; requires_deposit: boolean; deposit_cents: number | null;
};
type BookingInfo = {
  business: { name: string; phone: string | null; suburb: string | null; state: string | null };
  services: Service[];
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function PublicBookingPage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [error, setError] = useState('');
  const [service, setService] = useState<Service | null>(null);
  const [slots, setSlots] = useState<Array<{ start: string; end: string }>>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ customer_name: '', phone: '', email: '', address_text: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ serviceName: string; start: string; note: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/book/${encodeURIComponent(slug)}`)
      .then(async (response) => { if (!response.ok) throw new Error('BUSINESS_NOT_FOUND'); return response.json(); })
      .then((payload) => { if (!cancelled) setInfo(payload); })
      .catch(() => { if (!cancelled) setError('BUSINESS_NOT_FOUND'); });
    return () => { cancelled = true; };
  }, [slug]);

  const loadSlots = async (selected: Service) => {
    setSlot(null);
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/public/book/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peek: true, service_id: selected.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'SLOTS_FAILED');
      setSlots(payload.slots ?? []);
    } catch (reason: any) {
      setError(reason.message || 'SLOTS_FAILED');
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!service || !slot) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/public/book/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: service.id, slot_start: slot, ...form }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || payload?.error || 'BOOKING_FAILED');
      setDone({ serviceName: payload.serviceName, start: payload.start, note: payload.note || '' });
    } catch (reason: any) {
      setError(reason.message || 'BOOKING_FAILED');
    } finally { setBusy(false); }
  };

  if (error && !info) {
    return <Frame><p className="text-sm text-slate-500">This booking page is not available. Please check the link or contact the business directly.</p></Frame>;
  }
  if (!info) return <Frame><p className="text-sm text-slate-500">Loading booking page…</p></Frame>;

  if (done) {
    return (
      <Frame>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
        <h1 className="mt-4 text-2xl font-black">Booking received</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{done.serviceName} — {fmt(done.start)}.</p>
        <p className="mt-2 text-sm text-slate-500">{done.note}</p>
        <p className="mt-4 text-xs text-slate-400">Powered by Jobryn</p>
      </Frame>
    );
  }

  return (
    <Frame wide>
      <p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">Book with {info.business.name}</p>
      <h1 className="mt-1 text-3xl font-black tracking-tight">Choose a service and a time</h1>
      {info.business.suburb && <p className="mt-1 text-sm text-slate-500">{info.business.suburb}{info.business.state ? `, ${info.business.state}` : ''}{info.business.phone ? ` · ${info.business.phone}` : ''}</p>}
      {error && <p className="mt-4 text-sm font-semibold text-red-600">{error === 'SLOT_TAKEN' ? 'That time was just booked — please pick another.' : error}</p>}
      <div className="mt-6 space-y-5 text-left">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">1. Service</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {info.services.map((item) => (
              <button key={item.id} onClick={() => { setService(item); void loadSlots(item); }}
                className={`rounded-xl border p-4 text-left transition ${service?.id === item.id ? 'border-indigo-500 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-indigo-300'}`}>
                <p className="font-bold">{item.name}</p>
                {item.description && <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>}
                <p className="mt-1 text-[11px] text-slate-400">{item.default_duration_minutes} min{item.requires_deposit ? ` · deposit $${((item.deposit_cents || 0) / 100).toFixed(0)}` : ''}</p>
              </button>
            ))}
          </div>
        </div>
        {service && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">2. Time</p>
            {slots.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {slots.slice(0, 24).map((item) => (
                  <button key={item.start} onClick={() => setSlot(item.start)}
                    className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${slot === item.start ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'}`}>
                    {new Date(item.start).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-slate-500">{busy ? 'Finding times…' : 'No times available in the next two weeks — call the business directly.'}</p>}
          </div>
        )}
        {service && slot && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">3. Your details</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={form.customer_name} onChange={(e) => setForm((v) => ({ ...v, customer_name: e.target.value }))} placeholder="Your name" className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500" />
              <input value={form.phone} onChange={(e) => setForm((v) => ({ ...v, phone: e.target.value }))} placeholder="Mobile number" className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500" />
              <input value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))} placeholder="Email (optional)" className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500" />
              <input value={form.address_text} onChange={(e) => setForm((v) => ({ ...v, address_text: e.target.value }))} placeholder="Street address (optional)" className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500" />
            </div>
            <button disabled={busy || form.customer_name.trim().length < 2 || form.phone.trim().length < 8} onClick={submit}
              className="mt-4 w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50">
              {busy ? 'Booking…' : `Book ${service.name} — ${fmt(slot)}`}
            </button>
            <p className="mt-2 text-center text-xs text-slate-400">The business confirms details by phone or SMS. No payment is taken here.</p>
          </div>
        )}
      </div>
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