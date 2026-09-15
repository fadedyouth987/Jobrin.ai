import React, { useEffect, useRef, useState } from 'react';
import {
  Bell, CalendarDays, ChevronDown, Home, Inbox, KeyRound, LayoutGrid, LogOut, Menu,
  MessageSquareMore, Moon, Search, Sun, X
} from 'lucide-react';
import { useAuth } from '../app/auth';
import { AppLink, navigate, usePathname } from '../app/router';
import { logoutUser } from '../lib/supabase';
import { apiFetch } from '../lib/api';
import { useTheme } from '../app/theme';
import { primaryRail, routeWorkspacePage, visibleWorkspaceGroups, type NavItem } from '../app/workspaceNavigation';

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
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/55 p-4 pt-[8vh] backdrop-blur-sm" onClick={onClose}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Find a page" className="jobrin-palette mx-auto max-w-xl overflow-hidden rounded-xl border border-white/10 shadow-2xl" onClick={(e)=>e.stopPropagation()}>
      <input value={query} onChange={(e)=>setQuery(e.target.value)} aria-label="Search pages and features" placeholder="Search pages and actions…"
        onKeyDown={(e)=>{if(e.key==='Escape')onClose();if(e.key==='Enter'&&filtered[0]){navigate(filtered[0].href);onClose();}}}
        className="w-full border-0 border-b border-white/10 bg-transparent px-5 py-4 text-sm text-[color:var(--jobrin-chrome-ink)] outline-none placeholder:text-[color:var(--jobrin-chrome-muted)]"/>
      <div className="max-h-80 overflow-y-auto p-2">
        {filtered.length?filtered.map((item)=><button key={item.href} onClick={()=>{navigate(item.href);onClose()}} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-[color:var(--jobrin-chrome-ink)] hover:bg-white/5">
          <item.Icon className="h-4 w-4 text-[color:var(--jobrin-chrome-muted)]"/><span className="flex-1 font-medium">{item.label}</span>{item.soon&&<span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--jobrin-chrome-muted)]">coming soon</span>}
        </button>):<p className="p-4 text-sm text-[color:var(--jobrin-chrome-muted)]">No matches.</p>}
      </div>
      <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[11px] text-[color:var(--jobrin-chrome-muted)]"><span>↑↓ browse · ↵ open · esc close</span><span>Ctrl K</span></div>
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
  if(auth.loading||!auth.session||!auth.workspaceId||!subscriptionChecked)return <div className="jobrin-loading flex min-h-screen items-center justify-center text-sm text-[color:var(--jobrin-muted)]">Loading secure workspace…</div>;

  const visibleGroups=visibleWorkspaceGroups(auth.workspace?.role);
  const paletteItems: NavItem[] = visibleGroups.flatMap((group)=>group.items);
  const isActive=(href:string)=>path===href||(href!=='/app'&&path.startsWith(`${href}/`));
  const content = routeWorkspacePage(path);
  return <div className="jobrin-workspace min-h-screen bg-[color:var(--jobrin-canvas)] text-[color:var(--jobrin-ink)]">
    <a href="#main-content" className="skip-link">Skip to content</a>
    {paletteOpen&&<CommandPalette items={paletteItems} onClose={()=>setPaletteOpen(false)}/>}
    {mobile&&<button aria-label="Close navigation overlay" onClick={()=>setMobile(false)} className="fixed inset-0 z-40 bg-black/50 lg:hidden"/>}
    {/* Command deck: brand, search, workspace and account controls in one dark strip. */}
    <header className="jobrin-deck fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 px-3 sm:px-4">
      <button aria-label="Open navigation" aria-expanded={mobile} onClick={()=>setMobile(true)} className="jobrin-deck-btn lg:hidden"><Menu className="h-4 w-4"/></button>
      <AppLink href="/app" className="jobrin-deck-brand flex items-center gap-2" aria-label="Jobrin.ai home">
        <span className="brand-mark h-8 w-8 text-base">J</span>
        <span className="hidden text-[15px] font-bold tracking-tight text-[color:var(--jobrin-chrome-ink)] sm:block">Jobrin<span className="text-[color:var(--jobrin-rail-active)]">.ai</span></span>
      </AppLink>
      <div className="relative mx-auto w-full max-w-md">
        <button onClick={()=>setPaletteOpen(true)} title="Search (Ctrl+K)" className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-[color:var(--jobrin-chrome-muted)] hover:border-white/25 hover:text-[color:var(--jobrin-chrome-ink)]">
          <Search className="h-3.5 w-3.5"/><span className="flex-1 text-left">Search pages & actions…</span><kbd className="hidden rounded border border-white/15 px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
        </button>
      </div>
      <div className="flex items-center gap-1">
        <div className="jobrin-deck-workspace relative hidden md:block"><select value={auth.workspaceId} onChange={e=>auth.setWorkspaceId(e.target.value)} aria-label="Switch workspace" className="w-44 appearance-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 pr-8 text-xs font-semibold text-[color:var(--jobrin-chrome-ink)] outline-none"><option value={auth.workspaceId}>{auth.workspace?.name}</option>{auth.workspaces.filter(w=>w.id!==auth.workspaceId).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-[color:var(--jobrin-chrome-muted)]"/></div>
        <button onClick={cycleTheme} aria-label={`Colour theme: ${theme}. Change theme`} title="Theme" className="jobrin-deck-btn">{theme==='dark'?<Moon className="h-4 w-4"/>:<Sun className="h-4 w-4"/>}</button>
        <AppLink href="/app/notifications" className="jobrin-deck-btn relative" aria-label="Notifications"><Bell className="h-4 w-4"/>{unreadCount!==null&&unreadCount>0&&<span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#f2c24e] text-[9px] font-black text-[#14201b]">{unreadCount>9?'9+':unreadCount}</span>}</AppLink>
        <AppLink href="/app/settings/security" className="jobrin-deck-btn" aria-label="Security settings"><KeyRound className="h-4 w-4"/></AppLink>
        <button aria-label="Log out" title="Log out" onClick={async()=>{await logoutUser();navigate('/login',true)}} className="jobrin-deck-btn"><span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f2c24e] text-[10px] font-black text-[#14201b]">{(auth.user?.user_metadata?.display_name||auth.user?.email||'U')[0]?.toUpperCase()}</span></button>
      </div>
    </header>
    {/* Cockpit rail: seven primary surfaces; everything else lives in the palette. */}
    <nav aria-label="Primary areas" className="jobrin-rail fixed bottom-0 left-0 top-14 z-40 hidden w-16 flex-col items-center gap-1 py-3 lg:flex">
      {primaryRail.map(([href,label,Icon])=>{const active=isActive(href);return <AppLink key={href} href={href} title={label} className={`jobrin-rail-item ${active?'is-active':''}`}><Icon className="h-[18px] w-[18px]"/><span>{label}</span></AppLink>})}
      <button onClick={()=>setPaletteOpen(true)} title="Everything else (Ctrl+K)" className="jobrin-rail-item"><LayoutGrid className="h-[18px] w-[18px]"/><span>More</span></button>
    </nav>
    {/* Mobile drawer keeps the full grouped map, restyled to the cockpit chrome. */}
    {mobile&&<aside aria-label="Workspace navigation" role="dialog" aria-modal={true} className="jobrin-sidebar fixed inset-y-0 left-0 z-50 w-[280px] translate-x-0">
      <div className="flex h-14 items-center justify-between border-b border-[color:var(--jobrin-chrome-border)] px-4"><AppLink href="/app" onClick={()=>setMobile(false)} className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight text-[color:var(--jobrin-chrome-ink)]"><span className="brand-mark h-8 w-8 text-base">J</span>Jobrin<span className="text-[color:var(--jobrin-rail-active)]">.ai</span></AppLink><button onClick={()=>setMobile(false)} aria-label="Close navigation" className="jobrin-deck-btn"><X className="h-4 w-4"/></button></div>
      <div className="border-b border-[color:var(--jobrin-chrome-border)] p-3"><label className="block text-[10px] font-bold uppercase tracking-wider text-[color:var(--jobrin-chrome-muted)]">Workspace</label><div className="relative mt-1"><select value={auth.workspaceId} onChange={e=>auth.setWorkspaceId(e.target.value)} className="w-full appearance-none rounded-lg border border-[color:var(--jobrin-chrome-border)] bg-white/5 px-3 py-2.5 pr-8 text-sm font-semibold text-[color:var(--jobrin-chrome-ink)] outline-none"><option value={auth.workspaceId}>{auth.workspace?.name}</option>{auth.workspaces.filter(w=>w.id!==auth.workspaceId).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-[color:var(--jobrin-chrome-muted)]"/></div><div className="mt-2 flex items-center justify-between px-1 text-[11px]"><span className="capitalize text-[color:var(--jobrin-chrome-muted)]">{auth.workspace?.role}</span><span className="rounded-full border border-[color:var(--jobrin-rail-active)]/30 bg-[color:var(--jobrin-rail-active)]/10 px-2 py-0.5 font-semibold capitalize text-[color:var(--jobrin-rail-active)]">{auth.workspace?.plan}</span></div></div>
      <nav className="jobrin-sidebar-nav overflow-y-auto px-2 py-3">{visibleGroups.map((group,gi)=>group.label? <details key={gi} className="mb-3" open={group.items.some(([href])=>path===href||(href!=='/app'&&path.startsWith(`${href}/`)))}><summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-sm font-semibold text-[color:var(--jobrin-chrome-muted)] hover:bg-white/5">{group.label}</summary><div className="mt-1 border-l border-[color:var(--jobrin-chrome-border)] pl-1">{group.items.map(([href,label,Icon,soon])=>{const active=isActive(href);return <AppLink key={href} href={href} onClick={()=>setMobile(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${active?'bg-[color:var(--jobrin-rail-active)]/12 text-[color:var(--jobrin-chrome-ink)]':'text-[color:var(--jobrin-chrome-muted)] hover:bg-white/5 hover:text-[color:var(--jobrin-chrome-ink)]'}`}><Icon className={`h-4 w-4 flex-none ${active?'text-[color:var(--jobrin-rail-active)]':'text-[color:var(--jobrin-chrome-muted)]'}`}/><span className="min-w-0 flex-1">{label}</span>{soon===true&&<span className="flex-none rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[color:var(--jobrin-chrome-muted)]">soon</span>}</AppLink>})}</div></details>:<div key={gi} className="mb-3">{group.items.map(([href,label,Icon,soon])=>{const active=isActive(href);return <AppLink key={href} href={href} onClick={()=>setMobile(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${active?'bg-[color:var(--jobrin-rail-active)]/12 text-[color:var(--jobrin-chrome-ink)]':'text-[color:var(--jobrin-chrome-muted)] hover:bg-white/5 hover:text-[color:var(--jobrin-chrome-ink)]'}`}><Icon className={`h-4 w-4 ${active?'text-[color:var(--jobrin-rail-active)]':'text-[color:var(--jobrin-chrome-muted)]'}`}/><span className="flex-1">{label}</span>{soon===true&&<span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[color:var(--jobrin-chrome-muted)]">soon</span>}</AppLink>})}</div>)}</nav>
      <div className="jobrin-sidebar-account border-t border-[color:var(--jobrin-chrome-border)] p-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f2c24e] text-sm font-black text-[#14201b]">{(auth.user?.user_metadata?.display_name||auth.user?.email||'U')[0]?.toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[color:var(--jobrin-chrome-ink)]">{auth.user?.user_metadata?.display_name||auth.user?.email}</p><p className="truncate text-[10px] text-[color:var(--jobrin-chrome-muted)]">{auth.user?.email}</p></div><button aria-label="Log out" title="Log out" onClick={async()=>{await logoutUser();navigate('/login',true)}} className="rounded-lg p-2 text-[color:var(--jobrin-chrome-muted)] hover:bg-white/5 hover:text-[color:var(--jobrin-chrome-ink)]"><LogOut className="h-4 w-4"/></button></div></div>
    </aside>}
    <div className="pt-14 lg:pl-16 pb-16 lg:pb-0"><main id="main-content" tabIndex={-1} className="jobrin-main mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{content}</main></div>
    <nav className="jobrin-bottom-nav fixed inset-x-0 bottom-0 z-30 flex border-t border-[color:var(--jobrin-chrome-border)] bg-[color:var(--jobrin-chrome)] lg:hidden">
      {([['/app','Today',Home],['/app/admin-chat','Admin',MessageSquareMore],['/app/inbox','Inbox',Inbox],['/app/schedule','Schedule',CalendarDays]] as NavItem[]).map(([href,label,Icon])=>{const active=isActive(href);const featured=href==='/app/admin-chat';return <AppLink key={href} href={href} className={`jobrin-bottom-link flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold ${active?'is-active text-[color:var(--jobrin-rail-active)]':'text-[color:var(--jobrin-chrome-muted)]'} ${featured?'is-featured':''}`}><Icon className="h-4 w-4"/>{label}</AppLink>})}
      <button onClick={()=>setMobile(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold text-[color:var(--jobrin-chrome-muted)]"><LayoutGrid className="h-4 w-4"/>More</button>
    </nav>
  </div>;
}