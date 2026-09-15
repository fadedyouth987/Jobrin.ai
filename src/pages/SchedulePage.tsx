import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, MapPin } from 'lucide-react';
import { useAuth } from '../app/auth';
import { AppLink } from '../app/router';
import { apiFetch } from '../lib/api';
import { AskAiAdminLink, Card, EmptyState, SecondaryButton, Spinner, StatusPill } from '../components/saas/ui';

const dayMs=86_400_000;
const startOfDay=(value:Date)=>new Date(value.getFullYear(),value.getMonth(),value.getDate());
const dayKey=(value:string|Date)=>{const date=new Date(value);return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`};

/* Colour-coded dispatch cards: each trade gets its own hue so the week can be
   scanned at a glance, matching the bright board layout. */
const jobTones:[RegExp,string][] = [
  [/leak|burst|flood/i,'rose'],
  [/gas|hws|hot water/i,'amber'],
  [/dishwash|kitchen|laundry/i,'violet'],
  [/toilet|wc\b|sewer|drain|block/i,'teal'],
  [/tap|shower|valve|mixer/i,'sky'],
  [/install|replace|supply|fit\b/i,'emerald'],
  [/inspect|service|check|test|maintenance/i,'indigo'],
];
const toneBorder:Record<string,string> = {
  sky:'border-sky-200 hover:border-sky-400', rose:'border-rose-200 hover:border-rose-400',
  amber:'border-amber-200 hover:border-amber-400', violet:'border-violet-200 hover:border-violet-400',
  teal:'border-teal-200 hover:border-teal-400', emerald:'border-emerald-200 hover:border-emerald-400',
  indigo:'border-indigo-200 hover:border-indigo-400', slate:'border-slate-200 hover:border-slate-400',
};
const toneSurface:Record<string,string> = {
  sky:'bg-sky-50', rose:'bg-rose-50', amber:'bg-amber-50', violet:'bg-violet-50',
  teal:'bg-teal-50', emerald:'bg-emerald-50', indigo:'bg-indigo-50', slate:'bg-slate-50',
};
const toneTime:Record<string,string> = {
  sky:'text-sky-700', rose:'text-rose-700', amber:'text-amber-700', violet:'text-violet-700',
  teal:'text-teal-700', emerald:'text-emerald-700', indigo:'text-indigo-700', slate:'text-slate-600',
};
const toneOf=(title:string)=>jobTones.find(([pattern])=>pattern.test(title||''))?.[1] ?? 'slate';

const scheduleTabs:{label:string;href?:string;active?:boolean}[] = [
  {label:'Inquiry handling', href:'/app/leads'},
  {label:'Jobs and scheduling', active:true},
  {label:'Quotes and invoices', href:'/app/quotes'},
];

export function SchedulePage(){
  const {workspaceId}=useAuth();
  const [weekStart,setWeekStart]=useState(()=>startOfDay(new Date()));
  const [data,setData]=useState<{jobs:any[];appointments:any[]}>({jobs:[],appointments:[]});
  const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const days=useMemo(()=>Array.from({length:7},(_,index)=>new Date(weekStart.getTime()+index*dayMs)),[weekStart]);
  useEffect(()=>{if(!workspaceId)return;let cancelled=false;setLoading(true);setError('');const from=weekStart.toISOString();const to=new Date(weekStart.getTime()+7*dayMs).toISOString();Promise.all([
    apiFetch<any>('/api/operations/jobs',{},workspaceId),
    apiFetch<any>(`/api/operations/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,{},workspaceId),
  ]).then(([jobs,appointments])=>{if(!cancelled)setData({jobs:jobs.jobs||[],appointments:appointments.appointments||[]})}).catch((reason:any)=>{if(!cancelled)setError(reason.message||'SCHEDULE_LOAD_FAILED')}).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[workspaceId,weekStart]);
  const scheduledJobs=data.jobs.filter(job=>job.scheduled_start&&new Date(job.scheduled_start)>=weekStart&&new Date(job.scheduled_start)<new Date(weekStart.getTime()+7*dayMs));
  const unscheduled=data.jobs.filter(job=>!job.scheduled_start&&!['completed','invoiced','paid','cancelled'].includes(job.status));
  const moveWeek=(amount:number)=>setWeekStart(value=>new Date(value.getTime()+amount*7*dayMs));
  const weekLabel=`${days[0].toLocaleDateString('en-AU',{weekday:'short',day:'numeric'})} – ${days[6].toLocaleDateString('en-AU',{weekday:'short',day:'numeric'})}`;
  return <section>
    {/* Section tabs — the same pattern every operations page follows. */}
    <nav aria-label="Operations sections" className="mb-6 inline-flex max-w-full flex-wrap rounded-xl border border-[color:var(--jobrin-border)] bg-[color:var(--jobrin-elevated)] p-1">
      {scheduleTabs.map(tab=>tab.active
        ?<span key={tab.label} aria-current="page" className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-[color:var(--jobrin-ink)] shadow-sm ring-1 ring-[color:var(--jobrin-border)]">{tab.label}</span>
        :<AppLink key={tab.label} href={tab.href!} className="rounded-lg px-4 py-2 text-sm font-semibold text-[color:var(--jobrin-muted)] transition hover:bg-white hover:text-[color:var(--jobrin-ink)]">{tab.label}</AppLink>)}
    </nav>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">Dispatch and availability</p><h1 className="mt-1 text-3xl font-black tracking-tight">Schedule</h1><p className="mt-2 text-sm text-[color:var(--jobrin-muted)]">{weekLabel} · open a job to schedule or reschedule it.</p></div><div className="flex flex-wrap gap-2"><AskAiAdminLink prompt="Help me plan this week's schedule in Jobrin.ai. Spot unscheduled work, possible dispatch issues, and the next action that helps turn enquiries into paid jobs."/><SecondaryButton onClick={()=>moveWeek(-1)} aria-label="Previous week"><ChevronLeft className="h-4 w-4"/></SecondaryButton><SecondaryButton onClick={()=>setWeekStart(startOfDay(new Date()))}>Today</SecondaryButton><SecondaryButton onClick={()=>moveWeek(1)} aria-label="Next week"><ChevronRight className="h-4 w-4"/></SecondaryButton></div></div>
    {!loading&&!error&&!data.jobs.length&&!data.appointments.length&&<div className="mb-5"><EmptyState icon={<CalendarDays className="h-5 w-5"/>} title="Your week is clear" description="The Schedule shows every dated job and appointment for this workspace in one view — so whoever is dispatching can see the whole board at a glance and nothing double-books." steps={['Create a job (or an appointment for a site visit)','Give it a date and time','Watch it appear on the right day — assigned work cannot double-book']} action={<AppLink href="/app/jobs" className="rounded-xl bg-[#176438] px-4 py-2.5 text-sm font-semibold text-white">Create a job</AppLink>}/></div>}
    {loading?<Spinner label="Loading schedule…"/>:error?<Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>:
    <div className="grid gap-5 xl:grid-cols-[1fr_290px]">
      {/* One connected week surface, not seven separate boxes. */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto"><div className="grid min-w-[880px] grid-cols-7">
          {days.map((day,index)=>{const jobs=scheduledJobs.filter(job=>dayKey(job.scheduled_start)===dayKey(day)).sort((a,b)=>new Date(a.scheduled_start).getTime()-new Date(b.scheduled_start).getTime());const appointments=data.appointments.filter(item=>dayKey(item.starts_at)===dayKey(day));const today=dayKey(day)===dayKey(new Date());
          return <div key={day.toISOString()} className={`min-h-[26rem] p-2.5 ${index<6?'border-r border-[color:var(--jobrin-border)]':''} ${today?'bg-[rgba(23,100,56,.045)]':''}`}>
            <div className="mb-3 flex items-baseline gap-1.5 px-1">
              <p className={`text-[11px] font-bold uppercase tracking-wide ${today?'text-[#176438]':'text-slate-400'}`}>{day.toLocaleDateString('en-AU',{weekday:'short'})}</p>
              <p className={`text-sm font-black ${today?'text-[#176438]':'text-[color:var(--jobrin-ink)]'}`}>{day.toLocaleDateString('en-AU',{day:'numeric'})}</p>
              {today&&<span className="ml-auto h-2 w-2 rounded-full bg-[#176438]" aria-label="Today"/>}
            </div>
            <div className="space-y-2">
              {jobs.map(job=>{const tone=toneOf(job.title);return <AppLink key={`job-${job.id}`} href={`/app/jobs/${job.id}`} className={`block rounded-xl border p-2.5 ${toneSurface[tone]} ${toneBorder[tone]}`}>
                <p className={`text-[11px] font-black ${toneTime[tone]}`}>{new Date(job.scheduled_start).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</p>
                <p className="mt-0.5 text-xs font-bold leading-4 text-[color:var(--jobrin-ink)]">{job.title}</p>
                {job.address_text&&<p className="mt-1 flex items-center gap-1 truncate text-[10px] font-semibold text-[color:var(--jobrin-muted)]"><MapPin className="h-3 w-3 flex-none"/>{job.address_text}</p>}
                <p className="mt-0.5 truncate text-[10px] text-[color:var(--jobrin-muted)]">{job.customers?.display_name||'Customer'}</p>
              </AppLink>})}
              {appointments.map(item=>{const inner=<><p className="text-[11px] font-black text-emerald-700">{new Date(item.starts_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}</p><p className="mt-0.5 text-xs font-bold leading-4 text-[color:var(--jobrin-ink)]">{item.title}</p><p className="mt-0.5 truncate text-[10px] text-[color:var(--jobrin-muted)]">{item.customers?.display_name||'Appointment'}</p></>;
                return item.customer_id
                  ?<AppLink key={`appointment-${item.id}`} href={`/app/customers/${item.customer_id}`} className="block rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 hover:border-emerald-400">{inner}</AppLink>
                  :<div key={`appointment-${item.id}`} className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">{inner}</div>})}
              {!jobs.length&&!appointments.length&&<p className="py-8 text-center text-[11px] text-slate-300">Available</p>}
            </div>
          </div>})}
        </div></div>
      </Card>
      <Card className="h-fit p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">Unscheduled</h2>
          {unscheduled.length? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200">{unscheduled.length} waiting</span>
            : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200"><CheckCircle2 className="h-3.5 w-3.5"/>All scheduled</span>}
        </div>
        <p className="mt-1 text-xs text-[color:var(--jobrin-muted)]">Work that needs a date and time</p>
        {unscheduled.length?<div className="mt-4 space-y-2">{unscheduled.map(job=><AppLink key={job.id} href={`/app/jobs/${job.id}`} className="block rounded-xl border border-[color:var(--jobrin-border)] bg-white p-3 hover:border-[#176438]"><div className="flex items-start justify-between gap-2"><p className="text-sm font-bold text-[color:var(--jobrin-ink)]">{job.title}</p><StatusPill>{job.status}</StatusPill></div><p className="mt-1 text-xs text-[color:var(--jobrin-muted)]">{job.customers?.display_name||'Customer'}</p>{job.address_text&&<p className="mt-2 flex gap-1 text-[11px] font-medium text-[color:var(--jobrin-muted)]"><MapPin className="h-3 w-3 flex-none"/>{job.address_text}</p>}<p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-[#176438]"><Clock3 className="h-3 w-3"/>Choose time</p></AppLink>)}</div>
          :<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs font-semibold leading-5 text-emerald-800">Every active job has a date and time — the board is clear for dispatch.</p>}
      </Card>
    </div>}
  </section>;
}