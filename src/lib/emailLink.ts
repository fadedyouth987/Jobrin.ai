// Parses the three shapes a Supabase Auth email link can land on our pages in.
//
// The browser client runs with flowType 'pkce', but an admin-sent invite
// (auth.admin.inviteUserByEmail) cannot carry a PKCE verifier: with Supabase's
// default email template it redirects back with implicit-grant tokens in the
// URL hash, which a PKCE client refuses to auto-detect ("Not a valid PKCE
// flow url"). The recommended template instead sends a `token_hash` that the
// page verifies itself. A self-service password reset started from this
// browser arrives as a PKCE `code`.
//
// Kept free of the Supabase client so it can be unit-tested in Node.

export type EmailLinkType = 'invite' | 'recovery';

export type EmailLinkParams =
  | { kind: 'token_hash'; tokenHash: string; type: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string; type: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

export function parseEmailLinkParams(href: string): EmailLinkParams {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: 'none' };
  }
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const read = (key: string) => (query.get(key) ?? hash.get(key) ?? '').trim();

  const errorDescription = read('error_description');
  const errorCode = read('error_code') || read('error');
  if (errorDescription || errorCode) {
    return { kind: 'error', message: (errorDescription || errorCode).replace(/\+/g, ' ').slice(0, 300) };
  }

  const tokenHash = read('token_hash');
  if (tokenHash) return { kind: 'token_hash', tokenHash, type: read('type') };

  const accessToken = hash.get('access_token')?.trim() ?? '';
  const refreshToken = hash.get('refresh_token')?.trim() ?? '';
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken, type: (hash.get('type') ?? '').trim() };

  const code = query.get('code')?.trim() ?? '';
  if (code) return { kind: 'code', code };

  return { kind: 'none' };
}

// An invite page must never act on a link minted for a different purpose
// (e.g. a magic-link or recovery token pasted into /set-password). An empty
// type is tolerated only for implicit tokens from older templates.
export function emailLinkTypeMatches(params: EmailLinkParams, expected: EmailLinkType): boolean {
  if (params.kind === 'token_hash') return params.type === expected;
  if (params.kind === 'tokens') return params.type === '' || params.type === expected;
  return true;
}

// Removes one-time credentials from the address bar (and browser history)
// once they have been consumed.
export function stripEmailLinkParams(href: string): string {
  const url = new URL(href);
  for (const key of ['code', 'token_hash', 'type', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
  url.hash = '';
  return `${url.pathname}${url.search}`;
}
