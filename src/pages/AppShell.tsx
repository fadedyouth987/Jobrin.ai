import React, { useEffect, useRef, useState } from 'react';
import {
  Bell, CalendarDays, ChevronDown, Home, Inbox, KeyRound, LogOut, Menu, MessageSquareMore, Moon, Search, Sun, X
} from 'lucide-react';
import { useAuth } from '../app/auth';
import { AppLink, navigate, usePathname } from '../app/router';
import { logoutUser } from '../lib/supabase';
import { apiFetch } from '../lib/api';
import { useTheme } from '../app/theme';
import { pageTitle, routeWorkspacePage, visibleWorkspaceGroups, type NavItem } from '../app/workspaceNavigation';

function CommandPalette({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const [query,setQuery]=useState('');
  const dialogRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const handle=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose();}
      if(event.key==='Tab'){
        const nodes=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input,button,[href]')||[]);
        const first=nodes[0],last=nodes[nodes.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',handle);
    return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',handle);previous?.focus();};
  },[onClose]);
  const all=items.map(([href,label,Icon,soon])=>({href,label,Icon,soon:soon===true}));
  const filtered=all.filter((item)=>item.label.toLowerCase().includes(query.toLowerCase())||item.href.includes(query.toLowerCase()));
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/50 p-4 pt-[8vh]" onClick={onClose}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Find a page" className="mx-auto max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl" onClick={(e)=>e.stopPropagation()}>
      <input value={query} onChange={(e)=>setQuery(e.target.value)} aria-label="Search pages and features" placeholder="Search pages and features…"
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
  useEffect(()=>{
    if(!mobile)return;
    const previous=document.activeElement as HTMLElement|null;
    const panel=document.querySelector<HTMLElement>('.jobrin-sidebar');
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    panel?.querySelector<HTMLElement>('a,button')?.focus();
    const handler=(event:KeyboardEvent)=>{
      if(event.key==='Escape')setMobile(false);
      if(event.key==='Tab'){
        const items=Array.from(panel?.querySelectorAll<HTMLElement>('a,button,select,summary')||[]).filter(item=>item.getClientRects().length>0);
        const first=items[0],last=items[items.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    const media=window.matchMedia('(min-width: 1024px)');
    const resize=()=>{if(media.matches)setMobile(false)};
    media.addEventListener('change',resize);
    document.addEventListener('keydown',handler);
    return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',handler);media.removeEventListener('change',resize);previous?.focus();};
  },[mobile]);
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

  const visibleGroups=visibleWorkspaceGroups(auth.workspace?.role);
  const paletteItems: NavItem[] = visibleGroups.flatMap((group)=>group.items);
  const content = routeWorkspacePage(path);
  return <div className="jobrin-workspace min-h-screen bg-slate-50 text-slate-950">
    <a href="#main-content" className="skip-link">Skip to content</a>
    {paletteOpen&&<CommandPalette items={paletteItems} onClose={()=>setPaletteOpen(false)}/>}
    {mobile&&<button aria-label="Close navigation overlay" onClick={()=>setMobile(false)} className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"/>}
    <aside aria-label="Workspace navigation" role={mobile?'dialog':undefined} aria-modal={mobile?true:undefined} className={`jobrin-sidebar fixed inset-y-0 left-0 z-50 w-[270px] border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${mobile?'translate-x-0':'-translate-x-full'}`}>
      <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4"><AppLink href="/app" onClick={()=>setMobile(false)} className="flex items-center gap-2.5 font-black tracking-tight"><span className="brand-mark flex h-9 w-9 items-center justify-center rounded-lg">J</span>Jobrin.ai</AppLink><button onClick={()=>setMobile(false)} aria-label="Close navigation" className="rounded-lg p-2 text-slate-500 lg:hidden"><X className="h-4 w-4"/></button></div>
      <div className="border-b border-slate-100 p-3"><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Workspace</label><div className="relative mt-1"><select value={auth.workspaceId} onChange={e=>auth.setWorkspaceId(e.target.value)} className="w-full appearance-none rounded-xl bg-slate-50 px-3 py-2.5 pr-8 text-sm font-semibold outline-none"><option value={auth.workspaceId}>{auth.workspace?.name}</option>{auth.workspaces.filter(w=>w.id!==auth.workspaceId).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-slate-400"/></div><div className="mt-2 flex items-center justify-between px-1 text-[11px]"><span className="capitalize text-slate-500">{auth.workspace?.role}</span><span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold capitalize text-indigo-700">{auth.workspace?.plan}</span></div></div>
      <nav className="jobrin-sidebar-nav overflow-y-auto px-2 py-3">{visibleGroups.map((group,gi)=>group.label? <details key={gi} className="mb-3" open={group.items.some(([href])=>path===href||(href!=='/app'&&path.startsWith(`${href}/`)))}><summary className="cursor-pointer list-none rounded-xl px-3 py-2 text-sm font-semibold tracking-normal text-slate-600 hover:bg-slate-50">{group.label}</summary><div className="mt-1 border-l border-slate-200 pl-1">{group.items.map(([href,label,Icon,soon])=>{const active=path===href||(href!=='/app'&&path.startsWith(`${href}/`));return <AppLink key={href} href={href} onClick={()=>setMobile(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active?'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm':'text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-950'}`}><Icon className={`h-4 w-4 flex-none ${active?'text-indigo-600':'text-slate-400'}`}/><span className="min-w-0 flex-1">{label}</span>{soon===true&&<span className="flex-none rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">soon</span>}</AppLink>})}</div></details>:<div key={gi} className="mb-3">{group.items.map(([href,label,Icon,soon])=>{const active=path===href||(href!=='/app'&&path.startsWith(`${href}/`));return <AppLink key={href} href={href} onClick={()=>setMobile(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active?'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm':'text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-950'}`}><Icon className={`h-4 w-4 ${active?'text-indigo-600':'text-slate-400'}`}/><span className="flex-1">{label}</span>{soon===true&&<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">soon</span>}</AppLink>})}</div>)}</nav>
      <div className="jobrin-sidebar-account border-t border-slate-100 bg-white p-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700">{(auth.user?.user_metadata?.display_name||auth.user?.email||'U')[0]?.toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{auth.user?.user_metadata?.display_name||auth.user?.email}</p><p className="truncate text-[10px] text-slate-400">{auth.user?.email}</p></div><button aria-label="Log out" title="Log out" onClick={async()=>{await logoutUser();navigate('/login',true)}} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><LogOut className="h-4 w-4"/></button></div></div>
    </aside>
    <div className="lg:pl-[270px] pb-16 lg:pb-0"><header className="jobrin-toolbar sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6"><div className="flex items-center gap-3"><button aria-label="Open navigation" aria-expanded={mobile} onClick={()=>setMobile(true)} className="rounded-xl border border-slate-200 p-2 lg:hidden"><Menu className="h-4 w-4"/></button><button onClick={()=>setPaletteOpen(true)} title="Search (Ctrl+K)" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-400 hover:border-indigo-300 hover:text-slate-600"><Search className="h-3.5 w-3.5"/>Search…<span className="hidden rounded border border-slate-200 px-1 text-[10px] sm:inline">Ctrl K</span></button><div className="hidden text-xs text-slate-400 sm:block">{auth.workspace?.name} / <span className="font-semibold text-slate-700">{pageTitle(path)}</span></div></div><div className="flex items-center gap-2"><button onClick={cycleTheme} aria-label={`Colour theme: ${theme}. Change theme`} title="Theme" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100">{theme==='dark'?<Moon className="h-4 w-4"/>:<Sun className="h-4 w-4"/>}</button><AppLink href="/app/notifications" className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications"><Bell className="h-4 w-4"/>{unreadCount!==null&&unreadCount>0&&<span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-black text-white">{unreadCount>9?'9+':unreadCount}</span>}</AppLink><AppLink href="/app/settings/security" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="Security settings"><KeyRound className="h-4 w-4"/></AppLink></div></header><main id="main-content" tabIndex={-1} className="jobrin-main mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{content}</main></div>
    <nav className="jobrin-bottom-nav fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white lg:hidden">
      {([['/app','Today',Home],['/app/admin-chat','Admin',MessageSquareMore],['/app/inbox','Inbox',Inbox],['/app/schedule','Schedule',CalendarDays]] as NavItem[]).map(([href,label,Icon])=>{const active=path===href||(href!=='/app'&&path.startsWith(`${href}/`));const featured=href==='/app/admin-chat';return <AppLink key={href} href={href} className={`jobrin-bottom-link flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold ${active?'is-active text-indigo-600':'text-slate-400'} ${featured?'is-featured':''}`}><Icon className="h-4 w-4"/>{label}</AppLink>})}
      <button onClick={()=>setMobile(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold text-slate-400"><Menu className="h-4 w-4"/>More</button>
    </nav>
  </div>;
}
