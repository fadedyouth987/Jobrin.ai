import React, { useEffect, useState } from 'react';
import {
  Activity, BarChart3, Bell, Bot, Brain, BriefcaseBusiness, Calculator, CalendarDays, ChevronDown,
  CircleDollarSign, ClipboardList, Clock3, ContactRound, CreditCard, FileCheck2, FileText, Globe,
  Home, Inbox, KeyRound, LibraryBig, LogOut, MapPin, Menu, Moon, MessageSquareMore, Package, Phone,
  PhoneCall, PlugZap, ReceiptText, Repeat, Search, Settings, ShieldAlert, ShieldCheck, Sparkles, Star, Sun,
  UserRoundPlus, Users, Voicemail, Workflow, X
} from 'lucide-react';
import { useAuth } from '../app/auth';
import { AppLink, navigate, usePathname } from '../app/router';
import { logoutUser } from '../lib/supabase';
import { apiFetch } from '../lib/api';
import {
  AnalyticsPage, ApprovalsPage, AutomationsPage, BillingPage, CapabilityMapPage, CommandCentrePage,
  ComingSoonPage, CustomersPage, DashboardPage, InboxPage, IntegrationsPage, KnowledgePage, LeadsPage,
  MarketingPage, ModulePage, NotificationsPage, OperationsListPage, OperatorPage, ReceptionistPage, ReviewsPage, SecuritySettingsPage, SettingsPage, TeamPage,
} from './AppPages';
import { HiringPage } from './HiringPage';
import { CustomerDetailPage, JobDetailPage } from './OperationalDetailPages';
import { SchedulePage } from './SchedulePage';
import { BusinessBrainPage } from './BusinessBrainPage';
import { AssetsPage } from './AssetsPage';
import { useTheme } from '../app/theme';

type NavItem = [string, string, React.ComponentType<{ className?: string }>, boolean?];
type NavGroup = { label: string; items: NavItem[] };

// Truth-in-UI navigation: every item is Ready, or marked Coming soon so it is
// visible (with an honest badge) instead of hidden. Slugs map to
// COMING_SOON_FEATURES in AppPages.
const groups: NavGroup[] = [
  { label:'', items:[
    ['/app','Command Centre',Home],
    ['/app/inbox','Inbox',Inbox],
    ['/app/notifications','Notifications',Bell],
  ]},
  { label:'Leads & Customers', items:[
    ['/app/customers','Customers',ContactRound],
    ['/app/leads','Leads',BriefcaseBusiness],
  ]},
  { label:'Schedule & Dispatch', items:[
    ['/app/schedule','Schedule & Dispatch',CalendarDays],
    ['/app/coming-soon/gps-dispatch','GPS dispatch & live ETA',MapPin,true],
  ]},
  { label:'Jobs', items:[
    ['/app/jobs','Jobs',FileCheck2],
    ['/app/coming-soon/job-checklists','Job checklists & badges',ClipboardList,true],
  ]},
  { label:'Quotes & Invoices', items:[
    ['/app/quotes','Quotes',FileText],
    ['/app/invoices','Invoices',ReceiptText],
    ['/app/payments','Payments',CircleDollarSign],
    ['/app/coming-soon/pdf-documents','PDF documents',FileText,true],
  ]},
  { label:'Field Operations', items:[
    ['/app/coming-soon/time-materials','Time & Materials log',Clock3,true],
    ['/app/coming-soon/checklists-forms','Checklists & forms',ClipboardList,true],
    ['/app/assets','Assets & service history',Package],
    ['/app/coming-soon/recurring-jobs','Recurring jobs & agreements',Repeat,true],
    ['/app/coming-soon/supplier-purchasing','Supplier purchasing',Package,true],
  ]},
  { label:'AI Admin', items:[
    ['/app/operator/phone','AI Receptionist',Phone],
    ['/app/automations','Automations',Workflow],
    ['/app/approvals','Approvals',ShieldCheck],
    ['/app/brain','Business Brain',Brain],
    ['/app/knowledge','Knowledge',LibraryBig],
    ['/app/operator','Operator log',Bot],
    ['/app/coming-soon/ai-recaps','AI post-work recaps',Sparkles,true],
    ['/app/coming-soon/voicemail','Voicemail transcription',Voicemail,true],
    ['/app/coming-soon/call-recordings','Call recordings',PhoneCall,true],
    ['/app/coming-soon/spam-screening','Spam & robocall screening',ShieldAlert,true],
    ['/app/coming-soon/multi-numbers','Multiple phone numbers',PhoneCall,true],
  ]},
  { label:'Marketing & Reviews', items:[
    ['/app/marketing','Marketing SMS',MessageSquareMore],
    ['/app/reviews','Reviews',Star],
    ['/app/coming-soon/customer-portal','Customer portal',Globe,true],
    ['/app/coming-soon/review-automation','Automated review requests',Star,true],
  ]},
  { label:'Hiring', items:[['/app/hiring','Hiring',UserRoundPlus]] },
  { label:'Reports', items:[['/app/analytics','Reports & attribution',BarChart3]] },
  { label:'Integrations', items:[
    ['/app/integrations','Integrations',PlugZap],
    ['/app/coming-soon/accounting-sync','Xero, MYOB & QuickBooks',Calculator,true],
    ['/app/coming-soon/zapier-api','Zapier, webhooks & API',Workflow,true],
  ]},
  { label:'Team', items:[['/app/team','Team',Users]] },
  { label:'Billing', items:[['/app/billing','Billing',CreditCard]] },
  { label:'Settings & Security', items:[
    ['/app/settings','Settings',Settings],
    ['/app/settings/security','Security',ShieldCheck],
    ['/app/coming-soon/deploy-health','Deployment health & monitoring',Activity,true],
  ]},
];

const flatNavItems = (): NavItem[] => groups.flatMap((group) => group.items);

function CommandPalette({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const [query,setQuery]=useState('');
  const all=items.map(([href,label,Icon,soon])=>({href,label,Icon,soon:soon===true}));
  const filtered=all.filter((item)=>item.label.toLowerCase().includes(query.toLowerCase())||item.href.includes(query.toLowerCase()));
  return <div className="fixed inset-0 z-[60] bg-slate-950/50 p-4 pt-[12vh]" onClick={onClose}>
    <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl" onClick={(e)=>e.stopPropagation()}>
      <input autoFocus value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search pages and features…"
        onKeyDown={(e)=>{if(e.key==='Escape')onClose();if(e.key==='Enter'&&filtered[0]){navigate(filtered[0].href);onClose();}}}
        className="w-full border-0 border-b border-slate-100 px-5 py-4 text-sm outline-none"/>
      <div className="max-h-80 overflow-y-auto p-2">
        {filtered.length?filtered.map((item)=><button key={item.href} onClick={()=>{navigate(item.href);onClose()}} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-slate-50">
          <item.Icon className="h-4 w-4 text-slate-400"/><span className="flex-1 font-medium text-slate-800">{item.label}</span>{item.soon&&<span className="text-[10px] font-bold text-slate-400">coming soon</span>}
        </button>):<p className="p-4 text-sm text-slate-500">No matches.</p>}
      </div>
    </div>
  </div>;
}

export default function AppShell() {
  const auth=useAuth(); const path=usePathname(); const [mobile,setMobile]=useState(false); const [subscriptionChecked,setSubscriptionChecked]=useState(false); const [paletteOpen,setPaletteOpen]=useState(false); const [unreadCount,setUnreadCount]=useState<number|null>(null); const {theme,setTheme}=useTheme();
  const cycleTheme=()=>setTheme(theme==='light'?'dark':theme==='dark'?'system':'light');
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
  useEffect(()=>{
    if(!auth.session||!auth.workspaceId)return;
    apiFetch<any>('/api/notifications',{},auth.workspaceId).then((data)=>{if(data?.unreadCount!=null)setUnreadCount(data.unreadCount)}).catch(()=>undefined);
  },[auth.session,auth.workspaceId,path]);
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPaletteOpen(true)}};
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[]);
  if(auth.loading||!auth.session||!auth.workspaceId||!subscriptionChecked)return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading secure workspace…</div>;

  const restrictedForStaff=new Set(['/app/hiring','/app/marketing','/app/brain','/app/automations','/app/analytics','/app/approvals','/app/integrations','/app/team','/app/billing','/app/settings']);
  const visibleGroups=auth.workspace?.role==='staff'?groups.map(group=>({...group,items:group.items.filter(([href])=>!restrictedForStaff.has(href))})):groups;
  const paletteItems: NavItem[] = visibleGroups.flatMap((group)=>group.items);
  const content = routePage(path);
  return <div className="min-h-screen bg-slate-50 text-slate-950">
    {paletteOpen&&<CommandPalette items={paletteItems} onClose={()=>setPaletteOpen(false)}/>}
    {mobile&&<button aria-label="Close navigation overlay" onClick={()=>setMobile(false)} className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"/>}
    <aside className={`fixed inset-y-0 left-0 z-50 w-[270px] border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${mobile?'translate-x-0':'-translate-x-full'}`}>
      <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4"><AppLink href="/app" onClick={()=>setMobile(false)} className="flex items-center gap-2.5 font-black tracking-tight"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white">J</span>JOBRIN.AI</AppLink><button onClick={()=>setMobile(false)} className="rounded-lg p-2 text-slate-500 lg:hidden"><X className="h-4 w-4"/></button></div>
      <div className="border-b border-slate-100 p-3"><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Workspace</label><div className="relative mt-1"><select value={auth.workspaceId} onChange={e=>auth.setWorkspaceId(e.target.value)} className="w-full appearance-none rounded-xl bg-slate-50 px-3 py-2.5 pr-8 text-sm font-semibold outline-none"><option value={auth.workspaceId}>{auth.workspace?.name}</option>{auth.workspaces.filter(w=>w.id!==auth.workspaceId).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-slate-400"/></div><div className="mt-2 flex items-center justify-between px-1 text-[11px]"><span className="capitalize text-slate-500">{auth.workspace?.role}</span><span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold capitalize text-indigo-700">{auth.workspace?.plan}</span></div></div>
      <nav className="h-[calc(100vh-205px)] overflow-y-auto px-2 py-3">{visibleGroups.map((group,gi)=>group.label? <details key={gi} className="mb-3" open={group.items.some(([href])=>path===href||path.startsWith(`${href}/`))}><summary className="cursor-pointer list-none rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[.14em] text-slate-400 hover:bg-slate-50">{group.label}</summary><div className="mt-1 border-l border-slate-200 pl-1">{group.items.map(([href,label,Icon,soon])=>{const active=path===href||path.startsWith(`${href}/`);return <AppLink key={href} href={href} onClick={()=>setMobile(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active?'bg-slate-950 text-white':'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}><Icon className={`h-4 w-4 flex-none ${active?'text-indigo-300':'text-slate-400'}`}/><span className="flex-1">{label}</span>{soon===true&&<span className="flex-none rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">soon</span>}</AppLink>})}</div></details>:<div key={gi} className="mb-3">{group.items.map(([href,label,Icon,soon])=>{const active=path===href||(href!=='/app'&&path.startsWith(`${href}/`));return <AppLink key={href} href={href} onClick={()=>setMobile(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active?'bg-slate-950 text-white':'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}><Icon className={`h-4 w-4 ${active?'text-indigo-300':'text-slate-400'}`}/><span className="flex-1">{label}</span>{soon===true&&<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">soon</span>}</AppLink>})}</div>)}</nav>
      <div className="absolute inset-x-0 bottom-0 border-t border-slate-100 bg-white p-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700">{(auth.user?.user_metadata?.display_name||auth.user?.email||'U')[0]?.toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{auth.user?.user_metadata?.display_name||auth.user?.email}</p><p className="truncate text-[10px] text-slate-400">{auth.user?.email}</p></div><button title="Log out" onClick={async()=>{await logoutUser();navigate('/login',true)}} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><LogOut className="h-4 w-4"/></button></div></div>
    </aside>
    <div className="lg:pl-[270px] pb-16 lg:pb-0"><header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6"><div className="flex items-center gap-3"><button onClick={()=>setMobile(true)} className="rounded-xl border border-slate-200 p-2 lg:hidden"><Menu className="h-4 w-4"/></button><button onClick={()=>setPaletteOpen(true)} title="Search (Ctrl+K)" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-400 hover:border-indigo-300 hover:text-slate-600"><Search className="h-3.5 w-3.5"/>Search…<span className="hidden rounded border border-slate-200 px-1 text-[10px] sm:inline">Ctrl K</span></button><div className="hidden text-xs text-slate-400 sm:block">{auth.workspace?.name} / <span className="font-semibold text-slate-700">{pageTitle(path)}</span></div></div><div className="flex items-center gap-2"><button onClick={cycleTheme} title="Theme" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100">{theme==='dark'?<Moon className="h-4 w-4"/>:<Sun className="h-4 w-4"/>}</button><AppLink href="/app/notifications" className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-100"><Bell className="h-4 w-4"/>{unreadCount!==null&&unreadCount>0&&<span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-black text-white">{unreadCount>9?'9+':unreadCount}</span>}</AppLink><AppLink href="/app/settings/security" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><KeyRound className="h-4 w-4"/></AppLink></div></header><main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{content}</main></div>
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white lg:hidden">
      {([['/app','Command Centre',Home],['/app/inbox','Inbox',Inbox],['/app/schedule','Schedule',CalendarDays],['/app/jobs','Jobs',FileCheck2]] as NavItem[]).map(([href,label,Icon])=>{const active=path===href||path.startsWith(`${href}/`);return <AppLink key={href} href={href} className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold ${active?'text-indigo-600':'text-slate-400'}`}><Icon className="h-4 w-4"/>{label}</AppLink>})}
      <button onClick={()=>setMobile(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold text-slate-400"><Menu className="h-4 w-4"/>More</button>
    </nav>
  </div>;
}

function routePage(path:string) {
  const jobMatch=path.match(/^\/app\/jobs\/([0-9a-f-]{36})$/i);if(jobMatch)return <JobDetailPage id={jobMatch[1]}/>;
  const customerMatch=path.match(/^\/app\/customers\/([0-9a-f-]{36})$/i);if(customerMatch)return <CustomerDetailPage id={customerMatch[1]}/>;
  const comingMatch=path.match(/^\/app\/coming-soon\/([a-z0-9-]+)$/);if(comingMatch)return <ComingSoonPage featureKey={comingMatch[1]}/>;
  if(path==='/app')return <DashboardPage/>;
  if(path==='/app/command')return <CommandCentrePage/>;
  if(path==='/app/inbox')return <InboxPage/>;
  if(path==='/app/notifications')return <NotificationsPage/>;
  if(path==='/app/assets')return <AssetsPage/>;
  if(path==='/app/capabilities')return <CapabilityMapPage/>;
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
  return <ModulePage title="Not found" eyebrow="Jobrin.ai" description="That workspace page does not exist in this build." status="404"/>;
}

function pageTitle(path:string){if(/^\/app\/jobs\//.test(path))return 'Job';if(/^\/app\/customers\//.test(path))return 'Customer';const item=groups.flatMap(g=>g.items).find(([href])=>path===href||(href!=='/app'&&path.startsWith(`${href}/`)));return item?.[1]||'Jobrin.ai'}
