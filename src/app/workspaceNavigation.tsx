import React from 'react';
import {
  Activity, BarChart3, Bell, Bot, Brain, BriefcaseBusiness, Calculator, CalendarDays, Clock3,
  CircleDollarSign, ClipboardList, ContactRound, CreditCard, FileCheck2, FileText, Globe,
  Home, Inbox, LibraryBig, MapPin, MessageSquareMore, Package, Phone,
  PhoneCall, PlugZap, ReceiptText, Repeat, Settings, ShieldAlert, ShieldCheck, Sparkles, Star,
  UserRoundPlus, Users, Voicemail, Workflow,
} from 'lucide-react';
import {
  AnalyticsPage, ApprovalsPage, AutomationsPage, BillingPage, BusinessProfileSettingsPage, CapabilityMapPage, CommandCentrePage,
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
import { SchedulePage } from '../pages/SchedulePage';

export type NavItem = [string, string, React.ComponentType<{ className?: string }>, boolean?];
export type NavGroup = { label: string; items: NavItem[] };

export const workspaceNavGroups: NavGroup[] = [
  { label:'', items:[
    ['/app','Today',Home],
    ['/app/command','Command Centre',Sparkles],
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
    ['/app/coming-soon/pdf-documents','PDF documents',FileText,true],
  ]},
  { label:'Field Operations', items:[
    ['/app/time-materials','Time & Materials log',Clock3],
    ['/app/coming-soon/checklists-forms','Checklists & forms',ClipboardList,true],
    ['/app/assets','Assets & service history',Package],
    ['/app/recurring-jobs','Recurring jobs & agreements',Repeat],
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

const staffRestrictedPaths = new Set([
  '/app/hiring', '/app/marketing', '/app/brain', '/app/automations', '/app/analytics',
  '/app/approvals', '/app/integrations', '/app/team', '/app/billing', '/app/settings',
  '/app/operator/phone', '/app/operator', '/app/capabilities', '/app/knowledge',
]);

export function visibleWorkspaceGroups(role?: string | null): NavGroup[] {
  if (role !== 'staff') return workspaceNavGroups;
  return workspaceNavGroups.map((group) => ({
    ...group,
    items: group.items.filter(([href]) => !staffRestrictedPaths.has(href)),
  }));
}

export function pageTitle(path: string) {
  if (/^\/app\/jobs\//.test(path)) return 'Job';
  if (/^\/app\/customers\//.test(path)) return 'Customer';
  const item = workspaceNavGroups.flatMap((group) => group.items).find(([href]) => path === href || (href !== '/app' && path.startsWith(`${href}/`)));
  return item?.[1] || 'Jobrin.ai';
}

export function routeWorkspacePage(path: string) {
  const receptionistMatch = path.match(/^\/app\/operator\/phone(?:\/(configure|handling|knowledge|test|calls|insights))?$/);
  if (receptionistMatch) return <ReceptionistPage/>;
  const jobMatch = path.match(/^\/app\/jobs\/([0-9a-f-]{36})$/i);
  if (jobMatch) return <JobDetailPage id={jobMatch[1]}/>;
  const customerMatch = path.match(/^\/app\/customers\/([0-9a-f-]{36})$/i);
  if (customerMatch) return <CustomerDetailPage id={customerMatch[1]}/>;
  const comingMatch = path.match(/^\/app\/coming-soon\/([a-z0-9-]+)$/);
  if (comingMatch) return <ComingSoonPage featureKey={comingMatch[1]}/>;
  if (path === '/app') return <DashboardPage/>;
  if (path === '/app/command') return <CommandCentrePage/>;
  if (path === '/app/inbox') return <InboxPage/>;
  if (path === '/app/notifications') return <NotificationsPage/>;
  if (path === '/app/assets') return <AssetsPage/>;
  if (path === '/app/time-materials') return <TimeMaterialsLogPage/>;
  if (path === '/app/recurring-jobs') return <RecurringJobsPage/>;
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
