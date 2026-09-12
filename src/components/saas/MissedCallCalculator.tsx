import React, { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { ArrowRight, PhoneMissed, TrendingDown } from 'lucide-react';
import { AppLink } from '../../app/router';

// None of the trade-software incumbents run a live calculator specific to
// the cost of a missed call on their marketing site — this fills that gap
// with something a visitor actually uses, rather than another paragraph
// they scroll past. Every number here is a clearly-labelled, editable
// estimate, never presented as a guarantee.

function useCountUp(target: number, decimals = 0) {
  const [value, setValue] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    const controls = animate(from, target, {
      duration: 0.5,
      ease: 'easeOut',
      onUpdate: (v: number) => setValue(v),
    });
    return () => controls.stop();
  }, [target]);

  return value.toFixed(decimals);
}

function currency(value: number) {
  return Number(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

export function MissedCallCalculator() {
  const [jobValue, setJobValue] = useState(350);
  const [missedCalls, setMissedCalls] = useState(4);
  const [conversionRate, setConversionRate] = useState(30);

  const weekly = jobValue * missedCalls * (conversionRate / 100);
  const annual = weekly * 52;

  const weeklyDisplay = useCountUp(weekly);
  const annualDisplay = useCountUp(annual);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 sm:p-8">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-slate-950 text-white dark:bg-indigo-600"><PhoneMissed className="h-5 w-5" /></span>
        <div>
          <p className="text-sm font-bold uppercase tracking-[.18em] text-indigo-600 dark:text-indigo-300">Try it yourself</p>
          <h3 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-50">What a missed call actually costs you</h3>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <label className="block">
            <span className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-200">
              Average job value
              <span className="font-bold text-slate-950 dark:text-slate-50">{currency(jobValue)}</span>
            </span>
            <input
              type="range"
              min={50}
              max={2000}
              step={10}
              value={jobValue}
              onChange={(e) => setJobValue(Number(e.target.value))}
              className="mt-2 w-full accent-indigo-600"
              aria-label="Average job value in Australian dollars"
            />
          </label>

          <label className="block">
            <span className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-200">
              Missed or unanswered calls per week
              <span className="font-bold text-slate-950 dark:text-slate-50">{missedCalls}</span>
            </span>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={missedCalls}
              onChange={(e) => setMissedCalls(Number(e.target.value))}
              className="mt-2 w-full accent-indigo-600"
              aria-label="Missed or unanswered calls per week"
            />
          </label>

          <details className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
              Assumption: {conversionRate}% of missed calls would have become a booked job
            </summary>
            <p className="mt-2">This is an editable estimate, not a guaranteed figure — every business converts differently. Adjust it to match your own experience.</p>
            <input
              type="range"
              min={5}
              max={70}
              step={5}
              value={conversionRate}
              onChange={(e) => setConversionRate(Number(e.target.value))}
              className="mt-3 w-full accent-indigo-600"
              aria-label="Assumed percentage of missed calls that convert to a booked job"
            />
          </details>
        </div>

        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-500/30 dark:bg-indigo-500/10">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-indigo-700 dark:text-indigo-300">
            <TrendingDown className="h-3.5 w-3.5" />
            Estimated lost job value
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Per week</p>
              <p className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50">{currency(Number(weeklyDisplay))}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Per year</p>
              <p className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50">{currency(Number(annualDisplay))}</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Estimate only — based on the figures above, not a guarantee for your business.</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
        Standalone AI-receptionist add-ons for trade businesses commonly run around $2,500 to set up plus $500 a month, based on general market pricing. Jobrin.ai's AI receptionist is included in your subscription — no separate setup fee.
      </div>

      <div className="mt-5">
        <AppLink href="/signup" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500">
          Stop missing calls <ArrowRight className="h-4 w-4" />
        </AppLink>
      </div>
    </div>
  );
}
