import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Clock3, Package, Play, Plus, Repeat } from 'lucide-react';
import { useAuth } from '../app/auth';
import { AppLink } from '../app/router';
import { apiFetch } from '../lib/api';
import { Card, EmptyState, Money, PrimaryButton, SecondaryButton, SelectField, Spinner, StatusPill } from '../components/saas/ui';

const CADENCES = [['weekly','Every week'],['fortnightly','Every fortnight'],['monthly','Every month'],['quarterly','Every quarter'],['half_yearly','Every 6 months'],['annual','Every year']] as const;

function agreementTone(status: string): 'slate'|'green'|'amber'|'red'|'indigo' {
  if (status==='active') return 'green';
  if (status==='paused'||status==='draft') return 'amber';
  if (status==='cancelled'||status==='expired') return 'red';
  return 'slate';
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('en-AU', { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' }) : 'Not set';
}
function formatDay(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' }) : 'Not set';
}

function ErrorBox({message,onRetry}:{message:string;onRetry?:()=>void}) { return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4"/>Could not load this page</div><p className="mt-2">{message}</p>{onRetry&&<button onClick={onRetry} className="mt-3 text-xs font-bold underline">Try again</button>}</div> }

function Page({title,eyebrow,description,action,children}:{title:string;eyebrow:string;description?:string;action?:React.ReactNode;children:React.ReactNode}) { return <div><div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">{eyebrow}</p><h1 className="mt-1 text-3xl font-black tracking-tight">{title}</h1>{description&&<p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}</div>{action}</div>{children}</div> }

export function TimeMaterialsLogPage() {
  const {workspaceId}=useAuth();
  const [data,setData]=useState<any>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const load=async()=>{if(!workspaceId)return;setLoading(true);setError('');try{setData(await apiFetch<any>('/api/operations/time-materials',{},workspaceId))}catch(err:any){setError(err.message)}finally{setLoading(false)}};
  useEffect(()=>{void load()},[workspaceId]);
  if(loading)return <Spinner label="Loading time & materials…"/>;
  if(error)return <ErrorBox message={error} onRetry={load}/>;
  const timeEntries=data?.timeEntries??[];const materials=data?.materials??[];
  const entryMinutes=(entry:any)=>{const end=entry.ended_at?new Date(entry.ended_at).getTime():Date.now();return Math.max(0,Math.round((end-new Date(entry.started_at).getTime())/60000)-Number(entry.break_minutes||0))};
  const labourMinutes=timeEntries.reduce((sum:number,entry:any)=>sum+entryMinutes(entry),0);
  const matCost=materials.reduce((sum:number,m:any)=>sum+Number(m.unit_cost_cents||0)*Number(m.quantity||0),0);
  const matCharge=materials.reduce((sum:number,m:any)=>sum+Number(m.unit_price_cents||0)*Number(m.quantity||0),0);
  return <Page title="Time & Materials log" eyebrow="Field Operations" description="Every logged hour and material across all jobs — who worked what, when, and what it cost. Time and materials are still recorded on each job; this is the workspace-wide view.">
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><Card className="p-4"><p className="text-xs text-slate-500">Labour logged (recent entries)</p><p className="mt-1 text-2xl font-black">{Math.floor(labourMinutes/60)}h {labourMinutes%60}m</p></Card><Card className="p-4"><p className="text-xs text-slate-500">Materials cost</p><p className="mt-1 text-2xl font-black"><Money cents={matCost}/></p></Card><Card className="p-4"><p className="text-xs text-slate-500">Materials charge</p><p className="mt-1 text-2xl font-black"><Money cents={matCharge}/></p></Card></div>
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-3"><h2 className="font-bold">Time log</h2></div>
      {timeEntries.length?<div className="divide-y divide-slate-100">{timeEntries.map((entry:any)=><div key={entry.id} className="flex items-center gap-3 px-5 py-3"><Clock3 className="h-4 w-4 flex-none text-slate-400"/><div className="min-w-0 flex-1"><AppLink href={`/app/jobs/${entry.jobs?.id}`} className="font-semibold hover:text-indigo-700">{entry.jobs?.title||'Job'}</AppLink><p className="text-xs text-slate-500">Job #{entry.jobs?.job_number} · {formatDate(entry.started_at)}{entry.ended_at?` → ${new Date(entry.ended_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}`:' (running)'}{entry.break_minutes?` · ${entry.break_minutes} min break`:''}</p>{entry.notes&&<p className="text-xs text-slate-500">{entry.notes}</p>}</div><span className="flex-none text-xs font-bold text-slate-600">{entry.ended_at?`${entryMinutes(entry)} min`:'—'}</span></div>)}</div>:<div className="p-5 text-sm text-slate-500">No time logged on any job yet.</div>}
    </Card>
    <Card className="mt-5 overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-3"><h2 className="font-bold">Materials ledger</h2></div>
      {materials.length?<div className="divide-y divide-slate-100">{materials.map((m:any)=><div key={m.id} className="flex items-center gap-3 px-5 py-3"><Package className="h-4 w-4 flex-none text-slate-400"/><div className="min-w-0 flex-1"><AppLink href={`/app/jobs/${m.jobs?.id}`} className="font-semibold hover:text-indigo-700">{m.description}</AppLink><p className="text-xs text-slate-500">Job #{m.jobs?.job_number}{m.supplier?` · ${m.supplier}`:''} · qty {m.quantity}</p></div><div className="flex-none text-right"><p className="text-xs font-bold text-slate-600">cost <Money cents={Number(m.unit_cost_cents||0)*Number(m.quantity||0)}/></p><p className="text-xs text-slate-500">charge <Money cents={Number(m.unit_price_cents||0)*Number(m.quantity||0)}/></p></div></div>)}</div>:<div className="p-5 text-sm text-slate-500">No materials recorded on any job yet.</div>}
    </Card>
  </Page>;
}

export function RecurringJobsPage() {
  const {workspaceId}=useAuth();
  const [agreements,setAgreements]=useState<any[]>([]);const [customers,setCustomers]=useState<any[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [busy,setBusy]=useState('');const [notice,setNotice]=useState('');const [formOpen,setFormOpen]=useState(false);
  const [form,setForm]=useState({customer_id:'',name:'',cadence:'monthly',price:'',starts_at:'',notes:''});
  const load=async()=>{if(!workspaceId)return;setLoading(true);setError('');setNotice('');try{const [agreementsResult,customersResult]=await Promise.all([apiFetch<any>('/api/operations/service-agreements',{},workspaceId),apiFetch<any>('/api/crm/customers',{},workspaceId)]);setAgreements(agreementsResult.agreements??[]);setCustomers(customersResult.customers??[])}catch(err:any){setError(err.message)}finally{setLoading(false)}};
  useEffect(()=>{void load()},[workspaceId]);
  const create=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;if(!form.customer_id||!form.name.trim())return;setBusy('create');setError('');try{await apiFetch('/api/operations/service-agreements',{method:'POST',body:JSON.stringify({customer_id:form.customer_id,name:form.name.trim(),cadence:form.cadence,price_cents:Math.round(Number(form.price||0)*100),status:'active',starts_at:form.starts_at?new Date(form.starts_at).toISOString():null,notes:form.notes})},workspaceId);setForm({customer_id:'',name:'',cadence:'monthly',price:'',starts_at:'',notes:''});setFormOpen(false);setNotice('Agreement created and activated. Its first visit is scheduled from the start date.');await load()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const setStatus=async(id:string,status:string)=>{if(!workspaceId)return;setBusy(`${id}:${status}`);setError('');try{await apiFetch(`/api/operations/service-agreements/${id}`,{method:'PATCH',body:JSON.stringify({status})},workspaceId);await load()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const generate=async(id:string)=>{if(!workspaceId)return;setBusy(`${id}:generate`);setError('');try{const result=await apiFetch<any>(`/api/operations/service-agreements/${id}/generate`,{method:'POST'},workspaceId);setNotice(`Job #${result.job.job_number} created and scheduled for ${formatDate(result.job.scheduled_start)}. The next visit date has advanced.`);await load()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  if(loading)return <Spinner label="Loading agreements…"/>;
  return <Page title="Recurring jobs & agreements" eyebrow="Field Operations" description="Service agreements for maintenance plans, filter changes and safety checks. Active agreements generate the next scheduled job on demand; generating advances the cycle to the following visit." action={<PrimaryButton onClick={()=>setFormOpen(v=>!v)}><Plus className="mr-2 inline h-4 w-4"/>{formOpen?'Cancel':'New agreement'}</PrimaryButton>}>
    {error&&<div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {notice&&<div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
    {formOpen&&<Card className="mb-5 p-5"><form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
      <SelectField label="Customer" required value={form.customer_id} onChange={e=>setForm(v=>({...v,customer_id:e.target.value}))}>{!customers.length&&<option value="">No customers yet</option>}{customers.map((c:any)=><option key={c.id} value={c.id}>{c.display_name}</option>)}</SelectField>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600">Agreement name</label><input placeholder="e.g. Quarterly hot water service" required value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"/></div>
      <SelectField label="Service cycle" value={form.cadence} onChange={e=>setForm(v=>({...v,cadence:e.target.value}))}>{CADENCES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</SelectField>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600">Price per visit ($)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={form.price} onChange={e=>setForm(v=>({...v,price:e.target.value}))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"/></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600">First visit</label><input type="datetime-local" value={form.starts_at} onChange={e=>setForm(v=>({...v,starts_at:e.target.value}))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"/></div>
      <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-600">Notes (private to the business)</label><input placeholder="Access notes, materials to bring, anything the visit needs" value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"/></div>
      <div className="flex justify-end sm:col-span-2"><PrimaryButton disabled={busy==='create'||!customers.length}>{busy==='create'?'Creating…':'Create & activate'}</PrimaryButton></div>
    </form></Card>}
    {agreements.length?<Card className="overflow-hidden"><div className="divide-y divide-slate-100">{agreements.map((a:any)=><div key={a.id} className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="font-bold">{a.name}</p><p className="mt-0.5 text-xs text-slate-500">{a.customers?.display_name||'Customer'}{a.services?.name?` · ${a.services.name}`:''} · {CADENCES.find(([value])=>value===a.cadence)?.[1]||a.cadence} · <Money cents={a.price_cents}/> per visit</p></div><div className="flex flex-wrap items-center gap-2"><StatusPill tone={agreementTone(a.status)}>{a.status}</StatusPill><span className="flex items-center gap-1 text-xs font-semibold text-slate-500"><CalendarClock className="h-3.5 w-3.5"/>Next: {formatDay(a.next_service_at)}</span></div></div>
      <div className="mt-3 flex flex-wrap gap-2">
        {a.status==='active'&&<SecondaryButton disabled={busy===`${a.id}:generate`} onClick={()=>void generate(a.id)}><Play className="mr-1.5 inline h-3.5 w-3.5"/>{busy===`${a.id}:generate`?'Creating job…':'Generate next job'}</SecondaryButton>}
        {a.status==='active'&&<SecondaryButton disabled={busy===`${a.id}:paused`} onClick={()=>void setStatus(a.id,'paused')}>{busy===`${a.id}:paused`?'Pausing…':'Pause'}</SecondaryButton>}
        {(a.status==='paused'||a.status==='draft')&&<SecondaryButton disabled={busy===`${a.id}:active`} onClick={()=>void setStatus(a.id,'active')}>{busy===`${a.id}:active`?'Activating…':'Activate'}</SecondaryButton>}
        {['draft','active','paused'].includes(a.status)&&<SecondaryButton disabled={busy===`${a.id}:cancelled`} onClick={()=>void setStatus(a.id,'cancelled')}>{busy===`${a.id}:cancelled`?'Cancelling…':'Cancel agreement'}</SecondaryButton>}
      </div>
    </div>)}</div></Card>
    :<EmptyState icon={<Repeat className="h-5 w-5"/>} title="No service agreements yet" description="Create a maintenance plan or recurring visit and Jobrin.ai will keep the next scheduled job ready for it."/>}
  </Page>;
}