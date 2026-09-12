import React, { useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

const STARTER_SEATS = 2;
const GROWTH_SEATS = 8;

export type PlanFinderResult = { key: 'starter' | 'growth'; reason: string };

function computeFit(seats: number, wantsAutomation: boolean | null): PlanFinderResult | null {
  if (wantsAutomation === null) return null;
  if (seats > STARTER_SEATS) return { key: 'growth', reason: `Growth — you'll need more than Starter's ${STARTER_SEATS} team members (Growth covers up to ${GROWTH_SEATS}).` };
  if (wantsAutomation) return { key: 'growth', reason: "Growth — Starter doesn't include customer follow-up workflows or advanced automations." };
  return { key: 'starter', reason: `Starter — ${seats === 1 ? "it's just you" : `your team of ${seats} fits within Starter's ${STARTER_SEATS} seats`}, and the essentials cover what you need for now.` };
}

export function PlanFinder({ onResult }: { onResult: (result: PlanFinderResult | null) => void }) {
  const [seats, setSeats] = useState(1);
  const [wantsAutomation, setWantsAutomation] = useState<boolean | null>(null);
  const result = computeFit(seats, wantsAutomation);

  function updateSeats(next: number) {
    const clamped = Math.max(1, Math.min(25, next));
    setSeats(clamped);
    onResult(computeFit(clamped, wantsAutomation));
  }
  function updateAutomation(value: boolean) {
    setWantsAutomation(value);
    onResult(computeFit(seats, value));
  }

  return <div className="jobrin-card rounded-2xl border border-slate-200 bg-white p-6 sm:p-7">
    <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[.14em] text-indigo-600"><Sparkles className="h-4 w-4"/>Which plan fits your business?</p>
    <div className="mt-5 grid gap-6 sm:grid-cols-2">
      <div>
        <label htmlFor="plan-finder-seats" className="text-sm font-semibold text-slate-700">How many people need a login?</label>
        <div className="mt-2 flex items-center gap-3">
          <button type="button" aria-label="Decrease team members" onClick={() => updateSeats(seats - 1)} className="h-9 w-9 rounded-lg border border-slate-200 text-lg font-bold text-slate-600 hover:bg-slate-50">−</button>
          <input id="plan-finder-seats" type="number" min={1} max={25} value={seats} onChange={e => updateSeats(Number(e.target.value) || 1)} className="h-9 w-16 rounded-lg border border-slate-200 text-center text-sm font-semibold text-slate-900"/>
          <button type="button" aria-label="Increase team members" onClick={() => updateSeats(seats + 1)} className="h-9 w-9 rounded-lg border border-slate-200 text-lg font-bold text-slate-600 hover:bg-slate-50">+</button>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-700">Want automated customer follow-ups?</p>
        <p className="mt-0.5 text-xs text-slate-500">Automatic reminder texts and advanced automations, vs. handling follow-up manually.</p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => updateAutomation(false)} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${wantsAutomation === false ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Manual is fine</button>
          <button type="button" onClick={() => updateAutomation(true)} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${wantsAutomation === true ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Yes, automate it</button>
        </div>
      </div>
    </div>
    {result && <p className="mt-5 flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700"><ArrowRight className="h-4 w-4 flex-none"/>{result.reason}</p>}
    {!result && <p className="mt-5 text-sm text-slate-400">Answer both questions to see which plan we'd recommend.</p>}
  </div>;
}
