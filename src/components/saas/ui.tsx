import React from 'react';

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

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center"><div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-lg shadow-sm">✦</div><h3 className="font-semibold text-slate-950">{title}</h3><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}
