import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, Bot, BriefcaseBusiness, Calendar, CalendarDays, Check, CheckCircle2, CircleDollarSign, ClipboardList, ContactRound, ExternalLink, FileCheck2, FileText, Inbox, LibraryBig, LockKeyhole, MessageSquareMore, Phone, PlugZap, Plus, RefreshCcw, ReceiptText, Search, ShieldCheck, Star, Wallet, Workflow } from 'lucide-react';
import { useAuth } from '../app/auth';
import { AppLink, navigate } from '../app/router';
import { apiFetch, ApiError } from '../lib/api';
import { supabase } from '../lib/supabase';
import { AskAiAdminLink, Card, EmptyState, FeatureStatus, Field, Money, PageIntro, PrimaryButton, SecondaryButton, SelectField, SetupChecklist, Spinner, StatCard, StatusPill, TextareaField } from '../components/saas/ui';
import { PLAN_CATALOG, PLAN_KEYS } from '../../shared/plans';

function useData<T>(path: string, initial: T) {
  const { workspaceId } = useAuth();
  const [data,setData]=useState<T>(initial); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const cancelled = useRef(false);
  useEffect(()=>{cancelled.current=false;return()=>{cancelled.current=true}},[]);
  const refresh=async()=>{if(!workspaceId)return;setLoading(true);setError('');try{const result=await apiFetch<T>(path,{},workspaceId);if(!cancelled.current){setData(result)}}catch(err:any){if(!cancelled.current){setError(err.message)}}finally{if(!cancelled.current){setLoading(false)}}};
  useEffect(()=>{void refresh()},[workspaceId,path]);
  return {data,loading,error,refresh};
}

// --- Jobryn Pulse: a single instrument strip (not four floating stat cards) —
// segments read left-to-right by urgency, with a real 7-day activity trace
// underneath rather than a generic bar/line chart. See ADVERSARIAL_UX_REVIEW.
function PulseTrace({ values }: { values: number[] }) {
  const w=280,h=28,pad=3; const max=Math.max(1,...values);
  const pt=(i:number,v:number)=>{const x=pad+(i*(w-pad*2))/Math.max(1,values.length-1);const y=h-pad-(v/max)*(h-pad*2);return [x,y] as const;};
  const points=values.map((v,i)=>pt(i,v).join(',')).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full max-w-xs text-indigo-500" preserveAspectRatio="none" aria-hidden="true">
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    {values.map((v,i)=>{const [x,y]=pt(i,v);return <circle key={i} cx={x} cy={y} r="2" fill="currentColor"/>;})}
  </svg>;
}
function PulseSegment({label,value,note,urgent}:{label:string;value:React.ReactNode;note?:string;urgent?:boolean}) {
  return <div className={`flex-1 min-w-[8rem] p-4 ${urgent?'border-l-4 border-red-400 bg-red-50/40':''}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{value}</p>
    {note&&<p className="mt-1 text-[11px] leading-4 text-slate-400">{note}</p>}
  </div>;
}
function JobrynPulse({metrics,pulse,stripeConfigured,openaiConfigured}:{metrics:any;pulse:number[];stripeConfigured:boolean;openaiConfigured:boolean}) {
  return <div className="mb-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="flex flex-wrap divide-x divide-slate-100">
      <PulseSegment label="This month" value={<Money cents={metrics.monthRevenueCents||0}/>} note={stripeConfigured?'received':'connect Stripe to record payments'}/>
      <PulseSegment label="Outstanding" value={<Money cents={metrics.outstandingCents||0}/>} note={(metrics.overdueCents||0)>0?`incl. ${new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(metrics.overdueCents/100)} overdue`:'across open invoices'} urgent={(metrics.overdueCents||0)>0}/>
      <PulseSegment label="New leads" value={String(metrics.newLeads||0)} note="waiting on a first reply" urgent={(metrics.newLeads||0)>0}/>
      <PulseSegment label="AI actions" value={String(metrics.aiActions||0)} note={openaiConfigured?'this month':'connect OpenAI to activate'}/>
    </div>
    <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3">
      <PulseTrace values={pulse.length?pulse:[0,0,0,0,0,0,0]}/>
      <p className="mt-1 text-[11px] text-slate-400">New enquiries by day, this week — the pulse of the business</p>
    </div>
  </div>;
}

// --- Revenue Flow: money shown moving through real pipeline stages, not
// three disconnected totals.
function RevenueFlow({metrics}:{metrics:any}) {
  const stages=[
    {label:'Quoted',sub:'Awaiting a decision',cents:metrics.openQuotesCents||0},
    {label:'Outstanding',sub:(metrics.overdueCents||0)>0?'Some invoices are overdue':'Invoiced, not yet paid',cents:metrics.outstandingCents||0,urgent:(metrics.overdueCents||0)>0},
    {label:'Received',sub:'Paid this month',cents:metrics.monthRevenueCents||0},
  ];
  return <section className="jobrin-revenue-flow mb-6" aria-labelledby="revenue-flow-title">
    <div className="jobrin-flow-heading">
      <div><h2 id="revenue-flow-title">Revenue in motion</h2><p>Follow money from customer decision to payment received.</p></div>
      <AppLink href="/app/invoices" className="text-sm font-semibold text-indigo-700">Open invoices</AppLink>
    </div>
    <div className="jobrin-flow-stages">
      {stages.map((stage,i)=><React.Fragment key={stage.label}>
        <div className={`jobrin-flow-stage ${stage.urgent?'is-urgent':''}`}>
          <p>{stage.label}</p>
          <strong><Money cents={stage.cents}/></strong>
          <span>{stage.sub}</span>
        </div>
        {i<stages.length-1&&<ArrowRight className="jobrin-flow-arrow h-4 w-4" aria-hidden="true"/>}
      </React.Fragment>)}
    </div>
  </section>;
}

// --- Decision Queue (was "Needs attention"): urgency is structural (a left
// border, a type icon, a specific action label) instead of a same-shaped
// pill on every row regardless of stakes.
const attentionKindMeta:Record<string,{icon:any;action:string}>={
  lead:{icon:BriefcaseBusiness,action:'Reply now'},
  invoice:{icon:ReceiptText,action:'Chase payment'},
  job:{icon:Calendar,action:'Schedule now'},
  approval:{icon:ShieldCheck,action:'Review'},
};
function DecisionQueue({items}:{items:any[]}) {
  if(!items.length)return <EmptyState title="You're caught up" description="No new leads, overdue invoices, unscheduled jobs or approvals waiting."/>;
  return <div className="space-y-2">{items.map((item:any)=>{
    const meta=attentionKindMeta[item.kind]||{icon:AlertTriangle,action:'Open'};
    const Icon=meta.icon;
    const border=item.tone==='red'?'border-red-400':item.tone==='amber'?'border-amber-400':'border-indigo-400';
    return <AppLink key={item.id} href={item.href} className={`flex items-center gap-3 rounded-lg border-l-4 ${border} bg-white p-3 shadow-sm transition hover:bg-slate-50`}>
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon className="h-4 w-4"/></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{item.title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.description}</span></span>
      <span className="flex-none text-xs font-bold text-indigo-600">{meta.action}</span>
    </AppLink>;
  })}</div>;
}

// --- AI Activity: what the AI actually did, in plain language, instead of a
// bare "AI actions: N" count — makes the work visible rather than magical.
function formatToolName(tool:string) {
  const labels:Record<string,string>={take_message:'Took a message',request_handoff:'Requested a handoff'};
  return labels[tool]||tool.replace(/_/g,' ').replace(/^\w/,(c)=>c.toUpperCase());
}
function timeAgo(iso:string) {
  const mins=Math.round((Date.now()-new Date(iso).getTime())/60000);
  if(mins<1)return 'just now'; if(mins<60)return `${mins}m ago`;
  const hrs=Math.round(mins/60); if(hrs<24)return `${hrs}h ago`;
  return `${Math.round(hrs/24)}d ago`;
}
function AIActivityFeed({items}:{items:any[]}) {
  if(!items.length)return <p className="text-sm text-slate-400">No AI activity yet — it will appear here the moment the receptionist takes an action.</p>;
  return <div className="space-y-1.5">{items.map((item:any)=>{
    const dot=item.status==='completed'?'bg-emerald-500':item.status==='failed'||item.status==='denied'?'bg-red-500':item.status==='awaiting_approval'?'bg-amber-500':'bg-slate-400';
    return <div key={item.id} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
      <span className={`h-2 w-2 flex-none rounded-full ${dot}`}/>
      <span className="min-w-0 flex-1 truncate text-slate-700">{formatToolName(item.tool)}{item.customer?` · ${item.customer}`:''}</span>
      <span className="flex-none text-[11px] text-slate-400">{timeAgo(item.at)}</span>
    </div>;
  })}</div>;
}

function InlineCommand() {
  const [question,setQuestion]=useState('');
  const ask=(event:React.FormEvent)=>{event.preventDefault();const value=question.trim();if(value)navigate(`/app/admin-chat?ask=${encodeURIComponent(value)}`);};
  return <form className="jobrin-inline-command mb-6" onSubmit={ask}>
    <Search className="h-5 w-5" aria-hidden="true"/>
    <label className="sr-only" htmlFor="command-question">Ask about this business</label>
    <input id="command-question" value={question} onChange={event=>setQuestion(event.target.value)} placeholder="Ask about today’s jobs, money owing, leads or follow-ups" />
    <button type="submit">Ask</button>
  </form>;
}

function ApprovalQueue({ items, metrics }: { items: any[]; metrics: any }) {
  const fallback = [
    {
      id: 'quote-draft',
      title: 'Quote draft waiting for review',
      description: 'Switchboard upgrade scope is ready to check before sending. GST and payment terms should be reviewed by a human.',
      href: '/app/quotes',
      tone: 'indigo',
      kind: 'approval',
    },
    {
      id: 'invoice-sync',
      title: 'Invoice and payment follow-up',
      description: `${new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format((metrics.outstandingCents || 0) / 100)} remains outstanding across open invoices.`,
      href: '/app/invoices',
      tone: (metrics.overdueCents || 0) > 0 ? 'red' : 'amber',
      kind: 'invoice',
    },
    {
      id: 'receptionist-review',
      title: 'Receptionist readiness and handoffs',
      description: 'Review call handling, knowledge and sign-off before any live answering claim appears to operators.',
      href: '/app/operator/phone',
      tone: 'amber',
      kind: 'approval',
    },
  ];
  const rows = items.length ? items : fallback;
  return <div className="space-y-2">{rows.slice(0, 6).map((item:any) => {
    const meta=attentionKindMeta[item.kind]||{icon:ShieldCheck,action:'Review'};
    const Icon=meta.icon;
    const border=item.tone==='red'?'border-red-400':item.tone==='amber'?'border-amber-400':'border-blue-500';
    return <AppLink key={item.id} href={item.href} className={`flex items-start gap-3 rounded-lg border border-slate-200 border-l-4 ${border} bg-white p-3 transition hover:border-blue-200 hover:bg-blue-50/35`}>
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon className="h-4 w-4"/></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-950">{item.title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span>
      </span>
      <span className="mt-1 flex-none text-xs font-bold text-blue-700">{meta.action}</span>
    </AppLink>;
  })}</div>;
}

function FieldScheduleLane({ jobs }: { jobs: any[] }) {
  const fallback = [
    { id: 'sample-1', title: 'Emergency repair', customer: 'Dave Miller', time: '8:30 am', status: 'scheduled' },
    { id: 'sample-2', title: 'Ducted service', customer: 'Sarah Lin', time: '11:00 am', status: 'in_progress' },
    { id: 'sample-3', title: 'Quote inspection', customer: 'Bondi Junction Strata', time: '2:30 pm', status: 'pending' },
  ];
  const rows = jobs.length ? jobs.map((job:any) => ({
    id: job.id,
    title: job.title,
    customer: job.customers?.display_name || 'Customer',
    time: job.scheduled_start ? new Date(job.scheduled_start).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}) : 'Time pending',
    status: job.status || 'scheduled',
    href: `/app/jobs/${job.id}`,
  })) : fallback;
  return <div className="space-y-2">{rows.slice(0, 5).map((job:any) => {
    const stateLabel=String(job.status).replace(/_/g,' ');
    const stateClass=/cancelled|overdue|failed/.test(stateLabel)?'is-risk':/in_progress|confirmed|completed/.test(stateLabel)?'is-live':'';
    const content = <div className={`jobrin-schedule-stop ${stateClass}`}>
      <span className="w-20 flex-none text-xs font-bold text-slate-900">{job.time}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-950">{job.title}</span>
        <span className="block truncate text-xs text-slate-500">{job.customer}</span>
      </span>
      <span className="jobrin-stop-state">{stateLabel}</span>
    </div>;
    return job.href ? <AppLink key={job.id} href={job.href}>{content}</AppLink> : <div key={job.id}>{content}</div>;
  })}</div>;
}

function HealthRow({ icon: Icon, label, value, ok }: { icon: any; label: string; value: string; ok: boolean }) {
  return <div className={`jobrin-health-row ${ok?'is-ready':'needs-setup'}`}>
    <span className="jobrin-health-icon"><Icon className="h-4 w-4"/></span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-slate-950">{label}</span>
      <span className="block text-xs text-slate-500">{value}</span>
    </span>
    <span className="jobrin-health-state"><i aria-hidden="true"/>{ok ? 'Ready' : 'Needs setup'}</span>
  </div>;
}

export function DashboardPage() {
  const query=useData<any>('/api/dashboard',{metrics:{},today:[],attention:[],pulse:[],aiActivity:[]});
  const onboarding=useData<any>('/api/workspaces/onboarding',{steps:[]});
  const billing=useData<any>('/api/billing/status',{subscription:null,entitlements:[],stripeConfigured:false});
  const integrations=useData<any>('/api/integrations',{integrations:[],readiness:{}});
  const services=useData<any>('/api/services',{services:[]});
  if(query.loading)return <Spinner label="Loading today…"/>;
  if(query.error)return <ErrorBox message={query.error} onRetry={query.refresh}/>;
  const m=query.data.metrics;
  const doneSteps=new Set((onboarding.data.steps||[]).filter((step:any)=>step.status==='complete').map((step:any)=>step.step_key));
  const setupItems=[
    {label:'Complete your business profile',description:'Trading name, ABN and contact details appear on quotes, invoices and customer messages.',href:'/onboarding',done:doneSteps.has('business')||(m.customers||0)>0},
    {label:'Add your first customer',description:'Customers link every job, quote, invoice and conversation in one place.',href:'/app/customers',done:(m.customers||0)>0},
    {label:'Create a job',description:'Jobs carry the work from schedule to completion to payment.',href:'/app/jobs',done:(m.jobs||0)>0},
    {label:'Send your first quote',description:'Customers review and accept quotes from a secure link — nothing to print or post.',href:'/app/quotes',done:(m.openQuotes||0)>0},
    {label:'Connect Stripe (get paid)',description:'Subscription signups and invoice payment links activate the moment Stripe keys are set.',href:'/app/billing',done:billing.data.stripeConfigured===true},
    {label:'Connect Twilio (text customers)',description:'The SMS inbox, campaigns and the AI receptionist all run on your Twilio number.',href:'/app/integrations',done:(integrations.data.integrations||[]).some((i:any)=>i.provider==='twilio'&&i.status==='connected')},
    {label:'Set up email delivery',description:'Quotes and invoices emailed straight to customers with a payment link.',href:'/app/integrations',done:integrations.data.readiness?.email===true},
  ];
  const openaiConfigured=(integrations.data.readiness as any)?.openai===true;
  const stripeConfigured=billing.data.stripeConfigured===true;
  const twilioConnected=(integrations.data.integrations||[]).some((i:any)=>i.provider==='twilio'&&i.status==='connected');
  return <Page title="Today" eyebrow="Operations console" description="Resolve the work in front of you, see who is out in the field and protect the money already earned." action={<SecondaryButton onClick={()=>query.refresh()}><RefreshCcw className="mr-2 inline h-4 w-4"/>Refresh</SecondaryButton>}>
    <SetupChecklist description="Set up the simple job loop: capture customers, book work, quote, invoice and get paid." items={setupItems}/>
    <InlineCommand/>
    <JobrynPulse metrics={m} pulse={query.data.pulse||[]} stripeConfigured={stripeConfigured} openaiConfigured={openaiConfigured}/>
    <RevenueFlow metrics={m}/>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
      <div className="space-y-6">
        <section className="jobrin-work-section" aria-labelledby="attention-queue-title">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="attention-queue-title" className="font-bold">Attention queue</h2>
              <p className="text-xs text-slate-500">AI suggestions, payment exceptions and operational work that needs a person to act.</p>
            </div>
            <span className="jobrin-queue-key"><i aria-hidden="true"/>Human decision needed</span>
          </div>
          <ApprovalQueue items={query.data.attention||[]} metrics={m}/>
        </section>
        <section className="jobrin-work-section" aria-labelledby="field-schedule-title">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 id="field-schedule-title" className="font-bold">Today's field schedule</h2>
              <p className="text-xs text-slate-500">Booked work, assigned jobs and the next schedule pressure points.</p>
            </div>
            <AppLink href="/app/schedule" className="text-xs font-semibold text-blue-700">Open schedule</AppLink>
          </div>
          <FieldScheduleLane jobs={query.data.today||[]}/>
        </section>
      </div>
      <div className="space-y-6">
        <section className="jobrin-side-section" aria-labelledby="receptionist-activity-title">
          <div className="mb-4">
            <h2 id="receptionist-activity-title" className="font-bold">Receptionist activity</h2>
            <p className="text-xs text-slate-500">Recent activity and whether the answering loop is ready.</p>
          </div>
          <AIActivityFeed items={query.data.aiActivity||[]}/>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <HealthRow icon={Phone} label="Phone and SMS" value={twilioConnected ? 'Twilio connection is live' : 'Connect Twilio before live customer SMS'} ok={twilioConnected}/>
          </div>
        </section>
        <section className="jobrin-side-section" aria-labelledby="revenue-exceptions-title">
          <div className="mb-4">
            <h2 id="revenue-exceptions-title" className="font-bold">Revenue exceptions</h2>
            <p className="text-xs text-slate-500">Quote, invoice and payment states that change what your team should do next.</p>
          </div>
          <div className="grid gap-2">
            <HealthRow icon={Wallet} label="Open quote value" value={`${new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format((m.openQuotesCents||0)/100)} waiting on customer decisions`} ok={(m.openQuotesCents||0)===0}/>
            <HealthRow icon={ReceiptText} label="Invoice balances" value={`${new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format((m.outstandingCents||0)/100)} outstanding`} ok={(m.overdueCents||0)===0}/>
            <HealthRow icon={PlugZap} label="Payment provider" value={stripeConfigured ? 'Stripe checkout links can be sent' : 'Stripe keys are not configured'} ok={stripeConfigured}/>
          </div>
        </section>
        <section className="jobrin-side-section" aria-labelledby="integration-health-title">
          <div className="mb-4">
            <h2 id="integration-health-title" className="font-bold">Setup and integration health</h2>
            <p className="text-xs text-slate-500">Supported capabilities first; unavailable items stay out of daily navigation.</p>
          </div>
          <div className="grid gap-2">
            <HealthRow icon={Bot} label="AI provider" value={openaiConfigured ? 'AI drafts can be generated' : 'Connect OpenAI before AI drafting'} ok={openaiConfigured}/>
            <HealthRow icon={CircleDollarSign} label="Stripe" value={stripeConfigured ? 'Subscription and invoice payment links ready' : 'Payments need setup'} ok={stripeConfigured}/>
            <HealthRow icon={MessageSquareMore} label="Email delivery" value={integrations.data.readiness?.email===true ? 'Email sending is ready' : 'Email provider needs setup'} ok={integrations.data.readiness?.email===true}/>
          </div>
        </section>
      </div>
    </div>
  </Page>;
}

function CommandResult({result}:{result:any}) { return <div><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold">{result.title}</h3><p className="mt-1 text-sm text-slate-500">{result.summary}</p></div>{result.approvalRequired&&<StatusPill tone="amber">Approval required</StatusPill>}</div>{typeof result.totalCents==='number'&&<div className="mt-5 text-4xl font-black"><Money cents={result.totalCents}/></div>}{result.rows?.length>0&&<div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><tbody>{result.rows.slice(0,20).map((row:any,i:number)=><tr key={row.id||row.source||i} className="border-t border-slate-100"><td className="py-3 font-semibold">{row.customers?.display_name||row.source||row.title||`#${row.invoice_number||row.quote_number||row.job_number||''}`}</td><td className="py-3 text-slate-500">{row.status||''}</td><td className="py-3 text-right font-semibold">{row.balance_due_cents!=null?<Money cents={row.balance_due_cents}/>:row.revenue_cents!=null?<Money cents={row.revenue_cents}/>:''}</td></tr>)}</tbody></table></div>}</div> }

type AdminChatTurn = {
  role: "user" | "admin";
  text: string;
  result?: any;
};

export function AdminChatPage() {
  const { workspaceId } = useAuth();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<AdminChatTurn[]>([
    {
      role: "admin",
      text: "This is a private workspace chat. Ask about jobs, money owed, leads, quotes, follow-ups or what needs attention. Nothing here is sent to customers.",
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const quick = [
    "What's happening today?",
    "Who owes us money?",
    "Which lead source made the most money?",
    "Follow up quotes older than three days.",
  ];
  useEffect(() => {
    const ask = new URLSearchParams(window.location.search).get("ask");
    if (ask) setInput(ask);
  }, []);
  const send = async (text = input) => {
    if (!workspaceId || !text.trim()) return;
    const message = text.trim();
    setInput("");
    setError("");
    setBusy(true);
    setTurns((current) => [...current, { role: "user", text: message }]);
    try {
      const result = await apiFetch<any>(
        "/api/operator/command",
        { method: "POST", body: JSON.stringify({ command: message }) },
        workspaceId,
      );
      setTurns((current) => [
        ...current,
        {
          role: "admin",
          text: result.summary || "I checked the workspace records.",
          result,
        },
      ]);
    } catch (err: any) {
      setError(err.message || "The admin chat could not answer that yet.");
      setTurns((current) => [
        ...current,
        {
          role: "admin",
          text: "I could not answer that yet. Try one of the suggested questions, or ask a more specific question about jobs, invoices, leads or quotes.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page
      title="Business questions"
      eyebrow="Private workspace search"
      description="Ask about jobs, money, leads, quotes or follow-ups. This view only inspects workspace records and drafts next steps; customer actions stay in their normal controls."
    >
      <section className="jobrin-business-questions" aria-label="Business question history">
        <div className="jobrin-question-context"><Bot className="h-4 w-4"/><span>Private business record lookup</span></div>
        <div className="jobrin-question-thread">
          {turns.map((turn, index) => (
            <div
              key={index}
              className={`jobrin-question-turn ${
                turn.role === "user"
                  ? "is-question"
                  : "is-answer"
              }`}
            >
              <p>{turn.text}</p>
              {turn.result && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700">
                  <CommandResult result={turn.result} />
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="jobrin-question-turn is-answer text-sm text-slate-500">
              Checking workspace records...
            </div>
          )}
        </div>
        <div className="jobrin-question-composer">
          <div className="jobrin-question-examples">
            {quick.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => void send(item)}
                className="text-sm font-semibold text-indigo-700 hover:text-indigo-900"
              >
                {item}
              </button>
            ))}
          </div>
          <form
            className="jobrin-question-input"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about this business..."
            />
            <PrimaryButton disabled={busy || !input.trim()}>
              {busy ? "Checking..." : "Send"}
            </PrimaryButton>
          </form>
          {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
        </div>
      </section>
    </Page>
  );
}

export function CustomersPage() {
  const {workspaceId}=useAuth(); const query=useData<any>('/api/crm/customers',{customers:[]}); const [open,setOpen]=useState(false);const [form,setForm]=useState({first_name:'',last_name:'',phone:'',email:'',source:'website',notes:''});const [error,setError]=useState('');const [search,setSearch]=useState('');
  const create=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!workspaceId)return;const next=(e.nativeEvent as SubmitEvent).submitter instanceof HTMLButtonElement&&(e.nativeEvent as SubmitEvent).submitter?.getAttribute('data-next')==='job';setError('');try{const result=await apiFetch<any>('/api/crm/customers',{method:'POST',body:JSON.stringify({...form,email:form.email||null,phone:form.phone||null})},workspaceId);setForm({first_name:'',last_name:'',phone:'',email:'',source:'website',notes:''});setOpen(false);await query.refresh();if(next&&result.customer?.id)navigate(`/app/jobs?customer=${encodeURIComponent(result.customer.id)}`)}catch(err:any){setError(err.message)}};
  const needle=search.trim().toLowerCase();
  const filtered=needle?query.data.customers.filter((c:any)=>[c.display_name,c.phone,c.email,c.source].filter(Boolean).some((v:string)=>String(v).toLowerCase().includes(needle))):query.data.customers;
  return <Page title="Customers" eyebrow="Customer memory" description="Every job, quote, invoice and message connects back to the person it belongs to. Add customers here — or capture one automatically when they text your business number." action={<PrimaryButton onClick={()=>setOpen(!open)}><Plus className="mr-2 inline h-4 w-4"/>New customer</PrimaryButton>}>{open&&<Card className="mb-5 p-5"><form onSubmit={create} className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><h2 className="font-bold">Add the customer first</h2><p className="mt-1 text-sm text-slate-500">Save their details, then continue directly into the job workflow.</p></div><Field label="First name" value={form.first_name} onChange={e=>setForm(v=>({...v,first_name:e.target.value}))}/><Field label="Last name" value={form.last_name} onChange={e=>setForm(v=>({...v,last_name:e.target.value}))}/><Field label="Phone" value={form.phone} onChange={e=>setForm(v=>({...v,phone:e.target.value}))}/><Field label="Email" type="email" value={form.email} onChange={e=>setForm(v=>({...v,email:e.target.value}))}/><SelectField label="Source" value={form.source} onChange={e=>setForm(v=>({...v,source:e.target.value}))}><option>website</option><option>google</option><option>facebook</option><option>missed_call</option><option>referral</option><option>existing_customer</option></SelectField><div className="sm:col-span-2"><TextareaField label="Notes" value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))}/></div>{error&&<p className="text-sm text-red-600 sm:col-span-2">{error}</p>}<div className="flex flex-wrap gap-2 sm:col-span-2"><PrimaryButton data-next="job">Save customer & create job <ArrowRight className="ml-1 inline h-4 w-4"/></PrimaryButton><SecondaryButton>Save customer only</SecondaryButton></div></form></Card>}{query.data.customers.length?<div className="mb-5 grid gap-3 sm:grid-cols-3"><StatCard label="Customers" value={query.data.customers.length} sub="Active records in this workspace" icon={<ContactRound className="h-4 w-4"/>}/><StatCard label="Lifetime value" value={<Money cents={query.data.customers.reduce((sum:number,c:any)=>sum+Number(c.lifetime_value_cents||0),0)}/>} sub="Total paid work across these customers" icon={<Wallet className="h-4 w-4"/>}/></div>:null}{query.data.customers.length?<div className="mb-4"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, phone, email or source…" className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 sm:max-w-md"/></div>:null}{query.loading?<Spinner/>:query.error?<ErrorBox message={query.error} onRetry={query.refresh}/>:query.data.customers.length?filtered.length?<>
    <Card className="hidden overflow-hidden md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Source</th><th className="px-4 py-3 text-right">Lifetime value</th></tr></thead><tbody>{filtered.map((c:any)=><tr key={c.id} onClick={()=>navigate(`/app/customers/${c.id}`)} className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50"><td className="px-4 py-3 font-semibold text-indigo-700">{c.display_name}</td><td className="px-4 py-3 text-slate-500"><div>{c.phone||'—'}</div><div>{c.email||''}</div></td><td className="px-4 py-3"><StatusPill>{c.source||'unknown'}</StatusPill></td><td className="px-4 py-3 text-right font-semibold"><Money cents={c.lifetime_value_cents||0}/></td></tr>)}</tbody></table></Card>
    <div className="grid gap-3 md:hidden">{filtered.map((c:any)=><AppLink key={c.id} href={`/app/customers/${c.id}`} className="block"><Card className="p-4"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold text-indigo-700">{c.display_name}</p><p className="mt-0.5 text-xs text-slate-500">{c.phone||c.email||'No contact on file'}</p></div><StatusPill>{c.source||'unknown'}</StatusPill></div><p className="mt-2 text-sm font-semibold"><Money cents={c.lifetime_value_cents||0}/> <span className="font-normal text-slate-400">lifetime</span></p></Card></AppLink>)}</div>
  </>:<p className="py-8 text-center text-sm text-slate-500">No customers match "{search}".</p>:<EmptyState icon={<ContactRound className="h-5 w-5"/>} title="No customers yet" description="Your customer list is the memory of the business — every job, quote, invoice, message and payment will link back to the people you save here." steps={['Add a customer with their name, phone and email','Create a job for their work — quotes and invoices attach to it','Send quotes and invoices from the job; everything stays connected']} action={<PrimaryButton onClick={()=>setOpen(true)}><Plus className="mr-2 inline h-4 w-4"/>Add your first customer</PrimaryButton>}/>}</Page>;
}

const stages=['new','contacted','qualified','quote','booked','won','completed'];
const leadNextStage:Record<string,string>={new:'contacted',contacted:'qualified',qualified:'quote',quote:'booked',booked:'won',won:'completed'};
export function LeadsPage() {
  const {workspaceId}=useAuth();
  const query=useData<any>('/api/crm/leads',{leads:[]});
  const [busyLead,setBusyLead]=useState('');
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState({title:'',customer_id:'',source:'website',estimated_value_dollars:''});
  const moveLead=async(lead:any,stage:string)=>{if(!workspaceId)return;setBusyLead(lead.id);try{await apiFetch(`/api/crm/leads/${lead.id}/stage`,{method:'PATCH',body:JSON.stringify({stage})},workspaceId);await query.refresh()}catch{/* invalid transitions surface on refresh */}finally{setBusyLead('')}};
  const createLead=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;setBusyLead('create');try{await apiFetch('/api/crm/leads',{method:'POST',body:JSON.stringify({title:form.title,customer_id:form.customer_id||null,source:form.source,estimated_value_cents:form.estimated_value_dollars?Math.round(Number(form.estimated_value_dollars)*100):null})},workspaceId);setOpen(false);setForm({title:'',customer_id:'',source:'website',estimated_value_dollars:''});await query.refresh()}catch{/* duplicate or invalid input surfaces on refresh */}finally{setBusyLead('')}};
  const openValue=query.data.leads.filter((lead:any)=>!['won','completed','lost','spam','cancelled'].includes(lead.stage)).reduce((sum:number,lead:any)=>sum+Number(lead.estimated_value_cents||0),0);
  if(query.loading)return <Page title="Leads" eyebrow="Revenue pipeline"><Spinner/></Page>;
  return <Page title="Leads" eyebrow="Revenue pipeline" description="Track every enquiry from first contact to booked work. Each lead records where it came from, so Analytics can later prove which sources actually make money." action={<><PrimaryButton onClick={()=>setOpen(!open)}><Plus className="mr-2 inline h-4 w-4"/>New lead</PrimaryButton><SecondaryButton onClick={()=>query.refresh()}>Refresh</SecondaryButton></>}>
    {open&&<Card className="mb-5 p-5"><form onSubmit={createLead} className="grid gap-3 sm:grid-cols-2"><h2 className="font-bold sm:col-span-2">New lead</h2><Field label="What do they need?" value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))} required placeholder="Burst pipe in Salisbury"/><Field label="Source" value={form.source} onChange={e=>setForm(v=>({...v,source:e.target.value}))} placeholder="website, google, referral…"/><Field label="Estimated value (AUD, optional)" type="number" min="0" step="0.01" value={form.estimated_value_dollars} onChange={e=>setForm(v=>({...v,estimated_value_dollars:e.target.value}))}/><div className="sm:col-span-2"><p className="text-xs leading-5 text-slate-500">The lead starts in “new”. Move it across the pipeline as you make contact, quote and book the work — Analytics later attributes the revenue back to the source.</p></div><div className="flex justify-end sm:col-span-2"><PrimaryButton disabled={busyLead==='create'}>{busyLead==='create'?'Saving…':'Save lead'}</PrimaryButton></div></form></Card>}
    <PageIntro>The pipeline reads left to right: a lead enters as <b>new</b>, you make contact, qualify it, quote, book the work and win it. Move a card with the <b>Mark …</b> button; lost enquiries stay in the <b>lost</b> column for later follow-up.</PageIntro>
    {query.error?<ErrorBox message={query.error}/>:query.data.leads.length?<>
      <div className="jobrin-pipeline-summary"><StatCard label="Open pipeline" value={<Money cents={openValue}/>} sub="Estimated value of live enquiries" icon={<BriefcaseBusiness className="h-4 w-4"/>}/><StatCard label="Leads" value={query.data.leads.length} sub="Across every stage" icon={<ClipboardList className="h-4 w-4"/>}/><StatCard label="Booked or won" value={query.data.leads.filter((lead:any)=>['booked','won','completed'].includes(lead.stage)).length} sub="Converted into work" icon={<CheckCircle2 className="h-4 w-4"/>}/></div>
      <div className="grid auto-cols-[280px] grid-flow-col gap-4 overflow-x-auto pb-4">{stages.map(stage=><div key={stage}><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{stage}</h3><span className="text-xs text-slate-400">{query.data.leads.filter((l:any)=>l.stage===stage).length}</span></div><div className="space-y-3">{query.data.leads.filter((l:any)=>l.stage===stage).map((lead:any)=><Card key={lead.id} className="p-4"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-bold">{lead.title}</p><p className="mt-1 text-xs text-slate-500">{lead.customers?.display_name||'Unmatched customer'}</p></div>{lead.estimated_value_cents!=null&&<span className="text-xs font-bold"><Money cents={lead.estimated_value_cents}/></span>}</div><div className="mt-3 flex flex-wrap items-center gap-2">{leadNextStage[lead.stage]&&<button disabled={busyLead===lead.id} onClick={()=>moveLead(lead,leadNextStage[lead.stage])} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">{busyLead===lead.id?'Moving…':`Mark ${leadNextStage[lead.stage]}`}</button>}{!['won','completed','lost','spam','cancelled'].includes(lead.stage)&&<button disabled={busyLead===lead.id} onClick={()=>moveLead(lead,'lost')} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 disabled:opacity-50">Lost</button>}</div><div className="mt-2 flex items-center justify-between text-[11px] text-slate-400"><span>{lead.source||'unknown source'}</span><span>{new Date(lead.created_at).toLocaleDateString('en-AU')}</span></div></Card>)}{!query.data.leads.some((l:any)=>l.stage===stage)&&<div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">No leads</div>}</div></div>)}</div></>:<EmptyState icon={<BriefcaseBusiness className="h-5 w-5"/>} title="No leads yet" description="Every enquiry is money you have already spent time on — the pipeline makes sure none of it slips through, and each lead remembers its source so Analytics can prove what works." steps={['Add the enquiry here (or let an inbound SMS create one)','Make contact and move it to contacted','Quote it, book it and win it']} action={<PrimaryButton onClick={()=>setOpen(true)}><Plus className="mr-2 inline h-4 w-4"/>Add your first lead</PrimaryButton>}/>}</Page>;
}

export function InboxPage() {
  const {workspaceId}=useAuth();const query=useData<any>('/api/communications/conversations',{conversations:[]});const [selectedId,setSelectedId]=useState('');const [detail,setDetail]=useState<any>(null);const [message,setMessage]=useState('');const [note,setNote]=useState('');const [recordConsent,setRecordConsent]=useState(false);const [busy,setBusy]=useState('');const [error,setError]=useState('');
  useEffect(()=>{if(!selectedId&&query.data.conversations?.[0])setSelectedId(query.data.conversations[0].id)},[query.data.conversations,selectedId]);
  useEffect(()=>{if(!workspaceId||!selectedId){setDetail(null);return;}let cancelled=false;const load=()=>apiFetch<any>(`/api/communications/conversations/${selectedId}`,{},workspaceId).then(data=>{if(!cancelled)setDetail(data)}).catch((err:any)=>{if(!cancelled)setError(err.message)});setDetail(null);void load();const interval=window.setInterval(()=>void load(),10_000);return()=>{cancelled=true;window.clearInterval(interval)}},[workspaceId,selectedId]);
  const refreshDetail=async()=>{if(!workspaceId||!selectedId)return;setDetail(await apiFetch<any>(`/api/communications/conversations/${selectedId}`,{},workspaceId));await query.refresh()};
  const send=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId||!detail?.conversation?.customer_id||!message.trim())return;setBusy('message');setError('');try{if(recordConsent)await apiFetch('/api/communications/consents',{method:'POST',body:JSON.stringify({customer_id:detail.conversation.customer_id,channel:'sms',purpose:'support',granted:true,source:'admin_inbox',evidence:{recorded_by_user:true}})},workspaceId);await apiFetch('/api/communications/sms',{method:'POST',body:JSON.stringify({customer_id:detail.conversation.customer_id,conversation_id:selectedId,purpose:'support',body:message})},workspaceId);setMessage('');setRecordConsent(false);await refreshDetail()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const addNote=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId||!note.trim())return;setBusy('note');setError('');try{await apiFetch(`/api/communications/conversations/${selectedId}/notes`,{method:'POST',body:JSON.stringify({body:note})},workspaceId);setNote('');await refreshDetail()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  return <Page title="Inbox" eyebrow="Customer conversations" description="Every text a customer sends your business number lands here in real time. Reply with a consent-checked SMS, or leave a private note for the team — customers never see internal notes." action={<AppLink href="/app/marketing" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Marketing SMS</AppLink>}>{query.loading?<Spinner/>:query.error?<ErrorBox message={query.error} onRetry={query.refresh}/>:query.data.conversations.length?<div className="grid gap-4 xl:grid-cols-[330px_1fr_320px]"><Card className="max-h-[680px] overflow-y-auto">{query.data.conversations.map((c:any)=><button key={c.id} onClick={()=>{setSelectedId(c.id);setError('')}} className={`block w-full border-b border-slate-100 p-4 text-left last:border-0 ${selectedId===c.id?'bg-indigo-50/70':'hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-2"><p className={`flex min-w-0 items-center gap-1.5 truncate ${c.needsReply?'font-bold text-slate-950':'font-semibold text-slate-700'}`}>{c.needsReply&&<span className="h-2 w-2 flex-none rounded-full bg-indigo-600" aria-label="Needs a reply"/>}<span className="truncate">{c.customers?.display_name||'Unknown contact'}</span></p><StatusPill tone={c.handling_mode==='ai_active'?'indigo':'amber'}>{c.handling_mode}</StatusPill></div><p className="mt-1 truncate text-xs text-slate-500">{c.subject||c.customers?.phone||c.customers?.email||'Conversation'}</p><p className="mt-2 text-[11px] text-slate-400">{c.last_message_at?new Date(c.last_message_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'No messages yet'}</p></button>)}</Card>{!detail?<Card className="p-6"><Spinner label="Loading conversation…"/></Card>:<Card className="flex min-h-[680px] flex-col overflow-hidden"><div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5"><div className="min-w-0"><h2 className="font-bold">{detail.conversation.customers?.display_name||'Customer conversation'}</h2><p className="mt-1 text-xs text-slate-500">{detail.conversation.customers?.phone||detail.conversation.customers?.email||detail.conversation.subject||'Private customer thread'}</p></div>{detail.conversation.customer_id&&<AppLink href={`/app/customers/${detail.conversation.customer_id}`} className="flex-none whitespace-nowrap text-xs font-semibold text-indigo-600 hover:text-indigo-700">View customer record</AppLink>}</div><div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-5">{detail.messages.length?detail.messages.map((item:any)=><div key={item.id} className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm ${item.direction==='outbound'?'ml-auto bg-slate-950 text-white':'bg-white text-slate-800 shadow-sm'}`}><p>{item.body}</p><p className={`mt-2 text-[10px] ${item.direction==='outbound'?'text-slate-400':'text-slate-400'}`}>{item.direction==='outbound'?'You':'Customer'} · {item.status} · {new Date(item.created_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}</p></div>):<EmptyState title="No messages yet" description="Messages from this customer will appear here."/>}</div><form onSubmit={send} className="border-t border-slate-100 p-4"><TextareaField label="Reply by SMS" value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write a clear, helpful reply…"/><label className="mt-2 flex items-start gap-2 text-xs text-slate-500"><input className="mt-0.5" type="checkbox" checked={recordConsent} onChange={e=>setRecordConsent(e.target.checked)}/><span>I have just recorded this customer's consent to receive support SMS.</span></label><div className="mt-3 flex justify-end"><PrimaryButton disabled={busy==='message'||!message.trim()}>{busy==='message'?'Sending…':'Send SMS'}</PrimaryButton></div></form></Card>}<Card className="flex min-h-[680px] flex-col"><div className="border-b border-slate-100 p-5"><h2 className="font-bold">Private team notes</h2><p className="mt-1 text-xs leading-5 text-slate-500">Visible to this workspace only. Customers never receive or see these notes.</p></div><div className="flex-1 space-y-3 overflow-y-auto p-5">{detail?.notes?.length?detail.notes.map((item:any)=><div key={item.id} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><p>{item.body}</p><p className="mt-2 text-[10px] text-amber-700">Team · {new Date(item.created_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}</p></div>):<p className="text-sm text-slate-400">No internal notes yet.</p>}</div>{detail&&<form onSubmit={addNote} className="border-t border-slate-100 p-4"><TextareaField label="Add private note" value={note} onChange={e=>setNote(e.target.value)} placeholder="Context for the next team member…"/><div className="mt-3 flex justify-end"><SecondaryButton disabled={busy==='note'||!note.trim()}>{busy==='note'?'Saving…':'Add note'}</SecondaryButton></div></form>}</Card></div>:<EmptyState icon={<Inbox className="h-5 w-5"/>} title="No conversations yet" description="Once your business SMS number is connected, every customer reply appears here the moment it arrives — with the full message history, consent status and internal notes kept separate from customer-visible messages." steps={['Connect your Twilio number under Integrations','Customers text your number; each becomes a conversation','Reply by SMS with the consent box ticked — nothing is ever sent automatically']} action={<AppLink href="/app/integrations" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Check messaging setup</AppLink>}/>}{error&&<p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}</Page>;
}

export function MarketingPage(){
  const {workspaceId}=useAuth();const query=useData<any>('/api/communications/campaigns',{campaigns:[]});const [open,setOpen]=useState(false);const [form,setForm]=useState({name:'',sender_name:'',contact_details:'',message_body:''});const [busy,setBusy]=useState('');const [error,setError]=useState('');
  const create=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;setBusy('create');setError('');try{await apiFetch('/api/communications/campaigns',{method:'POST',body:JSON.stringify(form)},workspaceId);setForm({name:'',sender_name:'',contact_details:'',message_body:''});setOpen(false);await query.refresh()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const act=async(id:string,action:'prepare'|'approve'|'send')=>{if(!workspaceId)return;setBusy(`${action}:${id}`);setError('');try{const body=action==='approve'?{acknowledge_compliance:true}:action==='send'?{batch_size:25}:undefined;await apiFetch(`/api/communications/campaigns/${id}/${action}`,{method:'POST',body:body?JSON.stringify(body):undefined},workspaceId);await query.refresh()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  return <Page title="Marketing SMS" eyebrow="Consent-first campaigns" description="Send offers and reminders only to customers who have explicitly consented. Jobrin.ai snapshots the eligible audience, excludes anyone who replied STOP, adds your sender details and opt-out wording, and requires an owner approval before every batch." action={<PrimaryButton onClick={()=>setOpen(v=>!v)}><Plus className="mr-2 inline h-4 w-4"/>New campaign</PrimaryButton>}><Card className="mb-5 border-amber-200 bg-amber-50 p-5"><h2 className="font-bold text-amber-950">A campaign is never sent automatically</h2><p className="mt-1 text-sm leading-6 text-amber-900">Jobrin.ai snapshots only customers with current SMS marketing consent, excludes STOP/suppressed numbers, adds identity and opt-out wording, then requires an owner/admin approval before each send batch.</p></Card>{open&&<Card className="mb-5 p-5"><form onSubmit={create} className="grid gap-4 md:grid-cols-2"><Field label="Campaign name" value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder="Spring maintenance reminder" required/><Field label="Business / sender name" value={form.sender_name} onChange={e=>setForm(v=>({...v,sender_name:e.target.value}))} placeholder="Acme Plumbing" required/><Field label="Contact details" value={form.contact_details} onChange={e=>setForm(v=>({...v,contact_details:e.target.value}))} placeholder="acmeplumbing.com.au · 02 1234 5678" required/><div className="md:col-span-2"><TextareaField label="Marketing message" value={form.message_body} onChange={e=>setForm(v=>({...v,message_body:e.target.value}))} placeholder="Book your annual hot-water system check before summer." required/></div><p className="md:col-span-2 text-xs text-slate-500">Jobrin.ai appends “Reply STOP to opt out” and your contact details. Do not include sensitive customer information.</p><div className="flex gap-2 md:col-span-2"><PrimaryButton disabled={busy==='create'}>{busy==='create'?'Creating…':'Create draft'}</PrimaryButton><SecondaryButton type="button" onClick={()=>setOpen(false)}>Cancel</SecondaryButton></div></form></Card>}{error&&<p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{query.loading?<Spinner/>:query.error?<ErrorBox message={query.error} onRetry={query.refresh}/>:query.data.campaigns.length?<div className="space-y-4">{query.data.campaigns.map((campaign:any)=><Card key={campaign.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{campaign.name}</h2><p className="mt-1 text-sm text-slate-500">{campaign.sender_name} · Created {new Date(campaign.created_at).toLocaleDateString('en-AU')}</p></div><StatusPill tone={campaign.status==='completed'?'green':campaign.status==='approved'?'indigo':campaign.status==='ready'?'amber':'slate'}>{campaign.status}</StatusPill></div><p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{campaign.message_body}</p><div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-3 py-1.5">Eligible: {campaign.counts?.eligible||0}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">No consent: {campaign.counts?.consent_missing||0}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">Suppressed: {campaign.counts?.suppressed||0}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">Sent: {campaign.counts?.sent||0}</span><span className="rounded-full bg-amber-100 px-3 py-1.5">Needs review: {campaign.counts?.unknown||0}</span></div><div className="mt-4 flex flex-wrap gap-2">{['draft','ready'].includes(campaign.status)&&<SecondaryButton disabled={busy===`prepare:${campaign.id}`} onClick={()=>act(campaign.id,'prepare')}>{busy===`prepare:${campaign.id}`?'Checking consent…':'Prepare consented audience'}</SecondaryButton>}{campaign.status==='ready'&&<PrimaryButton disabled={busy===`approve:${campaign.id}`} onClick={()=>act(campaign.id,'approve')}>{busy===`approve:${campaign.id}`?'Approving…':'Owner approval'}</PrimaryButton>}{['approved','sending'].includes(campaign.status)&&<PrimaryButton disabled={busy===`send:${campaign.id}`} onClick={()=>act(campaign.id,'send')}>{busy===`send:${campaign.id}`?'Sending…':'Send next 25'}</PrimaryButton>}</div></Card>)}</div>:<EmptyState icon={<MessageSquareMore className="h-5 w-5"/>} title="No SMS campaigns yet" description="A campaign is a carefully governed broadcast — never a bulk blast. Jobrin.ai snapshots only customers with current marketing consent, excludes STOP/suppressed numbers automatically, and requires an owner or admin to approve the send." steps={['Write the campaign and sender identity','Prepare it: Jobrin.ai counts who is eligible, suppressed or missing consent','An owner/admin approves, then you send in controlled batches']} action={<PrimaryButton onClick={()=>setOpen(true)}><Plus className="mr-2 inline h-4 w-4"/>Create your first campaign</PrimaryButton>}/>}</Page>;
}

export function OperationsListPage({kind}:{kind:'appointments'|'jobs'|'quotes'|'invoices'|'payments'}) {
  if(kind==='jobs')return <JobsWorkflowPage/>;
  if(kind==='quotes'||kind==='invoices')return <FinancialDocumentsPage kind={kind}/>;
  return <AppointmentsPaymentsList kind={kind}/>;
}

// Hooks live below the kind-based redirects so hook order stays stable no
// matter which list the operator visited last.
function AppointmentsPaymentsList({kind}:{kind:'appointments'|'payments'}) {
  const names={appointments:['Schedule','Bookings and availability'],payments:['Payments','Money received']} as const;
  const query=useData<any>(`/api/operations/${kind}`,{[kind]:[]});
  const rows=query.data[kind]||[];
  const [statusFilter,setStatusFilter]=useState('all');const [search,setSearch]=useState('');
  const statuses=Array.from(new Set<string>(rows.map((row:any)=>String(row.status))));
  const filtered=rows.filter((row:any)=>(statusFilter==='all'||row.status===statusFilter)&&(!search.trim()||JSON.stringify([row.title,row.customers?.display_name,row.status]).toLowerCase().includes(search.trim().toLowerCase())));
  const rowHref=(row:any)=>kind==='payments'?'/app/invoices':row.job_id?`/app/jobs/${row.job_id}`:null;
  const rowLabel=(row:any)=>row.title||`#${row.job_number||row.quote_number||row.invoice_number||row.id.slice(0,8)}`;
  return <Page title={names[kind][0]} eyebrow={names[kind][1]} description={kind==='payments'?'Every dollar that arrives through a secure invoice payment link is recorded here automatically — no manual data entry, and card details never touch Jobrin.ai.':'Site visits, measure-ups and meetings you book for a customer. They appear on the Schedule beside your jobs so the whole week stays visible.'}>{query.loading?<Spinner/>:query.error?<ErrorBox message={query.error}/>:rows.length?<><div className="mb-4 flex flex-wrap items-center gap-2">{['all',...statuses].map((status)=><button key={status} onClick={()=>setStatusFilter(status)} className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize ${statusFilter===status?'bg-slate-950 text-white':'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>{status==='all'?'All':status}</button>)}<input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label="Search records" placeholder="Search…" className="ml-auto w-44 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"/></div><Card className="hidden overflow-hidden md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Record</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Value / Time</th></tr></thead><tbody>{filtered.map((row:any)=><tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{(()=>{const href=rowHref(row);const label=rowLabel(row);return href?<AppLink href={href} className="font-semibold hover:text-indigo-700">{label}</AppLink>:<span>{label}</span>})()}</td><td className="px-4 py-3 text-slate-500">{row.customers?.display_name||'—'}</td><td className="px-4 py-3"><StatusPill tone={['paid','succeeded','completed','accepted','confirmed'].includes(row.status)?'green':['overdue','failed','cancelled'].includes(row.status)?'red':'slate'}>{row.status}</StatusPill></td><td className="px-4 py-3 text-right font-semibold">{row.amount_cents!=null?<Money cents={row.amount_cents}/>:row.balance_due_cents!=null?<Money cents={row.balance_due_cents}/>:row.total_cents!=null?<Money cents={row.total_cents}/>:row.starts_at?new Date(row.starts_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):row.scheduled_start?new Date(row.scheduled_start).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'—'}</td></tr>)}</tbody></table></Card><div className="space-y-2 md:hidden">{filtered.map((row:any)=>{const href=rowHref(row);const label=rowLabel(row);return <Card key={row.id} className="p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0">{href?<AppLink href={href} className="text-sm font-semibold hover:text-indigo-700">{label}</AppLink>:<p className="text-sm font-semibold">{label}</p>}<p className="mt-0.5 text-xs text-slate-500">{row.customers?.display_name||'—'}</p></div><div className="flex-none text-right"><StatusPill tone={['paid','succeeded','completed','accepted','confirmed'].includes(row.status)?'green':['overdue','failed','cancelled'].includes(row.status)?'red':'slate'}>{row.status}</StatusPill><p className="mt-1 text-xs font-semibold">{row.amount_cents!=null?<Money cents={row.amount_cents}/>:row.balance_due_cents!=null?<Money cents={row.balance_due_cents}/>:row.total_cents!=null?<Money cents={row.total_cents}/>:row.starts_at||row.scheduled_start?new Date(row.starts_at||row.scheduled_start).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'—'}</p></div></div></Card>})}</div></>:<EmptyState icon={kind==='payments'?<CircleDollarSign className="h-5 w-5"/>:<CalendarDays className="h-5 w-5"/>} title={kind==='payments'?'Payments appear here automatically':'No appointments yet'} description={kind==='payments'?'You never handle card details: send an invoice, the customer pays through a Stripe-hosted link, and the confirmed payment lands in this list.':'Appointments are bookings such as site visits or measure-ups. Book them for a job and they appear on the Schedule alongside the work.'} steps={kind==='payments'?['Create an invoice for a job','Mark it sent — Jobrin.ai emails a secure payment link','The customer pays; Stripe confirms it and the payment is recorded here']:['Create the job first (Jobs page)','Book the site visit — it shows on the Schedule next to the job']} action={kind==='payments'?undefined:<AppLink href="/app/schedule" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Open the Schedule</AppLink>}/>}</Page>;
}

function FinancialDocumentsPage({kind}:{kind:'quotes'|'invoices'}) {
  const {workspaceId}=useAuth();
  const records=useData<any>(`/api/operations/${kind}`,{[kind]:[]});
  const customers=useData<any>('/api/crm/customers',{customers:[]});
  const jobs=useData<any>('/api/operations/jobs',{jobs:[]});
  const singular=kind==='quotes'?'quote':'invoice';
  const title=kind==='quotes'?'Quotes':'Invoices';
  const requestedJobId=new URLSearchParams(window.location.search).get('job')||'';
  const [open,setOpen]=useState(false);const [step,setStep]=useState(0);const [busy,setBusy]=useState<boolean|string>(false);const [error,setError]=useState('');const [created,setCreated]=useState<any>(null);const [paymentLink,setPaymentLink]=useState('');
  const [rowBusy,setRowBusy]=useState('');const [notice,setNotice]=useState('');
  const [form,setForm]=useState({customer_id:'',job_id:'',date:'',notes:'',terms:'',deposit_dollars:'',items:[{description:'',quantity:1,unit_price_dollars:'',gst:true}]});
  useEffect(()=>{if(!requestedJobId||form.job_id||!jobs.data.jobs.length)return;const requested=jobs.data.jobs.find((job:any)=>job.id===requestedJobId);if(requested){setForm(value=>({...value,customer_id:requested.customer_id,job_id:requested.id}));setOpen(true)}},[requestedJobId,jobs.data.jobs,form.job_id]);
  const availableJobs=jobs.data.jobs.filter((j:any)=>!form.customer_id||j.customer_id===form.customer_id);
  const totals=form.items.reduce((t,item)=>{const subtotal=Math.round(Number(item.quantity||0)*Number(item.unit_price_dollars||0)*100);return {subtotal:t.subtotal+subtotal,gst:t.gst+(item.gst?Math.round(subtotal*.1):0)}},{subtotal:0,gst:0});
  const reset=()=>{setForm({customer_id:'',job_id:'',date:'',notes:'',terms:'',deposit_dollars:'',items:[{description:'',quantity:1,unit_price_dollars:'',gst:true}]});setStep(0);setError('');setCreated(null);setOpen(true)};
  const next=(e:React.FormEvent)=>{e.preventDefault();setError('');if(step===0&&!form.customer_id)return setError('Choose a customer before continuing.');if(step===1&&form.items.some(i=>!i.description.trim()||Number(i.quantity)<=0||Number(i.unit_price_dollars)<0))return setError('Complete every line item before continuing.');setStep(v=>Math.min(v+1,2))};
  const updateItem=(index:number,patch:any)=>setForm(v=>({...v,items:v.items.map((item,i)=>i===index?{...item,...patch}:item)}));
  const create=async()=>{if(!workspaceId)return;setBusy(true);setError('');try{const body:any={customer_id:form.customer_id,job_id:form.job_id||null,items:form.items.map(i=>({description:i.description.trim(),quantity:Number(i.quantity),unit_price_cents:Math.round(Number(i.unit_price_dollars)*100),gst_rate:i.gst ? 0.1 : 0}))};if(kind==='quotes'){body.expires_at=form.date?new Date(`${form.date}T23:59:59`).toISOString():null;body.terms=form.terms;body.notes=form.notes;body.deposit_cents=Math.round(Number(form.deposit_dollars||0)*100)}else body.due_at=form.date?new Date(`${form.date}T23:59:59`).toISOString():null;const result=await apiFetch<any>(`/api/operations/${kind}`,{method:'POST',body:JSON.stringify(body)},workspaceId);setCreated(result[singular]);await records.refresh()}catch(err:any){setError(err.message)}finally{setBusy(false)}};
  const createPaymentLink=async(invoiceId:string)=>{if(!workspaceId)return;setBusy(invoiceId);setError('');setPaymentLink('');try{const result=await apiFetch<any>(`/api/operations/invoices/${invoiceId}/checkout`,{method:'POST',headers:{'idempotency-key':crypto.randomUUID()}},workspaceId);setPaymentLink(result.checkoutUrl);try{await navigator.clipboard.writeText(result.checkoutUrl)}catch{/* The visible field remains available when clipboard access is denied. */}}catch(err:any){setError(err.message)}finally{setBusy(false)}};
  const rows=records.data[kind]||[];
  const [statusFilter,setStatusFilter]=useState('all');const [search,setSearch]=useState('');
  const docStatuses=Array.from(new Set<string>(rows.map((row:any)=>String(row.status))));
  const filtered=rows.filter((row:any)=>(statusFilter==='all'||row.status===statusFilter)&&(!search.trim()||JSON.stringify([row.quote_number,row.invoice_number,row.customers?.display_name,row.status]).toLowerCase().includes(search.trim().toLowerCase())));
  const quoteAction=async(row:any,action:'send'|'link'|'convert'|'void')=>{if(!workspaceId)return;setRowBusy(row.id);setNotice('');try{
    if(action==='send'){const result=await apiFetch<any>(`/api/operations/quotes/${row.id}/send`,{method:'PATCH'},workspaceId);try{await navigator.clipboard.writeText(result.shareUrl)}catch{/* The link stays visible in the notice. */}setNotice(`Quote #${result.quote.quote_number} sent. Customer link (copied): ${result.shareUrl}${result.delivery==='sent'?' · Emailed':result.delivery==='not_configured'?' · Email delivery not configured yet — copy the link':' · Email could not be delivered — copy the link'}`)}
    else if(action==='link'){const result=await apiFetch<any>(`/api/operations/quotes/${row.id}/link`,{method:'POST'},workspaceId);try{await navigator.clipboard.writeText(result.shareUrl)}catch{/* The link stays visible in the notice. */}setNotice(`Fresh customer link (copied): ${result.shareUrl}`)}
    else if(action==='void'){if(!window.confirm(`Void quote #${row.quote_number}? The customer link will stop working and this cannot be undone.`)){setRowBusy('');return}const result=await apiFetch<any>(`/api/operations/quotes/${row.id}/void`,{method:'PATCH',body:JSON.stringify({reason:''})},workspaceId);setNotice(`Quote #${row.quote_number} voided.`)}
    else{const result=await apiFetch<any>(`/api/operations/quotes/${row.id}/convert`,{method:'POST'},workspaceId);setNotice(`Invoice #${result.invoice.invoice_number} created from quote #${row.quote_number}.`)}
    await records.refresh()}catch(err:any){setError(err.message)}finally{setRowBusy('')}};
  const invoiceSend=async(row:any)=>{if(!workspaceId)return;setRowBusy(row.id);setNotice('');try{const result=await apiFetch<any>(`/api/operations/invoices/${row.id}/send`,{method:'PATCH'},workspaceId);const deliveryText=result.delivery==='sent'?'emailed to the customer':result.delivery==='not_configured'?'email delivery is not configured yet, it is marked sent':result.delivery==='no_customer_email'?'the customer has no email on file, it is marked sent':'marked sent, but the email could not be delivered';setNotice(`Invoice #${result.invoice.invoice_number} ${deliveryText}.${result.paymentUrl?' Payment link included in the email.':''}`);await records.refresh()}catch(err:any){setError(err.message)}finally{setRowBusy('')}};
  const downloadPdf=async(row:any)=>{if(!workspaceId)return;setRowBusy(row.id);setError('');try{const {data:sessionData}=await supabase.auth.getSession();const token=sessionData.session?.access_token;if(!token)throw new Error('Your session expired. Please sign in again.');const response=await fetch(`/api/operations/${kind}/${row.id}/pdf`,{headers:{Authorization:`Bearer ${token}`,'x-workspace-id':workspaceId}});if(!response.ok)throw new Error('The PDF could not be generated.');const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${singular}-${row.quote_number||row.invoice_number}.pdf`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url)}catch(err:any){setError(err.message)}finally{setRowBusy('')}};
  return <Page title={title} eyebrow={kind==='quotes'?'Price work clearly':'Money owed'} description={kind==='quotes'?'Create a quote, send the customer a secure link, and they accept or decline online. Accepted quotes convert into invoices with one click — no printing, no PDFs, no lost versions.':'Draft an invoice, mark it sent, and Jobrin.ai emails the customer a secure Stripe payment link. Payments settle automatically and appear under Payments.'} action={<PrimaryButton onClick={reset}><Plus className="mr-2 inline h-4 w-4"/>New {singular}</PrimaryButton>}>
    {notice&&<Card className="mb-5 border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900"><p className="break-all">{notice}</p></Card>}
    {open&&<Card className="mb-6 overflow-hidden"><div className="grid grid-cols-3 gap-2 border-b border-slate-100 bg-slate-50 p-5">{['Customer & job','Line items','Review'].map((label,index)=><div key={label}><div className={`h-1.5 rounded-full ${index<=step?'bg-indigo-600':'bg-slate-200'}`}/><p className={`mt-2 text-xs font-semibold ${index===step?'text-indigo-700':'text-slate-500'}`}>{index+1}. {label}</p></div>)}</div><div className="p-6">{created?<div className="py-3 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-7 w-7"/></div><h2 className="mt-4 text-2xl font-black">Draft {singular} created</h2><p className="mt-2 text-sm text-slate-500">It is saved securely as a draft. Sending will remain disabled until email delivery and public document security are connected.</p><div className="mt-6 flex justify-center gap-2"><PrimaryButton onClick={()=>setOpen(false)}>View {kind}</PrimaryButton><SecondaryButton onClick={reset}>Create another</SecondaryButton></div></div>:<form onSubmit={next}>
      {step===0&&<div><h2 className="text-xl font-bold">Connect this {singular}</h2><p className="mt-1 text-sm text-slate-500">Choose the customer and, where relevant, the job it belongs to.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><SelectField label="Customer" value={form.customer_id} onChange={e=>setForm(v=>({...v,customer_id:e.target.value,job_id:''}))} required><option value="">Choose a customer…</option>{customers.data.customers.map((c:any)=><option key={c.id} value={c.id}>{c.display_name}</option>)}</SelectField><SelectField label="Related job (optional)" value={form.job_id} onChange={e=>setForm(v=>({...v,job_id:e.target.value}))}><option value="">No related job</option>{availableJobs.map((j:any)=><option key={j.id} value={j.id}>{j.title}</option>)}</SelectField><Field label={kind==='quotes'?'Expiry date (optional)':'Due date (optional)'} type="date" value={form.date} onChange={e=>setForm(v=>({...v,date:e.target.value}))}/></div></div>}
      {step===1&&<div><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">What are you charging for?</h2><p className="mt-1 text-sm text-slate-500">Jobrin.ai calculates totals and GST on the server.</p></div><SecondaryButton type="button" onClick={()=>setForm(v=>({...v,items:[...v.items,{description:'',quantity:1,unit_price_dollars:'',gst:true}]}))}>Add line</SecondaryButton></div><div className="mt-5 space-y-3">{form.items.map((item,index)=><div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_100px_140px_auto]"><Field label="Description" value={item.description} onChange={e=>updateItem(index,{description:e.target.value})} required/><Field label="Quantity" type="number" min="0.001" step="0.001" value={item.quantity} onChange={e=>updateItem(index,{quantity:Number(e.target.value)})} required/><Field label="Unit price (AUD)" type="number" min="0" step="0.01" value={item.unit_price_dollars} onChange={e=>updateItem(index,{unit_price_dollars:e.target.value})} required/><div className="flex items-end gap-2 pb-2"><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={item.gst} onChange={e=>updateItem(index,{gst:e.target.checked})}/>GST</label>{form.items.length>1&&<button type="button" onClick={()=>setForm(v=>({...v,items:v.items.filter((_,i)=>i!==index)}))} className="text-xs font-bold text-red-600">Remove</button>}</div></div>)}</div>{kind==='quotes'&&<div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Deposit requested (AUD)" type="number" min="0" step="0.01" value={form.deposit_dollars} onChange={e=>setForm(v=>({...v,deposit_dollars:e.target.value}))}/><TextareaField label="Terms" value={form.terms} onChange={e=>setForm(v=>({...v,terms:e.target.value}))}/><div className="sm:col-span-2"><TextareaField label="Internal notes" value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))}/></div></div>}</div>}
      {step===2&&<div><h2 className="text-xl font-bold">Review the draft</h2><p className="mt-1 text-sm text-slate-500">Nothing will be sent to the customer yet.</p><div className="mt-5 rounded-xl border border-slate-200 p-5"><div className="space-y-3">{form.items.map((item,index)=><div key={index} className="flex justify-between gap-4 text-sm"><span>{item.description} × {item.quantity}</span><span className="font-semibold"><Money cents={Math.round(Number(item.quantity)*Number(item.unit_price_dollars)*100)}/></span></div>)}</div><div className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm"><div className="flex justify-between"><span>Subtotal</span><Money cents={totals.subtotal}/></div><div className="flex justify-between"><span>GST</span><Money cents={totals.gst}/></div><div className="flex justify-between text-lg font-black"><span>Total</span><Money cents={totals.subtotal+totals.gst}/></div></div></div></div>}
      {error&&<p className="mt-4 text-sm font-medium text-red-600">{error}</p>}<div className="mt-6 flex justify-between gap-2">{step>0?<SecondaryButton type="button" onClick={()=>{setError('');setStep(v=>v-1)}}>Back</SecondaryButton>:<span/>}{step<2?<PrimaryButton>Save & continue <ArrowRight className="ml-1 inline h-4 w-4"/></PrimaryButton>:<PrimaryButton type="button" disabled={Boolean(busy)} onClick={create}>{busy?'Creating…':`Create draft ${singular}`}</PrimaryButton>}</div>
    </form>}</div></Card>}
    {error&&!open&&<div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}{paymentLink&&<Card className="mb-4 p-4"><p className="text-sm font-bold text-emerald-700">Secure Stripe payment link created and copied</p><p className="mt-1 text-xs text-slate-500">Card and bank details are entered only on Stripe. Share this link with the intended customer.</p><input readOnly value={paymentLink} onFocus={e=>e.currentTarget.select()} className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"/></Card>}
    {records.loading?<Spinner/>:records.error?<ErrorBox message={records.error} onRetry={records.refresh}/>:rows.length?<><div className="mb-4 flex flex-wrap items-center gap-2">{['all',...docStatuses].map((status)=><button key={status} onClick={()=>setStatusFilter(status)} className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize ${statusFilter===status?'bg-slate-950 text-white':'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>{status==='all'?'All':status}</button>)}<input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label="Search documents" placeholder="Search…" className="ml-auto w-44 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"/></div><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Record</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Actions</th>{kind==='invoices'&&<th className="px-4 py-3 text-right">Payment</th>}</tr></thead><tbody>{filtered.map((row:any)=><tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">#{row.quote_number||row.invoice_number}</td><td className="px-4 py-3 text-slate-500">{row.customers?.display_name||'—'}</td><td className="px-4 py-3"><StatusPill>{row.status}</StatusPill></td><td className="px-4 py-3 text-right font-semibold"><Money cents={row.total_cents||0}/></td><td className="px-4 py-3 text-right"><div className="flex flex-wrap justify-end gap-2">{kind==='quotes'?<>{row.status==='draft'?<SecondaryButton disabled={rowBusy===row.id} onClick={()=>quoteAction(row,'send')}>{rowBusy===row.id?'Sending…':'Send to customer'}</SecondaryButton>:row.status==='accepted'?<SecondaryButton disabled={rowBusy===row.id} onClick={()=>quoteAction(row,'convert')}>{rowBusy===row.id?'Converting…':'Convert to invoice'}</SecondaryButton>:['sent','viewed','declined'].includes(row.status)?<SecondaryButton disabled={rowBusy===row.id} onClick={()=>quoteAction(row,'link')}>{rowBusy===row.id?'Preparing…':'Get customer link'}</SecondaryButton>:<span className="text-xs text-slate-400">—</span>}{['draft','sent','viewed','awaiting_approval'].includes(row.status)&&<SecondaryButton disabled={rowBusy===row.id} onClick={()=>quoteAction(row,'void')}>{rowBusy===row.id?'Voiding…':'Void'}</SecondaryButton>}</>:(row.status==='draft'?<SecondaryButton disabled={rowBusy===row.id} onClick={()=>invoiceSend(row)}>{rowBusy===row.id?'Sending…':'Mark sent & email'}</SecondaryButton>:<span className="text-xs text-slate-400">Sent</span>)}<SecondaryButton disabled={rowBusy===row.id} onClick={()=>downloadPdf(row)}>{rowBusy===row.id?'Preparing…':'Download PDF'}</SecondaryButton></div></td>{kind==='invoices'&&<td className="px-4 py-3 text-right">{Number(row.balance_due_cents)>0&&!['void','refunded'].includes(row.status)?<SecondaryButton disabled={busy===row.id} onClick={()=>createPaymentLink(row.id)}>{busy===row.id?'Creating…':'Secure payment link'}</SecondaryButton>:<span className="text-xs text-slate-400">Settled</span>}</td>}</tr>)}</tbody></table></div></Card></>:<EmptyState icon={kind==='quotes'?<FileText className="h-5 w-5"/>:<ReceiptText className="h-5 w-5"/>} title={kind==='quotes'?'No quotes yet':'No invoices yet'} description={kind==='quotes'?'A quote is a clear price for agreed work. Customers see the full breakdown, including GST, on a secure page — and you see the moment they accept.':'An invoice is how completed work turns into money in the bank. Create it from a job, send it, and let Stripe collect the payment securely.'} steps={kind==='quotes'?['Create a draft with line items — GST is calculated for you','Send it: the customer gets a secure review link','When they accept, convert it to an invoice in one click']:['Create a draft from the job','Mark it sent — the customer gets a payment link by email','Payment settles automatically and shows under Payments']} action={<PrimaryButton onClick={reset}><Plus className="mr-2 inline h-4 w-4"/>Create your first {singular}</PrimaryButton>}/>}
  </Page>;
}

function JobsWorkflowPage() {
  const {workspaceId}=useAuth();
  const jobs=useData<any>('/api/operations/jobs',{jobs:[]});
  const customers=useData<any>('/api/crm/customers',{customers:[]});
  const initialCustomer=new URLSearchParams(window.location.search).get('customer')||'';
  const [open,setOpen]=useState(Boolean(initialCustomer));
  const [step,setStep]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [created,setCreated]=useState<any>(null);
  const [form,setForm]=useState({customer_id:initialCustomer,title:'',description:'',address_text:'',scheduled_start:'',scheduled_end:''});
  const steps=['Customer','Job details','Schedule','Review'];
  const selectedCustomer=customers.data.customers.find((c:any)=>c.id===form.customer_id);
  const [jobStatusFilter,setJobStatusFilter]=useState('all');const [jobSearch,setJobSearch]=useState('');
  const jobStatuses=Array.from(new Set<string>(jobs.data.jobs.map((job:any)=>String(job.status))));
  const filteredJobs=jobs.data.jobs.filter((job:any)=>(jobStatusFilter==='all'||job.status===jobStatusFilter)&&(!jobSearch.trim()||JSON.stringify([job.title,job.customers?.display_name,job.status]).toLowerCase().includes(jobSearch.trim().toLowerCase())));
  const reset=()=>{setForm({customer_id:'',title:'',description:'',address_text:'',scheduled_start:'',scheduled_end:''});setStep(0);setCreated(null);setError('');setOpen(true)};
  const continueStep=(e:React.FormEvent)=>{e.preventDefault();setError('');if(step===0&&!form.customer_id)return setError('Choose a customer before continuing.');if(step===1&&!form.title.trim())return setError('Add a short job title before continuing.');if(step===2&&Boolean(form.scheduled_start)!==Boolean(form.scheduled_end))return setError('Add both a start and finish time, or leave both blank to schedule later.');setStep(v=>Math.min(v+1,3))};
  const create=async()=>{if(!workspaceId)return;setBusy(true);setError('');try{const result=await apiFetch<any>('/api/operations/jobs',{method:'POST',body:JSON.stringify({customer_id:form.customer_id,title:form.title.trim(),description:form.description.trim(),address_text:form.address_text.trim()||null,scheduled_start:form.scheduled_start?new Date(form.scheduled_start).toISOString():null,scheduled_end:form.scheduled_end?new Date(form.scheduled_end).toISOString():null})},workspaceId);setCreated(result.job);await jobs.refresh()}catch(err:any){setError(err.message)}finally{setBusy(false)}};
  const setStart=(value:string)=>{setForm(v=>{const start=value?new Date(value):null;const end=start?new Date(start.getTime()+60*60*1000):null;return {...v,scheduled_start:value,scheduled_end:end?`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}T${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}`:''}})};
  return <Page title="Jobs" eyebrow="Guided job workflow" action={<PrimaryButton onClick={reset}><Plus className="mr-2 inline h-4 w-4"/>New job</PrimaryButton>}>
    {open&&<Card className="mb-6 overflow-hidden"><div className="border-b border-slate-100 bg-slate-50 p-5"><div className="grid grid-cols-4 gap-2">{steps.map((label,index)=><div key={label}><div className={`h-1.5 rounded-full ${index<=step?'bg-indigo-600':'bg-slate-200'}`}/><p className={`mt-2 text-xs font-semibold ${index===step?'text-indigo-700':'text-slate-500'}`}>{index+1}. {label}</p></div>)}</div></div>
      <div className="p-6">{created?<div className="py-3 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-7 w-7"/></div><h2 className="mt-4 text-2xl font-black">Job created</h2><p className="mt-2 text-sm text-slate-500">{created.title} is saved securely. Choose what you want to do next.</p><div className="mt-6 flex flex-wrap justify-center gap-2"><PrimaryButton onClick={()=>{setOpen(false);setCreated(null)}}>View jobs</PrimaryButton><SecondaryButton onClick={reset}>Create another job</SecondaryButton><SecondaryButton onClick={()=>navigate('/app/schedule')}>Open schedule</SecondaryButton></div></div>:<form onSubmit={continueStep}>
        {step===0&&<div><h2 className="text-xl font-bold">Who is this job for?</h2><p className="mt-1 text-sm text-slate-500">Select the customer so every later quote, invoice and payment can stay connected.</p><div className="mt-5"><SelectField label="Customer" value={form.customer_id} onChange={e=>setForm(v=>({...v,customer_id:e.target.value}))} required><option value="">Choose a customer…</option>{customers.data.customers.map((c:any)=><option key={c.id} value={c.id}>{c.display_name}</option>)}</SelectField></div>{!customers.loading&&!customers.data.customers.length&&<div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Add a customer before creating a job. <AppLink href="/app/customers" className="font-bold underline">Create customer</AppLink></div>}</div>}
        {step===1&&<div><h2 className="text-xl font-bold">What work needs doing?</h2><p className="mt-1 text-sm text-slate-500">Give the team enough context to understand the outcome and location.</p><div className="mt-5 grid gap-4"><Field label="Job title" value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))} required placeholder="Repair leaking kitchen tap"/><TextareaField label="Description" value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))} placeholder="Scope, access notes, parts or customer expectations"/><Field label="Job address" value={form.address_text} onChange={e=>setForm(v=>({...v,address_text:e.target.value}))} placeholder="Street, suburb and postcode"/></div></div>}
        {step===2&&<div><h2 className="text-xl font-bold">When should it happen?</h2><p className="mt-1 text-sm text-slate-500">Add the booking now, or leave both fields blank and schedule it later.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Start" type="datetime-local" value={form.scheduled_start} onChange={e=>setStart(e.target.value)}/><Field label="Finish" type="datetime-local" value={form.scheduled_end} onChange={e=>setForm(v=>({...v,scheduled_end:e.target.value}))}/></div></div>}
        {step===3&&<div><h2 className="text-xl font-bold">Review and create</h2><p className="mt-1 text-sm text-slate-500">Confirm the details before Jobrin.ai creates the operational record.</p><div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">{[['Customer',selectedCustomer?.display_name||'—'],['Job',form.title],['Address',form.address_text||'Not added'],['Schedule',form.scheduled_start?`${new Date(form.scheduled_start).toLocaleString('en-AU')} → ${new Date(form.scheduled_end).toLocaleString('en-AU')}`:'Schedule later']].map(([label,value])=><div key={label} className="flex gap-4 p-4 text-sm"><span className="w-24 flex-none font-semibold text-slate-500">{label}</span><span className="font-medium text-slate-900">{value}</span></div>)}</div></div>}
        {error&&<p className="mt-4 text-sm font-medium text-red-600">{error}</p>}<div className="mt-6 flex flex-wrap justify-between gap-2">{step>0?<SecondaryButton type="button" onClick={()=>{setError('');setStep(v=>v-1)}}>Back</SecondaryButton>:<span/>}{step<3?<PrimaryButton disabled={customers.loading}>{step===0?'Save & continue to job details':step===1?'Save & continue to schedule':'Save & continue to review'} <ArrowRight className="ml-1 inline h-4 w-4"/></PrimaryButton>:<PrimaryButton type="button" disabled={busy} onClick={create}>{busy?'Creating job…':'Create job & complete'}</PrimaryButton>}</div>
      </form>}</div></Card>}
    {jobs.loading?<Spinner/>:jobs.error?<ErrorBox message={jobs.error} onRetry={jobs.refresh}/>:jobs.data.jobs.length?<><div className="mb-4 flex flex-wrap items-center gap-2">{['all',...jobStatuses].map((status)=><button key={status} onClick={()=>setJobStatusFilter(status)} className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize ${jobStatusFilter===status?'bg-slate-950 text-white':'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>{status==='all'?'All':status}</button>)}<input value={jobSearch} onChange={(event)=>setJobSearch(event.target.value)} aria-label="Search jobs" placeholder="Search jobs…" className="ml-auto w-44 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"/></div><Card className="hidden overflow-hidden md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Job</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Scheduled</th></tr></thead><tbody>{filteredJobs.map((job:any)=><tr key={job.id} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold"><AppLink href={`/app/jobs/${job.id}`} className="font-semibold hover:text-indigo-700">{job.title}</AppLink></td><td className="px-4 py-3 text-slate-500">{job.customers?.display_name||'—'}</td><td className="px-4 py-3"><StatusPill tone={job.status==='completed'?'green':'slate'}>{job.status}</StatusPill></td><td className="px-4 py-3 text-right text-slate-600">{job.scheduled_start?new Date(job.scheduled_start).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'Not scheduled'}</td></tr>)}</tbody></table></Card><div className="space-y-2 md:hidden">{filteredJobs.map((job:any)=><Card key={job.id} className="p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><AppLink href={`/app/jobs/${job.id}`} className="text-sm font-semibold hover:text-indigo-700">{job.title}</AppLink><p className="text-xs text-slate-500">{job.customers?.display_name||'—'}</p></div><div className="flex-none text-right"><StatusPill tone={job.status==='completed'?'green':'slate'}>{job.status}</StatusPill><p className="mt-1 text-xs font-semibold text-slate-600">{job.scheduled_start?new Date(job.scheduled_start).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'Not scheduled'}</p></div></div></Card>)}</div></>:<EmptyState icon={<FileCheck2 className="h-5 w-5"/>} title="No jobs yet" description="A job is the thread that ties work together: the customer, the schedule, the quote, the invoice and the payment all hang off it. Create the first job and Jobrin.ai keeps every record connected from schedule to payment." steps={['Pick the customer (or add one on the spot)','Describe the work and the address','Schedule it now or leave it unscheduled until you confirm a time']} action={<PrimaryButton onClick={reset}><Plus className="mr-2 inline h-4 w-4"/>Create your first job</PrimaryButton>}/>}
  </Page>;
}

export function BillingPage() {
  const {workspaceId}=useAuth();const query=useData<any>('/api/billing/status',{subscription:null,entitlements:[],usage:[],stripeConfigured:false});const [busy,setBusy]=useState('');const [error,setError]=useState('');
  const checkout=async(plan:string)=>{if(!workspaceId)return;setBusy(plan);setError('');try{const result=await apiFetch<any>('/api/billing/checkout',{method:'POST',headers:{'idempotency-key':crypto.randomUUID()},body:JSON.stringify({plan})},workspaceId);window.location.assign(result.checkoutUrl)}catch(err:any){if(err instanceof ApiError&&err.code==='ACTIVE_SUBSCRIPTION_EXISTS')return portal();setError(err.message);setBusy('')}};
  const portal=async()=>{if(!workspaceId)return;setBusy('portal');setError('');try{const result=await apiFetch<any>('/api/billing/portal',{method:'POST'},workspaceId);window.location.assign(result.portalUrl)}catch(err:any){setError(err.message);setBusy('')}};
  const entitlement=new Map<string,number>((query.data.entitlements||[]).map((item:any):[string,number]=>[String(item.feature_key),Number(item.limit_value||0)]));
  const usage=new Map<string,number>((query.data.usage||[]).map((item:any):[string,number]=>[String(item.metric_key),Number(item.quantity||0)]));
  const meters:Array<[string,string]>=[['usage.users','Team members'],['usage.sms','SMS actions this month'],['usage.ai_actions','AI Admin actions this month']];
  return <Page title="Billing" eyebrow="Stripe subscriptions" description="Your subscription price, included monthly usage and current consumption are shown together. Limits are enforced on the server. Provider charges from Twilio, OpenAI, Resend and Stripe are separate." action={query.data.subscription?.stripe_customer_id?<SecondaryButton disabled={!!busy} onClick={portal}><ExternalLink className="mr-2 inline h-4 w-4"/>Manage in Stripe</SecondaryButton>:undefined}>{query.loading?<Spinner/>:<>{(()=>{const s=(query.data.subscription||{}) as any;const now=Date.now();const active=s.status==='active'||(s.status==='trialing'&&s.trial_ends_at&&new Date(s.trial_ends_at).getTime()>now)||(s.status==='past_due'&&s.grace_period_ends_at&&new Date(s.grace_period_ends_at).getTime()>now);return !active?<div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">Your subscription is not active.</p><p className="mt-1">The workspace stays locked to this page until a plan is running. Choose a plan below to restore access — your data is safe and waiting.</p></div>:null})()}<Card className="mb-6 p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold text-slate-500">Current plan</p><h2 className="mt-1 text-2xl font-black capitalize">{query.data.subscription?.plan||'starter'}</h2><p className="mt-1 text-sm text-slate-500">Status: {query.data.subscription?.status||'not active'}{query.data.subscription?.status==='trialing'&&query.data.subscription?.trial_ends_at?` · trial ends ${new Date(query.data.subscription.trial_ends_at).toLocaleDateString('en-AU')}`:''}{query.data.subscription?.status==='past_due'&&query.data.subscription?.grace_period_ends_at?` · grace until ${new Date(query.data.subscription.grace_period_ends_at).toLocaleDateString('en-AU')}`:''}</p></div><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600"/><span className="text-sm font-semibold">Stripe-hosted secure billing</span></div></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{meters.map(([key,label])=>{const used=usage.get(key)||0;const limit=entitlement.get(key)||0;return <div key={key} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-black">{used.toLocaleString()} <span className="text-xs font-medium text-slate-400">/ {limit.toLocaleString()}</span></p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-indigo-500" style={{width:`${limit?Math.min(100,(used/limit)*100):0}%`}}/></div></div>})}</div><p className="mt-4 text-xs text-slate-500">AI Admin actions are completed model-assisted tasks or turns, not raw model tokens. Legacy credit-wallet tables are not used for subscription charging.</p></Card>{error&&<div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}{/MFA_REQUIRED/i.test(error)&&<button onClick={()=>navigate('/app/settings/security')} className="ml-2 font-bold underline">Set up MFA</button>}</div>}<div className="grid gap-4 lg:grid-cols-3">{PLAN_KEYS.map((key)=>{const plan=PLAN_CATALOG[key];return <Card key={key} className="p-6"><h3 className="text-lg font-bold">{plan.name}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{plan.description}</p><div className="mt-5"><span className="text-4xl font-black">${plan.monthlyAud}</span><span className="text-sm text-slate-500"> / month AUD</span></div><ul className="mt-4 space-y-2">{plan.highlights.map(item=><li key={item} className="text-xs text-slate-600">✓ {item}</li>)}</ul><PrimaryButton disabled={!query.data.stripeConfigured||!!busy||query.data.subscription?.plan===key} onClick={()=>checkout(key)} className="mt-5 w-full">{busy===key?'Opening Stripe…':query.data.subscription?.plan===key?'Current plan':`Choose ${plan.name}`}</PrimaryButton></Card>})}</div>{!query.data.stripeConfigured&&<div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Stripe server keys, webhook signing secret and all three Price IDs are not configured in this environment yet. Checkout stays disabled instead of simulating payment success.</div>}</>}</Page>;
}

const receptionistDefaults={enabled:false,display_name:'Jobrin.ai Receptionist',greeting:'Thanks for calling. How can I help you today?',voice_provider:'Google',voice_id:'en-AU-Chirp3-HD-Achernar',language:'en-AU',tone:'warm, calm and professional',business_instructions:'Answer questions using approved business knowledge. Ask one question at a time. Never invent prices, availability, policies or completed actions.',qualification_questions:['What can we help you with?','What suburb is the job in?','How urgent is the work?'],transfer_number:null,after_hours_message:'The team is unavailable right now. I can take a message and arrange a callback.',allow_booking:false,allow_warm_transfer:true,allow_message_take:true,allow_followup_sms:false,recording_enabled:false,recording_consent_prompt:'This call may be recorded to help the business follow up. Is that okay?',approved_pricing_language:'A team member will confirm pricing after reviewing the request.',custom_escalation_rules:[] as string[],callback_window:'within one business day',after_hours_rule:'',max_concurrent_calls:2,max_calls_per_caller_hour:3,max_call_minutes:15,max_call_turns:40};
const voiceOptions:any={Google:[['en-AU-Chirp3-HD-Achernar','Australian — calm'],['en-AU-Chirp3-HD-Kore','Australian — warm'],['en-US-Journey-O','US — conversational']],Amazon:[['Olivia-Neural','Australian — Olivia'],['Joanna-Neural','US — Joanna'],['Matthew-Neural','US — Matthew']],ElevenLabs:[['UgBBYS2sOqTuMpoF3BR0','Natural default']]};
function ReceptionistOutcomes({calls,pendingApprovals}:{calls:any[];pendingApprovals:number}) {
  const total=calls.length;
  const answered=calls.filter((c:any)=>c.status==='completed').length;
  const missed=calls.filter((c:any)=>c.missed===true).length;
  const stats=[
    {label:'Calls logged',value:total,note:'all time'},
    {label:'Answered',value:answered,note:total?`${Math.round((answered/total)*100)}% of calls`:'no calls yet'},
    {label:'Missed',value:missed,note:missed?'review these first':'none missed'},
    {label:'Awaiting approval',value:pendingApprovals,note:pendingApprovals?'needs a decision':'nothing pending'},
  ];
  return <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats.map((s)=><Card key={s.label} className={`p-4 ${s.label==='Missed'&&missed>0?'border-l-4 border-red-400':s.label==='Awaiting approval'&&pendingApprovals>0?'border-l-4 border-amber-400':''}`}><p className="text-xs font-semibold text-slate-500">{s.label}</p><p className="mt-1 text-2xl font-black tracking-tight">{s.value}</p><p className="mt-1 text-[11px] text-slate-400">{s.note}</p></Card>)}</div>;
}
export function ReceptionistPage(){
  const {workspaceId}=useAuth();const query=useData<any>('/api/receptionist',{profile:null,readiness:{}});const calls=useData<any>('/api/receptionist/calls',{calls:[]});const approvals=useData<any>('/api/intelligence/approvals',{approvals:[]});const [form,setForm]=useState<any>(receptionistDefaults);const [message,setMessage]=useState('');const [error,setError]=useState('');const [saving,setSaving]=useState(false);const [simHistory,setSimHistory]=useState<Array<{role:'user'|'assistant';content:string}>>([]);const [simInput,setSimInput]=useState('');const [simBusy,setSimBusy]=useState(false);const [simError,setSimError]=useState('');const [simMode,setSimMode]=useState('receptionist');const [signNote,setSignNote]=useState('');const [signBusy,setSignBusy]=useState(false);
  useEffect(()=>{if(!query.loading)setForm({...receptionistDefaults,...(query.data.profile||{})})},[query.loading,query.data.profile]);
  const save=async()=>{if(!workspaceId)return;setSaving(true);setError('');setMessage('');try{const body={...form,qualification_questions:(form.qualification_questions||[]).filter((q:string)=>q.trim()),custom_escalation_rules:(form.custom_escalation_rules||[]).filter((r:string)=>r.trim()),transfer_number:form.transfer_number||null,approved_pricing_language:form.approved_pricing_language?.trim()||null,callback_window:form.callback_window?.trim()||null,after_hours_rule:form.after_hours_rule?.trim()||null};const result=await apiFetch<any>('/api/receptionist',{method:'PUT',body:JSON.stringify(body)},workspaceId);setForm(result.profile);setMessage('Receptionist settings saved securely.')}catch(err:any){setError(err.message)}finally{setSaving(false)}};
  const sendSim=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId||!simInput.trim())return;const text=simInput;setSimInput('');setSimBusy(true);setSimError('');const history=simHistory;setSimHistory(v=>[...v,{role:'user',content:text}]);try{const result=await apiFetch<any>('/api/receptionist/simulate',{method:'POST',body:JSON.stringify({message:text,history,mode:simMode})},workspaceId);setSimHistory(v=>[...v,{role:'assistant',content:result.reply}]);}catch(err:any){setSimError(err.message||'Preview failed');}finally{setSimBusy(false)}};
  const update=(key:string,value:any)=>setForm((v:any)=>({...v,[key]:value}));
  const goLive=query.data.goLive||{items:[],ready:false,missing:[] as string[],signoff:null as null|{decided_at:string;decided_by:string;decision_note:string|null}};
  const signoff=goLive.signoff||null;
  const goLiveItems=(goLive.items||[]) as Array<{key:string;label:string;ok:boolean;fix:string}>;
  const otherChecks=goLiveItems.filter((item)=>item.key!=='signoff');
  const signoffReady=otherChecks.length>0&&otherChecks.every((item)=>item.ok);
  const notReady=goLive.missing||[];
  const itemHref:Record<string,string|null>={twilio:'/app/integrations',profile:'/onboarding',knowledge:'/app/knowledge'};
  const recordSignoff=async()=>{if(!workspaceId||signNote.trim().length<20)return;setSignBusy(true);setError('');try{await apiFetch('/api/receptionist/go-live-signoff',{method:'POST',body:JSON.stringify({note:signNote.trim()})},workspaceId);setSignNote('');await query.refresh()}catch(err:any){setError(err.message)}finally{setSignBusy(false)}};
  const toggles=[
    ['allow_warm_transfer','Warm-transfer to a person','On request or when unsure, the caller is handed to your configured transfer number.'],
    ['allow_message_take','Take a message or callback request','Captures the caller, reason and requested time as a task for the team.'],
  ] as const;
  return <Page title="AI Receptionist" eyebrow="Phone front desk" description="A governed voice receptionist for your business line: it takes messages, transfers to a person, and only answers from approved business facts. Live answering stays locked until readiness checks pass and the owner sign-off is recorded." action={<PrimaryButton disabled={saving||query.loading} onClick={save}>{saving?'Saving…':'Save receptionist'}</PrimaryButton>}>
    {query.loading?<Spinner/>:query.error?<ErrorBox message={query.error} onRetry={query.refresh}/>:<>
    <ReceptionistOutcomes calls={calls.data.calls||[]} pendingApprovals={(approvals.data.approvals||[]).filter((a:any)=>a.status==='pending').length}/>
    <Card className="mb-5 overflow-hidden">
      <div className="jobrin-operator-panel p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-200">Current status</p>
            <h2 className="mt-1 text-2xl font-black">{form.enabled?'Answering live':'Standing by'}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">{form.enabled?'Calls are answered by your receptionist.':'Calls ring through normally. Save settings any time - nothing goes live until the launch controls unlock.'}</p>
          </div>
          <StatusPill tone={form.enabled?'green':'amber'}>{form.enabled?'live':'standby'}</StatusPill>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold text-slate-300">Voice identity</p>
            <p className="mt-1 text-lg font-bold">{form.display_name||'Receptionist'}</p>
            <p className="mt-1 text-xs text-slate-400">{form.voice_provider} voice</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold text-slate-300">Launch readiness</p>
            <p className="mt-1 text-lg font-bold">{goLiveItems.filter((item)=>item.ok).length} of {goLiveItems.length} ready</p>
            <p className="mt-1 text-xs text-slate-400">{notReady.length?`${notReady.length} checks waiting`:'Ready to enable'}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold text-slate-300">Human handoff</p>
            <p className="mt-1 text-lg font-bold">{form.transfer_number?'Configured':'Not set'}</p>
            <p className="mt-1 text-xs text-slate-400">Required before live answering</p>
          </div>
        </div>
      </div>
    </Card>
    <PageIntro>The receptionist introduces itself as a virtual receptionist, answers only from approved knowledge, and transfers or takes a message whenever it is unsure.</PageIntro>
    <div className="jobrin-console-grid">
      <div className="space-y-5">
        <Card className="p-6">
          <div className="jobrin-section-title">
            <div>
              <h2 className="text-lg font-bold">1. Voice and personality</h2>
              <p className="text-xs">The caller-facing name, greeting and speaking style.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4">
            <Field label="Receptionist name" value={form.display_name} onChange={e=>update('display_name',e.target.value)}/>
            <div><TextareaField label="Opening greeting" value={form.greeting} onChange={e=>update('greeting',e.target.value)}/><p className="mt-1 text-[11px] text-slate-500">The first thing callers hear. Keep it warm and short.</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Voice provider" value={form.voice_provider} onChange={e=>{update('voice_provider',e.target.value);update('voice_id',voiceOptions[e.target.value][0][0])}}>{Object.keys(voiceOptions).map(k=><option key={k}>{k}</option>)}</SelectField><SelectField label="Voice" value={form.voice_id} onChange={e=>update('voice_id',e.target.value)}>{voiceOptions[form.voice_provider]?.map(([id,label]:string[])=><option key={id} value={id}>{label}</option>)}</SelectField></div>
            <Field label="Tone and speaking style" value={form.tone} onChange={e=>update('tone',e.target.value)}/>
          </div>
        </Card>
        <Card className="p-6">
          <div className="jobrin-section-title">
            <div>
              <h2 className="text-lg font-bold">2. Behaviour and guardrails</h2>
              <p className="text-xs">Approved boundaries for what it can say and when it must hand off.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4">
            <div><TextareaField label="Business instructions" value={form.business_instructions} onChange={e=>update('business_instructions',e.target.value)}/><p className="mt-1 text-[11px] text-slate-500">Rules of the road: what it may say, what never to do, and when to transfer.</p></div>
            <div><TextareaField label="After-hours or fallback message" value={form.after_hours_message} onChange={e=>update('after_hours_message',e.target.value)}/><p className="mt-1 text-[11px] text-slate-500">Played outside business hours or whenever live answering is off.</p></div>
            <div><Field label="Warm-transfer number (E.164)" placeholder="+61412345678" value={form.transfer_number||''} onChange={e=>update('transfer_number',e.target.value)}/><p className="mt-1 text-[11px] text-slate-500">Your mobile or office line - callers are introduced and transferred here.</p></div>
            <div><TextareaField label="Approved pricing language" value={form.approved_pricing_language||''} onChange={e=>update('approved_pricing_language',e.target.value)}/><p className="mt-1 text-[11px] text-slate-500">The only wording it may use about price - general, non-committal phrasing, never a dollar figure.</p></div>
            <div><Field label="Callback window" value={form.callback_window||''} onChange={e=>update('callback_window',e.target.value)} placeholder="within one business day"/><p className="mt-1 text-[11px] text-slate-500">The only timeframe it may promise when it takes a callback request.</p></div>
            <div><TextareaField label="After-hours handling rule" value={form.after_hours_rule||''} onChange={e=>update('after_hours_rule',e.target.value)} placeholder="Optional - extra instructions for calls near closing time."/><p className="mt-1 text-[11px] text-slate-500">Optional. Extra guidance the receptionist checks close to opening/closing hours.</p></div>
            <div><TextareaField label="Custom escalation rules (one per line)" value={(form.custom_escalation_rules||[]).join('\n')} onChange={e=>update('custom_escalation_rules',e.target.value.split('\n'))} placeholder={'e.g. If the caller mentions a gas leak, transfer immediately\ne.g. If the caller asks for a refund, take a message'}/><p className="mt-1 text-[11px] text-slate-500">Checked on every turn - any match triggers a transfer or message-take.</p></div>
          </div>
        </Card>
        <Card className="p-6">
          <div className="jobrin-section-title">
            <div>
              <h2 className="text-lg font-bold">3. Call handling rules</h2>
              <p className="text-xs">The exact permissions the receptionist has on a live call.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">{toggles.map(([key,label,desc])=><label key={key} className="jobrin-rule-tile flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm"><input type="checkbox" className="mt-1" checked={Boolean(form[key])} onChange={e=>update(key,e.target.checked)}/><span><span className="font-semibold">{label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{desc}</span></span></label>)}<div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Every call starts with an AI-processing disclosure. Recording, autonomous booking and follow-up SMS stay unavailable until their separate consent and policy controls are complete.</div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Max call minutes" type="number" min={5} max={30} value={form.max_call_minutes} onChange={e=>update('max_call_minutes',Number(e.target.value))}/>
            <Field label="Max turns per call" type="number" min={10} max={80} value={form.max_call_turns} onChange={e=>update('max_call_turns',Number(e.target.value))}/>
            <Field label="Max concurrent calls" type="number" min={1} max={5} value={form.max_concurrent_calls} onChange={e=>update('max_concurrent_calls',Number(e.target.value))}/>
            <Field label="Max calls per caller per hour" type="number" min={1} max={6} value={form.max_calls_per_caller_hour} onChange={e=>update('max_calls_per_caller_hour',Number(e.target.value))}/>
            <p className="sm:col-span-2 text-[11px] text-slate-500">Hard limits enforced by the call engine - a call that hits the minute or turn limit wraps up and ends automatically.</p>
          </div>
        </Card>
      </div>
      <div className="space-y-5">
        <Card className="p-5">
          <div className="jobrin-section-title">
            <div>
              <h2 className="font-bold">Readiness checklist</h2>
              <p className="text-xs">Everything that must be green before live answering can be switched on.</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">{goLiveItems.map((check)=><div key={check.key} data-ready={check.ok?'true':'false'} className="jobrin-check-row flex flex-wrap items-start justify-between gap-3 rounded-lg p-3"><div className="flex min-w-0 items-start gap-3"><span className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-black ${check.ok?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{check.ok?'✓':'!'}</span><div className="min-w-0"><p className="text-sm font-semibold">{check.label}</p><p className="text-xs leading-5 text-slate-500">{check.ok?'Ready.':check.fix}</p></div></div>{!check.ok&&itemHref[check.key]&&<AppLink href={itemHref[check.key]} className="text-xs font-bold text-indigo-600">Fix it →</AppLink>}</div>)}</div>
        </Card>
        <Card className="p-5">
          <div className="jobrin-section-title">
            <div>
              <h2 className="font-bold">Try it in text mode</h2>
              <p className="text-xs">A safe preview for AI Admin responses before anything touches customers.</p>
            </div>
          </div>
          <div className="mt-4">{simHistory.length?<div className="mb-3 space-y-2">{simHistory.map((turn:{role:'user'|'assistant';content:string},index:number)=><div key={index} className={`max-w-[88%] rounded-xl px-4 py-2.5 text-sm ${turn.role==='assistant'?'bg-slate-950 text-white':'ml-auto bg-indigo-50 text-slate-800'}`}>{turn.content}</div>)}</div>:<p className="mb-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">Nothing yet - choose a department and enter the task you want it to draft or answer.</p>}{simError&&<p className="mb-2 text-xs font-semibold text-red-600">{simError}</p>}<form onSubmit={sendSim} className="grid gap-2"><select aria-label="AI Admin department" value={simMode} onChange={e=>setSimMode(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700"><option value="receptionist">Receptionist</option><option value="finance">Finance</option><option value="sales">Sales & leads</option><option value="marketing">Marketing</option><option value="support">Customer support</option></select><input aria-label="AI Admin task" value={simInput} onChange={e=>setSimInput(e.target.value)} placeholder="Describe the question or draft you need..." className="min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"/><PrimaryButton disabled={simBusy||!simInput.trim()}>{simBusy?'Drafting...':'Send to AI Admin'}</PrimaryButton></form><p className="mt-2 text-[11px] text-slate-400">The text you enter and approved business knowledge are sent to your configured OpenAI account. Private workspace records are not included automatically. Nothing is sent to customers or the phone network from this preview.</p></div>
        </Card>
        <Card className="p-5">
          <div className="jobrin-section-title">
            <div>
              <h2 className="font-bold">Recent calls</h2>
              <p className="text-xs">Every answered, transferred, messaged or missed call is logged here.</p>
            </div>
          </div>
          <div className="mt-4">{calls.loading?<Spinner/>:calls.data.calls?.length?<div className="overflow-hidden rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Caller</th><th className="px-4 py-3">Handled by</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Duration</th><th className="px-4 py-3 text-right">When</th></tr></thead><tbody>{calls.data.calls.map((call:any)=><tr key={call.id} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{call.from_number||'Unknown'}</td><td className="px-4 py-3 text-slate-500">{(call.answered_by||'').replaceAll('_',' ')||'—'}</td><td className="px-4 py-3"><StatusPill tone={call.status==='in_progress'?'amber':call.status==='completed'?'green':'slate'}>{call.status}</StatusPill></td><td className="px-4 py-3 text-right text-slate-500">{call.duration_seconds?`${Math.max(1,Math.round(Number(call.duration_seconds)/60))} min`:'—'}</td><td className="px-4 py-3 text-right text-slate-500">{call.started_at?new Date(call.started_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'—'}</td></tr>)}</tbody></table></div>:<EmptyState icon={<Phone className="h-5 w-5"/>} title="No calls yet" description="Once your number is live, every inbound call appears in this log with its outcome and duration - your complete phone history." steps={['Connect your Twilio number from the readiness checklist','Switch on live answering once the launch controls unlock','Calls, transfers and messages all land here']}/>}</div>
        </Card>
        <Card className="p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><h2 className="font-bold">4. Go live</h2><p className="mt-1 text-sm leading-6 text-slate-500">The switch stays locked until every check above is green and the owner sign-off below is recorded{notReady.length?`. Currently waiting on: ${notReady.join(', ')}.`:'.'} Saving your settings is always safe.</p></div><label className="flex flex-none items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(form.enabled)} disabled={!goLive.ready} onChange={e=>update('enabled',e.target.checked)}/>Live answering</label></div>{signoff?<div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><p className="font-semibold">Owner sign-off recorded {new Date(signoff.decided_at).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'})} - reviewer {String(signoff.decided_by).slice(0,8)}...</p>{signoff.decision_note&&<p className="mt-1 text-xs leading-5">"{signoff.decision_note}"</p>}</div>:<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="text-sm font-bold text-amber-950">Owner sign-off required before live answering</h3><p className="mt-1 text-xs leading-5 text-amber-900">Only the workspace owner can sign off, after reviewing this setup and the phase-1 behaviour. The review note is stored in the auditable approvals record.</p>{!signoffReady?<p className="mt-2 text-xs font-semibold text-amber-900">Complete the checks above first - sign-off unlocks when they are green.</p>:<div className="mt-3 space-y-2"><TextareaField label="What did you review?" value={signNote} onChange={e=>setSignNote(e.target.value)} placeholder="Reviewed the greeting, guardrails, transfer number and behaviour with the team..." /><div><PrimaryButton disabled={signBusy||signNote.trim().length<20} onClick={recordSignoff}>{signBusy?'Recording...':'Record owner sign-off'}</PrimaryButton></div></div>}</div>}{error&&<p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{message&&<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}</Card>
      </div>
    </div>
    </>}</Page>;
}

export function KnowledgePage() {
  const {workspaceId}=useAuth();const query=useData<any>('/api/intelligence/knowledge',{documents:[]});const [open,setOpen]=useState(false);const [form,setForm]=useState({title:'',source_type:'faq',content:'',approved:false});const [error,setError]=useState('');
  const create=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;try{await apiFetch('/api/intelligence/knowledge',{method:'POST',body:JSON.stringify(form)},workspaceId);setOpen(false);setForm({title:'',source_type:'faq',content:'',approved:false});await query.refresh()}catch(err:any){setError(err.message)}};
  return <Page title="Knowledge" eyebrow="Business truth" description="This is what Jobrin.ai is allowed to know and say on your behalf: approved FAQs, policies, pricing and service details. Anything not approved here stays out of customer answers — the Operator retrieves only what you approve." action={<PrimaryButton onClick={()=>setOpen(!open)}><Plus className="mr-2 inline h-4 w-4"/>Add knowledge</PrimaryButton>}>{open&&<Card className="mb-5 p-5"><form onSubmit={create} className="space-y-3"><Field label="Title" value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))} required/><SelectField label="Type" value={form.source_type} onChange={e=>setForm(v=>({...v,source_type:e.target.value}))}><option value="faq">FAQ</option><option value="policy">Policy</option><option value="manual">Manual note</option><option value="pricing">Pricing</option><option value="website">Website</option></SelectField><TextareaField label="Content" value={form.content} onChange={e=>setForm(v=>({...v,content:e.target.value}))} required/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.approved} onChange={e=>setForm(v=>({...v,approved:e.target.checked}))}/>Approved for Operator retrieval</label>{error&&<p className="text-sm text-red-600">{error}</p>}<PrimaryButton>Save knowledge</PrimaryButton></form></Card>}{query.loading?<Spinner/>:query.data.documents.length?<div className="grid gap-3 md:grid-cols-2">{query.data.documents.map((d:any)=><Card key={d.id} className="p-4"><div className="flex items-start justify-between"><div><p className="font-semibold">{d.title}</p><p className="mt-1 text-xs text-slate-500">{d.source_type}</p></div><StatusPill tone={d.approved?'green':'amber'}>{d.approved?'approved':'draft'}</StatusPill></div></Card>)}</div>:<EmptyState icon={<LibraryBig className="h-5 w-5"/>} title="No business knowledge yet" description="Knowledge documents are the single source of truth the Operator may use when answering customers. If it is not here, Jobrin.ai will not invent it — unanswered questions get escalated to a human instead." steps={['Add FAQs, policies, pricing or service notes','Tick “Approved” so the Operator may retrieve them','Update any time — old versions stay in the audit trail']} action={<PrimaryButton onClick={()=>setOpen(true)}><Plus className="mr-2 inline h-4 w-4"/>Add your first document</PrimaryButton>}/>}</Page>;
}

export function ApprovalsPage() { const {workspaceId}=useAuth(); const query=useData<any>('/api/intelligence/approvals',{approvals:[]}); const decide=async(id:string,decision:string)=>{if(!workspaceId)return;await apiFetch(`/api/intelligence/approvals/${id}/decision`,{method:'POST',body:JSON.stringify({decision,note:''})},workspaceId);await query.refresh()}; return <Page title="Approvals" eyebrow="Human control" description="Review proposed consequential actions here. A decision is audited; Jobrin only executes actions backed by a connected, production-ready executor.">{query.loading?<Spinner/>:query.data.approvals.length?<div className="space-y-3">{query.data.approvals.map((a:any)=><Card key={a.id} className="p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><p className="font-bold">{a.resource_type}</p><StatusPill tone={a.status==='pending'?'amber':a.status==='approved'?'green':'red'}>{a.status}</StatusPill></div><p className="mt-2 text-sm text-slate-600">{a.reason}</p></div>{a.status==='pending'&&<div className="flex gap-2"><SecondaryButton onClick={()=>decide(a.id,'rejected')}>Reject</SecondaryButton><PrimaryButton onClick={()=>decide(a.id,'approved')}>Record approval</PrimaryButton></div>}</div></Card>)}</div>:<EmptyState icon={<ShieldCheck className="h-5 w-5"/>} title="No approvals waiting" description="No proposed consequential actions currently need a human decision. Jobrin’s runnable automations are limited to complete, tested executors." steps={['Consequential proposals are shown before execution','You approve or reject with one click','Every decision is audited with your name on it']} action={<AppLink href="/app/automations" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Set up an automation</AppLink>}/>}</Page> }


export function AutomationsPage() {
  const {workspaceId}=useAuth();const query=useData<any>('/api/intelligence/automations',{automations:[]});const runs=useData<any>('/api/intelligence/automation-runs',{runs:[]});const [open,setOpen]=useState(false);const [busy,setBusy]=useState('');const [error,setError]=useState('');
  const [form,setForm]=useState({name:'',description:'',trigger_key:'job.completed',tool:'business.report',channel:'sms'});
  const create=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;setBusy('create');setError('');try{
    const step=form.tool==='review.request'
      ?{tool:'review.request',input:{channel:form.channel}}
      :{tool:'business.report',input:{question:form.description||'Summarise business performance'}};
    await apiFetch('/api/intelligence/automations',{method:'POST',body:JSON.stringify({name:form.name,description:form.description,trigger_key:form.trigger_key,definition:{conditions:[],steps:[step]},schedule_cron:null,timezone:'Australia/Adelaide'})},workspaceId);setOpen(false);setForm({name:'',description:'',trigger_key:'job.completed',tool:'business.report',channel:'sms'});await query.refresh()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const status=async(id:string,next:string)=>{if(!workspaceId)return;setBusy(id);try{await apiFetch(`/api/intelligence/automations/${id}/status`,{method:'POST',body:JSON.stringify({status:next})},workspaceId);await query.refresh()}finally{setBusy('')}};
  const run=async(id:string)=>{if(!workspaceId)return;setBusy(id);try{await apiFetch(`/api/intelligence/automations/${id}/run`,{method:'POST'},workspaceId);await runs.refresh()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  return <Page title="Automations" eyebrow="Safe autopilot" action={<PrimaryButton onClick={()=>setOpen(!open)}><Plus className="mr-2 inline h-4 w-4"/>New automation</PrimaryButton>}>
    <Card className="mb-5 border-indigo-200 bg-indigo-50 p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-indigo-600"/><div><h2 className="font-bold">Safe autopilot is the default</h2><p className="mt-1 text-sm leading-6 text-slate-600">Only actions with complete, tested executors can be selected here. Customer sends, bookings, refunds and financial commitments remain unavailable until their provider-backed executors are production-ready.</p></div></div></Card>
    {error&&<div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {open&&<Card className="mb-5 p-5"><form onSubmit={create} className="grid gap-3 md:grid-cols-2"><Field label="Automation name" value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} required/><SelectField label="Trigger" value={form.trigger_key} onChange={e=>setForm(v=>({...v,trigger_key:e.target.value}))}><option value="lead.created">New lead</option><option value="appointment.completed">Appointment completed</option><option value="job.completed">Job completed</option><option value="invoice.overdue">Invoice overdue</option></SelectField><SelectField label="Action" value={form.tool} onChange={e=>setForm(v=>({...v,tool:e.target.value}))}><option value="business.report">Business report</option><option value="review.request">Automated review request</option></SelectField>
    {form.tool==='business.report'?<div className="md:col-span-2"><TextareaField label="Report question" value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))}/></div>:<>
      <SelectField label="Send via" value={form.channel} onChange={e=>setForm(v=>({...v,channel:e.target.value}))}><option value="sms">SMS</option><option value="email">Email</option></SelectField>
      <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">When this trigger fires for a job, the customer gets a short message with a link to rate the work — SMS only sends if they've recorded transactional consent and aren't suppressed; email only sends if email delivery is configured. Delivery status and their response appear on the <AppLink href="/app/reviews" className="font-semibold text-indigo-600 underline">Reviews</AppLink> page.</div>
    </>}
    <div><p className="text-sm font-semibold text-slate-700">Production-ready action</p><p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm">{form.tool}</p><p className="mt-1 text-xs text-slate-500">{form.tool==='review.request'?'Sends a consented review request with delivery tracking and captures the customer\'s rated response against the job.':'Calculates revenue received and outstanding invoice totals from Jobrin records.'}</p></div><div className="flex items-end"><PrimaryButton disabled={busy==='create'}>{busy==='create'?'Saving…':'Save as draft'}</PrimaryButton></div></form></Card>}
    {query.loading?<Spinner/>:query.data.automations.length?<div className="grid gap-4 md:grid-cols-2">{query.data.automations.map((a:any)=><Card key={a.id} className="p-5"><div className="flex items-center justify-between"><h3 className="font-bold">{a.name}</h3><StatusPill tone={a.status==='active'?'green':a.status==='paused'?'amber':'slate'}>{a.status}</StatusPill></div><p className="mt-2 text-sm text-slate-500">{a.description||'Business report from Jobrin records'}</p><p className="mt-4 text-xs font-semibold text-indigo-600">Trigger: {a.trigger_key} · v{a.version}</p><div className="mt-4 flex flex-wrap gap-2">{a.status!=='active'?<SecondaryButton disabled={busy===a.id} onClick={()=>status(a.id,'active')}>Activate</SecondaryButton>:<SecondaryButton disabled={busy===a.id} onClick={()=>status(a.id,'paused')}>Pause</SecondaryButton>}<SecondaryButton disabled={a.status!=='active'||busy===a.id} onClick={()=>run(a.id)}>Run test</SecondaryButton></div></Card>)}</div>:<EmptyState icon={<Workflow className="h-5 w-5"/>} title="No automations yet" description="The production-ready builder currently creates deterministic business reports. Provider-backed customer sends, bookings and refunds remain unavailable until their executors are complete." steps={['Name the automation and pick a real business trigger','Write the business question the report should answer','Save it as a draft, activate it, then run a test']} action={<PrimaryButton onClick={()=>setOpen(true)}><Plus className="mr-2 inline h-4 w-4"/>Create your first automation</PrimaryButton>}/>}
    <div className="mt-8"><h2 className="mb-3 font-bold">Recent runs</h2>{runs.data.runs?.length?<Card className="overflow-hidden"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Automation</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Attempts</th><th className="px-4 py-3">Started</th></tr></thead><tbody>{runs.data.runs.map((r:any)=><tr key={r.id} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{r.automations?.name||'Automation'}</td><td className="px-4 py-3"><StatusPill tone={r.status==='completed'?'green':r.status==='failed'?'red':'amber'}>{r.status}</StatusPill></td><td className="px-4 py-3">{r.attempt_count}/{r.max_attempts}</td><td className="px-4 py-3 text-slate-500">{new Date(r.created_at).toLocaleString('en-AU')}</td></tr>)}</tbody></table></Card>:<p className="text-sm text-slate-500">No workflow runs yet.</p>}</div>
  </Page>;
}

function reviewStatusTone(status: string) {
  if (status === 'completed') return 'green';
  if (status === 'sent' || status === 'clicked') return 'amber';
  if (status === 'suppressed' || status === 'failed') return 'red';
  return 'slate';
}
function reviewDeliveryLabel(r: any) {
  if (r.status === 'completed') return `Responded ${r.completed_at ? new Date(r.completed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}`;
  if (r.status === 'clicked') return 'Delivered · link opened';
  if (r.status === 'sent') return `Delivered ${r.sent_at ? new Date(r.sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}`;
  if (r.status === 'suppressed') return r.delivery_error === 'CONSENT_MISSING' ? 'Not sent · no consent on file' : r.delivery_error === 'SUPPRESSED' ? 'Not sent · customer suppressed' : 'Not sent · suppressed';
  if (r.status === 'failed') return r.delivery_error ? `Delivery failed · ${r.delivery_error.replaceAll('_', ' ').toLowerCase()}` : 'Delivery failed';
  return 'Queued';
}
export function ReviewsPage() { const query=useData<any>('/api/intelligence/reviews',{reviews:[]}); return <Page title="Reviews" eyebrow="Reputation engine" description="After a job completes, Jobrin.ai can invite the customer to leave a review. Unhappy feedback is captured privately first, so you can fix problems before they become public.">{query.loading?<Spinner/>:query.data.reviews.length?<div className="space-y-3">{query.data.reviews.map((r:any)=><Card key={r.id} className="p-4"><div className="flex justify-between"><div><p className="font-semibold">{r.customers?.display_name||'Customer'}</p><p className="mt-1 flex items-center gap-2 text-xs text-slate-500"><StatusPill tone={reviewStatusTone(r.status)}>{r.status}</StatusPill><span>{r.channel}</span></p><p className="mt-1 text-xs text-slate-400">{reviewDeliveryLabel(r)}</p></div><span className="font-black">{r.rating?`${r.rating}/5`:'—'}</span></div>{r.feedback&&<p className="mt-3 text-sm text-slate-600">"{r.feedback}"</p>}</Card>)}</div>:<EmptyState icon={<Star className="h-5 w-5"/>} title="No review requests yet" description="Positive reviews are the cheapest marketing a trade business can have. Jobrin.ai queues a review invitation after completed work and holds critical feedback private so you can respond first." steps={['A job completes — the automation queues a review request','The customer gets a short consented message with a link to respond','Delivery status, then ratings and feedback, land here — private feedback escalates to you']} action={<AppLink href="/app/automations" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Automate review requests</AppLink>}/>}</Page> }

export function AnalyticsPage() { const query=useData<any>('/api/intelligence/attribution',{sources:[],events:[]}); const total=(query.data.sources||[]).reduce((s:number,r:any)=>s+r.revenueCents,0); return <Page title="Analytics" eyebrow="Revenue attribution" description="Where does the money actually come from? Every payment traces back through the job and lead to its original source, so you can see which marketing earns its keep — and which to stop paying for."><Card className="mb-5 p-6"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Jobrin.ai-attributed revenue</p><div className="mt-2 text-5xl font-black"><Money cents={total}/></div></Card>{query.loading?<Spinner/>:query.data.sources.length?<Card className="overflow-hidden"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Source</th><th className="px-4 py-3">Conversions</th><th className="px-4 py-3 text-right">Revenue</th></tr></thead><tbody>{query.data.sources.map((s:any)=><tr key={s.source} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{s.source}</td><td className="px-4 py-3 text-slate-500">{s.conversions}</td><td className="px-4 py-3 text-right font-bold"><Money cents={s.revenueCents}/></td></tr>)}</tbody></table></Card>:<EmptyState icon={<BarChart3 className="h-5 w-5"/>} title="No attributed revenue yet" description="This is the page that answers “which of my marketing actually works?” — revenue traced back through each payment, job, booking and lead to the source that started it." steps={['Record the source when a lead arrives (website, Google, referral…)','Run the job and get paid through Jobrin.ai','Watch each source’s true return on investment appear here']} action={<AppLink href="/app/leads" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Start tracking leads</AppLink>}/>}</Page> }

export function TeamPage() { const {workspaceId,workspace}=useAuth(); const query=useData<any>('/api/team',{members:[]}); const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');const [form,setForm]=useState({email:'',role:'staff',display_name:''});
  const canInvite=workspace?.role==='owner'||workspace?.role==='admin';
  const invite=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;setBusy(true);setError('');setMessage('');try{const result=await apiFetch<any>('/api/team/invites',{method:'POST',body:JSON.stringify(form)},workspaceId);setMessage(`Invitation sent to ${form.email} as ${form.role}. They appear in the list straight away and can sign in once they accept the invite email.`);setForm({email:'',role:'staff',display_name:''});await query.refresh()}catch(err:any){setError(err.message)}finally{setBusy(false)}};
  return <Page title="Team" eyebrow="Workspace access" description="Who can see and do what in this workspace. Owners and admins manage billing and members; managers run the day-to-day; staff see their own work; viewers are read-only.">{canInvite&&(open?<Card className="mb-5 p-5"><form onSubmit={invite} className="grid gap-3 md:grid-cols-3"><Field label="Email" type="email" value={form.email} onChange={e=>setForm(v=>({...v,email:e.target.value}))} required/><SelectField label="Role" value={form.role} onChange={e=>setForm(v=>({...v,role:e.target.value}))}>{workspace?.role==='owner'&&<option value="admin">Admin</option>}<option value="manager">Manager</option><option value="staff">Staff</option><option value="viewer">Viewer</option></SelectField><Field label="Display name (optional)" value={form.display_name} onChange={e=>setForm(v=>({...v,display_name:e.target.value}))}/><div className="md:col-span-3 flex justify-end gap-2"><SecondaryButton type="button" onClick={()=>setOpen(false)}>Cancel</SecondaryButton><PrimaryButton disabled={busy}>{busy?'Sending invite…':'Send invite'}</PrimaryButton></div>{error&&<p className="text-sm text-red-600 md:col-span-3">{error}</p>}{message&&<p className="text-sm text-emerald-700 md:col-span-3">{message}</p>}</form></Card>:<PrimaryButton className="mb-5" onClick={()=>setOpen(true)}><Plus className="mr-2 inline h-4 w-4"/>Invite a team member</PrimaryButton>)}<Card className="mb-5 p-4 text-xs text-slate-500">{canInvite?'Only the workspace owner can invite another admin. Invitations need account security (MFA) when the server requires it.':'Invitations are sent by the workspace owner or an admin.'}</Card>{query.loading?<Spinner/>:query.error?<ErrorBox message={query.error} onRetry={query.refresh}/>:<div className="grid gap-3 md:grid-cols-2">{query.data.members.map((m:any)=><Card key={m.user_id} className="p-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 font-bold">{(m.profile?.display_name||'?')[0]}</div><div className="min-w-0 flex-1"><p className="font-semibold">{m.profile?.display_name||m.user_id.slice(0,8)}</p><p className="text-xs text-slate-500">{m.role}</p></div><StatusPill tone={m.status==='active'?'green':'slate'}>{m.status}</StatusPill></div></Card>)}</div>}</Page> }

export function SecuritySettingsPage() {
  const {refreshMfa}=useAuth(); const [factors,setFactors]=useState<any[]>([]); const [enrollment,setEnrollment]=useState<any>(null); const [code,setCode]=useState(''); const [error,setError]=useState(''); const [loading,setLoading]=useState(true);
  const load=async()=>{setLoading(true);const {data,error}=await supabase.auth.mfa.listFactors();if(error)setError(error.message);else setFactors(data.totp);setLoading(false)};useEffect(()=>{void load()},[]);
  const enroll=async()=>{setError('');const {data,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'Jobrin.ai Authenticator'});if(error)return setError(error.message);setEnrollment(data)};
  const verify=async()=>{if(!enrollment)return;const {error}=await supabase.auth.mfa.challengeAndVerify({factorId:enrollment.id,code});if(error)return setError(error.message);setEnrollment(null);setCode('');await refreshMfa();await load()};
  const remove=async(id:string)=>{const {error}=await supabase.auth.mfa.unenroll({factorId:id});if(error)return setError(error.message);await refreshMfa();await load()};
  return <Page title="Security" eyebrow="Account protection"><div className="grid gap-5 xl:grid-cols-2"><Card className="p-6"><div className="flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><LockKeyhole className="h-5 w-5"/></div><div><h3 className="font-bold">Authenticator MFA</h3><p className="mt-1 text-sm leading-6 text-slate-500">Add TOTP to protect account takeover and allow AAL2 enforcement on sensitive owner/admin routes.</p></div></div>{loading?<Spinner/>:<div className="mt-5 space-y-3">{factors.map(f=><div key={f.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3"><div><p className="text-sm font-semibold">{f.friendly_name||'Authenticator app'}</p><p className="text-xs text-slate-500">{f.status}</p></div><SecondaryButton onClick={()=>remove(f.id)}>Remove</SecondaryButton></div>)}{!factors.some(f=>f.status==='verified')&&!enrollment&&<PrimaryButton onClick={enroll}>Set up authenticator</PrimaryButton>}</div>}{enrollment&&<div className="mt-5 rounded-2xl bg-slate-50 p-4"><p className="mb-3 text-sm font-semibold">Scan this QR code, then verify a code.</p><img src={enrollment.totp.qr_code} alt="Authenticator QR code" className="h-44 w-44 rounded-lg bg-white p-2"/><p className="mt-2 break-all text-[10px] text-slate-500">Secret: {enrollment.totp.secret}</p><div className="mt-4 flex gap-2"><input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} maxLength={6} placeholder="123456" className="w-32 rounded-xl border border-slate-200 px-3 py-2 text-sm"/><PrimaryButton onClick={verify}>Verify</PrimaryButton></div></div>}{error&&<p className="mt-4 text-sm text-red-600">{error}</p>}</Card><Card className="p-6"><h3 className="font-bold">Security boundaries in this build</h3><div className="mt-4 space-y-3">{['PKCE social login and email authentication','Workspace membership verified on the API','PostgreSQL RLS on tenant-owned tables','Server secrets never exposed through browser variables','Signed Stripe and Twilio webhook verification','Strict body validation and API rate limits','Append-only audit schema; trusted server writes require the service key'].map(item=><div key={item} className="flex gap-2 text-sm text-slate-600"><CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600"/>{item}</div>)}</div></Card></div></Page>;
}

export function NotificationsPage() {
  const {workspaceId}=useAuth();const query=useData<any>('/api/notifications',{notifications:[],unreadCount:0});const [busy,setBusy]=useState(false);
  const markAll=async()=>{if(!workspaceId)return;setBusy(true);try{await apiFetch('/api/notifications/read-all',{method:'POST'},workspaceId);await query.refresh()}finally{setBusy(false)}};
  const markOne=async(id:string)=>{if(!workspaceId)return;try{await apiFetch(`/api/notifications/${id}/read`,{method:'POST',body:'{}'},workspaceId);await query.refresh()}catch{/* already read */}};
  return <Page title="Notifications" eyebrow="What needs you" description="Every alert in one place: new leads, online bookings, messages taken by the AI receptionist and approvals waiting." action={<SecondaryButton disabled={busy} onClick={markAll}>Mark all read</SecondaryButton>}>{query.loading?<Spinner/>:query.error?<ErrorBox message={query.error} onRetry={query.refresh}/>:query.data.notifications.length?<div className="space-y-2">{query.data.notifications.map((n:any)=><button key={n.id} onClick={()=>{if(!n.read_at)void markOne(n.id)}} className={`block w-full rounded-2xl border p-4 text-left transition ${n.read_at?'border-slate-200 bg-white':'border-indigo-200 bg-indigo-50/50 hover:border-indigo-300'}`}><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">{n.title}</p>{!n.read_at&&<span className="h-2 w-2 flex-none rounded-full bg-indigo-500"/>}</div>{n.body&&<p className="mt-1 text-xs leading-5 text-slate-600">{n.body}</p>}<p className="mt-2 text-[11px] text-slate-400">{new Date(n.created_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}</p></button>)}</div>:<EmptyState title="Nothing needs you" description="New leads, online bookings, AI-receptionist messages and pending approvals appear here the moment they happen."/>}</Page>;
}

export function OperatorPage() { const query=useData<any>('/api/intelligence/ai-actions',{actions:[]}); const [dept,setDept]=useState('all'); const departments=['all','receptionist','finance','sales','marketing','support','business_brain','triage','scheduler','quotes','collections','reviews','insights','job_prep','field_scribe']; const rows=(query.data.actions||[]).filter((a:any)=>dept==='all'||a.specialist===dept); return <Page title="Operator" eyebrow="AI action log" description="Every AI action, logged by the hat that wore it: filter by department to audit each admin's behaviour.">{query.loading?<Spinner/>:query.error?<ErrorBox message={query.error} onRetry={query.refresh}/>:<Card className="overflow-hidden"><div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4"><select aria-label="Filter AI actions by department" value={dept} onChange={e=>setDept(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">{departments.map((d)=><option key={d} value={d}>{d==='all'?'All departments':d.replaceAll('_',' ')}</option>)}</select></div>{rows.length?<table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">Tool</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Risk</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Time</th></tr></thead><tbody>{rows.map((a:any)=><tr key={a.id} className="border-t border-slate-100"><td className="px-4 py-3 font-mono text-xs">{a.tool_name}</td><td className="px-4 py-3"><StatusPill>{(a.specialist||'unassigned').replaceAll('_',' ')}</StatusPill></td><td className="px-4 py-3"><StatusPill tone={a.risk_level==='high'?'red':a.risk_level==='medium'?'amber':'green'}>{a.risk_level}</StatusPill></td><td className="px-4 py-3">{a.status}</td><td className="px-4 py-3 text-slate-500">{new Date(a.created_at).toLocaleString('en-AU')}</td></tr>)}</tbody></table>:<EmptyState title="No actions in this view" description="Every AI action in this workspace is logged here with its department, risk level and outcome — filter by department to audit each hat separately."/>}</Card>}</Page>; }

export function CapabilityMapPage() {
  const integrations=useData<any>('/api/integrations',{integrations:[]});
  const billing=useData<any>('/api/billing/status',{subscription:null,entitlements:[],stripeConfigured:false});
  const twilioConnected=(integrations.data.integrations||[]).some((i:any)=>i.provider==='twilio'&&i.status==='connected');
  const openaiReady=integrations.data.readiness?.openai===true;
  const groups=[
    {label:'Run the day',items:[
      ['Jobs & scheduling','Create, schedule and complete work from anywhere.','/app/jobs','ready'],
      ['Jobrin.ai Admin (one brain, five hats)','Text previews need OpenAI; live phone answering also needs Twilio and public HTTPS.','/app/operator/phone',openaiReady?'ready':'connect'],
      ['AI Admin chat','Ask privately about revenue, outstanding invoices, leads, quotes and operational priorities.','/app/admin-chat','ready'],
      ['Notifications','Every alert that needs you, in one list.','/app/notifications','ready'],
    ]},
    {label:'Money',items:[
      ['Quotes with customer approval','Send a secure link; customers accept online, then convert to invoices.','/app/quotes','ready'],
      ['Invoices & payments','Email invoices with secure Stripe payment links.','/app/invoices',billing.data.stripeConfigured?'ready':'connect'],
      ['Revenue attribution','Prove which marketing actually makes money.','/app/analytics','ready'],
      ['Billing & plans','Stripe-hosted subscriptions and entitlements.','/app/billing',billing.data.stripeConfigured?'ready':'connect'],
    ]},
    {label:'Grow',items:[
      ['Marketing SMS','Consent-first campaigns with owner approval and STOP handling.','/app/marketing',twilioConnected?'ready':'connect'],
      ['Review requests','Queue post-job review invitations; delivery needs a connected messaging provider.','/app/reviews',twilioConnected?'ready':'connect'],
      ['Hiring pipeline','Private candidate management with consent records.','/app/hiring','ready'],
    ]},
    {label:'Automate & learn',items:[
      ['Safe autopilot','Production-ready deterministic reports run with visible retries and terminal outcomes.','/app/automations','ready'],
      ['Business Brain','Evidence-driven learning needs OpenAI; deterministic promotion rules and human controls remain authoritative.','/app/brain',openaiReady?'ready':'connect'],
      ['Knowledge','The only facts the AI may share with customers.','/app/knowledge','ready'],
    ]},
  ] as const;
  const pill=(state:string)=>state==='ready'?<FeatureStatus state="ready"/>:state==='connect'?<FeatureStatus state="setup"/>:<FeatureStatus state="soon"/>;
  return <Page title="What Jobrin.ai can do" eyebrow="Capability map" description="Every capability in this workspace and exactly what state it is in. Green means it is live today; amber means connect a provider to switch it on.">{groups.map((group)=><div key={group.label} className="mb-6"><h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">{group.label}</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{group.items.map(([title,desc,href,state])=><AppLink key={href} href={href} className="block"><Card className="h-full p-4 transition hover:border-indigo-300"><div className="flex items-start justify-between gap-2"><p className="font-bold">{title}</p>{pill(state)}</div><p className="mt-1 text-xs leading-5 text-slate-500">{desc}</p></Card></AppLink>)}</div></div>)}</Page>;
}

export const COMING_SOON_FEATURES: Record<string, { title: string; eyebrow: string; description: string; points: string[] }> = {
  'gps-dispatch': {
    title: 'GPS dispatch & live ETA', eyebrow: 'Schedule & Dispatch',
    description: 'See your crew on a live map, dispatch the closest available technician and give customers an automatic on-the-way text with a real ETA.',
    points: ['Live technician locations on a map', 'Smart dispatch suggestions by proximity and skills', 'Automatic on-the-way SMS with live ETA', 'Travel-time aware schedule adjustments'],
  },
  'checklists-forms': {
    title: 'Checklists & forms', eyebrow: 'Field Operations',
    description: 'Custom checklists, safety forms and compliance documents completed on site, stored against the job and exportable as branded PDFs.',
    points: ['Custom checklist and form templates', 'Completed on any phone or tablet', 'Automatic PDF reports stored with the job'],
  },
  'voicemail': {
    title: 'Voicemail transcription', eyebrow: 'AI Admin',
    description: 'Missed calls go to voicemail, and the AI transcribes the message and alerts you instantly — so missed calls still become jobs.',
    points: ['Automatic transcription of voicemails', 'Instant alert with the caller and message', 'Feeds the same lead pipeline as calls and SMS'],
  },
  'call-recordings': {
    title: 'Call recordings', eyebrow: 'AI Admin',
    description: 'Store answered-call recordings with the job record when the caller consents — full quality-assurance history for every conversation.',
    points: ['Consent prompt enforced before recording', 'Recordings stored against the call', 'Owner-only access with full audit trail'],
  },
  'spam-screening': {
    title: 'Spam & robocall screening', eyebrow: 'AI Admin',
    description: 'Known spam and robocall numbers are screened out before the receptionist answers — your phone stays clean and your AI minutes stay for real customers.',
    points: ['Automatic screening of known spam patterns', 'Screened calls logged for review', 'Receptionist only spends time on real customers'],
  },
  'multi-numbers': {
    title: 'Multiple phone numbers', eyebrow: 'AI Admin',
    description: 'Run several Twilio numbers — one per brand, suburb or campaign — each mapped to the same workspace with its own receptionist settings.',
    points: ['Multiple numbers on one workspace', 'Per-number routing and reporting', 'Consolidated inbox across all numbers'],
  },
  'customer-portal': {
    title: 'Customer self-service portal', eyebrow: 'Marketing & Reviews',
    description: 'Your customers log in to see their job history, quotes and invoices, approve work and pay — everything customer-facing in one branded place.',
    points: ['Job history and quotes for every customer', 'Secure invoice payment', 'Booking requests and approval history'],
  },
  'accounting-sync': {
    title: 'Xero, MYOB & QuickBooks', eyebrow: 'Integrations',
    description: 'Sync customers, invoices and payments straight into your accounting package — no double entry, no end-of-month surprises.',
    points: ['Two-way customer sync', 'Invoices and payments pushed automatically', 'Works with Xero, MYOB and QuickBooks Online'],
  },
  'zapier-api': {
    title: 'Zapier, webhooks & API', eyebrow: 'Integrations',
    description: 'Connect Jobrin.ai to anything: Zapier, webhooks and a documented API — leads in from your website, events out to your other tools.',
    points: ['Outbound webhooks on key events', 'Documented API with workspace keys', 'Zapier triggers for leads, jobs and payments'],
  },
  'deploy-health': {
    title: 'Deployment health & monitoring', eyebrow: 'Settings & Security',
    description: 'Live status of your deployment: uptime, error rates, backup schedule and rollback readiness — so you always know the platform is healthy.',
    points: ['Uptime and error-rate monitoring', 'Backup schedule and restore drills', 'Deployment history with one-click rollback'],
  },
};

export function ComingSoonPage({ featureKey }: { featureKey: string }) {
  const feature = COMING_SOON_FEATURES[featureKey];
  if (!feature) return <ModulePage title="Coming soon" eyebrow="Jobrin.ai" description="This capability is on the roadmap. The details will appear here once it is scheduled." status="Coming soon"/>;
  return <Page title={feature.title} eyebrow={feature.eyebrow} description={feature.description}><Card className="p-7"><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">Coming soon</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">This capability is planned for the near future — the interface below shows exactly how it will work when it ships. Nothing here is live yet, and no controls pretend to work.</p></div><FeatureStatus state="soon"/></div><div className="mt-6 space-y-2">{feature.points.map((point,index)=><div key={index} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-sm leading-6 text-slate-700"><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-white text-[10px] font-black text-slate-500 shadow-sm">{index+1}</span>{point}</div>)}</div><div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">This page is a design commitment, not a working feature. When it ships, it will use the same layout, components and data connections as the rest of Jobrin.ai — so activating it means connecting real data, not redesigning the interface.</div></Card></Page>;
}


export function ModulePage({title,eyebrow,description,status='Backend schema ready'}:{title:string;eyebrow:string;description:string;status?:string}) { return <Page title={title} eyebrow={eyebrow}><Card className="p-7"><div className="flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold">{title}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p></div><StatusPill tone="amber">{status}</StatusPill></div><div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">This screen does not fake external actions. It stays visibly limited until the required provider, worker or controlled Operator tool is connected and tested.</div></Card></Page> }

export function SettingsPage() { return <Page title="Settings" eyebrow="Workspace configuration" description="Everything that shapes how Jobrin.ai works for this business. Business identity and services feed quotes, invoices and customer messages; security protects the account; billing controls the plan."><div className="grid gap-4 md:grid-cols-2">{[['Business profile','Update business identity, trading details and service context.','/app/settings/business'],['Services & pricing','Configure approved services, prices, business hours and service areas.','/app/settings/services'],['Security','MFA and security posture.','/app/settings/security'],['Billing','Plan, subscription and Stripe portal.','/app/billing']].map(([title,desc,href])=><AppLink key={title} href={href} className="block"><Card className="h-full p-5 transition hover:border-indigo-300"><h3 className="font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p></Card></AppLink>)}</div></Page> }

const BUSINESS_PROFILE_EMPTY = {
  trading_name: '', legal_name: '', abn: '', industry: '', phone: '', email: '', website: '',
  timezone: 'Australia/Adelaide', gst_registered: false, description: '',
  street_address: '', suburb: '', state: '', postcode: '',
};

export function BusinessProfileSettingsPage() {
  const { workspaceId } = useAuth();
  const [form,setForm] = useState<any>(BUSINESS_PROFILE_EMPTY);
  const [loading,setLoading] = useState(true); const [error,setError] = useState(''); const [busy,setBusy] = useState(false); const [saved,setSaved] = useState(false); const [dirty,setDirty] = useState(false);
  const load = async () => { if (!workspaceId) return; setLoading(true); setError(''); try { const result = await apiFetch<any>('/api/workspaces/current', {}, workspaceId); const profile = result.businessProfile || {}; setForm({ ...BUSINESS_PROFILE_EMPTY, ...profile }); setDirty(false); } catch (err: any) { setError(err.message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [workspaceId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const set = (key: string) => (event: any) => { const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value; setForm((v: any) => ({ ...v, [key]: value })); setDirty(true); setSaved(false); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!workspaceId) return; setBusy(true); setError('');
    try {
      const payload = { ...form, abn: form.abn || null, phone: form.phone || null, email: form.email || null, website: form.website || null, street_address: form.street_address || null, suburb: form.suburb || null, postcode: form.postcode || null };
      await apiFetch('/api/workspaces/business-profile', { method: 'PUT', body: JSON.stringify(payload) }, workspaceId);
      setDirty(false); setSaved(true);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  if (loading) return <Spinner label="Loading business profile…"/>;
  return <Page title="Business profile" eyebrow="Workspace configuration" description="Trading details, timezone and address used on quotes, invoices, customer messages and the AI receptionist.">
    <Card className="p-7">
      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {saved && !dirty && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">Saved.</div>}
      {dirty && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">You have unsaved changes.</div>}
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Trading name" value={form.trading_name} onChange={set('trading_name')} required/>
        <Field label="Legal name" value={form.legal_name} onChange={set('legal_name')}/>
        <Field label="ABN" value={form.abn||''} onChange={set('abn')}/>
        <SelectField label="Industry" value={form.industry||'other'} onChange={set('industry')}><option value="plumbing">Plumbing</option><option value="electrical">Electrical</option><option value="hvac">HVAC</option><option value="building">Building</option><option value="cleaning">Cleaning</option><option value="landscaping">Landscaping</option><option value="painting">Painting</option><option value="pest_control">Pest control</option><option value="handyman">Handyman</option><option value="other">Other service</option></SelectField>
        <Field label="Phone" value={form.phone||''} onChange={set('phone')}/>
        <Field label="Email" type="email" value={form.email||''} onChange={set('email')}/>
        <Field label="Website" type="url" value={form.website||''} onChange={set('website')} placeholder="https://"/>
        <SelectField label="Timezone" value={form.timezone} onChange={set('timezone')}><option>Australia/Adelaide</option><option>Australia/Sydney</option><option>Australia/Brisbane</option><option>Australia/Perth</option><option>Australia/Darwin</option><option>Australia/Hobart</option></SelectField>
        <Field label="Street address" value={form.street_address||''} onChange={set('street_address')}/>
        <Field label="Suburb" value={form.suburb||''} onChange={set('suburb')}/>
        <Field label="State" value={form.state||''} onChange={set('state')}/>
        <Field label="Postcode" value={form.postcode||''} onChange={set('postcode')}/>
        <div className="sm:col-span-2"><TextareaField label="Business description" value={form.description} onChange={set('description')}/></div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2"><input type="checkbox" checked={form.gst_registered} onChange={set('gst_registered')}/> GST registered</label>
        <div className="sm:col-span-2"><PrimaryButton disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</PrimaryButton></div>
      </form>
    </Card>
  </Page>;
}

const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const emptyHours = () => Array.from({length:7},(_,weekday)=>({weekday,opens_at:'09:00',closes_at:'17:00',closed:weekday>=5}));

export function ServicesSettingsPage() {
  const { workspaceId } = useAuth();
  const [services,setServices] = useState<any[]>([]);
  const [hours,setHours] = useState<any[]>(emptyHours());
  const [areas,setAreas] = useState<any[]>([]);
  const [loading,setLoading] = useState(true); const [error,setError] = useState(''); const [busy,setBusy] = useState('');
  const [editingId,setEditingId] = useState<string|null>(null);
  const [showArchived,setShowArchived] = useState(false);
  const [newService,setNewService] = useState({ name:'', description:'', booking_type:'bookable', default_duration_minutes:60, pricing_mode:'quote', base_price_dollars:'' });
  const [newArea,setNewArea] = useState({ kind:'suburb', value:'', surcharge_dollars:'' });
  const [addingService,setAddingService] = useState(false);
  const [addingArea,setAddingArea] = useState(false);

  const load = async () => {
    if (!workspaceId) return; setLoading(true); setError('');
    try {
      const [svc,hrs,ar] = await Promise.all([
        apiFetch<any>('/api/services', {}, workspaceId),
        apiFetch<any>('/api/services/hours?scheduleType=business', {}, workspaceId),
        apiFetch<any>('/api/services/areas', {}, workspaceId),
      ]);
      setServices(svc.services||[]);
      setHours(hrs.hours?.length===7 ? hrs.hours.slice().sort((a:any,b:any)=>a.weekday-b.weekday) : emptyHours());
      setAreas(ar.areas||[]);
    } catch (err:any) { setError(err.message); } finally { setLoading(false); }
  };
  useEffect(()=>{ void load(); }, [workspaceId]);

  const createService = async (event: React.FormEvent) => {
    event.preventDefault(); if (!workspaceId) return; setBusy('new-service'); setError('');
    try {
      await apiFetch('/api/services', { method:'POST', body: JSON.stringify({ ...newService, base_price_cents: newService.base_price_dollars ? Math.round(Number(newService.base_price_dollars)*100) : null }) }, workspaceId);
      setNewService({ name:'', description:'', booking_type:'bookable', default_duration_minutes:60, pricing_mode:'quote', base_price_dollars:'' });
      setAddingService(false);
      await load();
    } catch (err:any) { setError(err.message); } finally { setBusy(''); }
  };

  const saveService = async (id: string, patch: any) => {
    if (!workspaceId) return; setBusy(`svc-${id}`); setError('');
    try { await apiFetch(`/api/services/${id}`, { method:'PATCH', body: JSON.stringify(patch) }, workspaceId); setEditingId(null); await load(); }
    catch (err:any) { setError(err.message); } finally { setBusy(''); }
  };

  const toggleArchive = async (service: any) => {
    if (!workspaceId) return; setBusy(`svc-${service.id}`); setError('');
    try { await apiFetch(`/api/services/${service.id}/${service.active ? 'archive' : 'restore'}`, { method:'POST' }, workspaceId); await load(); }
    catch (err:any) { setError(err.message); } finally { setBusy(''); }
  };

  const saveHours = async () => {
    if (!workspaceId) return; setBusy('hours'); setError('');
    try {
      const result = await apiFetch<any>('/api/services/hours', { method:'PUT', body: JSON.stringify({ scheduleType:'business', days: hours.map(({weekday,opens_at,closes_at,closed})=>({weekday,opens_at:closed?null:opens_at,closes_at:closed?null:closes_at,closed})) }) }, workspaceId);
      setHours(result.hours.slice().sort((a:any,b:any)=>a.weekday-b.weekday));
    } catch (err:any) { setError(err.message); } finally { setBusy(''); }
  };

  const createArea = async (event: React.FormEvent) => {
    event.preventDefault(); if (!workspaceId || !newArea.value.trim()) return; setBusy('new-area'); setError('');
    try {
      await apiFetch('/api/services/areas', { method:'POST', body: JSON.stringify({ kind:newArea.kind, value:newArea.value.trim(), surcharge_cents: newArea.surcharge_dollars ? Math.round(Number(newArea.surcharge_dollars)*100) : 0 }) }, workspaceId);
      setNewArea({ kind:'suburb', value:'', surcharge_dollars:'' });
      setAddingArea(false);
      await load();
    } catch (err:any) { setError(err.message); } finally { setBusy(''); }
  };

  const archiveArea = async (area: any) => {
    if (!workspaceId) return; setBusy(`area-${area.id}`); setError('');
    try { await apiFetch(`/api/services/areas/${area.id}/archive`, { method:'POST' }, workspaceId); await load(); }
    catch (err:any) { setError(err.message); } finally { setBusy(''); }
  };

  if (loading) return <Spinner label="Loading services & pricing…"/>;
  const visibleServices = services.filter((s:any) => showArchived || s.active);

  return <Page title="Services & pricing" eyebrow="Workspace configuration" description="The services the AI receptionist can offer, weekly business hours, and where the business works.">
    {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Services</h2><div className="flex items-center gap-3"><label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Show archived</label><SecondaryButton type="button" onClick={()=>setAddingService(v=>!v)}>{addingService?'Cancel':'Add service'}</SecondaryButton></div></div>
        {addingService && <form onSubmit={createService} className="mt-4 grid gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-2">
          <Field label="Service name" required value={newService.name} onChange={e=>setNewService(v=>({...v,name:e.target.value}))}/>
          <SelectField label="Customer action" value={newService.booking_type} onChange={e=>setNewService(v=>({...v,booking_type:e.target.value}))}><option value="bookable">Can request a booking</option><option value="quote">Quote required first</option><option value="enquiry">Enquiry only</option></SelectField>
          <Field label="Typical duration (minutes)" type="number" min={5} max={1440} value={newService.default_duration_minutes} onChange={e=>setNewService(v=>({...v,default_duration_minutes:Number(e.target.value)}))}/>
          <SelectField label="Pricing" value={newService.pricing_mode} onChange={e=>setNewService(v=>({...v,pricing_mode:e.target.value}))}><option value="quote">Quote required—no price shown</option><option value="fixed">Fixed price</option><option value="starting_from">Starting from</option><option value="hourly">Hourly</option><option value="callout_hourly">Callout + hourly</option><option value="range">Price range</option></SelectField>
          <Field label="Base price (AUD)" type="number" min={0} step="0.01" disabled={newService.pricing_mode==='quote'} value={newService.base_price_dollars} onChange={e=>setNewService(v=>({...v,base_price_dollars:e.target.value}))}/>
          <div className="sm:col-span-2"><TextareaField label="What is included?" value={newService.description} onChange={e=>setNewService(v=>({...v,description:e.target.value}))}/></div>
          <div className="sm:col-span-2"><PrimaryButton disabled={busy==='new-service'}>{busy==='new-service'?'Adding…':'Add service'}</PrimaryButton></div>
        </form>}
        <div className="mt-4 space-y-2">
          {visibleServices.map((service:any) => <ServiceRow key={service.id} service={service} editing={editingId===service.id} busy={busy===`svc-${service.id}`} onEdit={()=>setEditingId(editingId===service.id?null:service.id)} onSave={(patch)=>saveService(service.id,patch)} onToggleArchive={()=>toggleArchive(service)}/>)}
          {!visibleServices.length && <p className="py-4 text-sm text-slate-400">No services yet.</p>}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-bold">Business hours</h2>
        <p className="mt-1 text-xs text-slate-500">Used for booking availability, schedule display and customer messages, in the workspace timezone.</p>
        <div className="mt-4 space-y-2">
          {hours.map((day:any,index:number) => <div key={day.weekday} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 p-3">
            <span className="w-24 flex-none text-sm font-semibold">{WEEKDAYS[day.weekday]}</span>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><input type="checkbox" checked={day.closed} onChange={e=>setHours(v=>v.map((d,i)=>i===index?{...d,closed:e.target.checked}:d))}/> Closed</label>
            {!day.closed && <>
              <input type="time" value={day.opens_at||'09:00'} onChange={e=>setHours(v=>v.map((d,i)=>i===index?{...d,opens_at:e.target.value}:d))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"/>
              <span className="text-xs text-slate-400">to</span>
              <input type="time" value={day.closes_at||'17:00'} onChange={e=>setHours(v=>v.map((d,i)=>i===index?{...d,closes_at:e.target.value}:d))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"/>
            </>}
          </div>)}
        </div>
        <PrimaryButton className="mt-4" disabled={busy==='hours'} onClick={saveHours}>{busy==='hours'?'Saving…':'Save business hours'}</PrimaryButton>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between"><h2 className="font-bold">Service areas</h2><SecondaryButton type="button" onClick={()=>setAddingArea(v=>!v)}>{addingArea?'Cancel':'Add area'}</SecondaryButton></div>
        {addingArea && <form onSubmit={createArea} className="mt-4 grid gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-3">
          <SelectField label="Kind" value={newArea.kind} onChange={e=>setNewArea(v=>({...v,kind:e.target.value}))}><option value="suburb">Suburb</option><option value="postcode">Postcode</option><option value="radius">Radius (km)</option><option value="exclude">Excluded</option></SelectField>
          <Field label="Value" required value={newArea.value} onChange={e=>setNewArea(v=>({...v,value:e.target.value}))} placeholder="e.g. Adelaide, 5000, 25"/>
          <Field label="Surcharge (AUD)" type="number" min={0} step="0.01" value={newArea.surcharge_dollars} onChange={e=>setNewArea(v=>({...v,surcharge_dollars:e.target.value}))}/>
          <div className="sm:col-span-3"><PrimaryButton disabled={busy==='new-area'}>{busy==='new-area'?'Adding…':'Add area'}</PrimaryButton></div>
        </form>}
        <div className="mt-4 space-y-2">
          {areas.filter((a:any)=>a.active).map((area:any) => <div key={area.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 text-sm"><span><span className="font-semibold capitalize">{area.kind}</span>: {area.value}{area.surcharge_cents>0 && <span className="ml-2 text-xs text-slate-500">+<Money cents={area.surcharge_cents}/> surcharge</span>}</span><button type="button" disabled={busy===`area-${area.id}`} onClick={()=>archiveArea(area)} className="text-xs font-semibold text-slate-400 hover:text-red-600">{busy===`area-${area.id}`?'Removing…':'Remove'}</button></div>)}
          {!areas.filter((a:any)=>a.active).length && <p className="py-4 text-sm text-slate-400">No service areas configured — the business is treated as available everywhere.</p>}
        </div>
      </Card>
    </div>
  </Page>;
}

function ServiceRow({ service, editing, busy, onEdit, onSave, onToggleArchive }: { service:any; editing:boolean; busy:boolean; onEdit:()=>void; onSave:(patch:any)=>void; onToggleArchive:()=>void }) {
  const [draft,setDraft] = useState<any>(null);
  useEffect(()=>{ if (editing) setDraft({ name:service.name, description:service.description||'', booking_type:service.booking_type, default_duration_minutes:service.default_duration_minutes, pricing_mode:service.pricing_mode, base_price_dollars: service.base_price_cents!=null ? String(service.base_price_cents/100) : '' }); }, [editing, service]);
  if (editing && draft) {
    return <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Service name" required value={draft.name} onChange={(e:any)=>setDraft((v:any)=>({...v,name:e.target.value}))}/>
        <SelectField label="Customer action" value={draft.booking_type} onChange={(e:any)=>setDraft((v:any)=>({...v,booking_type:e.target.value}))}><option value="bookable">Can request a booking</option><option value="quote">Quote required first</option><option value="enquiry">Enquiry only</option></SelectField>
        <Field label="Typical duration (minutes)" type="number" min={5} max={1440} value={draft.default_duration_minutes} onChange={(e:any)=>setDraft((v:any)=>({...v,default_duration_minutes:Number(e.target.value)}))}/>
        <SelectField label="Pricing" value={draft.pricing_mode} onChange={(e:any)=>setDraft((v:any)=>({...v,pricing_mode:e.target.value}))}><option value="quote">Quote required—no price shown</option><option value="fixed">Fixed price</option><option value="starting_from">Starting from</option><option value="hourly">Hourly</option><option value="callout_hourly">Callout + hourly</option><option value="range">Price range</option></SelectField>
        <Field label="Base price (AUD)" type="number" min={0} step="0.01" disabled={draft.pricing_mode==='quote'} value={draft.base_price_dollars} onChange={(e:any)=>setDraft((v:any)=>({...v,base_price_dollars:e.target.value}))}/>
        <div className="sm:col-span-2"><TextareaField label="What is included?" value={draft.description} onChange={(e:any)=>setDraft((v:any)=>({...v,description:e.target.value}))}/></div>
      </div>
      <div className="mt-3 flex gap-2">
        <PrimaryButton type="button" disabled={busy} onClick={()=>onSave({ name:draft.name, description:draft.description, booking_type:draft.booking_type, default_duration_minutes:draft.default_duration_minutes, pricing_mode:draft.pricing_mode, base_price_cents: draft.base_price_dollars ? Math.round(Number(draft.base_price_dollars)*100) : null })}>{busy?'Saving…':'Save changes'}</PrimaryButton>
        <SecondaryButton type="button" onClick={onEdit}>Cancel</SecondaryButton>
      </div>
    </div>;
  }
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
    <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate font-semibold">{service.name}</p>{!service.active && <StatusPill tone="slate">archived</StatusPill>}</div><p className="truncate text-xs text-slate-500">{service.booking_type.replace('_',' ')} · {service.pricing_mode.replace('_',' ')}{service.base_price_cents!=null && <> · <Money cents={service.base_price_cents}/></>}</p></div>
    <div className="flex flex-none gap-2"><SecondaryButton type="button" onClick={onEdit}>Edit</SecondaryButton><button type="button" disabled={busy} onClick={onToggleArchive} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-red-600">{busy?'…':service.active?'Archive':'Restore'}</button></div>
  </div>;
}

function ErrorBox({message,onRetry}:{message:string;onRetry?:()=>void}) { return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4"/>Could not load this page</div><p className="mt-2">{message}</p>{onRetry&&<button onClick={onRetry} className="mt-3 text-xs font-bold underline">Try again</button>}</div> }
function Page({title,eyebrow,description,action,children}:{title:string;eyebrow:string;description?:string;action?:React.ReactNode;children:React.ReactNode}) {
  const showAi = title !== 'AI Admin chat' && title !== 'Business questions';
  const prompt = `Help me with the ${title} page in this Jobrin.ai workspace. Look for the most useful next action, any risk I should check, and how this helps turn enquiries into paid jobs.`;
  const pageKey = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return <div className={`jobrin-page jobrin-page--${pageKey}`}><header className="jobrin-page-header"><div className="jobrin-page-title"><p>{eyebrow}</p><h1>{title}</h1>{description&&<p>{description}</p>}</div><div className="jobrin-page-actions">{showAi&&<AskAiAdminLink prompt={prompt}/>} {action}</div></header><div className="jobrin-page-body">{children}</div></div>;
}
