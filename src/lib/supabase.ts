import { createClient } from '@supabase/supabase-js';
import { emailLinkTypeMatches, parseEmailLinkParams, stripEmailLinkParams, type EmailLinkType } from './emailLink';

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

export type JobrinAiOAuthProvider = 'google' | 'github' | 'azure' | 'apple';

export async function signInWithProvider(provider: JobrinAiOAuthProvider) {
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

const EMAIL_LINK_INVALID: Record<EmailLinkType, string> = {
  invite: 'This invitation link is invalid or has expired. Ask your workspace owner to send a new invitation.',
  recovery: 'This reset link is invalid or has expired. Request a new password-reset email.',
};

// Establishes the session an emailed invite or password-reset link grants.
// For invites it never falls back to a session the browser already holds:
// otherwise opening someone's invite while another user is signed in would
// let "Finish joining" change the signed-in user's password instead.
export async function establishSessionFromEmailLink(expected: EmailLinkType): Promise<void> {
  const params = parseEmailLinkParams(window.location.href);
  // getSession waits for the client's own URL detection to finish, so a PKCE
  // code it auto-exchanged cannot race the explicit handling below.
  const { data: initial } = await supabase.auth.getSession();
  const invalid = new Error(EMAIL_LINK_INVALID[expected]);
  const consumeUrl = () => history.replaceState(history.state, '', stripEmailLinkParams(window.location.href));

  if (params.kind === 'error' || !emailLinkTypeMatches(params, expected)) {
    consumeUrl();
    throw invalid;
  }
  if (params.kind === 'token_hash') {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: expected });
    consumeUrl();
    if (error || !data.session) throw invalid;
    return;
  }
  if (params.kind === 'tokens') {
    const { data, error } = await supabase.auth.setSession({ access_token: params.accessToken, refresh_token: params.refreshToken });
    consumeUrl();
    if (error || !data.session) throw invalid;
    return;
  }
  if (params.kind === 'code') {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    consumeUrl();
    if (!error && data.session) return;
    // A reset requested from this browser is usually exchanged by the client
    // during initialisation, which consumes the verifier; the explicit retry
    // then reports it missing. An admin invite never arrives as a PKCE code.
    if (expected === 'recovery' && error && /code verifier/i.test(error.message) && initial.session) return;
    throw invalid;
  }
  // No credential in the URL: a signed-in user may still change their own
  // password on the reset page, but an invite must come from the link itself.
  if (expected === 'recovery' && initial.session) return;
  throw invalid;
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function logoutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
