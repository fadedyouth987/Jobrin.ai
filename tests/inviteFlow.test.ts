import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { emailLinkTypeMatches, parseEmailLinkParams, stripEmailLinkParams } from '../src/lib/emailLink';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// --- Email-link parsing: the three shapes a Supabase link can arrive in ---

test('default invite template: implicit tokens in the hash are recognised', () => {
  const params = parseEmailLinkParams('https://jobrin.ai/set-password#access_token=at.jwt&expires_in=3600&refresh_token=rt123&token_type=bearer&type=invite');
  assert.deepEqual(params, { kind: 'tokens', accessToken: 'at.jwt', refreshToken: 'rt123', type: 'invite' });
  assert.equal(emailLinkTypeMatches(params, 'invite'), true);
});

test('recommended template: token_hash in the query is recognised', () => {
  const params = parseEmailLinkParams('https://jobrin.ai/set-password?token_hash=pkce_abc&type=invite');
  assert.deepEqual(params, { kind: 'token_hash', tokenHash: 'pkce_abc', type: 'invite' });
  assert.equal(emailLinkTypeMatches(params, 'invite'), true);
});

test('a PKCE code from a self-service reset is recognised', () => {
  assert.deepEqual(parseEmailLinkParams('https://jobrin.ai/reset-password?code=abc-123'), { kind: 'code', code: 'abc-123' });
});

test('an expired or already-used link surfaces as an error, not a session', () => {
  const params = parseEmailLinkParams('https://jobrin.ai/set-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.equal(params.kind, 'error');
  assert.match((params as { message: string }).message, /invalid or has expired/);
});

test('a bare page visit carries no credential', () => {
  assert.deepEqual(parseEmailLinkParams('https://jobrin.ai/set-password'), { kind: 'none' });
  assert.deepEqual(parseEmailLinkParams('not a url'), { kind: 'none' });
});

test('an invite page rejects links minted for another purpose', () => {
  assert.equal(emailLinkTypeMatches(parseEmailLinkParams('https://x.test/set-password?token_hash=h&type=recovery'), 'invite'), false);
  assert.equal(emailLinkTypeMatches(parseEmailLinkParams('https://x.test/set-password?token_hash=h&type=magiclink'), 'invite'), false);
  assert.equal(emailLinkTypeMatches(parseEmailLinkParams('https://x.test/set-password?token_hash=h'), 'invite'), false);
  assert.equal(emailLinkTypeMatches(parseEmailLinkParams('https://x.test/set-password#access_token=a&refresh_token=r&type=magiclink'), 'invite'), false);
  assert.equal(emailLinkTypeMatches(parseEmailLinkParams('https://x.test/reset-password?token_hash=h&type=invite'), 'recovery'), false);
});

test('consumed one-time credentials are stripped from the address bar', () => {
  assert.equal(stripEmailLinkParams('https://jobrin.ai/set-password?token_hash=h&type=invite&keep=1'), '/set-password?keep=1');
  assert.equal(stripEmailLinkParams('https://jobrin.ai/set-password#access_token=a&refresh_token=r&type=invite'), '/set-password');
  assert.equal(stripEmailLinkParams('https://jobrin.ai/reset-password?code=c'), '/reset-password');
});

// --- Contracts on the page and the server route ---

test('the invite page establishes its session only from the link, never a pre-existing one', async () => {
  const supabaseSource = await source('src/lib/supabase.ts');
  const pageSource = await source('src/pages/PasswordPages.tsx');
  assert.match(pageSource, /establishSessionFromEmailLink\(isInvite\?'invite':'recovery'\)/);
  // The old page fell back to supabase.auth.getSession() for invites, which
  // returns whoever is already signed in when the link itself fails.
  assert.doesNotMatch(pageSource, /supabase\.auth\.getSession/);
  assert.match(supabaseSource, /verifyOtp\(\{ token_hash: params\.tokenHash, type: expected \}\)/);
  assert.match(supabaseSource, /setSession\(\{ access_token: params\.accessToken, refresh_token: params\.refreshToken \}\)/);
  // Only the recovery page may reuse an existing session.
  assert.match(supabaseSource, /if \(expected === 'recovery' && initial\.session\) return;\n  throw invalid;/);
});

test('a failed membership insert rolls back the invited auth user', async () => {
  const teamSource = await source('server/routes/team.ts');
  const insertAt = teamSource.indexOf(".from('workspace_members')\n    .insert(");
  const rollbackAt = teamSource.indexOf('await rollbackInvitedUser();');
  assert.ok(insertAt > 0 && rollbackAt > insertAt, 'rollback must follow the membership insert');
  assert.match(teamSource, /auth\.admin\.deleteUser\(userId\)/);
  // Raw database errors are not echoed back to the browser.
  assert.doesNotMatch(teamSource, /message: insertError\.message/);
});
