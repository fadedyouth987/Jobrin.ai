import React, { useState } from 'react';
import { PublicHeader } from '../components/saas/PublicHeader';
import { Check, Award } from 'lucide-react';
import { AppLink } from '../app/router';
import { PlanFinder, type PlanFinderResult } from '../components/saas/PlanFinder';

const plans = [
  { name:'Starter', key:'starter', price:'149', description:'Private hiring and essential operations for a small trade-services team.', features:['Private hiring pipeline','CRM and customer history','Jobs, quotes and scheduling','AI-assisted drafting when configured','2 team members'] },
  { name:'Growth', key:'growth', price:'299', description:'Hiring and coordinated operations for an established trade team.', featured:true, features:['Everything in Starter','8 team members','Customer follow-up workflows','Advanced automations','Up to 1,000 SMS per month'] },
];

// Grounded, modest translations of the real limits above — no invented usage numbers.
const FEATURE_NOTES: Record<string, string> = {
  '2 team members': 'e.g. you + one apprentice or offsider',
  '8 team members': 'e.g. you, an office admin, and a crew of up to 6',
  'Up to 1,000 SMS per month': 'roughly 30–40 customer texts a day',
};

export default function PricingPage() {
  const [recommended, setRecommended] = useState<PlanFinderResult | null>(null);
  return <div className="min-h-screen bg-slate-50"><PublicHeader/><main id="main-content" className="mx-auto max-w-7xl px-5 py-16 lg:px-8"><div className="mx-auto max-w-2xl text-center"><p className="text-sm font-bold uppercase tracking-[.18em] text-indigo-600">Simple SaaS pricing</p><h1 className="mt-3 text-5xl font-black tracking-tight">Pricing for a stronger trade team.</h1><p className="mt-5 text-slate-600">Start with 14 days free—no card required. Every plan includes Jobrin.ai’s private employer-side hiring pipeline.</p><p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Founding trades: <AppLink href="/support" className="underline underline-offset-2">ask us about the limited first-ten-customer Starter offer →</AppLink></p></div>

  <div className="mx-auto mt-10 max-w-4xl"><PlanFinder onResult={setRecommended}/></div>

  <div className="mx-auto mt-8 grid max-w-4xl gap-5 lg:grid-cols-2">{plans.map(plan=>{
    const isRecommended = recommended?.key === plan.key;
    return <div key={plan.name} className={`relative flex flex-col rounded-2xl border bg-white p-7 shadow-sm ${plan.featured?'border-indigo-500 ring-4 ring-indigo-500/10':'border-slate-200'} ${isRecommended?'ring-4 ring-emerald-500/20 border-emerald-500':''}`}>
      {plan.featured&&!isRecommended&&<span className="absolute -top-3 left-7 rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">Most popular</span>}
      {isRecommended&&<span className="absolute -top-3 left-7 flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"><Award className="h-3.5 w-3.5"/>Recommended for you</span>}
      <h2 className="text-xl font-bold">{plan.name}</h2>
      <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{plan.description}</p>
      <div className="mt-6 flex items-end gap-1"><span className="text-5xl font-black tracking-tight">${plan.price}</span><span className="pb-1.5 text-sm text-slate-500">AUD / month</span></div>
      <AppLink href={`/signup?plan=${plan.key}`} className={`mt-6 block rounded-xl px-4 py-3 text-center text-sm font-semibold ${plan.featured?'bg-indigo-600 text-white':'bg-slate-950 text-white'}`}>Start with {plan.name}</AppLink>
      <div className="mt-6 space-y-3">{plan.features.map(feature=><div key={feature} className="flex gap-2 text-sm text-slate-600"><Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600"/><span>{feature}{FEATURE_NOTES[feature]&&<span className="block text-xs text-slate-400">{FEATURE_NOTES[feature]}</span>}</span></div>)}</div>
    </div>;
  })}</div>

  <div className="mx-auto mt-10 max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-7"><h2 className="text-lg font-bold">What you're not paying for separately</h2><p className="mt-2 text-sm leading-6 text-slate-600">Standalone job-management software for trade businesses typically doesn't include an AI receptionist at all — that's commonly sold as a separate add-on service, often costing roughly $2,500 to set up plus $500 a month on top of your existing software bill. Jobrin.ai bundles the AI receptionist, CRM, quoting, invoicing and hiring into the one subscription above, so there's no separate setup fee or add-on to negotiate.</p></div>

  </main></div>;
}
