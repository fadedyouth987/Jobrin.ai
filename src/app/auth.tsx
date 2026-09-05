import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabase';
import { navigate } from './router';

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  plan: 'starter'|'growth'|'operator';
  role: string;
  created_at: string;
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceSummary | null;
  workspaceId: string | null;
  needsMfa: boolean;
  refreshWorkspaces: () => Promise<void>;
  setWorkspaceId: (id: string) => void;
  refreshMfa: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const WORKSPACE_KEY = 'jobrin-ai.active_workspace';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(() => localStorage.getItem(WORKSPACE_KEY));
  const [needsMfa, setNeedsMfa] = useState(false);

  const refreshMfa = async () => {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return setNeedsMfa(false);
    setNeedsMfa(data.currentLevel === 'aal1' && data.nextLevel === 'aal2');
  };

  const refreshWorkspaces = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return setWorkspaces([]);
    const data = await apiFetch<{ workspaces: WorkspaceSummary[] }>('/api/workspaces');
    setWorkspaces(data.workspaces);
    setWorkspaceIdState((current) => {
      if (current && data.workspaces.some((workspace) => workspace.id === current)) return current;
      const next = data.workspaces[0]?.id ?? null;
      if (next) localStorage.setItem(WORKSPACE_KEY, next); else localStorage.removeItem(WORKSPACE_KEY);
      return next;
    });
  };

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        await Promise.allSettled([refreshWorkspaces(), refreshMfa()]);
      }
      if (active) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password', true);
      }
      if (!nextSession) {
        setWorkspaces([]);
        setWorkspaceIdState(null);
        setNeedsMfa(false);
        setLoading(false);
      } else {
        setTimeout(() => {
          void Promise.allSettled([refreshWorkspaces(), refreshMfa()]).finally(() => setLoading(false));
        }, 0);
      }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  const setWorkspaceId = (id: string) => {
    if (!workspaces.some((workspace) => workspace.id === id)) return;
    localStorage.setItem(WORKSPACE_KEY, id);
    setWorkspaceIdState(id);
  };

  const workspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0] ?? null;
  const value = useMemo<AuthState>(() => ({
    loading,
    session,
    user: session?.user ?? null,
    workspaces,
    workspace,
    workspaceId: workspace?.id ?? null,
    needsMfa,
    refreshWorkspaces,
    setWorkspaceId,
    refreshMfa,
  }), [loading, session, workspaces, workspace, needsMfa]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be inside AuthProvider');
  return value;
}
