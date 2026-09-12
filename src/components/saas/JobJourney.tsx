import React, { useEffect, useRef, useState } from 'react';
import { motion, animate } from 'motion/react';
import { CheckCircle2, Phone, ClipboardCheck, FileText, ReceiptText, PartyPopper } from 'lucide-react';

// Follows one concrete job (Dave, burst pipe, Salisbury — the same scenario
// used in the hero mockups) through its whole lifecycle. Built as a single
// interactive stepper instead of five disconnected "how it works" cards,
// because a visitor who plays with a real example remembers it; a grid of
// abstract steps is the same shape every SaaS homepage already uses.

type Stage = {
  id: string;
  label: string;
  elapsed: string;
  revenue: string;
  amount: number;
  icon: typeof Phone;
  render: (amount: number) => React.ReactNode;
};

function useCountUp(target: number) {
  const [value, setValue] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) { setValue(target); return; }
    const controls = animate(from, target, {
      duration: 0.7,
      ease: 'easeOut',
      onUpdate: (v: number) => setValue(v),
    });
    return () => controls.stop();
  }, [target]);

  return value;
}

function money(v: number) {
  return v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const transcript = [
  { who: 'caller', text: "Hi, my kitchen tap's burst — how fast can someone get here?" },
  { who: 'receptionist', text: 'Sorry to hear that! I can book an emergency callout this morning. What suburb are you in?' },
  { who: 'caller', text: 'Salisbury, please — as soon as you can.' },
];

const stages: Stage[] = [
  {
    id: 'call',
    label: 'Call comes in',
    elapsed: '0 min since the call',
    revenue: 'Enquiry',
    amount: 0,
    icon: Phone,
    render: () => (
      <div className="rounded-2xl bg-slate-900 p-5 text-white dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-indigo-300" /><p className="text-sm font-bold">Incoming call — Dave, Salisbury</p></div>
          <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold text-emerald-300">ON DUTY</span>
        </div>
        <div className="space-y-2.5 pt-4">
          {transcript.map((turn, i) => (
            <div key={i} className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-xs leading-5 ${turn.who === 'caller' ? 'bg-white/10 text-slate-200' : 'ml-auto bg-indigo-600 text-white'}`}>{turn.text}</div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'confirm',
    label: 'You confirm the job',
    elapsed: '4 min since the call',
    revenue: 'Job confirmed',
    amount: 0,
    icon: ClipboardCheck,
    render: () => (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-slate-400">Job #4417</p>
          <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">CONFIRMED</span>
        </div>
        <p className="mt-2 text-sm font-bold text-slate-950 dark:text-slate-50">Burst pipe repair — Dave, Salisbury</p>
        <div className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex justify-between"><span>Scheduled</span><span className="font-semibold text-slate-900 dark:text-slate-100">Today, 11:30am</span></div>
          <div className="flex justify-between"><span>Assigned to</span><span className="font-semibold text-slate-900 dark:text-slate-100">Priya (plumber)</span></div>
          <div className="flex justify-between"><span>Customer notified</span><span className="font-semibold text-emerald-600 dark:text-emerald-400">Yes — on-the-way text queued</span></div>
        </div>
      </div>
    ),
  },
  {
    id: 'quote',
    label: 'Quote sent',
    elapsed: '2 days since the call',
    revenue: 'quoted',
    amount: 305.80,
    icon: FileText,
    render: (amount) => (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-slate-400">Quote #1024</p>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">ACCEPTED ONLINE</span>
        </div>
        <p className="mt-2 text-sm font-bold text-slate-950 dark:text-slate-50">Burst pipe repair — Salisbury</p>
        <div className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex justify-between"><span>Emergency callout</span><span>$180.00</span></div>
          <div className="flex justify-between"><span>Pipe replacement labour</span><span>$99.00</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900 dark:border-slate-700 dark:text-slate-50"><span>Total (inc. GST)</span><span>{money(amount)}</span></div>
        </div>
      </div>
    ),
  },
  {
    id: 'invoice',
    label: 'Invoice sent',
    elapsed: '2 days since the call',
    revenue: 'Invoice sent',
    amount: 305.80,
    icon: ReceiptText,
    render: (amount) => (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-slate-400">Invoice #1024</p>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">AWAITING PAYMENT</span>
        </div>
        <p className="mt-2 text-sm font-bold text-slate-950 dark:text-slate-50">Balance due: {money(amount)}</p>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <ReceiptText className="h-3.5 w-3.5 flex-none text-indigo-600 dark:text-indigo-300" />
          Secure Stripe payment link sent by SMS and email — no card details touch Jobrin.ai.
        </div>
      </div>
    ),
  },
  {
    id: 'paid',
    label: 'Paid',
    elapsed: '2 days since the call',
    revenue: 'collected',
    amount: 305.80,
    icon: PartyPopper,
    render: (amount) => (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-700 dark:text-emerald-300">Invoice #1024</p>
          <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white">PAID</span>
        </div>
        <p className="mt-2 text-sm font-bold text-slate-950 dark:text-slate-50">Collected: {money(amount)} · Balance {money(0)}</p>
        <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 flex-none" />
          Job closed — Dave's tap fixed, invoice paid, nothing left to chase.
        </div>
      </div>
    ),
  },
];

export function JobJourney() {
  const [activeStage, setActiveStage] = useState(0);
  const [autoAdvancing, setAutoAdvancing] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.4 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoAdvancing || !inView) return;
    const id = setInterval(() => {
      setActiveStage((s) => (s + 1) % stages.length);
    }, 4000);
    return () => clearInterval(id);
  }, [autoAdvancing, inView]);

  const select = (index: number) => {
    setAutoAdvancing(false);
    setActiveStage(index);
  };

  const stage = stages[activeStage];
  const displayedAmount = useCountUp(stage.amount);

  return (
    <div ref={containerRef} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[.18em] text-indigo-600 dark:text-indigo-300">Follow one real job</p>
          <h3 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-50">Dave's burst pipe, Salisbury</h3>
        </div>
        <div className="flex gap-6 text-right text-xs">
          <div>
            <p className="font-semibold text-slate-400">Time elapsed</p>
            <p className="mt-0.5 font-bold text-slate-900 dark:text-slate-100">{stage.elapsed}</p>
          </div>
          <div>
            <p className="font-semibold text-slate-400">Revenue status</p>
            <p className="mt-0.5 font-bold text-slate-900 dark:text-slate-100">{stage.amount > 0 ? `${money(displayedAmount)} ${stage.revenue}` : stage.revenue}</p>
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="Job lifecycle stages" className="mt-6 flex flex-wrap gap-2">
        {stages.map((s, index) => {
          const Icon = s.icon;
          const isActive = index === activeStage;
          return (
            <button
              key={s.id}
              role="tab"
              id={`journey-tab-${s.id}`}
              aria-selected={isActive}
              aria-controls={`journey-panel-${s.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => select(index)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold transition ${isActive ? 'bg-slate-950 text-white dark:bg-indigo-600' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600'}`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{String(index + 1).padStart(2, '0')}. {s.label}</span>
            </button>
          );
        })}
      </div>

      <div
        id={`journey-panel-${stage.id}`}
        role="tabpanel"
        aria-labelledby={`journey-tab-${stage.id}`}
        aria-live="polite"
        className="relative mt-5 min-h-[220px]"
      >
        <motion.div
          key={stage.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {stage.render(displayedAmount)}
        </motion.div>
      </div>
    </div>
  );
}
