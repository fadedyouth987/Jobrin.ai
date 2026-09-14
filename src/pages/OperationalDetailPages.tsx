import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Bot, BriefcaseBusiness, CalendarClock, CheckCircle2, CircleDollarSign, ClipboardList, Clock3, FileText, Mail, MapPin, MessageSquareMore, PenLine, Phone, Star, UserRound, Wallet } from 'lucide-react';
import { useAuth } from '../app/auth';
import { AppLink } from '../app/router';
import { apiFetch } from '../lib/api';
import { Card, EmptyState, Field, Money, PrimaryButton, SecondaryButton, Spinner, StatusPill } from '../components/saas/ui';

function poTone(status: string): 'slate'|'green'|'amber'|'red'|'indigo' {
  if (status === 'received') return 'green';
  if (status === 'ordered') return 'indigo';
  if (status === 'cancelled') return 'red';
  return 'slate';
}

function tone(status: string): 'slate'|'green'|'amber'|'red'|'indigo' {
  if (['paid','completed','succeeded','accepted'].includes(status)) return 'green';
  if (['overdue','failed','cancelled','lost'].includes(status)) return 'red';
  if (['new','scheduled','sent','viewed','part_paid'].includes(status)) return 'amber';
  return 'slate';
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('en-AU', { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' }) : 'Not set';
}

function toLocalInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function JobDetailPage({ id }: { id: string }) {
  const { workspaceId } = useAuth();
  const [data,setData] = useState<any>(null); const [loading,setLoading] = useState(true); const [error,setError] = useState(''); const [busy,setBusy] = useState('');
  const [scheduleOpen,setScheduleOpen] = useState(false); const [start,setStart] = useState(''); const [end,setEnd] = useState('');
  const load = async()=>{if(!workspaceId)return;setLoading(true);setError('');try{const [result,cl,sig,rc]=await Promise.all([apiFetch<any>(`/api/operations/jobs/${id}`,{},workspaceId),apiFetch<any>(`/api/operations/jobs/${id}/checklists`,{},workspaceId).catch(()=>({checklists:[]})),apiFetch<any>(`/api/operations/jobs/${id}/signatures`,{},workspaceId).catch(()=>({signatures:[]})),apiFetch<any>(`/api/operations/jobs/${id}/recap`,{},workspaceId).catch(()=>({recap:null}))]);setData(result);setStart(toLocalInput(result.job.scheduled_start));setEnd(toLocalInput(result.job.scheduled_end));setField({checklists:cl.checklists||[],signatures:sig.signatures||[]});setRecap(rc.recap||null);setRecapText(rc.recap?.draft_text||'')}catch(err:any){setError(err.message)}finally{setLoading(false)}};
  useEffect(()=>{void load()},[workspaceId,id]);
  // Read-only purchase-orders summary for this job. Full PO management
  // (creating orders, adding line items, changing status) lives on the
  // Purchasing page — this is just enough to see spend committed against
  // the job without leaving it.
  const [purchaseOrders,setPurchaseOrders]=useState<any[]>([]);
  useEffect(()=>{if(!workspaceId)return;apiFetch<any>(`/api/purchasing/purchase-orders?job_id=${id}`,{},workspaceId).then(res=>setPurchaseOrders(res.purchaseOrders||[])).catch(()=>setPurchaseOrders([]))},[workspaceId,id]);
  const [tmOpen,setTmOpen]=useState(false);const [matOpen,setMatOpen]=useState(false);
  const [tmForm,setTmForm]=useState({start:'',end:'',break_minutes:'',notes:''});
  const [matForm,setMatForm]=useState({description:'',supplier:'',quantity:'1',unit_cost:'',unit_price:''});
  const [field,setField]=useState<{checklists:any[];signatures:any[]}>({checklists:[],signatures:[]});
  const [recap,setRecap]=useState<any>(null);const [recapText,setRecapText]=useState('');const [recapNote,setRecapNote]=useState('');
  const saveRecapEdit=async()=>{if(!workspaceId||!recap||recapText.trim()===recap.draft_text)return;setBusy('recap-save');setError('');try{const res=await apiFetch<any>(`/api/operations/jobs/${id}/recap`,{method:'PATCH',body:JSON.stringify({draft_text:recapText.trim()})},workspaceId);setRecap(res.recap)}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const approveRecap=async()=>{if(!workspaceId||!recap)return;setBusy('recap-approve');setError('');setRecapNote('');try{await saveRecapEdit();const res=await apiFetch<any>(`/api/operations/jobs/${id}/recap`,{method:'PATCH',body:JSON.stringify({status:'approved'})},workspaceId);setRecap(res.recap);setRecapNote('Approved and kept with the job record.')}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const discardRecap=async()=>{if(!workspaceId||!recap)return;setBusy('recap-discard');setError('');setRecapNote('');try{const res=await apiFetch<any>(`/api/operations/jobs/${id}/recap`,{method:'PATCH',body:JSON.stringify({status:'discarded'})},workspaceId);setRecap(res.recap)}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const sendRecap=async()=>{if(!workspaceId||!recap)return;setBusy('recap-send');setError('');setRecapNote('');try{await saveRecapEdit();const res=await apiFetch<any>(`/api/operations/jobs/${id}/recap/send`,{method:'POST'},workspaceId);setRecap(res.recap);setRecapNote('Sent to the customer by email.')}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const [clOpen,setClOpen]=useState(false);const [clForm,setClForm]=useState({title:'',items:[{item:'',done:false,critical:false}]});
  const submitChecklist=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;const results=clForm.items.filter(it=>it.item.trim()).map(it=>({item:it.item.trim(),done:it.done,critical:it.critical,notes:''}));if(!clForm.title.trim()||!results.length)return;setBusy('checklist');setError('');try{await apiFetch(`/api/operations/jobs/${id}/checklists`,{method:'POST',body:JSON.stringify({title:clForm.title.trim(),results})},workspaceId);setClForm({title:'',items:[{item:'',done:false,critical:false}]});setClOpen(false);await load()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const [sigName,setSigName]=useState('');const [sigDirty,setSigDirty]=useState(false);const sigRef=useRef<HTMLCanvasElement|null>(null);
  const clearSig=()=>{const canvas=sigRef.current;const ctx=canvas?.getContext('2d');if(canvas&&ctx)ctx.clearRect(0,0,canvas.width,canvas.height);setSigDirty(false)};
  const submitSignature=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;const data=sigDirty?sigRef.current?.toDataURL('image/png'):'';if(!sigName.trim()||!data||data.length<50)return;setBusy('signature');setError('');try{await apiFetch(`/api/operations/jobs/${id}/signatures`,{method:'POST',body:JSON.stringify({customer_name:sigName.trim(),signature_data:data})},workspaceId);setSigName('');clearSig();await load()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const addTime=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;setBusy('time');setError('');try{await apiFetch(`/api/operations/jobs/${id}/time`,{method:'POST',body:JSON.stringify({started_at:new Date(tmForm.start).toISOString(),ended_at:tmForm.end?new Date(tmForm.end).toISOString():null,break_minutes:Number(tmForm.break_minutes||0),notes:tmForm.notes})},workspaceId);setTmForm({start:'',end:'',break_minutes:'',notes:''});await load()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const addMaterial=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;setBusy('mat');setError('');try{await apiFetch(`/api/operations/jobs/${id}/materials`,{method:'POST',body:JSON.stringify({description:matForm.description,supplier:matForm.supplier||null,quantity:Number(matForm.quantity||1),unit_cost_cents:Math.round(Number(matForm.unit_cost||0)*100),unit_price_cents:Math.round(Number(matForm.unit_price||0)*100)})},workspaceId);setMatForm({description:'',supplier:'',quantity:'1',unit_cost:'',unit_price:''});await load()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const next = useMemo(()=>({new:'in_progress',scheduled:'on_the_way',on_the_way:'in_progress',in_progress:'completed',completed:'invoiced',invoiced:'paid'} as Record<string,string>)[data?.job?.status],[data?.job?.status]);
  const actionLabel:Record<string,string>={in_progress:'Start work',on_the_way:'Mark on the way',completed:'Complete job',invoiced:'Mark invoiced',paid:'Mark paid'};
  const changeStatus=async(status:string)=>{if(!workspaceId)return;setBusy(status);setError('');try{await apiFetch(`/api/operations/jobs/${id}/status`,{method:'PATCH',body:JSON.stringify({status})},workspaceId);await load()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  const saveSchedule=async(e:React.FormEvent)=>{e.preventDefault();if(!workspaceId)return;setBusy('schedule');setError('');try{await apiFetch(`/api/operations/jobs/${id}/schedule`,{method:'PATCH',body:JSON.stringify({scheduled_start:new Date(start).toISOString(),scheduled_end:new Date(end).toISOString()})},workspaceId);setScheduleOpen(false);await load()}catch(err:any){setError(err.message)}finally{setBusy('')}};
  if(loading)return <Spinner label="Loading job workspace…"/>;
  if(error&&!data)return <EmptyState title="Job could not be opened" description={error} action={<SecondaryButton onClick={load}>Try again</SecondaryButton>}/>;
  const {job,appointments,quotes,invoices,payments,time_entries:timeEntries,materials}=data;
  const labourMinutes=timeEntries.reduce((sum:number,e:any)=>{const end=e.ended_at?new Date(e.ended_at).getTime():Date.now();return sum+Math.max(0,Math.round((end-new Date(e.started_at).getTime())/60000)-Number(e.break_minutes||0))},0);
  const matCost=materials.reduce((sum:number,m:any)=>sum+Number(m.unit_cost_cents||0)*Number(m.quantity||0),0);
  const matCharge=materials.reduce((sum:number,m:any)=>sum+Number(m.unit_price_cents||0)*Number(m.quantity||0),0);
  const canAdvance = next && !(next==='invoiced'&&!invoices.length) && !(next==='paid'&&invoices.some((invoice:any)=>Number(invoice.balance_due_cents)>0));
  return <div className="space-y-5">
    <div><AppLink href="/app/jobs" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-950"><ArrowLeft className="h-4 w-4"/>Back to jobs</AppLink><div className="mt-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Job #{job.job_number}</p><StatusPill tone={tone(job.status)}>{job.status.replaceAll('_',' ')}</StatusPill></div><h1 className="mt-2 text-3xl font-black tracking-tight">{job.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{job.description||'No work description has been added.'}</p></div><div className="flex flex-wrap gap-2"><SecondaryButton onClick={()=>setScheduleOpen(v=>!v)}><CalendarClock className="mr-2 inline h-4 w-4"/>{job.scheduled_start?'Reschedule':'Schedule job'}</SecondaryButton>{canAdvance&&<PrimaryButton disabled={Boolean(busy)} onClick={()=>changeStatus(next)}>{busy===next?'Updating…':actionLabel[next]}</PrimaryButton>}</div></div></div>
    {error&&<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {scheduleOpen&&<Card className="p-5"><form onSubmit={saveSchedule} className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><h2 className="font-bold">Job schedule</h2><p className="mt-1 text-sm text-slate-500">Both times are required. Jobrin.ai checks the time range before saving.</p></div><Field label="Start" type="datetime-local" required value={start} onChange={e=>{setStart(e.target.value);if(e.target.value&&!end){const d=new Date(e.target.value);d.setHours(d.getHours()+1);setEnd(toLocalInput(d.toISOString()))}}}/><Field label="Finish" type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/><div className="flex gap-2 sm:col-span-2"><PrimaryButton disabled={busy==='schedule'}>{busy==='schedule'?'Saving…':'Save schedule'}</PrimaryButton><SecondaryButton type="button" onClick={()=>setScheduleOpen(false)}>Cancel</SecondaryButton></div></form></Card>}
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]"><div className="space-y-5"><Card className="p-5"><h2 className="font-bold">Job overview</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><Info icon={UserRound} label="Customer" value={job.customers?.display_name||'No customer'} href={job.customer_id?`/app/customers/${job.customer_id}`:undefined}/><Info icon={MapPin} label="Address" value={job.address_text||'Not added'}/><Info icon={CalendarClock} label="Start" value={formatDate(job.scheduled_start)}/><Info icon={Clock3} label="Finish" value={formatDate(job.scheduled_end)}/></div></Card><Card className="p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Quotes and invoices</h2><AppLink href={`/app/quotes?job=${job.id}`} className="text-xs font-semibold text-indigo-600">Create quote</AppLink></div><div className="mt-4 space-y-2">{quotes.map((row:any)=><MoneyRow key={`q${row.id}`} icon={FileText} label={`Quote #${row.quote_number}`} status={row.status} cents={row.total_cents}/>) }{invoices.map((row:any)=><MoneyRow key={`i${row.id}`} icon={CircleDollarSign} label={`Invoice #${row.invoice_number}`} status={row.status} cents={row.balance_due_cents} suffix=" outstanding"/>)}{!quotes.length&&!invoices.length&&<EmptyState title="No financial documents" description="Create a quote or invoice from this job so revenue stays connected to the work."/>}</div></Card>
        <Card className="p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Purchase orders</h2><AppLink href="/app/purchasing" className="text-xs font-semibold text-indigo-600">Manage purchasing</AppLink></div>
          <div className="mt-4 space-y-2">{purchaseOrders.map((po:any)=><div key={po.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><ClipboardList className="h-4 w-4 flex-none text-slate-400"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{po.suppliers?.name||'Supplier'}</p><p className="text-xs text-slate-500">Created {formatDate(po.created_at)}</p></div><StatusPill tone={poTone(po.status)}>{po.status}</StatusPill></div>)}{!purchaseOrders.length&&<EmptyState title="No purchase orders linked" description="Create a purchase order for this job from the Purchasing page to track supplier costs against it."/>}</div>
        </Card>
        <Card className="p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Checklists &amp; critical items</h2><SecondaryButton onClick={()=>setClOpen(v=>!v)}>{clOpen?'Cancel checklist':'Complete checklist'}</SecondaryButton></div>
          {clOpen&&<form onSubmit={submitChecklist} className="mt-3 space-y-2"><input placeholder="Checklist title (e.g. Hot water service)" required value={clForm.title} onChange={e=>setClForm(v=>({...v,title:e.target.value}))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"/>
            {clForm.items.map((item,index)=><div key={index} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2"><input placeholder="Checklist item" required value={item.item} onChange={e=>setClForm(v=>({...v,items:v.items.map((it,i)=>i===index?{...it,item:e.target.value}:it)}))} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"/><label className="flex items-center gap-1 text-xs font-semibold text-slate-600"><input type="checkbox" checked={item.done} onChange={e=>setClForm(v=>({...v,items:v.items.map((it,i)=>i===index?{...it,done:e.target.checked}:it)}))}/>Done</label><label className="flex items-center gap-1 text-xs font-semibold text-slate-600"><input type="checkbox" checked={item.critical} onChange={e=>setClForm(v=>({...v,items:v.items.map((it,i)=>i===index?{...it,critical:e.target.checked}:it)}))}/>Critical</label><button type="button" onClick={()=>setClForm(v=>({...v,items:v.items.length>1?v.items.filter((_,i)=>i!==index):v.items}))} className="text-xs font-semibold text-slate-400 hover:text-red-600">Remove</button></div>)}
            <div className="flex justify-between"><SecondaryButton type="button" onClick={()=>setClForm(v=>({...v,items:[...v.items,{item:'',done:false,critical:false}]}))}>Add item</SecondaryButton><PrimaryButton disabled={busy==='checklist'}>{busy==='checklist'?'Saving…':'Save checklist'}</PrimaryButton></div></form>}
          <div className="mt-4 space-y-2">{field.checklists.map((cl:any)=><div key={cl.id} className="rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{cl.title}</p>{cl.all_critical_done?<span className="flex-none rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">critical done</span>:<span className="flex-none rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">critical missed</span>}</div><div className="mt-2 space-y-1">{(cl.results||[]).map((r:any,i:number)=><p key={i} className={`text-xs ${r.done?'text-slate-600':'font-medium text-amber-700'}`}>{r.done?'✓':'○'} {r.item}{r.critical&&<span className="ml-1 font-bold text-red-600">critical</span>}</p>)}</div><p className="mt-2 text-[10px] text-slate-400">Completed {formatDate(cl.completed_at||cl.created_at)}</p></div>)}{!field.checklists.length&&!clOpen&&<p className="mt-3 text-xs text-slate-400">No checklists completed yet.</p>}</div>
        </Card>
        {recap&&recap.status!=='discarded'&&<Card className="p-5"><div className="flex items-center justify-between gap-2"><h2 className="font-bold"><Bot className="mr-2 inline h-4 w-4 text-indigo-600"/>AI work recap</h2><StatusPill tone={recap.status==='sent'?'green':recap.status==='approved'?'indigo':'amber'}>{recap.status}</StatusPill></div>
          <p className="mt-1 text-xs text-slate-500">Drafted by the AI from the job's checklist, time and material record. Review and edit before you keep it or send it — nothing goes to the customer without your approval.</p>
          <textarea value={recapText} onChange={e=>setRecapText(e.target.value)} onBlur={saveRecapEdit} disabled={recap.status==='sent'} rows={5} className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"/>
          {recapNote&&<p className="mt-2 text-xs font-semibold text-emerald-700">{recapNote}</p>}
          {recap.status!=='sent'&&<div className="mt-3 flex flex-wrap gap-2">
            <PrimaryButton disabled={Boolean(busy)} onClick={approveRecap}>{busy==='recap-approve'?'Saving…':'Approve & keep'}</PrimaryButton>
            <SecondaryButton disabled={Boolean(busy)||!job.customers?.email} onClick={sendRecap} title={!job.customers?.email?'This customer has no email on file':undefined}>{busy==='recap-send'?'Sending…':'Send to customer'}</SecondaryButton>
            <SecondaryButton disabled={Boolean(busy)} onClick={discardRecap}>{busy==='recap-discard'?'Discarding…':'Discard'}</SecondaryButton>
          </div>}
          {recap.status==='sent'&&<p className="mt-3 text-xs text-slate-400">Sent {formatDate(recap.sent_at)}.</p>}
        </Card>}
      </div>
      <div className="space-y-5">        <Card className="p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Time &amp; materials</h2>{labourMinutes>0?<span className="text-xs font-semibold text-slate-500">{Math.floor(labourMinutes/60)}h {labourMinutes%60}m logged</span>:null}</div>
          {timeEntries.length?<div className="mt-3 space-y-2">{timeEntries.map((entry:any)=><div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 text-sm"><div className="min-w-0"><p className="font-semibold">{new Date(entry.started_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}{entry.ended_at?` → ${new Date(entry.ended_at).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}`:' (running)'}</p>{entry.notes&&<p className="text-xs text-slate-500">{entry.notes}</p>}</div><span className="flex-none text-xs font-bold text-slate-600">{entry.ended_at?`${Math.max(0,Math.round((new Date(entry.ended_at).getTime()-new Date(entry.started_at).getTime())/60000-Number(entry.break_minutes||0)))} min`:''}</span></div>)}</div>:<p className="mt-3 text-xs text-slate-400">No time logged yet.</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs text-slate-500">Labour logged</p><p className="text-sm font-black">{Math.floor(labourMinutes/60)}h {labourMinutes%60}m</p></div>
            <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs text-slate-500">Materials cost</p><p className="text-sm font-black"><Money cents={matCost}/></p></div>
            <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs text-slate-500">Materials charge</p><p className="text-sm font-black"><Money cents={matCharge}/></p></div>
          </div>
          {tmOpen&&<form onSubmit={addTime} className="mt-3 grid gap-2 sm:grid-cols-4"><input type="datetime-local" required value={tmForm.start} onChange={e=>setTmForm(v=>({...v,start:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"/><input type="datetime-local" value={tmForm.end} onChange={e=>setTmForm(v=>({...v,end:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"/><input type="number" min="0" placeholder="Break (min)" value={tmForm.break_minutes} onChange={e=>setTmForm(v=>({...v,break_minutes:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"/><input placeholder="What was done" value={tmForm.notes} onChange={e=>setTmForm(v=>({...v,notes:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2"/><div className="sm:col-span-2 flex justify-end"><PrimaryButton disabled={busy==='time'}>{busy==='time'?'Logging…':'Log time'}</PrimaryButton></div></form>}
          {matOpen&&<form onSubmit={addMaterial} className="mt-3 grid gap-2 sm:grid-cols-5"><input placeholder="Material / part" required value={matForm.description} onChange={e=>setMatForm(v=>({...v,description:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2"/><input placeholder="Supplier (optional)" value={matForm.supplier} onChange={e=>setMatForm(v=>({...v,supplier:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"/><input type="number" min="0.001" step="0.001" placeholder="Qty" value={matForm.quantity} onChange={e=>setMatForm(v=>({...v,quantity:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"/><input type="number" min="0" step="0.01" placeholder="Unit cost $" value={matForm.unit_cost} onChange={e=>setMatForm(v=>({...v,unit_cost:e.target.value}))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"/><div className="flex gap-2"><input type="number" min="0" step="0.01" placeholder="Charge $" value={matForm.unit_price} onChange={e=>setMatForm(v=>({...v,unit_price:e.target.value}))} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"/><PrimaryButton disabled={busy==='mat'}>{busy==='mat'?'Adding…':'Add'}</PrimaryButton></div></form>}
          <div className="mt-3 flex flex-wrap gap-2"><SecondaryButton onClick={()=>setTmOpen(v=>!v)}>{tmOpen?'Cancel time entry':'Log time'}</SecondaryButton><SecondaryButton onClick={()=>setMatOpen(v=>!v)}>{matOpen?'Cancel material':'Add material'}</SecondaryButton></div>
        </Card>
      <Card className="p-5"><h2 className="font-bold">Customer signature</h2><p className="mt-1 text-xs text-slate-500">Signed on site as proof of acceptance; stored with the job record and the customer's name and time.</p>
        <form onSubmit={submitSignature} className="mt-3 space-y-2"><input placeholder="Customer full name" required value={sigName} onChange={e=>setSigName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"/><SignaturePad canvasRef={sigRef} onInk={()=>setSigDirty(true)}/><div className="flex gap-2"><PrimaryButton disabled={busy==='signature'}>{busy==='signature'?'Saving…':'Capture signature'}</PrimaryButton><SecondaryButton type="button" onClick={clearSig}>Clear</SecondaryButton></div></form>
        {field.signatures.length?<div className="mt-4 space-y-2">{field.signatures.map((s:any)=><div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 text-sm"><span className="min-w-0 truncate font-semibold"><PenLine className="mr-1.5 inline h-4 w-4 text-slate-400"/>{s.customer_name}</span><span className="flex-none text-xs text-slate-400">{formatDate(s.signed_at)}</span></div>)}</div>:<p className="mt-3 text-xs text-slate-400">No signatures captured yet.</p>}
      </Card>
      <Card className="p-5"><h2 className="font-bold">Recommended next step</h2><p className="mt-2 text-sm leading-6 text-slate-500">{next==='invoiced'&&!invoices.length?'Create an invoice before marking this job invoiced.':next==='paid'&&!canAdvance?'The job will become paid automatically only after its invoice balance is settled.':next?`${actionLabel[next]} when the business has genuinely reached that stage.`:'No further lifecycle action is required.'}</p>{next==='invoiced'&&!invoices.length&&<AppLink href={`/app/invoices?job=${job.id}`} className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Create invoice</AppLink>}</Card><Card className="p-5"><h2 className="font-bold">Activity</h2><div className="mt-4 space-y-3"><Activity label="Job created" date={job.created_at}/>{appointments.map((row:any)=><Activity key={row.id} label={`Appointment ${row.status}`} date={row.starts_at}/>)}{quotes.map((row:any)=><Activity key={row.id} label={`Quote #${row.quote_number} ${row.status}`} date={row.created_at}/>)}{invoices.map((row:any)=><Activity key={row.id} label={`Invoice #${row.invoice_number} ${row.status}`} date={row.created_at}/>)}{payments.map((row:any)=><Activity key={row.id} label={`Payment ${row.status}`} date={row.paid_at||row.created_at}/>)}</div></Card></div></div>
  </div>;
}

// --- Business Timeline: one chronological stream for a customer, instead of
// four disconnected cards (Jobs / Quotes+Invoices / Recent contact / Sales
// history) that each sorted and scrolled independently. Reuses the same
// interleaved-Activity idea JobDetailPage already uses for a single job.
type TimelineEntry={id:string;icon:any;label:string;date:string|null;href?:string;tone:'slate'|'green'|'amber'|'red'|'indigo'};
function customerTimelineEntries(data:any):TimelineEntry[] {
  const {jobs=[],quotes=[],invoices=[],payments=[],calls=[],leads=[],messages=[],reviews=[],aiActions=[]}=data;
  const money=(cents:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format((cents||0)/100);
  const entries:TimelineEntry[]=[
    ...jobs.map((row:any)=>({id:`job:${row.id}`,icon:ClipboardList,label:`Job — ${row.title} (${row.status.replaceAll('_',' ')})`,date:row.created_at,href:`/app/jobs/${row.id}`,tone:tone(row.status)})),
    ...quotes.map((row:any)=>({id:`quote:${row.id}`,icon:FileText,label:`Quote #${row.quote_number} ${row.status} — ${money(row.total_cents)}`,date:row.created_at,tone:tone(row.status)})),
    ...invoices.map((row:any)=>({id:`invoice:${row.id}`,icon:CircleDollarSign,label:`Invoice #${row.invoice_number} ${row.status} — ${money(row.balance_due_cents)} owing`,date:row.created_at,tone:tone(row.status)})),
    ...payments.map((row:any)=>({id:`payment:${row.id}`,icon:Wallet,label:`Payment ${row.status} — ${money(row.amount_cents)}`,date:row.paid_at||row.created_at,tone:row.status==='succeeded'?'green':'slate'as const})),
    ...calls.map((row:any)=>({id:`call:${row.id}`,icon:Phone,label:`${row.direction==='inbound'?'Inbound':'Outbound'} call · ${row.status}${row.summary?` — ${row.summary}`:''}`,date:row.started_at,tone:'slate'as const})),
    ...leads.map((row:any)=>({id:`lead:${row.id}`,icon:BriefcaseBusiness,label:`Lead — ${row.title} (${row.stage})`,date:row.created_at,tone:tone(row.stage)})),
    ...messages.map((row:any)=>({id:`message:${row.id}`,icon:MessageSquareMore,label:`${row.direction==='inbound'?'Message from customer':'Message sent'}${row.body?`: "${String(row.body).slice(0,80)}${row.body.length>80?'…':''}"`:''}`,date:row.created_at,tone:'slate'as const})),
    ...reviews.map((row:any)=>({id:`review:${row.id}`,icon:Star,label:`Review request ${row.status}${row.rating?` — ${row.rating}★`:''}`,date:row.completed_at||row.sent_at||row.created_at,tone:row.status==='completed'?'green':'slate'as const})),
    ...aiActions.map((row:any)=>({id:`ai:${row.id}`,icon:Bot,label:`AI: ${String(row.tool_name||'action').replace(/_/g,' ')} (${row.status})`,date:row.created_at,tone:row.status==='completed'?'indigo':'slate'as const})),
  ];
  return entries.filter((e)=>e.date).sort((a,b)=>new Date(b.date as string).getTime()-new Date(a.date as string).getTime());
}
function BusinessTimeline({data}:{data:any}) {
  const entries=useMemo(()=>customerTimelineEntries(data),[data]);
  if(!entries.length)return <p className="p-5 text-sm text-slate-500">No activity recorded for this customer yet.</p>;
  return <div className="divide-y divide-slate-100">{entries.map((entry)=>{
    const Icon=entry.icon;
    const dotTone={slate:'bg-slate-400',green:'bg-emerald-500',amber:'bg-amber-500',red:'bg-red-500',indigo:'bg-indigo-500'}[entry.tone];
    const content=<div className="flex items-start gap-3 px-5 py-3"><span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon className="h-4 w-4"/></span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800">{entry.label}</p><p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${dotTone}`}/>{formatDate(entry.date)}</p></div></div>;
    return entry.href?<AppLink key={entry.id} href={entry.href} className="block transition hover:bg-slate-50">{content}</AppLink>:<div key={entry.id}>{content}</div>;
  })}</div>;
}

export function CustomerDetailPage({ id }: { id: string }) {
  const {workspaceId}=useAuth(); const [data,setData]=useState<any>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  useEffect(()=>{if(!workspaceId)return;setLoading(true);apiFetch<any>(`/api/crm/customers/${id}`,{},workspaceId).then(setData).catch((err:any)=>setError(err.message)).finally(()=>setLoading(false))},[workspaceId,id]);
  if(loading)return <Spinner label="Loading customer workspace…"/>;
  if(error||!data)return <EmptyState title="Customer could not be opened" description={error||'Customer not found.'}/>;
  const {customer,addresses,jobs,invoices}=data; const outstanding=invoices.reduce((sum:number,row:any)=>sum+Number(row.balance_due_cents||0),0);
  return <div className="space-y-5"><div><AppLink href="/app/customers" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500"><ArrowLeft className="h-4 w-4"/>Back to customers</AppLink><div className="mt-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Customer workspace</p><h1 className="mt-2 text-3xl font-black tracking-tight">{customer.display_name}</h1><div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">{customer.phone&&<a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4"/>{customer.phone}</a>}{customer.email&&<a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4"/>{customer.email}</a>}</div></div><AppLink href={`/app/jobs?customer=${customer.id}`} className="inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Create job</AppLink></div></div>
    <div className="grid gap-4 md:grid-cols-3"><Metric label="Lifetime value" value={<Money cents={customer.lifetime_value_cents||0}/>}/><Metric label="Outstanding" value={<Money cents={outstanding}/>}/><Metric label="Jobs" value={String(jobs.length)}/></div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <Card className="overflow-hidden"><SectionHead title="Business timeline"/><BusinessTimeline data={data}/></Card>
      <div className="space-y-5"><Card className="p-5"><h2 className="font-bold">Customer details</h2><div className="mt-4 space-y-3 text-sm"><Detail label="Source" value={customer.source||'Not recorded'}/><Detail label="Notes" value={customer.notes||'No notes'}/><Detail label="Tags" value={(customer.tags||[]).join(', ')||'No tags'}/>{addresses.map((address:any)=><Detail key={address.id} label={address.label||'Address'} value={[address.street,address.suburb,address.state,address.postcode].filter(Boolean).join(', ')}/>)}</div></Card></div>
    </div>
  </div>;
}

function Info({icon:Icon,label,value,href}:{icon:any;label:string;value:string;href?:string}) { const content=<><Icon className="h-4 w-4 text-slate-400"/><div><p className="text-xs font-semibold text-slate-400">{label}</p><p className="mt-0.5 text-sm font-semibold text-slate-800">{value}</p></div></>; return href?<AppLink href={href} className="flex gap-3 rounded-xl bg-slate-50 p-3 hover:bg-slate-100">{content}</AppLink>:<div className="flex gap-3 rounded-xl bg-slate-50 p-3">{content}</div> }
function MoneyRow({icon:Icon,label,status,cents,suffix='' }:{icon:any;label:string;status:string;cents:number;suffix?:string}) { return <div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><Icon className="h-4 w-4 text-slate-400"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{label}</p><p className="text-xs text-slate-500"><Money cents={cents}/>{suffix}</p></div><StatusPill tone={tone(status)}>{status}</StatusPill></div> }
function Activity({label,date}:{label:string;date?:string|null}) { return <div className="flex gap-3"><span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-indigo-500"/><div><p className="text-sm font-medium text-slate-800">{label}</p><p className="text-xs text-slate-400">{formatDate(date)}</p></div></div> }
function Metric({label,value}:{label:string;value:ReactNode}) { return <Card className="p-5"><p className="text-xs font-semibold text-slate-500">{label}</p><div className="mt-2 text-3xl font-black">{value}</div></Card> }
function SectionHead({title}:{title:string}) { return <div className="border-b border-slate-100 bg-slate-50 px-5 py-3"><h2 className="font-bold">{title}</h2></div> }
function Detail({label,value}:{label:string;value:string}) { return <div><p className="text-xs font-semibold text-slate-400">{label}</p><p className="mt-0.5 leading-6 text-slate-700">{value}</p></div> }

// Draw-with-finger-or-mouse signature pad. Pointer events cover touch, pen and
// mouse; touch-none stops the page scrolling while the customer signs.
function SignaturePad({canvasRef,onInk}:{canvasRef:React.RefObject<HTMLCanvasElement|null>;onInk:()=>void}) {
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.lineWidth=2;ctx.lineCap='round';ctx.strokeStyle='#0f172a';
    let drawing=false;
    const pos=(e:PointerEvent)=>{const rect=canvas.getBoundingClientRect();return {x:e.clientX-rect.left,y:e.clientY-rect.top}};
    const down=(e:PointerEvent)=>{e.preventDefault();drawing=true;onInk();const {x,y}=pos(e);ctx.beginPath();ctx.moveTo(x,y)};
    const move=(e:PointerEvent)=>{if(!drawing)return;const {x,y}=pos(e);ctx.lineTo(x,y);ctx.stroke()};
    const up=()=>{drawing=false};
    canvas.addEventListener('pointerdown',down);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
    return ()=>{canvas.removeEventListener('pointerdown',down);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};
  },[canvasRef,onInk]);
  return <canvas ref={canvasRef} width={480} height={180} className="w-full touch-none rounded-xl border border-slate-200 bg-white"/>;
}
