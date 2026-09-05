import React from 'react';
import { AppLink } from '../../app/router';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="flex min-h-[220px] items-center justify-center gap-3 text-sm text-slate-500"><span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />{label}</div>;
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function PrimaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

export function SecondaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

export function Field({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-700">{label}</span><input {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 ${props.className || ''}`} />{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</label>;
}

export function SelectField({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-700">{label}</span><select {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 ${props.className || ''}`}>{children}</select></label>;
}

export function TextareaField({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-700">{label}</span><textarea {...props} className={`min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 ${props.className || ''}`} /></label>;
}

export function StatusPill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate'|'green'|'amber'|'red'|'indigo' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

export function Money({ cents, className = '' }: { cents: number; className?: string }) {
  return <span className={className}>{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format((cents || 0) / 100)}</span>;
}

// A short explainer band shown under the page title. Every page uses it to
// tell a new operator what the page is for before any data exists.
export function PageIntro({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-6 text-slate-600 ${className}`}><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-indigo-100 text-[11px] font-black text-indigo-700">i</span><div className="min-w-0">{children}</div></div>;
}

// Compact metric card with an icon accent. Used in page summary strips.
export function StatCard({ icon, label, value, sub, className = '' }: { icon?: React.ReactNode; label: string; value: React.ReactNode; sub?: string; className?: string }) {
  return <Card className={`p-4 ${className}`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-500">{label}</p>{icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">{icon}</span>}</div><div className="mt-1.5 text-2xl font-black tracking-tight text-slate-950">{value}</div>{sub && <p className="mt-1 text-[11px] leading-4 text-slate-400">{sub}</p>}</Card>;
}

// Guided first-run card. Each item is a real next step with its destination;
// completed items tick off so the card shrinks away as the workspace grows.
export function SetupChecklist({ title = 'Set up your workspace', description, items, className = '' }: {
  title?: string;
  description?: string;
  items: Array<{ label: string; description: string; href: string; done: boolean }>;
  className?: string;
}) {
  const doneCount = items.filter((item) => item.done).length;
  const pending = items.filter((item) => !item.done);
  if (!pending.length) return null;
  return (
    <Card className={`mb-6 overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-950 p-5 text-white">
        <div>
          <h2 className="font-bold">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-slate-300">{description}</p>}
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-indigo-200">{items.length - pending.length} of {items.length} done</span>
      </div>
      <div className="divide-y divide-slate-100">
        {pending.map((item, index) => (
          <AppLink key={item.href + item.label} href={item.href} className="flex items-start gap-3 p-4 transition hover:bg-indigo-50/40">
            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">{doneCount + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.description}</span>
            </span>
            <span className="mt-1 text-xs font-bold text-indigo-600">Go →</span>
          </AppLink>
        ))}
      </div>
    </Card>
  );
}

// Empty states explain what will appear here, why it matters, and what to do
// next — so an empty workspace reads as guided, not broken.
export function EmptyState({ icon, title, description, action, steps }: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  steps?: string[];
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-xl text-indigo-600 shadow-sm">{icon ?? '✦'}</div>
      <h3 className="font-semibold text-slate-950">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      {steps && steps.length > 0 && (
        <ol className="mx-auto mt-4 max-w-md space-y-1.5 text-left">
          {steps.map((step, index) => <li key={index} className="flex items-start gap-2 text-xs leading-5 text-slate-500"><span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-slate-200 text-[10px] font-black text-slate-600">{index + 1}</span>{step}</li>)}
        </ol>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// Truth-in-UI: every feature is exactly one of these three states, shown the
// same way everywhere (capability map, integrations, dashboard, navigation).
export function FeatureStatus({ state, className = '' }: { state: 'ready' | 'setup' | 'soon'; className?: string }) {
  const tones = {
    ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    setup: 'bg-amber-50 text-amber-700 ring-amber-200',
    soon: 'bg-slate-100 text-slate-600 ring-slate-200',
  } as const;
  const labels = { ready: 'Ready', setup: 'Needs setup', soon: 'Coming soon' } as const;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${tones[state]} ${className}`}>{labels[state]}</span>;
}