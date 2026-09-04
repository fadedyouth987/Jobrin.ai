import { supabase } from './supabase';

export class ApiError extends Error {
  status: number;
  code: string;
  payload: any;
  constructor(status: number, payload: any) {
    super(payload?.message || payload?.error || `HTTP_${status}`);
    this.status = status;
    this.code = payload?.error || `HTTP_${status}`;
    this.payload = payload;
  }
}

export async function apiFetch<T = any>(path: string, init: RequestInit = {}, workspaceId?: string): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  let token = sessionData.session?.access_token;
  if (!token) throw new ApiError(401, { error: 'AUTH_REQUIRED' });

  const run = async (accessToken: string) => {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('x-request-id', crypto.randomUUID());
    if (workspaceId) headers.set('x-workspace-id', workspaceId);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(path, { ...init, headers, credentials: 'omit' });
  };

  let response = await run(token);
  if (response.status === 401) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token;
    if (refreshError || !token) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new ApiError(401, { error: 'SESSION_EXPIRED', message: 'Your session expired. Please sign in again.' });
    }
    response = await run(token);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

export async function jobrynFetch<T = any>(path: string, workspaceId: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, init, workspaceId);
}
