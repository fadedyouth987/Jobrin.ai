import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppLink, navigate } from '../../app/router';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="flex min-h-[220px] items-center justify-center gap-3 text-sm text-slate-500"><span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />{label}</div>;
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`jobrin-card rounded-lg border border-slate-200 bg-white ${className}`}>{children}</div>;
}

export function PrimaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`jobrin-primary rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

export function SecondaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`jobrin-secondary rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

export function aiAdminHref(prompt: string) {
  return `/app/admin-chat?ask=${encodeURIComponent(prompt)}`;
}

export function AskAiAdminLink({ prompt, label = 'Ask AI Admin', className = '' }: { prompt: string; label?: string; className?: string }) {
  return <AppLink href={aiAdminHref(prompt)} className={`inline-flex items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 ${className}`}>{label}</AppLink>;
}

export function Field({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return <label className="block space-y-1.5"><span className="text-sm font-semibold text-slate-700">{label}</span><input {...props} className={`w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 ${props.className || ''}`} />{hint && <span className="block text-xs text-slate-500">{hint}</span>}</label>;
}

export function SelectField({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-semibold text-slate-700">{label}</span><select {...props} className={`w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 ${props.className || ''}`}>{children}</select></label>;
}

export function TextareaField({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return <label className="block space-y-1.5"><span className="text-sm font-semibold text-slate-700">{label}</span><textarea {...props} className={`min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 ${props.className || ''}`} /></label>;
}

export function StatusPill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate'|'green'|'amber'|'red'|'indigo' }) {
  const tones = {
    slate: 'text-slate-600 before:bg-slate-400',
    green: 'text-emerald-700 before:bg-emerald-600',
    amber: 'text-amber-800 before:bg-amber-600',
    red: 'text-red-700 before:bg-red-600',
    indigo: 'text-indigo-700 before:bg-indigo-600',
  };
  return <span className={`jobrin-status inline-flex items-center gap-1.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Money({ cents, className = '' }: { cents: number; className?: string }) {
  return <span className={className}>{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format((cents || 0) / 100)}</span>;
}

// A short explainer band shown under the page title. Every page uses it to
// tell a new operator what the page is for before any data exists.
export function PageIntro({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`jobrin-page-intro mb-5 flex items-start gap-3 text-sm leading-6 text-slate-600 ${className}`}><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-indigo-100 text-xs font-black text-indigo-700">i</span><div className="min-w-0">{children}</div></div>;
}

// Compact metric card with an icon accent. Used in page summary strips. A
// `pendingNote` explains why a value is zero or pending inline — numbers never
// appear without their context.
export function StatCard({ icon, label, value, sub, pendingNote, className = '' }: { icon?: React.ReactNode; label: string; value: React.ReactNode; sub?: string; pendingNote?: string; className?: string }) {
  return <div className={`jobrin-metric ${className}`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-500">{label}</p>{icon && <span className="text-indigo-600">{icon}</span>}</div><div className="mt-1.5 text-2xl font-black tracking-tight text-slate-950">{value}</div>{sub && <p className="mt-1 text-[11px] leading-4 text-slate-400">{sub}</p>}{pendingNote && <p className="mt-2 text-[11px] leading-4 font-medium text-amber-800">{pendingNote}</p>}</div>;
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
    <section className={`jobrin-setup-checklist mb-6 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="font-bold text-slate-950">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
        </div>
        <span className="text-xs font-bold text-indigo-700">{items.length - pending.length} of {items.length} done</span>
      </div>
      <div>
        {pending.map((item, index) => (
          <AppLink key={item.href + item.label} href={item.href} className="jobrin-setup-step flex items-start gap-3 transition hover:bg-indigo-50/40">
            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">{doneCount + index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.description}</span>
            </span>
            <span className="mt-1 text-xs font-bold text-indigo-600">Go</span>
          </AppLink>
        ))}
      </div>
    </section>
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
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-white text-xl text-indigo-600 shadow-sm">{icon ?? '•'}</div>
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
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tones[state]} ${className}`}>{labels[state]}</span>;
}

// Canonical status -> StatusPill tone mapping. Every list/detail page should
// call this instead of inventing its own tone logic — the UI/UX audit found
// three separate, inconsistent copies of this mapping across the app (e.g.
// "cancelled" rendered red in one place and slate in another).
const STATUS_TONE_MAP: Record<string, 'green' | 'red' | 'amber' | 'indigo'> = {
  paid: 'green', succeeded: 'green', completed: 'green', accepted: 'green', confirmed: 'green', won: 'green', active: 'green', ready: 'green',
  overdue: 'red', failed: 'red', cancelled: 'red', canceled: 'red', lost: 'red', declined: 'red', void: 'red', expired: 'red', past_due: 'red',
  pending: 'amber', draft: 'amber', scheduled: 'amber', trialing: 'amber', awaiting_approval: 'amber', unpaid: 'amber',
  sent: 'indigo', approved: 'indigo', in_progress: 'indigo', booked: 'indigo',
};
export function statusTone(status?: string | null): 'slate' | 'green' | 'amber' | 'red' | 'indigo' {
  if (!status) return 'slate';
  return STATUS_TONE_MAP[status.toLowerCase().trim()] ?? 'slate';
}

// Heading scale tokens (--text-h1/h2/h3, defined in index.css) so every page
// uses one type scale instead of hand-picking text-3xl/font-black per file.
export function Heading({ level = 1, children, className = '' }: { level?: 1 | 2 | 3; children: React.ReactNode; className?: string }) {
  const Tag = (`h${level}` as 'h1' | 'h2' | 'h3');
  const scale = { 1: 'text-h1 font-black tracking-tight', 2: 'text-h2 font-bold tracking-tight', 3: 'text-h3 font-bold' }[level];
  return <Tag className={`${scale} text-slate-950 ${className}`}>{children}</Tag>;
}

// Pulsing placeholder for loading content whose shape is known in advance
// (a row, a card, a line of text) — use instead of a bare Spinner when the
// eventual layout should already be visible while data loads.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} aria-hidden="true" />;
}

// Shared data table: wraps <table> in the same card/overflow treatment every
// page was reimplementing by hand. Columns declare a key, header label, and
// optional cell renderer; rows are plain objects.
export type TableColumn<T> = { key: string; header: string; render?: (row: T) => React.ReactNode; className?: string };
export function Table<T extends { id?: string | number }>({ columns, rows, rowHref, emptyLabel = 'No records yet.', className = '' }: {
  columns: TableColumn<T>[];
  rows: T[];
  rowHref?: (row: T) => string | undefined;
  emptyLabel?: string;
  className?: string;
}) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-500">{emptyLabel}</p>;
  return (
    <Card className={`overflow-hidden ${className}`}>
      <table>
        <thead>
          <tr className="border-b border-slate-100">
            {columns.map((col) => <th key={col.key} className={`px-4 py-3 text-xs uppercase tracking-wide text-slate-500 ${col.className || ''}`}>{col.header}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => {
            const href = rowHref?.(row);
            return (
              <tr
                key={row.id ?? index}
                onClick={href ? () => navigate(href) : undefined}
                className={href ? 'cursor-pointer transition hover:bg-slate-50' : undefined}
              >
                {columns.map((col) => <td key={col.key} className={`px-4 py-3 text-sm text-slate-700 ${col.className || ''}`}>{col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// Modal/dialog: backdrop + Escape-to-close + focus on open. No portal —
// rendered inline at fixed positioning, which is sufficient given the app
// has no nested-stacking-context modals today.
export function Modal({ open, onClose, title, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-slate-950/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="jobrin-card relative w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-lg outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="modal-title" className="text-lg font-bold text-slate-950">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">✕</button>
        </div>
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// Popover menu: click trigger to open, click outside or Escape to close.
export function Dropdown({ trigger, children, align = 'right' }: { trigger: React.ReactNode; children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={rootRef} className="relative inline-block">
      <span onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">{trigger}</span>
      {open && (
        <div role="menu" className={`jobrin-card absolute z-40 mt-1.5 min-w-[10rem] rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
export function DropdownItem({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button role="menuitem" {...props} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${props.className || ''}`}>{children}</button>;
}

// Toast notifications: mount <ToastProvider> once near the app root, then
// call useToast().show(...) anywhere below it.
type Toast = { id: number; message: string; tone: 'success' | 'error' | 'info' };
const ToastContext = createContext<{ show: (message: string, tone?: Toast['tone']) => void } | null>(null);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className={`jobrin-card pointer-events-auto w-full max-w-sm rounded-lg border p-3.5 text-sm font-medium shadow-lg ${
              toast.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : toast.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
