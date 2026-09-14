import { useEffect, useState } from 'react';

// Public, session-free review-response page. The token in the URL is the
// only credential; nothing else about the workspace is exposed. Mirrors the
// structure of PublicQuotePage.tsx.
type PublicReview = {
  request: { status: string; rating: number | null; feedback: string | null };
  job: { title: string; completedAt: string | null } | null;
  business: { trading_name?: string | null; phone?: string | null };
};

export default function PublicReviewPage({ token }: { token: string }) {
  const [data, setData] = useState<PublicReview | null>(null);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState<{ rating: number | null; feedback: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/review/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'LINK_NOT_FOUND' : 'REVIEW_LINK_READ_FAILED');
        return response.json();
      })
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((reason: any) => { if (!cancelled) setError(reason.message || 'REVIEW_LINK_READ_FAILED'); });
    return () => { cancelled = true; };
  }, [token]);

  const submit = async () => {
    if (!rating) { setError('Please choose a rating.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/public/review/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'REVIEW_SUBMIT_FAILED');
      setSubmitted({ rating: payload.rating, feedback: payload.feedback });
    } catch (reason: any) {
      setError(reason.message || 'REVIEW_SUBMIT_FAILED');
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return <Frame><p className="text-sm text-slate-500">This review link is not available. It may have expired — please contact the business if you'd still like to leave feedback.</p></Frame>;
  }
  if (!data) {
    return <Frame><p className="text-sm text-slate-500">Loading…</p></Frame>;
  }

  const { request, job, business } = data;
  const currentStatus = submitted ? 'completed' : request.status;
  const finalRating = submitted?.rating ?? request.rating;
  const finalFeedback = submitted?.feedback ?? request.feedback;

  if (currentStatus === 'completed') {
    return (
      <Frame>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
        <h1 className="mt-4 text-2xl font-black">Thanks for your feedback!</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {finalRating != null ? `You rated this ${finalRating}/5. ` : ''}
          {business.trading_name || 'The business'} has received your response.
        </p>
        {finalFeedback && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-left text-sm text-slate-600">"{finalFeedback}"</p>}
      </Frame>
    );
  }

  if (!['sent', 'clicked'].includes(currentStatus)) {
    return <Frame><p className="text-sm text-slate-500">This review link is no longer open for a response (status: {currentStatus}). Please contact the business directly if you'd like to share feedback.</p></Frame>;
  }

  return (
    <Frame>
      <p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">{business.trading_name || 'The business'}</p>
      <h1 className="mt-1 text-2xl font-black tracking-tight">How did we do?</h1>
      {job?.title && <p className="mt-2 text-sm text-slate-500">For: {job.title}</p>}
      <div className="mt-6 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`${value} star${value > 1 ? 's' : ''}`}
            onClick={() => setRating(value)}
            className={`flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold transition ${value <= rating ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
          >★</button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Anything you'd like to add? (optional)"
        maxLength={2000}
        rows={4}
        className="mt-5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
      />
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-center">
        <button disabled={busy} onClick={submit} className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50">
          {busy ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">{business.phone ? `${business.phone} · ` : ''}A low rating stays private with the business first, so they can put things right.</p>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm text-center">{children}</div>
    </div>
  );
}
