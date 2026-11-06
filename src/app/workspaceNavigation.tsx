import React from 'react';
import {
  Activity, BarChart3, Bell, Bot, Brain, BriefcaseBusiness, Calculator, CalendarDays, Clock3,
  CircleDollarSign, ClipboardList, ContactRound, CreditCard, FileCheck2, FileText, Globe,
  Home, Inbox, LibraryBig, MapPin, MessageSquareMore, Package, Phone,
  PhoneCall, PlugZap, ReceiptText, Repeat, Settings, ShieldAlert, ShieldCheck, Star,
  Truck, UserRoundPlus, Users, Voicemail, Workflow, EyeOff,
} from 'lucide-react';
import {
  AdminChatPage, AnalyticsPage, ApprovalsPage, AutomationsPage, BillingPage, BusinessProfileSettingsPage, CapabilityMapPage,
  ComingSoonPage, CustomersPage, DashboardPage, InboxPage, KnowledgePage, LeadsPage,
  MarketingPage, ModulePage, NotificationsPage, OperationsListPage, OperatorPage, ReviewsPage,
  ReceptionistPage, SecuritySettingsPage, ServicesSettingsPage, SettingsPage, TeamPage,
} from '../pages/AppPages';
import { AssetsPage } from '../pages/AssetsPage';
import { BusinessBrainPage } from '../pages/BusinessBrainPage';
import { HiringPage } from '../pages/HiringPage';
import { IntegrationsPage } from '../pages/IntegrationsPage';
import { CustomerDetailPage, JobDetailPage } from '../pages/OperationalDetailPages';
import { RecurringJobsPage, TimeMaterialsLogPage } from '../pages/FieldOpsPages';
import { PurchasingPage } from '../pages/PurchasingPage';
import { SchedulePage } from '../pages/SchedulePage';
import { AppLink } from './router';
import { EmptyState } from '../components/saas/ui';
import { HIDEABLE_AREAS, areaForPath, isPathVisible, type WorkspaceFeatures } from '../../shared/features';

export type NavItem = [string, string, React.ComponentType<{ className?: string }>, boolean?];
export type NavGroup = { label: string; items: NavItem[] };

export const workspaceNavGroups: NavGroup[] = [
  { label:'', items:[
    ['/app','Today',Home],
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
  ]},
  { label:'Quotes & Invoices', items:[
    ['/app/quotes','Quotes',FileText],
    ['/app/invoices','Invoices',ReceiptText],
    ['/app/payments','Payments',CircleDollarSign],
  ]},
  { label:'Field Operations', items:[
    ['/app/time-materials','Time & Materials log',Clock3],
    ['/app/coming-soon/checklists-forms','Checklists & forms',ClipboardList,true],
    ['/app/assets','Assets & service history',Package],
    ['/app/recurring-jobs','Recurring jobs & agreements',Repeat],
    ['/app/purchasing','Supplier purchasing',Truck],
  ]},
  { label:'AI Admin', items:[
    ['/app/admin-chat','AI Admin chat',MessageSquareMore],
    ['/app/operator/phone','AI Receptionist',Phone],
    ['/app/automations','Automations',Workflow],
    ['/app/approvals','Approvals',ShieldCheck],
    ['/app/brain','Business Brain',Brain],
    ['/app/knowledge','Knowledge',LibraryBig],
    ['/app/operator','Operator log',Bot],
    ['/app/coming-soon/voicemail','Voicemail transcription',Voicemail,true],
    ['/app/coming-soon/call-recordings','Call recordings',PhoneCall,true],
    ['/app/coming-soon/spam-screening','Spam & robocall screening',ShieldAlert,true],
    ['/app/coming-soon/multi-numbers','Multiple phone numbers',PhoneCall,true],
  ]},
  { label:'Marketing & Reviews', items:[
    ['/app/marketing','Marketing SMS',MessageSquareMore],
    ['/app/reviews','Reviews',Star],
    ['/app/coming-soon/customer-portal','Customer portal',Globe,true],
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

const staffRestrictedPaths = new Set([
  '/app/hiring', '/app/marketing', '/app/brain', '/app/automations', '/app/analytics',
  '/app/approvals', '/app/integrations', '/app/team', '/app/billing', '/app/settings',
  '/app/admin-chat',
  '/app/operator/phone', '/app/operator', '/app/capabilities', '/app/knowledge',
]);

/* Cockpit rail: the seven primary surfaces live on the desktop icon rail.
   Everything else — including coming-soon features — stays reachable through
   the command palette (Ctrl/Cmd+K), so the chrome stays scannable. */
export const primaryRail: NavItem[] = [
  ['/app', 'Today', Home],
  ['/app/inbox', 'Inbox', Inbox],
  ['/app/customers', 'Customers', ContactRound],
  ['/app/schedule', 'Schedule & Dispatch', CalendarDays],
  ['/app/jobs', 'Jobs', FileCheck2],
  ['/app/quotes', 'Quotes', FileText],
  ['/app/admin-chat', 'AI Admin chat', MessageSquareMore],
];

// Role filtering (staff) plus the workspace's product surface: areas the
// workspace has hidden (shared/features.ts) disappear from every menu, and a
// group left with no items is dropped. Visibility only — the API keeps its
// own role and entitlement checks.
export function visibleWorkspaceGroups(role?: string | null, features?: WorkspaceFeatures | null): NavGroup[] {
  return workspaceNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(([href]) => (role !== 'staff' || !staffRestrictedPaths.has(href)) && isPathVisible(href, features)),
    }))
    .filter((group) => group.items.length > 0);
}

// Surfaces that take an empty rail slot when a primary one is hidden, so the
// receptionist-first surface still leads with what it is for.
const railFallbacks: NavItem[] = [
  ['/app/leads', 'Leads', BriefcaseBusiness],
  ['/app/operator/phone', 'AI Receptionist', Phone],
  ['/app/brain', 'Business Brain', Brain],
];

function fillVisible(primary: NavItem[], fallbacks: NavItem[], size: number, visible: (href: string) => boolean): NavItem[] {
  const items = primary.filter(([href]) => visible(href));
  for (const item of fallbacks) {
    if (items.length >= size) break;
    if (visible(item[0]) && !items.some(([href]) => href === item[0])) items.push(item);
  }
  return items.slice(0, size);
}

const restrictedFor = (role?: string | null) => (href: string) => role !== 'staff' || !staffRestrictedPaths.has(href);

export function visibleRail(role?: string | null, features?: WorkspaceFeatures | null): NavItem[] {
  const allowed = restrictedFor(role);
  return fillVisible(primaryRail, railFallbacks, primaryRail.length, (href) => allowed(href) && isPathVisible(href, features));
}

// Phone bottom bar: four tabs plus "More".
const mobilePrimary: NavItem[] = [
  ['/app', 'Today', Home],
  ['/app/admin-chat', 'Admin', MessageSquareMore],
  ['/app/inbox', 'Inbox', Inbox],
  ['/app/schedule', 'Schedule', CalendarDays],
];
const mobileFallbacks: NavItem[] = [
  ['/app/leads', 'Leads', BriefcaseBusiness],
  ['/app/operator/phone', 'Receptionist', Phone],
];

export function visibleMobileTabs(role?: string | null, features?: WorkspaceFeatures | null): NavItem[] {
  const allowed = restrictedFor(role);
  return fillVisible(mobilePrimary, mobileFallbacks, mobilePrimary.length, (href) => allowed(href) && isPathVisible(href, features));
}

export function pageTitle(path: string) {
  if (/^\/app\/jobs\//.test(path)) return 'Job';
  if (/^\/app\/customers\//.test(path)) return 'Customer';
  const item = workspaceNavGroups.flatMap((group) => group.items).find(([href]) => path === href || (href !== '/app' && path.startsWith(`${href}/`)));
  return item?.[1] || 'Jobrin.ai';
}

function AreaHiddenPage({ path }: { path: string }) {
  const area = areaForPath(path);
  const label = area ? HIDEABLE_AREAS[area].label : 'This area';
  return <EmptyState
    icon={<EyeOff className="h-5 w-5"/>}
    title={`${label} is turned off for this workspace`}
    description="This workspace is set up around the AI receptionist, so this area is hidden to keep things simple. Nothing has been deleted — contact Jobrin.ai if you need it switched on."
    action={<AppLink href="/app/leads" className="inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Go to leads</AppLink>}
  />;
}

export function routeWorkspacePage(path: string, features?: WorkspaceFeatures | null) {
  if (!isPathVisible(path, features)) return <AreaHiddenPage path={path}/>;
  const receptionistMatch = path.match(/^\/app\/operator\/phone(?:\/(configure|handling|knowledge|test|calls|insights))?$/);
  if (receptionistMatch) return <ReceptionistPage/>;
  const jobMatch = path.match(/^\/app\/jobs\/([0-9a-f-]{36})$/i);
  if (jobMatch) return <JobDetailPage id={jobMatch[1]}/>;
  const customerMatch = path.match(/^\/app\/customers\/([0-9a-f-]{36})$/i);
  if (customerMatch) return <CustomerDetailPage id={customerMatch[1]}/>;
  const comingMatch = path.match(/^\/app\/coming-soon\/([a-z0-9-]+)$/);
  if (comingMatch) return <ComingSoonPage featureKey={comingMatch[1]}/>;
  if (path === '/app') return <DashboardPage/>;
  if (path === '/app/admin-chat') return <AdminChatPage/>;
  if (path === '/app/command') return <AdminChatPage/>;
  if (path === '/app/inbox') return <InboxPage/>;
  if (path === '/app/notifications') return <NotificationsPage/>;
  if (path === '/app/assets') return <AssetsPage/>;
  if (path === '/app/time-materials') return <TimeMaterialsLogPage/>;
  if (path === '/app/recurring-jobs') return <RecurringJobsPage/>;
  if (path === '/app/purchasing') return <PurchasingPage/>;
  if (path === '/app/capabilities') return <CapabilityMapPage/>;
  if (path === '/app/marketing') return <MarketingPage/>;
  if (path === '/app/hiring') return <HiringPage/>;
  if (path === '/app/leads') return <LeadsPage/>;
  if (path === '/app/customers') return <CustomersPage/>;
  if (path === '/app/schedule') return <SchedulePage/>;
  if (path === '/app/jobs') return <OperationsListPage kind="jobs"/>;
  if (path === '/app/quotes') return <OperationsListPage kind="quotes"/>;
  if (path === '/app/invoices') return <OperationsListPage kind="invoices"/>;
  if (path === '/app/payments') return <OperationsListPage kind="payments"/>;
  if (path === '/app/automations') return <AutomationsPage/>;
  if (path === '/app/brain') return <BusinessBrainPage/>;
  if (path === '/app/reviews') return <ReviewsPage/>;
  if (path === '/app/analytics') return <AnalyticsPage/>;
  if (path === '/app/knowledge') return <KnowledgePage/>;
  if (path === '/app/operator') return <OperatorPage/>;
  if (path === '/app/approvals') return <ApprovalsPage/>;
  if (path === '/app/integrations') return <IntegrationsPage/>;
  if (path === '/app/team') return <TeamPage/>;
  if (path === '/app/billing') return <BillingPage/>;
  if (path === '/app/settings/security') return <SecuritySettingsPage/>;
  if (path === '/app/settings/business') return <BusinessProfileSettingsPage/>;
  if (path === '/app/settings/services') return <ServicesSettingsPage/>;
  if (path === '/app/settings') return <SettingsPage/>;
  return <ModulePage title="Not found" eyebrow="Jobrin.ai" description="That workspace page does not exist in this build." status="404"/>;
}
