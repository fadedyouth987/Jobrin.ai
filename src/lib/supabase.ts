import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  console.warn('Supabase browser configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(url || 'http://127.0.0.1:54321', anonKey || 'missing-anon-key', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type JobrynOAuthProvider = 'google' | 'github' | 'azure' | 'apple';

export async function signInWithProvider(provider: JobrynOAuthProvider) {
  const scopes = provider === 'azure' ? 'email openid profile' : undefined;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      scopes,
    },
  });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string, displayName?: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || '' },
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function resetPasswordEmail(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function logoutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
