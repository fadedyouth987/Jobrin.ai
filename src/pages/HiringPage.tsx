import React, { useEffect, useState } from 'react';
import { AlertTriangle, BriefcaseBusiness, CheckCircle2, ChevronRight, Plus, RefreshCcw, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../app/auth';
import { apiFetch } from '../lib/api';
import { Card, EmptyState, Field, PrimaryButton, SecondaryButton, SelectField, Spinner, StatusPill, TextareaField } from '../components/saas/ui';

const stages = ['applied', 'screening', 'interview', 'trial', 'offered', 'hired'] as const;
const nextStage: Record<string, string | undefined> = { applied: 'screening', screening: 'interview', interview: 'trial', trial: 'offered', offered: 'hired' };

function displayStage(stage: string) { return stage.replace('_', ' '); }

export function HiringPage() {
  const { workspaceId } = useAuth();
  const [openings, setOpenings] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showOpening, setShowOpening] = useState(false);
  const [showCandidate, setShowCandidate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState({ title: '', trade: '', location: '', employment_type: 'full_time', summary: '', requirements: '', status: 'open' });
  const [candidate, setCandidate] = useState({ opening_id: '', full_name: '', email: '', phone: '', suburb: '', experience_summary: '', licences: '', availability: '', source: 'direct', consent: false });

  const refresh = async () => {
    if (!workspaceId) return;
    setLoading(true); setError('');
    try {
      const [openingResult, applicationResult] = await Promise.all([
        apiFetch<any>('/api/hiring/openings', {}, workspaceId),
        apiFetch<any>('/api/hiring/applications', {}, workspaceId),
      ]);
      setOpenings(openingResult.openings ?? []);
      setApplications(applicationResult.applications ?? []);
    } catch (err: any) { setError(err.message || 'Could not load the hiring pipeline.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, [workspaceId]);

  const createOpening = async (event: React.FormEvent) => {
    event.preventDefault(); if (!workspaceId) return;
    setBusy(true); setError('');
    try {
      await apiFetch('/api/hiring/openings', { method: 'POST', body: JSON.stringify({ ...opening, requirements: opening.requirements.split('\n').map((item) => item.trim()).filter(Boolean) }) }, workspaceId);
      setOpening({ title: '', trade: '', location: '', employment_type: 'full_time', summary: '', requirements: '', status: 'open' }); setShowOpening(false); await refresh();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  const createCandidate = async (event: React.FormEvent) => {
    event.preventDefault(); if (!workspaceId || !candidate.opening_id) return;
    if (!candidate.consent) { setError('Record the candidate’s permission before saving their details.'); return; }
    setBusy(true); setError('');
    try {
      const created = await apiFetch<any>('/api/hiring/candidates', { method: 'POST', body: JSON.stringify({
        full_name: candidate.full_name, email: candidate.email || null, phone: candidate.phone || null, suburb: candidate.suburb,
        experience_summary: candidate.experience_summary, licences: candidate.licences.split('\n').map((item) => item.trim()).filter(Boolean), availability: candidate.availability,
        source: candidate.source, privacy_notice_version: 'jobrin-ai-hiring-v1', consent_captured_at: new Date().toISOString(),
      }) }, workspaceId);
      await apiFetch('/api/hiring/applications', { method: 'POST', body: JSON.stringify({ job_opening_id: candidate.opening_id, candidate_id: created.candidate.id }) }, workspaceId);
      setCandidate({ opening_id: '', full_name: '', email: '', phone: '', suburb: '', experience_summary: '', licences: '', availability: '', source: 'direct', consent: false }); setShowCandidate(false); await refresh();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  const changeStage = async (application: any, stage: string) => {
    if (!workspaceId) return;
    setBusy(true); setError('');
    try { await apiFetch(`/api/hiring/applications/${application.id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage, notes: notes[application.id] ?? application.notes ?? '' }) }, workspaceId); await refresh(); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  const saveNotes = async (application: any) => {
    if (!workspaceId) return;
    setBusy(true); setError('');
    try { await apiFetch(`/api/hiring/applications/${application.id}/notes`, { method: 'PATCH', body: JSON.stringify({ notes: notes[application.id] ?? application.notes ?? '' }) }, workspaceId); await refresh(); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  if (loading) return <Spinner label="Loading hiring pipeline…" />;
  return <section>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-indigo-600">Grow the crew</p><h1 className="mt-1 text-3xl font-black tracking-tight">Hiring</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Run a fair, structured hiring process for your own team. Jobrin.ai supports the workflow; a manager always makes the hiring decision.</p></div><div className="flex flex-wrap gap-2"><SecondaryButton onClick={() => void refresh()}><RefreshCcw className="mr-2 inline h-4 w-4" />Refresh</SecondaryButton><PrimaryButton onClick={() => setShowOpening((value) => !value)}><Plus className="mr-2 inline h-4 w-4" />New role</PrimaryButton></div></div>
    {error && <div className="mb-5 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />{error}</div>}
    <div className="mb-6 grid gap-4 md:grid-cols-3"><Card className="p-5"><BriefcaseBusiness className="h-5 w-5 text-indigo-600" /><p className="mt-4 text-3xl font-black">{openings.filter((item) => item.status === 'open').length}</p><p className="text-sm text-slate-500">Open roles</p></Card><Card className="p-5"><Users className="h-5 w-5 text-indigo-600" /><p className="mt-4 text-3xl font-black">{applications.length}</p><p className="text-sm text-slate-500">Active applications</p></Card><Card className="p-5"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><p className="mt-4 text-3xl font-black">{applications.filter((item) => item.stage === 'hired').length}</p><p className="text-sm text-slate-500">Hired</p></Card></div>
    {showOpening && <Card className="mb-6 p-5"><form onSubmit={createOpening} className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2"><h2 className="font-bold">Create an opening</h2><p className="mt-1 text-sm text-slate-500">Write the role first. Publishing to job boards comes later, after those integrations are properly configured.</p></div><Field label="Role title" required value={opening.title} onChange={(event) => setOpening((value) => ({ ...value, title: event.target.value }))} placeholder="Qualified electrician" /><Field label="Trade or service" value={opening.trade} onChange={(event) => setOpening((value) => ({ ...value, trade: event.target.value }))} placeholder="Electrical" /><Field label="Location" value={opening.location} onChange={(event) => setOpening((value) => ({ ...value, location: event.target.value }))} placeholder="Adelaide, SA" /><SelectField label="Employment type" value={opening.employment_type} onChange={(event) => setOpening((value) => ({ ...value, employment_type: event.target.value }))}><option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="casual">Casual</option><option value="apprenticeship">Apprenticeship</option><option value="subcontractor">Subcontractor</option></SelectField><div className="md:col-span-2"><TextareaField label="Role summary" value={opening.summary} onChange={(event) => setOpening((value) => ({ ...value, summary: event.target.value }))} placeholder="What will this person do and why would they want the role?" /></div><div className="md:col-span-2"><TextareaField label="Required licences or capabilities" value={opening.requirements} onChange={(event) => setOpening((value) => ({ ...value, requirements: event.target.value }))} placeholder={'One per line, e.g.\nCurrent electrical licence\nAustralian driver licence'} /></div><div className="md:col-span-2 flex gap-2"><PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Save opening'}</PrimaryButton><SecondaryButton type="button" onClick={() => setShowOpening(false)}>Cancel</SecondaryButton></div></form></Card>}
    <div className="mb-6 grid gap-4 lg:grid-cols-2">{openings.map((item) => <Card key={item.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{item.title}</h2><p className="mt-1 text-sm text-slate-500">{[item.trade, item.location, displayStage(item.employment_type)].filter(Boolean).join(' · ')}</p></div><StatusPill tone={item.status === 'open' ? 'green' : 'slate'}>{item.status}</StatusPill></div><p className="mt-4 text-sm leading-6 text-slate-600">{item.summary || 'No summary added yet.'}</p><div className="mt-4 flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{item.application_count} applicant{item.application_count === 1 ? '' : 's'}</span><SecondaryButton onClick={() => { setCandidate((value) => ({ ...value, opening_id: item.id })); setShowCandidate(true); }}>Add candidate <ChevronRight className="ml-1 inline h-4 w-4" /></SecondaryButton></div></Card>)}{!openings.length && <EmptyState title="Start with one role" description="Create the first role you need to fill. Jobrin.ai will keep the candidate workflow private to your management team." action={<PrimaryButton onClick={() => setShowOpening(true)}>Create an opening</PrimaryButton>} />}</div>
    {showCandidate && <Card className="mb-6 p-5"><form onSubmit={createCandidate} className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2"><h2 className="font-bold">Add a candidate</h2><p className="mt-1 text-sm text-slate-500">Only store details the candidate has agreed you may keep. Do not enter medical, criminal-history or other sensitive information.</p></div><SelectField label="Role" value={candidate.opening_id} onChange={(event) => setCandidate((value) => ({ ...value, opening_id: event.target.value }))} required><option value="">Choose role…</option>{openings.filter((item) => item.status === 'open').map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</SelectField><Field label="Full name" value={candidate.full_name} onChange={(event) => setCandidate((value) => ({ ...value, full_name: event.target.value }))} required /><Field label="Email" type="email" value={candidate.email} onChange={(event) => setCandidate((value) => ({ ...value, email: event.target.value }))} /><Field label="Phone" value={candidate.phone} onChange={(event) => setCandidate((value) => ({ ...value, phone: event.target.value }))} /><Field label="Suburb" value={candidate.suburb} onChange={(event) => setCandidate((value) => ({ ...value, suburb: event.target.value }))} /><Field label="Source" value={candidate.source} onChange={(event) => setCandidate((value) => ({ ...value, source: event.target.value }))} placeholder="Referral, direct, job board" /><div className="md:col-span-2"><TextareaField label="Relevant experience" value={candidate.experience_summary} onChange={(event) => setCandidate((value) => ({ ...value, experience_summary: event.target.value }))} placeholder="Keep this factual and relevant to the role." /></div><div className="md:col-span-2"><TextareaField label="Licences and tickets" value={candidate.licences} onChange={(event) => setCandidate((value) => ({ ...value, licences: event.target.value }))} placeholder={'One per line, e.g.\nWhite Card\nDriver licence'} /></div><div className="md:col-span-2"><Field label="Availability" value={candidate.availability} onChange={(event) => setCandidate((value) => ({ ...value, availability: event.target.value }))} placeholder="Available weekdays from 15 September" /></div><label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"><input type="checkbox" checked={candidate.consent} onChange={(event) => setCandidate((value) => ({ ...value, consent: event.target.checked }))} className="mt-1 h-4 w-4" /><span><strong>I confirm this candidate has been told why we are collecting these details and has agreed to us keeping them for this hiring process.</strong><br /><span className="text-xs text-slate-500">This is an employer record, not a public Jobrin.ai talent marketplace.</span></span></label><div className="md:col-span-2 flex gap-2"><PrimaryButton disabled={busy || !candidate.consent}>{busy ? 'Saving…' : 'Add to pipeline'}</PrimaryButton><SecondaryButton type="button" onClick={() => setShowCandidate(false)}>Cancel</SecondaryButton></div></form></Card>}
    <div className="mb-3 flex items-center justify-between"><div><h2 className="text-xl font-black">Candidate pipeline</h2><p className="mt-1 text-sm text-slate-500">Move candidates forward only after a human review. Rejections and withdrawals are intentionally not automated.</p></div><ShieldCheck className="h-5 w-5 text-emerald-600" /></div>
    <div className="grid auto-cols-[300px] grid-flow-col gap-4 overflow-x-auto pb-4">{stages.map((stage) => <div key={stage}><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{displayStage(stage)}</h3><span className="text-xs text-slate-400">{applications.filter((item) => item.stage === stage).length}</span></div><div className="space-y-3">{applications.filter((item) => item.stage === stage).map((item) => <Card key={item.id} className="p-4"><p className="font-bold">{item.candidates?.full_name || 'Candidate'}</p><p className="mt-1 text-xs text-slate-500">{item.job_openings?.title || 'Role'} · {item.candidates?.suburb || 'Location not added'}</p>{item.candidates?.licences?.length > 0 && <p className="mt-3 text-xs text-slate-600">{item.candidates.licences.join(' · ')}</p>}<div className="mt-3"><TextareaField label="Manager notes" className="min-h-20" value={notes[item.id] ?? item.notes ?? ''} onChange={(event) => setNotes((value) => ({ ...value, [item.id]: event.target.value }))} placeholder="Interview outcome, next step or reason…" /></div><div className="mt-3 flex flex-wrap gap-2"><SecondaryButton disabled={busy} onClick={() => void saveNotes(item)}>Save note</SecondaryButton>{nextStage[item.stage] && <PrimaryButton disabled={busy} onClick={() => void changeStage(item, nextStage[item.stage]!)}>Move to {displayStage(nextStage[item.stage]!)}</PrimaryButton>}</div>{!['hired','rejected','withdrawn'].includes(item.stage) && <div className="mt-3 flex gap-3 text-xs"><button disabled={busy} onClick={() => void changeStage(item, 'rejected')} className="font-semibold text-slate-500 hover:text-red-700 disabled:opacity-50">Reject</button><button disabled={busy} onClick={() => void changeStage(item, 'withdrawn')} className="font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-50">Mark withdrawn</button></div>}</Card>)}{!applications.some((item) => item.stage === stage) && <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">No candidates</div>}</div></div>)}</div>
    {applications.some((item) => ['rejected','withdrawn'].includes(item.stage)) && <Card className="mt-6 p-5"><h2 className="font-bold">Closed decisions</h2><p className="mt-1 text-sm text-slate-500">These records stay visible to the management team for a clear, accountable hiring history.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{applications.filter((item) => ['rejected','withdrawn'].includes(item.stage)).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><p className="font-semibold">{item.candidates?.full_name || 'Candidate'}</p><StatusPill tone={item.stage === 'rejected' ? 'red' : 'slate'}>{item.stage}</StatusPill></div><p className="mt-1 text-xs text-slate-500">{item.job_openings?.title || 'Role'}</p>{item.notes && <p className="mt-3 text-sm text-slate-600">{item.notes}</p>}</div>)}</div></Card>}
  </section>;
}
