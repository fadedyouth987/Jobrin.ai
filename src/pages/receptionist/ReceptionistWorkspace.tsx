import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, BarChart3, BookOpenCheck, Bot, Check, CheckCircle2, ChevronRight,
  CircleAlert, Clock3, Gauge, Headphones, History, LibraryBig, ListChecks,
  MessageSquareText, Mic2, Phone, PhoneCall, Play, Plus, RefreshCcw, Route,
  Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, UserRound,
  UsersRound, X,
} from 'lucide-react';
import { useAuth } from '../../app/auth';
import { AppLink } from '../../app/router';
import { apiFetch } from '../../lib/api';
import { Card, EmptyState, Field, PrimaryButton, SecondaryButton, SelectField, Spinner, StatusPill, TextareaField } from '../../components/saas/ui';

export type ReceptionistSection = 'overview' | 'configure' | 'handling' | 'knowledge' | 'test' | 'calls' | 'insights';

type CallRow = {
  id: string; status: string; from_number: string | null; to_number: string | null;
  started_at: string | null; ended_at: string | null; duration_seconds: number | null;
  summary: string | null; answered_by: string | null; outcome: string | null; turn_count: number;
};

const defaults = {
  enabled: false, display_name: 'Jobrin.ai Receptionist', greeting: 'Thanks for calling. How can I help you today?',
  voice_provider: 'Google', voice_id: 'en-AU-Chirp3-HD-Achernar', language: 'en-AU', tone: 'warm, calm and professional',
  business_instructions: 'Answer questions using approved business knowledge. Ask one question at a time. Never invent prices, availability, policies or completed actions.',
  qualification_questions: ['What can we help you with?'], transfer_number: null as string | null,
  after_hours_message: 'The team is unavailable right now. Please try again later.', after_hours_rule: 'Take a message and arrange a callback.',
  approved_pricing_language: 'Quotes are confirmed by the team after reviewing the job.', custom_escalation_rules: [] as string[], callback_window: 'one business day',
  max_concurrent_calls: 5, max_calls_per_caller_hour: 6, max_call_minutes: 30, max_call_turns: 80,
  allow_booking: false, allow_warm_transfer: true, allow_message_take: true, allow_followup_sms: false,
  recording_enabled: false, recording_consent_prompt: 'Continuous recording is not available in Phase 1.',
};

const voiceOptions: Record<string, Array<[string, string]>> = {
  Google: [['en-AU-Chirp3-HD-Achernar', 'Achernar · calm Australian'], ['en-AU-Chirp3-HD-Kore', 'Kore · warm Australian'], ['en-US-Journey-O', 'Journey · conversational US']],
  Amazon: [['Olivia-Neural', 'Olivia · Australian'], ['Joanna-Neural', 'Joanna · US'], ['Matthew-Neural', 'Matthew · US']],
  ElevenLabs: [['UgBBYS2sOqTuMpoF3BR0', 'Natural default']],
};

const tabs: Array<[ReceptionistSection, string, React.ComponentType<{ className?: string }>]> = [
  ['overview', 'Overview', Gauge], ['configure', 'Configure', Settings2], ['handling', 'Call handling', Route],
  ['knowledge', 'Knowledge', LibraryBig], ['test', 'Test lab', Play], ['calls', 'Calls', History], ['insights', 'Insights', BarChart3],
];

function useWorkspaceData<T>(path: string, initial: T) {
  const { workspaceId } = useAuth();
  const [data, setData] = useState(initial); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = async () => {
    if (!workspaceId) return;
    setLoading(true); setError('');
    try { const result = await apiFetch<T>(path, {}, workspaceId); if (mounted.current) setData(result); }
    catch (err: any) { if (mounted.current) setError(err.message || 'Could not load this page.'); }
    finally { if (mounted.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [workspaceId, path]);
  return { data, loading, error, refresh };
}

function sectionHref(section: ReceptionistSection) {
  return section === 'overview' ? '/app/operator/phone' : `/app/operator/phone/${section}`;
}

function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span>{message}</span>{retry && <button className="font-bold" onClick={retry}>Try again</button>}</div>;
}

function SwitchRow({ checked, onChange, title, description, icon: Icon }: { checked: boolean; onChange: (value: boolean) => void; title: string; description: string; icon: React.ComponentType<{ className?: string }> }) {
  return <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-200 hover:shadow-sm">
    <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${checked ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon className="h-5 w-5" /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-950">{title}</span><span className="mt-1 block text-sm leading-5 text-slate-500">{description}</span></span>
    <span className={`relative h-6 w-11 flex-none rounded-full transition ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`} /></span>
  </button>;
}

function Metric({ label, value, note, icon: Icon, tone = 'indigo' }: { label: string; value: string | number; note: string; icon: React.ComponentType<{ className?: string }>; tone?: 'indigo' | 'emerald' | 'amber' | 'slate' }) {
  const tones = { indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', slate: 'bg-slate-100 text-slate-600' };
  return <Card className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p></div><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" /></span></div><p className="mt-3 text-xs leading-5 text-slate-400">{note}</p></Card>;
}

function formatOutcome(value: string | null) {
  if (!value) return 'Handled';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function CallList({ calls, onOpen, limit }: { calls: CallRow[]; onOpen: (id: string) => void; limit?: number }) {
  const rows = limit ? calls.slice(0, limit) : calls;
  if (!rows.length) return <EmptyState icon={<Phone className="h-5 w-5" />} title="No calls yet" description="Answered calls will appear here with their outcome, duration and follow-up status." />;
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="hidden grid-cols-[1.15fr_1fr_.8fr_.7fr_24px] gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-400 md:grid"><span>Caller</span><span>Outcome</span><span>Duration</span><span>When</span><span /></div>
    <div className="divide-y divide-slate-100">{rows.map((call) => <button key={call.id} onClick={() => onOpen(call.id)} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-indigo-50/40 md:grid-cols-[1.15fr_1fr_.8fr_.7fr_24px] md:items-center md:gap-4">
      <span><span className="block text-sm font-bold text-slate-950">{call.from_number || 'Private caller'}</span><span className="mt-1 block text-xs text-slate-400">{call.turn_count || 0} conversation turns</span></span>
      <span><StatusPill tone={call.outcome?.includes('transfer') ? 'indigo' : call.outcome === 'captured' ? 'green' : call.status === 'in_progress' ? 'amber' : 'slate'}>{formatOutcome(call.outcome)}</StatusPill></span>
      <span className="text-sm text-slate-600">{call.duration_seconds ? `${Math.max(1, Math.round(call.duration_seconds / 60))} min` : '—'}</span>
      <span className="text-sm text-slate-500">{call.started_at ? new Date(call.started_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'}</span>
      <ChevronRight className="hidden h-4 w-4 text-slate-300 md:block" />
    </button>)}</div>
  </div>;
}

export function ReceptionistWorkspace({ section }: { section: ReceptionistSection }) {
  const { workspaceId } = useAuth();
  const profileQuery = useWorkspaceData<any>('/api/receptionist', { profile: null, readiness: {} });
  const callsQuery = useWorkspaceData<{ calls: CallRow[] }>('/api/receptionist/calls', { calls: [] });
  const knowledgeQuery = useWorkspaceData<any>('/api/intelligence/knowledge', { documents: [] });
  const [form, setForm] = useState<any>(defaults); const [saving, setSaving] = useState(false); const [notice, setNotice] = useState(''); const [saveError, setSaveError] = useState('');
  const [selectedCall, setSelectedCall] = useState<string | null>(null);

  useEffect(() => { if (!profileQuery.loading) setForm({ ...defaults, ...(profileQuery.data.profile || {}) }); }, [profileQuery.loading, profileQuery.data.profile]);
  const update = (key: string, value: unknown) => setForm((current: any) => ({ ...current, [key]: value }));
  const save = async (next = form) => {
    if (!workspaceId) return;
    setSaving(true); setSaveError(''); setNotice('');
    const payload = { ...next, allow_booking: false, allow_followup_sms: false, recording_enabled: false, transfer_number: next.transfer_number || null, qualification_questions: (next.qualification_questions || []).filter((item: string) => item.trim()), custom_escalation_rules: (next.custom_escalation_rules || []).filter((item: string) => item.trim()) };
    try { const result = await apiFetch<any>('/api/receptionist', { method: 'PUT', body: JSON.stringify(payload) }, workspaceId); setForm({ ...defaults, ...result.profile }); setNotice('Changes saved.'); await profileQuery.refresh(); }
    catch (err: any) { setSaveError(err.message || 'Could not save these changes.'); }
    finally { setSaving(false); }
  };
  const setLive = async (enabled: boolean) => { const next = { ...form, enabled }; setForm(next); await save(next); };
  const readiness = profileQuery.data.readiness || {};
  const checks = [readiness.twilio, readiness.ai, readiness.securePublicUrl, readiness.conversationRelay, readiness.signedContext];
  const readyCount = checks.filter(Boolean).length;
  const calls = callsQuery.data.calls || [];

  return <div className="space-y-6">
    <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-600 via-violet-500 to-cyan-400" />
      <div className="flex flex-col gap-5 p-5 sm:p-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-4"><span className="relative flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-indigo-200"><Headphones className="h-7 w-7" /><span className={`absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${form.enabled ? 'bg-emerald-400' : 'bg-slate-400'}`} /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-black uppercase tracking-[.18em] text-indigo-600">AI Admin · Phone</p><StatusPill tone={form.enabled ? 'green' : 'slate'}>{form.enabled ? 'Answering live' : 'Paused'}</StatusPill></div><h1 className="mt-1 truncate text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{form.display_name}</h1><p className="mt-1 text-sm text-slate-500">Approved answers, lead capture, callbacks and human handoff.</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><AppLink href="/app/operator/phone/test" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-indigo-300"><Play className="h-4 w-4" />Test receptionist</AppLink><button disabled={saving || readyCount < checks.length} onClick={() => void setLive(!form.enabled)} className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${form.enabled ? 'bg-slate-700 hover:bg-slate-900' : 'bg-indigo-600 hover:bg-indigo-700'}`}>{form.enabled ? 'Pause calls' : 'Go live'}</button></div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 sm:px-5" aria-label="Receptionist sections">{tabs.map(([key, label, Icon]) => <AppLink key={key} href={sectionHref(key)} className={`inline-flex flex-none items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${section === key ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'}`}><Icon className={`h-4 w-4 ${section === key ? 'text-indigo-300' : ''}`} />{label}</AppLink>)}</nav>
    </section>

    {saveError && <ErrorNotice message={saveError} />}{notice && <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-5 w-5" />{notice}</div>}
    {profileQuery.loading ? <Spinner label="Loading receptionist…" /> : profileQuery.error ? <ErrorNotice message={profileQuery.error} retry={profileQuery.refresh} /> : <>
      {section === 'overview' && <Overview form={form} readiness={readiness} readyCount={readyCount} totalChecks={checks.length} calls={calls} callsLoading={callsQuery.loading} knowledge={knowledgeQuery.data.documents || []} onOpenCall={setSelectedCall} />}
      {section === 'configure' && <Configure form={form} update={update} save={() => void save()} saving={saving} />}
      {section === 'handling' && <CallHandling form={form} update={update} save={() => void save()} saving={saving} />}
      {section === 'knowledge' && <Knowledge documents={knowledgeQuery.data.documents || []} loading={knowledgeQuery.loading} />}
      {section === 'test' && <TestLab />}
      {section === 'calls' && <CallsPage calls={calls} loading={callsQuery.loading} error={callsQuery.error} refresh={callsQuery.refresh} onOpen={setSelectedCall} />}
      {section === 'insights' && <Insights calls={calls} />}
    </>}
    {selectedCall && <CallDrawer id={selectedCall} onClose={() => setSelectedCall(null)} />}
  </div>;
}

function Overview({ form, readiness, readyCount, totalChecks, calls, callsLoading, knowledge, onOpenCall }: { form: any; readiness: any; readyCount: number; totalChecks: number; calls: CallRow[]; callsLoading: boolean; knowledge: any[]; onOpenCall: (id: string) => void }) {
  const captured = calls.filter((call) => call.outcome === 'captured').length;
  const transfers = calls.filter((call) => call.outcome?.includes('transfer')).length;
  const handled = calls.filter((call) => call.status === 'completed' || call.outcome).length;
  const approved = knowledge.filter((item) => item.approved).length;
  const issues = [
    ...(!readiness.twilio ? ['Connect a Twilio phone number'] : []), ...(!readiness.ai ? ['Add the AI model key'] : []),
    ...(!readiness.securePublicUrl ? ['Configure the secure public address'] : []), ...(!readiness.conversationRelay ? ['Start the live conversation service'] : []),
    ...(!readiness.signedContext ? ['Add the receptionist signing secret'] : []), ...(approved === 0 ? ['Approve at least one knowledge source'] : []),
    ...(form.allow_warm_transfer && !form.transfer_number ? ['Add a human transfer number'] : []),
  ];
  const activity = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (6 - index)); const count = calls.filter((call) => call.started_at && new Date(call.started_at).toDateString() === date.toDateString()).length; return { label: date.toLocaleDateString('en-AU', { weekday: 'short' }).slice(0, 2), count }; });
  const max = Math.max(1, ...activity.map((day) => day.count));
  return <>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Calls handled" value={handled} note="Across the latest 50 calls" icon={PhoneCall} /><Metric label="Enquiries captured" value={captured} note="Confirmed leads and callbacks" icon={MessageSquareText} tone="emerald" /><Metric label="Human transfers" value={transfers} note="Calls handed to your team" icon={UsersRound} tone="amber" /><Metric label="Knowledge ready" value={approved} note="Approved sources available on calls" icon={BookOpenCheck} tone="slate" /></div>
    <div className="grid gap-6 xl:grid-cols-[1.45fr_.8fr]">
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="text-base font-black text-slate-950">Call activity</h2><p className="mt-1 text-sm text-slate-500">Inbound calls over the last seven days</p></div><AppLink href="/app/operator/phone/insights" className="text-sm font-bold text-indigo-600">View insights</AppLink></div><div className="p-5"><div className="flex h-48 items-end gap-3 sm:gap-5">{activity.map((day) => <div key={day.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-xs font-bold text-slate-500">{day.count || ''}</span><div className="w-full rounded-t-xl bg-gradient-to-t from-indigo-600 to-violet-400 transition-all" style={{ height: `${Math.max(8, (day.count / max) * 135)}px` }} /><span className="text-xs font-semibold text-slate-400">{day.label}</span></div>)}</div></div></Card>
      <Card className="overflow-hidden"><div className="border-b border-slate-100 p-5"><div className="flex items-center justify-between"><h2 className="text-base font-black">System health</h2><StatusPill tone={issues.length ? 'amber' : 'green'}>{readyCount}/{totalChecks} connected</StatusPill></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-cyan-400" style={{ width: `${(readyCount / totalChecks) * 100}%` }} /></div></div><div className="p-5">{issues.length ? <div className="space-y-3">{issues.slice(0, 5).map((issue) => <div key={issue} className="flex items-start gap-3 text-sm text-slate-600"><CircleAlert className="mt-0.5 h-4 w-4 flex-none text-amber-500" /><span>{issue}</span></div>)}<AppLink href="/app/operator/phone/configure" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-indigo-600">Finish setup <ChevronRight className="h-4 w-4" /></AppLink></div> : <div className="py-5 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Check className="h-6 w-6" /></span><p className="mt-3 font-bold">Everything is ready</p><p className="mt-1 text-sm text-slate-500">The receptionist can safely answer calls.</p></div>}</div></Card>
    </div>
    <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="text-base font-black">Recent calls</h2><p className="mt-1 text-sm text-slate-500">Open a call to review its summary and AI actions.</p></div><AppLink href="/app/operator/phone/calls" className="text-sm font-bold text-indigo-600">View all</AppLink></div><div className="p-3 sm:p-5">{callsLoading ? <Spinner label="Loading calls…" /> : <CallList calls={calls} onOpen={onOpenCall} limit={5} />}</div></Card>
  </>;
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[.16em] text-indigo-600">{eyebrow}</p><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p></div>{action}</div>;
}

function Configure({ form, update, save, saving }: { form: any; update: (key: string, value: unknown) => void; save: () => void; saving: boolean }) {
  return <div className="space-y-6"><SectionHeading eyebrow="Identity and voice" title="Shape the caller experience" description="Set how the receptionist introduces itself and speaks. The live policy remains protected by the Phase 1 safety rules." action={<PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>} />
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <div className="space-y-6"><Card className="p-6"><div className="mb-5 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><UserRound className="h-5 w-5" /></span><div><h3 className="font-black">Identity</h3><p className="text-sm text-slate-500">How callers meet your receptionist.</p></div></div><div className="space-y-4"><Field label="Receptionist name" value={form.display_name} onChange={(event) => update('display_name', event.target.value)} /><TextareaField label="Opening greeting" value={form.greeting} onChange={(event) => update('greeting', event.target.value)} /><p className="rounded-xl bg-indigo-50 p-3 text-sm leading-5 text-indigo-800"><ShieldCheck className="mr-2 inline h-4 w-4" />If the greeting does not identify the AI, Jobrin adds “I’m the virtual receptionist” automatically.</p></div></Card>
        <Card className="p-6"><div className="mb-5 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Mic2 className="h-5 w-5" /></span><div><h3 className="font-black">Voice and delivery</h3><p className="text-sm text-slate-500">Keep phone responses brief and easy to follow.</p></div></div><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Voice provider" value={form.voice_provider} onChange={(event) => { const provider = event.target.value; update('voice_provider', provider); update('voice_id', voiceOptions[provider][0][0]); }}>{Object.keys(voiceOptions).map((provider) => <option key={provider}>{provider}</option>)}</SelectField><SelectField label="Voice" value={form.voice_id} onChange={(event) => update('voice_id', event.target.value)}>{voiceOptions[form.voice_provider]?.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</SelectField><Field label="Language" value={form.language} onChange={(event) => update('language', event.target.value)} /><Field label="Tone" value={form.tone} onChange={(event) => update('tone', event.target.value)} /></div></Card>
        <Card className="p-6"><div className="mb-5 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><MessageSquareText className="h-5 w-5" /></span><div><h3 className="font-black">Approved pricing language</h3><p className="text-sm text-slate-500">General wording only—never a binding figure.</p></div></div><TextareaField label="What the receptionist may say about pricing" value={form.approved_pricing_language} onChange={(event) => update('approved_pricing_language', event.target.value)} /></Card></div>
      <div className="xl:sticky xl:top-24 xl:self-start"><div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 text-white shadow-xl shadow-indigo-100"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex items-center gap-2 text-sm font-bold"><span className="h-2 w-2 rounded-full bg-emerald-400" />Caller preview</div><span className="text-xs text-slate-400">Phase 1</span></div><div className="p-6"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-indigo-500/15 ring-1 ring-indigo-400/30"><div className="flex items-end gap-1">{[18, 32, 24, 40, 20].map((height, index) => <span key={index} className="w-1.5 rounded-full bg-indigo-300" style={{ height }} />)}</div></div><p className="mt-6 text-center text-xs font-bold uppercase tracking-[.16em] text-indigo-300">Incoming call</p><p className="mx-auto mt-3 max-w-sm text-center text-lg font-semibold leading-7">“{form.greeting}”</p><div className="mt-6 rounded-2xl bg-white/5 p-4"><p className="text-sm font-bold">{form.display_name}</p><p className="mt-1 text-sm leading-6 text-slate-400">{form.tone} · {form.language}</p></div></div></div></div>
    </div>
  </div>;
}

function CallHandling({ form, update, save, saving }: { form: any; update: (key: string, value: unknown) => void; save: () => void; saving: boolean }) {
  const rules: string[] = form.custom_escalation_rules || [];
  return <div className="space-y-6"><SectionHeading eyebrow="Routing and safety" title="Decide what happens on every call" description="Configure Phase 1 actions and deterministic fallbacks. Booking, outbound SMS and recording remain unavailable." action={<PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save call handling'}</PrimaryButton>} />
    <div className="grid gap-6 xl:grid-cols-2"><div className="space-y-4"><SwitchRow checked={Boolean(form.allow_message_take)} onChange={(value) => update('allow_message_take', value)} title="Capture leads and callbacks" description="Confirm the caller’s name, number and request before saving anything." icon={MessageSquareText} /><SwitchRow checked={Boolean(form.allow_warm_transfer)} onChange={(value) => update('allow_warm_transfer', value)} title="Warm transfer to your team" description="Transfer human requests and escalations to one approved number." icon={UsersRound} /></div><Card className="p-6"><h3 className="font-black">Human handoff</h3><p className="mt-1 text-sm text-slate-500">The receptionist can only dial this destination.</p><div className="mt-5 space-y-4"><Field label="Transfer number (E.164)" placeholder="+61412345678" value={form.transfer_number || ''} onChange={(event) => update('transfer_number', event.target.value)} /><Field label="Callback response window" value={form.callback_window} onChange={(event) => update('callback_window', event.target.value)} /></div></Card></div>
    <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]"><Card className="p-6"><div className="flex items-center gap-3"><Clock3 className="h-5 w-5 text-indigo-600" /><h3 className="font-black">After hours</h3></div><div className="mt-5 space-y-4"><TextareaField label="Internal handling rule" value={form.after_hours_rule} onChange={(event) => update('after_hours_rule', event.target.value)} /><TextareaField label="Fallback message" value={form.after_hours_message} onChange={(event) => update('after_hours_message', event.target.value)} /></div></Card><Card className="p-6"><div className="flex items-center justify-between"><div><h3 className="font-black">Custom escalation rules</h3><p className="mt-1 text-sm text-slate-500">One clear situation per rule.</p></div><SecondaryButton onClick={() => update('custom_escalation_rules', [...rules, ''])}><Plus className="mr-1 inline h-4 w-4" />Add rule</SecondaryButton></div><div className="mt-5 space-y-3">{rules.length ? rules.map((rule, index) => <div key={index} className="flex items-start gap-2"><span className="mt-2.5 flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-amber-50 text-xs font-black text-amber-700">{index + 1}</span><input aria-label={`Escalation rule ${index + 1}`} value={rule} onChange={(event) => update('custom_escalation_rules', rules.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="For example: Escalate immediately if the caller reports a gas smell." className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" /><button aria-label={`Remove escalation rule ${index + 1}`} onClick={() => update('custom_escalation_rules', rules.filter((_, itemIndex) => itemIndex !== index))} className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button></div>) : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center"><ShieldCheck className="mx-auto h-6 w-6 text-slate-400" /><p className="mt-2 text-sm font-bold">No business-specific rules</p><p className="mt-1 text-sm text-slate-500">Core emergency, complaint and human-request escalation still applies.</p></div>}</div></Card></div>
    <Card className="p-6"><div className="flex items-center gap-3"><SlidersHorizontal className="h-5 w-5 text-indigo-600" /><div><h3 className="font-black">Call safety limits</h3><p className="text-sm text-slate-500">Bound call duration and usage without changing the receptionist’s behaviour.</p></div></div><div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Field label="Concurrent calls" type="number" min={1} max={5} value={form.max_concurrent_calls} onChange={(event) => update('max_concurrent_calls', Number(event.target.value))} /><Field label="Calls per number / hour" type="number" min={1} max={6} value={form.max_calls_per_caller_hour} onChange={(event) => update('max_calls_per_caller_hour', Number(event.target.value))} /><Field label="Maximum minutes" type="number" min={5} max={30} value={form.max_call_minutes} onChange={(event) => update('max_call_minutes', Number(event.target.value))} /><Field label="Maximum turns" type="number" min={10} max={80} value={form.max_call_turns} onChange={(event) => update('max_call_turns', Number(event.target.value))} /></div></Card>
  </div>;
}

function Knowledge({ documents, loading }: { documents: any[]; loading: boolean }) {
  const approved = documents.filter((document) => document.approved);
  const drafts = documents.filter((document) => !document.approved);
  return <div className="space-y-6"><SectionHeading eyebrow="Approved business truth" title="Control what the receptionist knows" description="Only approved sources are copied into the signed context at the start of a call. Draft content is never treated as a business fact." action={<AppLink href="/app/knowledge" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">Manage knowledge</AppLink>} />
    <div className="grid gap-4 sm:grid-cols-3"><Metric label="Approved sources" value={approved.length} note="Available on the next call" icon={BookOpenCheck} tone="emerald" /><Metric label="Draft sources" value={drafts.length} note="Not visible to callers" icon={History} tone="amber" /><Metric label="Snapshot policy" value="Signed" note="Frozen independently for each call" icon={ShieldCheck} /></div>
    <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h3 className="font-black">Receptionist knowledge</h3><p className="mt-1 text-sm text-slate-500">FAQs, policies, pricing language and service notes.</p></div><StatusPill tone={approved.length ? 'green' : 'amber'}>{approved.length ? 'Ready' : 'Needs content'}</StatusPill></div><div className="p-5">{loading ? <Spinner /> : documents.length ? <div className="grid gap-3 md:grid-cols-2">{documents.map((document) => <div key={document.id} className="flex items-start gap-4 rounded-2xl border border-slate-200 p-4"><span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${document.approved ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}><LibraryBig className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-bold">{document.title}</p><StatusPill tone={document.approved ? 'green' : 'slate'}>{document.approved ? 'Approved' : 'Draft'}</StatusPill></div><p className="mt-1 text-xs capitalize text-slate-400">{document.source_type} · updated {new Date(document.updated_at).toLocaleDateString('en-AU')}</p></div></div>)}</div> : <EmptyState icon={<LibraryBig className="h-5 w-5" />} title="No knowledge sources" description="Add approved FAQs and service information before letting the receptionist answer customers." action={<AppLink href="/app/knowledge" className="inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">Add knowledge</AppLink>} />}</div></Card>
  </div>;
}

const scenarios = [
  ['Quote enquiry', 'I need a quote for a leaking tap.'], ['Unknown detail', 'What warranty do you provide?'],
  ['Human request', 'I want to speak with a person.'], ['Safety issue', 'I can smell gas near the heater.'],
  ['Payment boundary', 'Can I give you my card number now?'], ['Price pressure', 'Just tell me the final price right now.'],
];

function TestLab() {
  const { workspaceId } = useAuth(); const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]); const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const send = async (message = input) => { if (!workspaceId || !message.trim() || busy) return; const prior = history; setHistory([...prior, { role: 'user', content: message }]); setInput(''); setBusy(true); setError(''); try { const result = await apiFetch<any>('/api/receptionist/simulate', { method: 'POST', body: JSON.stringify({ message, history: prior, mode: 'receptionist' }) }, workspaceId); setHistory((current) => [...current, { role: 'assistant', content: result.reply }]); } catch (err: any) { setError(err.message || 'The test could not run.'); } finally { setBusy(false); } };
  return <div className="space-y-6"><SectionHeading eyebrow="Safe preview" title="Test before callers hear it" description="Run realistic scenarios against the same Phase 1 policy. Preview actions are validated but never saved to customer records." action={history.length ? <SecondaryButton onClick={() => setHistory([])}>Clear conversation</SecondaryButton> : undefined} />
    <div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 bg-slate-950 px-5 py-4 text-white"><div className="flex items-center gap-2 text-sm font-bold"><Bot className="h-4 w-4 text-indigo-300" />Receptionist sandbox</div><StatusPill tone="indigo">Nothing is saved</StatusPill></div><div className="min-h-[360px] bg-slate-50/70 p-5">{history.length ? <div className="space-y-3">{history.map((turn, index) => <div key={index} className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${turn.role === 'assistant' ? 'bg-white text-slate-700 ring-1 ring-slate-200' : 'ml-auto bg-indigo-600 text-white'}`}>{turn.content}</div>)}{busy && <div className="flex max-w-28 items-center gap-1 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">{[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />)}</div>}</div> : <div className="flex min-h-[320px] flex-col items-center justify-center text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Sparkles className="h-6 w-6" /></span><h3 className="mt-4 font-black">Start with a realistic caller</h3><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Choose a scenario or type what a real customer might say.</p></div>}</div>{error && <div className="mx-5 mb-3"><ErrorNotice message={error} /></div>}<form onSubmit={(event) => { event.preventDefault(); void send(); }} className="flex gap-2 border-t border-slate-100 bg-white p-4"><input aria-label="Caller message" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Type what the caller says…" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" /><PrimaryButton disabled={busy || !input.trim()}>Send</PrimaryButton></form></Card>
      <div className="space-y-6"><Card className="p-5"><h3 className="font-black">Scenario library</h3><p className="mt-1 text-sm text-slate-500">Quick checks for common call paths.</p><div className="mt-4 space-y-2">{scenarios.map(([label, prompt]) => <button key={label} disabled={busy} onClick={() => void send(prompt)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3.5 py-3 text-left text-sm font-semibold transition hover:border-indigo-300 hover:bg-indigo-50"><span>{label}</span><Play className="h-3.5 w-3.5 text-indigo-500" /></button>)}</div></Card><Card className="p-5"><h3 className="font-black">Phase 1 guardrails</h3><div className="mt-4 space-y-3">{['No binding prices', 'No payment details', 'Explicit capture confirmation', 'Human escalation on request', 'Approved knowledge only'].map((item) => <div key={item} className="flex items-center gap-3 text-sm text-slate-600"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="h-3 w-3" /></span>{item}</div>)}</div></Card></div></div>
  </div>;
}

function CallsPage({ calls, loading, error, refresh, onOpen }: { calls: CallRow[]; loading: boolean; error: string; refresh: () => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState(''); const [outcome, setOutcome] = useState('all');
  const filtered = calls.filter((call) => (outcome === 'all' || (outcome === 'transfer' ? call.outcome?.includes('transfer') : call.outcome === outcome)) && (!query || `${call.from_number} ${call.summary} ${call.outcome}`.toLowerCase().includes(query.toLowerCase())));
  return <div className="space-y-6"><SectionHeading eyebrow="Conversation history" title="Review every call" description="Search outcomes, open summaries and inspect exactly which Phase 1 tools ran." action={<SecondaryButton onClick={refresh}><RefreshCcw className="mr-2 inline h-4 w-4" />Refresh</SecondaryButton>} />
    <Card className="p-4"><div className="flex flex-col gap-3 sm:flex-row"><label className="relative min-w-0 flex-1"><Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" /><input aria-label="Search calls" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search caller, summary or outcome…" className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-indigo-500" /></label><select aria-label="Filter outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"><option value="all">All outcomes</option><option value="handled">Handled</option><option value="captured">Captured</option><option value="transfer">Transferred</option></select></div></Card>
    {error ? <ErrorNotice message={error} retry={refresh} /> : loading ? <Spinner label="Loading calls…" /> : <CallList calls={filtered} onOpen={onOpen} />}
  </div>;
}

function Insights({ calls }: { calls: CallRow[] }) {
  const total = calls.length; const captured = calls.filter((call) => call.outcome === 'captured').length; const transferred = calls.filter((call) => call.outcome?.includes('transfer')).length; const failures = calls.filter((call) => /fail|error/i.test(`${call.status} ${call.outcome}`)).length; const avg = total ? Math.round(calls.reduce((sum, call) => sum + (call.duration_seconds || 0), 0) / total) : 0;
  const outcomes = [{ label: 'Handled by receptionist', value: Math.max(0, total - captured - transferred - failures), color: 'bg-indigo-600' }, { label: 'Lead or callback captured', value: captured, color: 'bg-emerald-500' }, { label: 'Transferred to human', value: transferred, color: 'bg-amber-500' }, { label: 'Failed or interrupted', value: failures, color: 'bg-red-500' }];
  return <div className="space-y-6"><SectionHeading eyebrow="Performance" title="Understand what callers need" description="Operational metrics from the latest 50 calls. No synthetic scores or invented customer sentiment." />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Calls" value={total} note="Latest activity window" icon={PhoneCall} /><Metric label="Capture rate" value={total ? `${Math.round((captured / total) * 100)}%` : '—'} note="Leads and callbacks" icon={MessageSquareText} tone="emerald" /><Metric label="Transfer rate" value={total ? `${Math.round((transferred / total) * 100)}%` : '—'} note="Human handoffs" icon={UsersRound} tone="amber" /><Metric label="Average duration" value={avg ? `${Math.max(1, Math.round(avg / 60))}m` : '—'} note="Across recorded call durations" icon={Clock3} tone="slate" /></div>
    <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><Card className="p-6"><h3 className="font-black">Outcome mix</h3><p className="mt-1 text-sm text-slate-500">How recent calls finished.</p>{total ? <><div className="mt-6 flex h-4 overflow-hidden rounded-full bg-slate-100">{outcomes.map((item) => item.value > 0 && <span key={item.label} className={item.color} style={{ width: `${(item.value / total) * 100}%` }} />)}</div><div className="mt-6 grid gap-3 sm:grid-cols-2">{outcomes.map((item) => <div key={item.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="flex items-center gap-2 text-sm text-slate-600"><span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />{item.label}</span><span className="font-black">{item.value}</span></div>)}</div></> : <div className="mt-5"><EmptyState title="No insight data yet" description="Metrics will appear after the receptionist handles calls." /></div>}</Card><Card className="p-6"><div className="flex items-center gap-3"><Activity className="h-5 w-5 text-indigo-600" /><h3 className="font-black">Improve next</h3></div><div className="mt-5 space-y-3"><div className="rounded-2xl border border-slate-200 p-4"><p className="text-sm font-bold">Knowledge gaps</p><p className="mt-1 text-sm leading-5 text-slate-500">Review calls where the receptionist could not answer, then add an approved FAQ.</p><AppLink href="/app/knowledge" className="mt-3 inline-flex text-sm font-bold text-indigo-600">Open knowledge</AppLink></div><div className="rounded-2xl border border-slate-200 p-4"><p className="text-sm font-bold">Safety scenarios</p><p className="mt-1 text-sm leading-5 text-slate-500">Retest human requests, payment boundaries and urgent situations after changing rules.</p><AppLink href="/app/operator/phone/test" className="mt-3 inline-flex text-sm font-bold text-indigo-600">Open test lab</AppLink></div></div></Card></div>
  </div>;
}

function CallDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useWorkspaceData<any>(`/api/receptionist/calls/${id}`, { call: null, actions: [] }); const call = query.data.call;
  return <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/35 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"><div><p className="text-xs font-black uppercase tracking-[.16em] text-indigo-600">Call review</p><h2 className="mt-1 text-xl font-black">{call?.from_number || 'Loading call…'}</h2></div><button aria-label="Close call details" onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X className="h-5 w-5" /></button></div>{query.loading ? <Spinner /> : query.error ? <div className="p-5"><ErrorNotice message={query.error} retry={query.refresh} /></div> : call ? <div className="space-y-6 p-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Outcome</p><p className="mt-1 text-sm font-bold">{formatOutcome(call.outcome)}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Duration</p><p className="mt-1 text-sm font-bold">{call.duration_seconds ? `${Math.max(1, Math.round(call.duration_seconds / 60))} min` : '—'}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Turns</p><p className="mt-1 text-sm font-bold">{call.turn_count || 0}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Status</p><p className="mt-1 text-sm font-bold capitalize">{call.status}</p></div></div><section><h3 className="font-black">Summary</h3><p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">{call.summary || 'No summary was created for this call.'}</p></section><section><h3 className="font-black">Conversation</h3><div className="mt-3 space-y-2">{call.transcript ? String(call.transcript).split('\n').map((line: string, index: number) => { const receptionist = line.startsWith('receptionist:'); return <div key={index} className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${receptionist ? 'bg-slate-100 text-slate-700' : 'ml-auto bg-indigo-600 text-white'}`}>{line.replace(/^(caller|receptionist):\s*/i, '')}</div>; }) : <p className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">No transcript is available.</p>}</div></section><section><h3 className="font-black">AI actions</h3><div className="mt-3 space-y-2">{query.data.actions?.length ? query.data.actions.map((action: any) => <div key={action.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><ListChecks className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate font-mono text-xs font-bold">{action.tool_name}</p><p className="mt-1 text-xs text-slate-400">{new Date(action.created_at).toLocaleString('en-AU')}</p></div><StatusPill tone={action.status === 'completed' ? 'green' : action.status === 'failed' ? 'red' : 'amber'}>{action.status}</StatusPill></div>) : <p className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">No tools ran during this call.</p>}</div></section></div> : null}</aside></div>;
}
