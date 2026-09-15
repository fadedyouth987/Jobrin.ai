import React from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  Headphones,
  LockKeyhole,
  MessageSquareText,
  PhoneCall,
  PlugZap,
  ReceiptText,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { AppLink } from "../app/router";

const proofItems = [
  ["Human approval gate", "AI drafts stay private until reviewed"],
  ["AUD + GST ready", "Quotes and invoices built for Australian operators"],
  ["Calls to cashflow", "Enquiries, jobs, invoices and payments stay linked"],
  ["Workspace scoped", "Records stay inside the right business"],
];

const lifecycle = [
  {
    icon: PhoneCall,
    title: "Capture the enquiry",
    body: "Calls, SMS and after-hours messages become structured work with customer context.",
  },
  {
    icon: FileText,
    title: "Draft the quote",
    body: "Jobrin prepares itemised scope, labour, materials and GST language for review.",
  },
  {
    icon: ClipboardCheck,
    title: "Approve the action",
    body: "Nothing goes to a customer, accounting system or payment link without a human check.",
  },
  {
    icon: ReceiptText,
    title: "Invoice and follow up",
    body: "Accepted work flows through to invoice status, payment links and polite reminders.",
  },
];

const comparisonRows = [
  ["After-hours enquiries", "Voicemails, texts and scraps of paper", "Call notes, source and next action in one queue"],
  ["Quoting", "Rebuild the same line items each evening", "Review a drafted quote with totals and GST already visible"],
  ["Payments", "Switch between invoice, bank and message threads", "Outstanding balances and follow-ups sit beside the job"],
  ["AI control", "Unclear what automation actually did", "Approval-gated suggestions with an audit trail"],
];

function ProductPreview() {
  return (
    <section className="jobrin-public-preview" aria-label="Example Jobrin.ai operations workspace">
      <div className="jobrin-preview-topline">
        <div>
          <p className="text-sm font-bold text-slate-950">Apex Electrical & Air Conditioning</p>
          <p className="text-xs text-slate-500">Live workspace - 6 active jobs - 3 approvals waiting</p>
        </div>
        <span className="jobrin-preview-live">
          <span /> AI gates enforced
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_220px]">
        <aside className="jobrin-preview-inbound">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-bold uppercase tracking-[.12em] text-slate-500">Inbound</p>
            <span className="text-xs font-bold text-blue-700">3 new</span>
          </div>
          <div className="mt-4 space-y-2">
            {[
              ["Call transcribed", "Dave Miller, Paddington - switchboard trip and RCD safety check", "Urgent"],
              ["SMS confirmed", "Sarah Lin - Tuesday 8:00 am ducted AC service", "Booked"],
              ["Supplier notice", "Rexel price file updated for copper cable", "+3.2%"],
            ].map(([title, body, tag]) => (
              <div key={title} className="jobrin-preview-inbound-row">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-900">{title}</p>
                  <span className="text-[11px] font-semibold text-slate-600">{tag}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{body}</p>
              </div>
            ))}
          </div>
        </aside>

        <section className="jobrin-preview-work">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[.12em] text-blue-700">Approval-gated AI suggestions</p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">Next actions waiting for a human tap</h2>
            </div>
            <span className="text-xs font-bold text-amber-800">Private drafts</span>
          </div>
          <div className="mt-4 space-y-3">
            <div className="jobrin-preview-action is-primary">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-950">Quote Draft #Q-2026-084</p>
                  <p className="mt-1 text-xs text-slate-500">Dave Miller - switchboard upgrade - Paddington NSW</p>
                </div>
                <span className="text-xs font-bold text-blue-700">$1,848.00 AUD inc GST</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>Clipsal enclosure</span><span>6x RCBOs</span><span>Testing certificate</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">Review quote</button>
                <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Edit lines</button>
              </div>
            </div>
            <div className="jobrin-preview-action">
              <div className="flex items-start gap-3">
                <ReceiptText className="mt-0.5 h-5 w-5 text-emerald-700" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-950">Tax Invoice #INV-1102 ready</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">Sarah Lin - completed ducted service - $385.00 inc GST. Ready for accounting sync and Stripe payment link.</p>
                </div>
                <span className="hidden text-xs font-bold text-emerald-700 sm:inline">Ready</span>
              </div>
            </div>
            <div className="jobrin-preview-action">
              <div className="flex items-start gap-3">
                <MessageSquareText className="mt-0.5 h-5 w-5 text-amber-700" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-950">Follow-up draft waiting</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">Two unapproved quotes from Thursday, $4,200 total value. Jobrin drafted a polite SMS check-in.</p>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-500">
            <PhoneCall className="h-4 w-4 text-blue-700" />
            AI captured the details and created a callback task.
          </p>
        </section>

        <aside className="jobrin-preview-today">
          <p className="text-[12px] font-bold uppercase tracking-[.12em] text-slate-500">Today</p>
          <div className="mt-4 space-y-3">
            {[
              ["8:30 am", "Woollahra", "Completed"],
              ["11:00 am", "Bondi Junction", "Assigned"],
              ["2:30 pm", "Marrickville", "En route"],
            ].map(([time, suburb, status]) => (
              <div key={time} className="jobrin-preview-stop">
                <span className="w-16 flex-none text-xs font-bold text-slate-900">{time}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{suburb}</p>
                  <p className="text-xs text-slate-500">{status}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4">
            <div>
              <p className="text-[11px] font-semibold text-slate-500">7-day collected</p>
              <p className="mt-1 text-lg font-bold text-slate-950">$18,450</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500">Outstanding</p>
              <p className="mt-1 text-lg font-bold text-slate-950">$4,120</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default function PublicHome() {
  return (
    <div className="jobrin-marketing min-h-screen bg-[#f8fafc] text-slate-950">
      <header className="marketing-header sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <AppLink href="/" className="flex items-center gap-2.5 font-bold text-slate-950">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-700 text-sm font-black text-white">J</span>
            <span>Jobrin.ai</span>
            <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 sm:inline-flex">Built for AU trades</span>
          </AppLink>
          <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-600 lg:flex">
            <a href="#lifecycle" className="hover:text-slate-950">How it works</a>
            <a href="#comparison" className="hover:text-slate-950">Why Jobrin</a>
            <AppLink href="/pricing" className="hover:text-slate-950">Pricing</AppLink>
            <a href="#security" className="hover:text-slate-950">Security</a>
          </nav>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AppLink href="/login" className="hidden px-3 py-2 text-slate-600 hover:text-slate-950 sm:block">Sign in</AppLink>
            <AppLink href="/signup" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2.5 text-white hover:bg-blue-800">
              Start 14-day trial <ArrowRight className="h-4 w-4" />
            </AppLink>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
            <div className="max-w-4xl">
              <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-700">AI admin operations for Australian trades</p>
              <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-normal text-slate-950 sm:text-5xl lg:text-6xl">
                Never miss an enquiry. Send the quote before the admin pile-up starts.
              </h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">
                Jobrin logs inbound calls and messages, prepares quote and invoice drafts, tracks schedule pressure and payment exceptions, then waits for your approval before anything reaches the customer.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <AppLink href="/signup" className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800">
                  Start free trial <ArrowRight className="h-4 w-4" />
                </AppLink>
                <a href="#lifecycle" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:border-blue-300">
                  See the job loop
                </a>
              </div>
              <p className="mt-4 text-sm text-slate-500">No card to start. Connect phone, payments and accounting when ready.</p>
              <div className="mt-10 grid gap-y-5 sm:grid-cols-2 sm:gap-x-10">
                {proofItems.map(([title, detail]) => (
                  <div key={title} className="flex gap-3 border-l border-slate-300 pl-4">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-700" />
                    <div>
                      <p className="text-sm font-bold text-slate-950">{title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-16 lg:mt-20"><ProductPreview /></div>
          </div>
        </section>

        <section id="lifecycle" className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-700">The trade lifecycle</p>
              <h2 className="mt-4 max-w-xl text-4xl font-black leading-tight text-slate-950">From first call to paid invoice, with control at every step.</h2>
              <p className="mt-5 max-w-lg leading-7 text-slate-600">
                Jobrin is built around the moments that make or lose money for a service business: capturing the job, quoting accurately, scheduling the work and getting paid.
              </p>
            </div>
            <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2">
              {lifecycle.map(({ icon: Icon, title, body }) => (
                <article key={title} className="bg-white p-6">
                  <Icon className="h-6 w-6 text-blue-700" />
                  <h3 className="mt-5 text-lg font-bold text-slate-950">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="comparison" className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-700">Operational difference</p>
              <h2 className="mt-4 text-4xl font-black leading-tight text-slate-950">Less kitchen-table admin. More work moving cleanly.</h2>
            </div>
            <div className="mt-10 overflow-hidden rounded-lg border border-slate-200">
              {comparisonRows.map(([area, oldWay, jobrin]) => (
                <div key={area} className="grid border-b border-slate-200 last:border-b-0 lg:grid-cols-[220px_1fr_1fr]">
                  <div className="bg-slate-50 p-4 text-sm font-bold text-slate-900">{area}</div>
                  <div className="border-t border-slate-200 p-4 text-sm leading-6 text-slate-500 lg:border-l lg:border-t-0">{oldWay}</div>
                  <div className="border-t border-slate-200 bg-blue-50/40 p-4 text-sm font-semibold leading-6 text-slate-800 lg:border-l lg:border-t-0">{jobrin}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[.9fr_1.1fr] lg:px-8 lg:py-24">
          <div>
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-slate-950 text-white">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[.16em] text-blue-700">Control is product behaviour</p>
            <h2 className="mt-4 text-4xl font-black leading-tight text-slate-950">Helpful AI without handing over the keys.</h2>
            <p className="mt-5 max-w-lg leading-7 text-slate-600">
              Sensitive actions stay visible, approval-gated and traceable. The AI admin helps your team make the next move; it does not quietly run the business for you.
            </p>
          </div>
          <div className="grid content-start gap-3 sm:grid-cols-2">
            {[
              [ShieldCheck, "Workspace-level access controls"],
              [Headphones, "Receptionist readiness before live answering"],
              [PlugZap, "Provider health shown plainly"],
              [CircleDollarSign, "Payment and GST status tied to records"],
              [Truck, "Field work, schedule and customer context connected"],
              [ClipboardCheck, "AI suggestions labelled and reviewable"],
            ].map(([Icon, label]) => {
              const LucideIcon = Icon as typeof ShieldCheck;
              return (
                <div key={label as string} className="rounded-lg border border-slate-200 bg-white p-5">
                  <LucideIcon className="h-5 w-5 text-blue-700" />
                  <p className="mt-4 text-sm font-bold leading-6 text-slate-900">{label as string}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-blue-700 text-white">
          <div className="mx-auto flex max-w-7xl flex-col items-start gap-7 px-5 py-14 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-100">Ready when you are</p>
              <h2 className="mt-4 text-4xl font-black leading-tight">Make the next enquiry easier to win.</h2>
              <p className="mt-4 text-blue-100">Start with the workspace. Add phone, payments, email and AI connections when each part is ready.</p>
            </div>
            <AppLink href="/signup" className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 text-sm font-bold text-blue-800 hover:bg-blue-50">
              Start free trial <ArrowRight className="h-4 w-4" />
            </AppLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div>
            <p className="font-bold text-slate-950">Jobrin.ai</p>
            <p className="mt-1 text-xs">AI admin workspace for Australian trade and service businesses.</p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold">
            <AppLink href="/pricing" className="hover:text-slate-950">Pricing</AppLink>
            <AppLink href="/support" className="hover:text-slate-950">Support</AppLink>
            <AppLink href="/privacy" className="hover:text-slate-950">Privacy</AppLink>
            <AppLink href="/terms" className="hover:text-slate-950">Terms</AppLink>
          </div>
        </div>
      </footer>
    </div>
  );
}
