import React, { useEffect, useState } from 'react';
import {
  BarChart3, Bell, Bot, Brain, BriefcaseBusiness, CalendarDays, ChevronDown, CircleDollarSign,
  ContactRound, CreditCard, FileCheck2, FileText, Home, Inbox, KeyRound, LibraryBig,
  LogOut, Menu, MessageSquareMore, Phone, ReceiptText, Settings, ShieldCheck,
  Sparkles, Users, Workflow, X, Star, PlugZap, UserRoundPlus
} from 'lucide-react';
import { useAuth } from '../app/auth';
import { AppLink, navigate, usePathname } from '../app/router';
import { logoutUser } from '../lib/supabase';
import { apiFetch } from '../lib/api';
import {
  AnalyticsPage, ApprovalsPage, AutomationsPage, BillingPage, CommandCentrePage,
  CustomersPage, DashboardPage, InboxPage, IntegrationsPage, KnowledgePage, LeadsPage,
  MarketingPage, ModulePage, OperationsListPage, OperatorPage, ReceptionistPage, ReviewsPage, SecuritySettingsPage, SettingsPage, TeamPage,
} from './AppPages';
import { HiringPage } from './HiringPage';
import { CustomerDetailPage, JobDetailPage } from './OperationalDetailPages';
import { SchedulePage } from './SchedulePage';
import { BusinessBrainPage } from './BusinessBrainPage';

type NavItem = [string, string, React.ComponentType<{ className?: string }>];
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  { label:'', items:[['/app','Today',Home],['/app/inbox','Inbox',Inbox],['/app/customers','Customers',ContactRound],['/app/schedule','Schedule',CalendarDays],['/app/jobs','Jobs',FileCheck2],['/app/operator/phone','AI Receptionist',Phone]] },
  { label:'Money', items:[['/app/quotes','Quotes',FileText],['/app/invoices','Invoices',ReceiptText],['/app/payments','Payments',CircleDollarSign]] },
  { label:'More', items:[['/app/hiring','Hiring',UserRoundPlus],['/app/leads','Leads',BriefcaseBusiness],['/app/marketing','Marketing SMS',MessageSquareMore],['/app/command','Command Centre',Sparkles],['/app/brain','AI Memory',Brain],['/app/automations','Automations',Workflow],['/app/reviews','Reviews',Star],['/app/analytics','Analytics',BarChart3],['/app/knowledge','Knowledge',LibraryBig],['/app/operator','Operator log',Bot],['/app/approvals','Approvals',ShieldCheck],['/app/integrations','Integrations',PlugZap],['/app/team','Team',Users],['/app/billing','Billing',CreditCard],['/app/settings','Settings',Settings]] },
];

export default function AppShell() {
  const auth=useAuth(); const path=usePathname(); const [mobile,setMobile]=useState(false); const [subscriptionChecked,setSubscriptionChecked]=useState(false);
  useEffect(()=>{
    if(auth.loading)return;
    if(!auth.session){navigate('/login',true);return;}
    if(auth.needsMfa&&path!=='/app/settings/security'){navigate('/mfa',true);return;}
    if(!auth.workspaceId){navigate('/onboarding',true);}
  },[auth.loading,auth.session,auth.needsMfa,auth.workspaceId,path]);
  useEffect(()=>{
    if(!auth.session||!auth.workspaceId)return;
    let cancelled=false;
    setSubscriptionChecked(false);
    apiFetch<any>('/api/billing/status',{},auth.workspaceId).then(({subscription})=>{
      if(cancelled)return;
      const now=Date.now();
      const active=subscription?.status==='active'
        || (subscription?.status==='trialing'&&subscription?.trial_ends_at&&new Date(subscription.trial_ends_at).getTime()>now)
        || (subscription?.status==='past_due'&&subscription?.grace_period_ends_at&&new Date(subscription.grace_period_ends_at).getTime()>now);
      setSubscriptionChecked(true);
      if(!active&&!['/app/billing','/app/settings/security'].includes(path))navigate('/app/billing',true);
    }).catch(()=>setSubscriptionChecked(true));
    return()=>{cancelled=true};
  },[auth.session,auth.workspaceId,path]);
  if(auth.loading||!auth.session||!auth.workspaceId||!subscriptionChecked)return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading secure workspace…</div>;

  const restrictedForStaff=new Set(['/app/hiring','/app/marketing','/app/brain','/app/automations','/app/analytics','/app/approvals','/app/integrations','/app/team','/app/billing','/app/settings']);
  const visibleGroups=auth.workspace?.role==='staff'?groups.map(group=>({...group,items:group.items.filter(([href])=>!restrictedForStaff.has(href))})):groups;
  const content = routePage(path);
  return <div className="min-h-screen bg-slate-50 text-slate-950">
    {mobile&&<button aria-label="Close navigation overlay" onClick={()=>setMobile(false)} className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"/>}
    <aside className={`fixed inset-y-0 left-0 z-50 w-[270px] border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${mobile?'translate-x-0':'-translate-x-full'}`}>
      <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4"><AppLink href="/app" onClick={()=>setMobile(false)} className="flex items-center gap-2.5 font-black tracking-tight"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white">J</span>JOBRYN</AppLink><button onClick={()=>setMobile(false)} className="rounded-lg p-2 text-slate-500 lg:hidden"><X className="h-4 w-4"/></button></div>
      <div className="border-b border-slate-100 p-3"><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Workspace</label><div className="relative mt-1"><select value={auth.workspaceId} onChange={e=>auth.setWorkspaceId(e.target.value)} className="w-full appearance-none rounded-xl bg-slate-50 px-3 py-2.5 pr-8 text-sm font-semibold outline-none"><option value={auth.workspaceId}>{auth.workspace?.name}</option>{auth.workspaces.filter(w=>w.id!==auth.workspaceId).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-slate-400"/></div><div className="mt-2 flex items-center justify-between px-1 text-[11px]"><span className="capitalize text-slate-500">{auth.workspace?.role}</span><span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold capitalize text-indigo-700">{auth.workspace?.plan}</span></div></div>
      <nav className="h-[calc(100vh-205px)] overflow-y-auto px-2 py-3">{visibleGroups.map((group,gi)=>group.label==='More'?<details key={gi} className="mb-3" open={group.items.some(([href])=>path===href||path.startsWith(`${href}/`))}><summary className="cursor-pointer list-none rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[.14em] text-slate-400 hover:bg-slate-50">More tools</summary><div className="mt-1 border-l border-slate-200 pl-1">{group.items.map(([href,label,Icon])=>{const active=path===href||path.startsWith(`${href}/`);return <AppLink key={href} href={href} onClick={()=>setMobile(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active?'bg-slate-950 text-white':'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}><Icon className={`h-4 w-4 ${active?'text-indigo-300':'text-slate-400'}`}/><span>{label}</span></AppLink>})}</div></details>:<div key={gi} className="mb-3">{group.label&&<p className="mb-1 px-3 pt-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">{group.label}</p>}{group.items.map(([href,label,Icon])=>{const active=path===href||(href!=='/app'&&path.startsWith(`${href}/`));return <AppLink key={href} href={href} onClick={()=>setMobile(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active?'bg-slate-950 text-white':'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}><Icon className={`h-4 w-4 ${active?'text-indigo-300':'text-slate-400'}`}/><span>{label}</span></AppLink>})}</div>)}</nav>
      <div className="absolute inset-x-0 bottom-0 border-t border-slate-100 bg-white p-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700">{(auth.user?.user_metadata?.display_name||auth.user?.email||'U')[0]?.toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{auth.user?.user_metadata?.display_name||auth.user?.email}</p><p className="truncate text-[10px] text-slate-400">{auth.user?.email}</p></div><button title="Log out" onClick={async()=>{await logoutUser();navigate('/login',true)}} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><LogOut className="h-4 w-4"/></button></div></div>
    </aside>
    <div className="lg:pl-[270px]"><header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6"><div className="flex items-center gap-3"><button onClick={()=>setMobile(true)} className="rounded-xl border border-slate-200 p-2 lg:hidden"><Menu className="h-4 w-4"/></button><div className="hidden text-xs text-slate-400 sm:block">{auth.workspace?.name} / <span className="font-semibold text-slate-700">{pageTitle(path)}</span></div></div><div className="flex items-center gap-2"><button className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-100"><Bell className="h-4 w-4"/><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500"/></button><AppLink href="/app/settings/security" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><KeyRound className="h-4 w-4"/></AppLink></div></header><main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{content}</main></div>
  </div>;
}

function routePage(path:string) {
  const jobMatch=path.match(/^\/app\/jobs\/([0-9a-f-]{36})$/i);if(jobMatch)return <JobDetailPage id={jobMatch[1]}/>;
  const customerMatch=path.match(/^\/app\/customers\/([0-9a-f-]{36})$/i);if(customerMatch)return <CustomerDetailPage id={customerMatch[1]}/>;
  if(path==='/app')return <DashboardPage/>;
  if(path==='/app/command')return <CommandCentrePage/>;
  if(path==='/app/inbox')return <InboxPage/>;
  if(path==='/app/marketing')return <MarketingPage/>;
  if(path==='/app/hiring')return <HiringPage/>;
  if(path==='/app/leads')return <LeadsPage/>;
  if(path==='/app/customers')return <CustomersPage/>;
  if(path==='/app/schedule')return <SchedulePage/>;
  if(path==='/app/jobs')return <OperationsListPage kind="jobs"/>;
  if(path==='/app/quotes')return <OperationsListPage kind="quotes"/>;
  if(path==='/app/invoices')return <OperationsListPage kind="invoices"/>;
  if(path==='/app/payments')return <OperationsListPage kind="payments"/>;
  if(path==='/app/automations')return <AutomationsPage/>;
  if(path==='/app/brain')return <BusinessBrainPage/>;
  if(path==='/app/reviews')return <ReviewsPage/>;
  if(path==='/app/analytics')return <AnalyticsPage/>;
  if(path==='/app/knowledge')return <KnowledgePage/>;
  if(path==='/app/operator')return <OperatorPage/>;
  if(path==='/app/approvals')return <ApprovalsPage/>;
  if(path==='/app/integrations')return <IntegrationsPage/>;
  if(path==='/app/team')return <TeamPage/>;
  if(path==='/app/billing')return <BillingPage/>;
  if(path==='/app/settings/security')return <SecuritySettingsPage/>;
  if(path==='/app/settings')return <SettingsPage/>;
  if(path==='/app/operator/phone')return <ReceptionistPage/>;
  return <ModulePage title="Not found" eyebrow="Jobryn" description="That workspace page does not exist in this build." status="404"/>;
}

function pageTitle(path:string){if(/^\/app\/jobs\//.test(path))return 'Job';if(/^\/app\/customers\//.test(path))return 'Customer';const item=groups.flatMap(g=>g.items).find(([href])=>path===href||(href!=='/app'&&path.startsWith(`${href}/`)));return item?.[1]||'Jobryn'}
