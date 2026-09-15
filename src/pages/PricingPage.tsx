import React from "react";
import { ArrowRight, Check } from "lucide-react";
import { AppLink } from "../app/router";
import { PLAN_CATALOG, PLAN_KEYS } from "../../shared/plans";

const plans = PLAN_KEYS.map((key) => PLAN_CATALOG[key]);

export default function PricingPage() {
  return (
    <div className="jobrin-marketing min-h-screen bg-[#f6f8f5] text-[#10282e]">
      <header className="marketing-header border-b border-[#d9e1de] bg-[#fdfefd]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 lg:px-8">
          <AppLink href="/" className="flex items-center gap-2.5 font-black tracking-tight">
            <span className="brand-mark flex h-9 w-9 items-center justify-center rounded-lg">J</span>
            Jobrin.ai
          </AppLink>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-[#405957] md:flex" aria-label="Main navigation">
            <AppLink href="/#how-it-works">How it works</AppLink>
            <AppLink href="/#ai-admin">AI admin</AppLink>
            <AppLink href="/pricing" className="text-[#10282e]">Pricing</AppLink>
          </nav>
          <div className="flex items-center gap-2">
            <AppLink href="/login" className="px-3 py-2 text-sm font-semibold text-[#405957] transition hover:text-[#10282e]">Log in</AppLink>
            <AppLink href="/signup" className="marketing-header-cta rounded-lg bg-[#10282e] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#176438]">Start free</AppLink>
          </div>
        </div>
      </header>

      <main>
        <section className="bg-[#10282e] px-5 py-20 text-white lg:px-8 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="marketing-accent text-xs font-bold uppercase tracking-[.18em] text-[#f2c24e]">Straightforward plans</p>
            <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-5xl">A plan that fits the work in front of you.</h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300">Start with 14 days free, then choose the tools and room your business needs. Your team keeps control of every customer-facing action.</p>
          </div>
        </section>

        <section className="px-5 pb-16 lg:px-8 lg:pb-24">
          <div className="mx-auto -mt-10 max-w-6xl">
            <div className="grid gap-5 lg:grid-cols-3">
              {plans.map((plan) => (
                <article key={plan.name} className={`relative flex flex-col rounded-lg border bg-white p-7 shadow-[0_12px_35px_rgba(16,40,46,.08)] ${plan.featured ? "border-[#f2c24e] ring-2 ring-[#f2c24e]" : "border-[#d9e1de]"}`}>
                  {plan.featured && <span className="absolute -top-3 left-7 rounded-full bg-[#f2c24e] px-3 py-1 text-xs font-bold text-[#10282e]">Most popular</span>}
                  <p className="text-xs font-bold uppercase tracking-[.16em] text-[#176438]">{plan.name}</p>
                  <p className="mt-3 min-h-12 text-sm leading-6 text-[#58706d]">{plan.description}</p>
                  <div className="mt-7 flex items-end gap-1">
                    <span className="text-5xl font-black tracking-tight text-[#10282e]">${plan.monthlyAud}</span>
                    <span className="pb-1.5 text-sm text-[#58706d]">AUD / month</span>
                  </div>
                  <AppLink href={`/signup?plan=${plan.key}`} className={`mt-7 flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${plan.featured ? "marketing-gold-cta bg-[#f2c24e] text-[#10282e] hover:bg-[#e6b63f]" : "bg-[#10282e] text-white hover:bg-[#176438]"}`}>
                    Start with {plan.name}<ArrowRight className="h-4 w-4" />
                  </AppLink>
                  <div className="mt-7 space-y-3 border-t border-[#e6ece8] pt-6">
                    {plan.highlights.map((feature) => <div key={feature} className="flex gap-2.5 text-sm leading-5 text-[#405957]"><Check className="mt-0.5 h-4 w-4 flex-none text-[#176438]" /><span>{feature}</span></div>)}
                  </div>
                </article>
              ))}
            </div>
            <div className="mx-auto mt-8 max-w-4xl border-y border-[#d9e1de] py-7 text-center text-sm leading-6 text-[#58706d]">
              <p>All prices are in AUD and every subscription invoice includes GST. Calling, SMS, AI responses, email delivery and payments require their relevant provider connections. Usage limits apply by plan.</p>
              <AppLink href="/support" className="mt-4 inline-flex items-center gap-2 font-bold text-[#176438] hover:text-[#104d2c]">Talk through the right plan <ArrowRight className="h-4 w-4" /></AppLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#10282e] px-5 py-8 text-slate-300 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-sm"><span className="font-bold text-white">Jobrin.ai</span><div className="flex gap-5"><AppLink href="/privacy">Privacy</AppLink><AppLink href="/terms">Terms</AppLink><AppLink href="/support">Support</AppLink></div></div>
      </footer>
    </div>
  );
}
