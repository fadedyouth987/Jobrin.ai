import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { mergeNumberOverrides, PHONE_NUMBER_E164, type ReceptionistProfileLike, type WorkspacePhoneNumberRow } from '../server/phoneNumbers';

const receptionistSource = await readFile(new URL('../server/routes/receptionist.ts', import.meta.url), 'utf8');
const communicationsSource = await readFile(new URL('../server/routes/communications.ts', import.meta.url), 'utf8');
const integrationsSource = await readFile(new URL('../server/routes/integrations.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260914010000_workspace_phone_numbers.sql', import.meta.url), 'utf8');

const baseProfile: ReceptionistProfileLike = {
  display_name: 'Jobrin.ai Receptionist',
  greeting: 'Thanks for calling. How can I help you today?',
  voice_provider: 'Google',
  voice_id: 'en-AU-Chirp3-HD-Achernar',
  language: 'en-AU',
  after_hours_message: 'The team is unavailable right now.',
  enabled: true,
};

function numberRow(overrides: Partial<WorkspacePhoneNumberRow>): WorkspacePhoneNumberRow {
  return {
    id: 'n1', workspace_id: 'w1', phone_number: '+61491234567', label: 'Line',
    is_primary: false, status: 'active',
    display_name_override: null, greeting_override: null, voice_provider_override: null,
    voice_id_override: null, language_override: null, after_hours_message_override: null,
    ...overrides,
  };
}

test('a single-number workspace (no override row) resolves to exactly the base profile, unchanged', () => {
  assert.deepEqual(mergeNumberOverrides(baseProfile, null), baseProfile);
  assert.deepEqual(mergeNumberOverrides(baseProfile, undefined), baseProfile);
});

test('a number with no overrides set still falls back to every base profile field', () => {
  const merged = mergeNumberOverrides(baseProfile, numberRow({}));
  assert.deepEqual(merged, baseProfile);
});

test('a number with overrides only replaces the fields it overrides, and leaves everything else (including non-caller-facing fields) untouched', () => {
  const row = numberRow({
    display_name_override: 'Northside Plumbing', greeting_override: 'Thanks for calling Northside.',
    voice_provider_override: 'ElevenLabs', voice_id_override: 'custom-voice',
  });
  const merged = mergeNumberOverrides(baseProfile, row);
  assert.equal(merged.display_name, 'Northside Plumbing');
  assert.equal(merged.greeting, 'Thanks for calling Northside.');
  assert.equal(merged.voice_provider, 'ElevenLabs');
  assert.equal(merged.voice_id, 'custom-voice');
  // Unoverridden caller-facing fields still fall back to the workspace default.
  assert.equal(merged.language, baseProfile.language);
  assert.equal(merged.after_hours_message, baseProfile.after_hours_message);
  // Non-caller-facing fields (limits, instructions, enabled, etc.) are never
  // touched by a number override -- they always come from the single
  // workspace receptionist_profiles row.
  assert.equal(merged.enabled, baseProfile.enabled);
});

test('two numbers on the same workspace can resolve to two different effective profiles from the one base profile', () => {
  const numberA = numberRow({ id: 'a', greeting_override: 'Greeting A' });
  const numberB = numberRow({ id: 'b', greeting_override: 'Greeting B', voice_id_override: 'voice-b' });
  const profileA = mergeNumberOverrides(baseProfile, numberA);
  const profileB = mergeNumberOverrides(baseProfile, numberB);
  assert.equal(profileA.greeting, 'Greeting A');
  assert.equal(profileB.greeting, 'Greeting B');
  assert.notEqual(profileA.greeting, profileB.greeting);
  assert.equal(profileB.voice_id, 'voice-b');
  assert.equal(profileA.voice_id, baseProfile.voice_id); // A has no voice override
});

test('the E.164 validator used by both the migration and the management routes agrees on shape', () => {
  assert.equal(PHONE_NUMBER_E164.test('+61491234567'), true);
  assert.equal(PHONE_NUMBER_E164.test('0491234567'), false);
  assert.equal(PHONE_NUMBER_E164.test('+0491234567'), false);
  assert.equal(PHONE_NUMBER_E164.test('not-a-number'), false);
});

test('the /voice webhook resolves the workspace via workspace_phone_numbers first, and falls back to the legacy single-number integrations lookup', () => {
  const numberLookupAt = receptionistSource.indexOf(".from('workspace_phone_numbers').select('*').eq('phone_number', to).eq('status', 'active')");
  const legacyLookupAt = receptionistSource.indexOf(".from('integrations').select('workspace_id').eq('provider','twilio').eq('external_account_id',to).eq('status','connected')");
  assert.ok(numberLookupAt >= 0, 'workspace_phone_numbers lookup must exist');
  assert.ok(legacyLookupAt >= 0, 'legacy integrations fallback lookup must still exist');
  assert.ok(numberLookupAt < legacyLookupAt, 'workspace_phone_numbers must be resolved before the legacy fallback runs');
  // The legacy fallback only runs when no number row was found.
  assert.match(receptionistSource, /if \(!integration\) \{\s*\n\s*const \{ data: legacyIntegration \}/);
  // Per-number overrides are applied before the profile is used to answer.
  assert.match(receptionistSource, /mergeNumberOverrides\(baseProfile, numberRow/);
  const mergeAt = receptionistSource.indexOf('mergeNumberOverrides(');
  const sayAt = receptionistSource.indexOf('response.say(');
  assert.ok(mergeAt >= 0 && sayAt >= 0 && mergeAt < sayAt, 'overrides must be merged before the call is answered');
});

test('inbound SMS workspace routing (assignedWorkspace) also resolves via workspace_phone_numbers first, with the same legacy fallback', () => {
  assert.match(communicationsSource, /assignedWorkspace\(to\)/);
  const numberLookupAt = communicationsSource.indexOf(".from('workspace_phone_numbers').select('workspace_id')");
  const legacyLookupAt = communicationsSource.indexOf(".from('integrations').select('workspace_id')");
  assert.ok(numberLookupAt >= 0, 'workspace_phone_numbers lookup must exist in assignedWorkspace');
  assert.ok(legacyLookupAt >= 0, 'legacy integrations fallback must still exist');
  assert.ok(numberLookupAt < legacyLookupAt);
  // The original ambiguity guard (more than one connected row means "unknown
  // tenant, do nothing") must still exist for the legacy path.
  assert.match(communicationsSource, /data\?\.length !== 1/);
});

test('the workspace_phone_numbers migration is tenant isolated, owner/admin write-gated, globally unique per number, and safely re-appliable', () => {
  assert.match(migration, /alter table public\.workspace_phone_numbers enable row level security/i);
  assert.match(migration, /private\.is_workspace_member\(workspace_id\)/);
  assert.match(migration, /private\.has_workspace_role\(workspace_id, array\['owner', 'admin'\]/);
  // Only select/insert/update are granted -- no browser delete on this
  // operational record, matching this codebase's convention.
  assert.match(migration, /grant select, insert, update on public\.workspace_phone_numbers to authenticated/);
  assert.match(migration, /revoke delete on public\.workspace_phone_numbers from authenticated/);
  // A number can only ever belong to one workspace.
  assert.match(migration, /unique \(phone_number\)/);
  // At most one primary per workspace, enforced in the DB, not just the API.
  assert.match(migration, /create unique index if not exists workspace_phone_numbers_one_primary_idx/);
  // The backfill from the legacy single-number model is idempotent.
  assert.match(migration, /on conflict \(phone_number\) do nothing/);
  assert.match(migration, /from public\.integrations\s*\nwhere provider = 'twilio' and status = 'connected'/);
});

test('phone number management routes require owner/admin plus step-up auth to add or change a number, but any member can list them', () => {
  const listMatch = /router\.get\(\s*"\/numbers",/.exec(integrationsSource);
  const postMatch = /router\.post\(\s*"\/numbers",/.exec(integrationsSource);
  const patchMatch = /router\.patch\(\s*"\/numbers\/:id",/.exec(integrationsSource);
  assert.ok(listMatch && postMatch && patchMatch, 'all three /numbers routes must exist');
  const listAt = listMatch!.index;
  const postAt = postMatch!.index;
  const patchAt = patchMatch!.index;
  const listRoute = integrationsSource.slice(listAt, postAt);
  const postRoute = integrationsSource.slice(postAt, patchAt);
  const patchRoute = integrationsSource.slice(patchAt, patchAt + 2000);
  // The list route relies on router-level requireAuth/requireWorkspace only
  // -- no extra role gate -- and reads through the user's own client so RLS
  // (member_select) is the real boundary, not an inline role check.
  assert.doesNotMatch(listRoute, /requireRole\(/);
  assert.match(listRoute, /createUserClient\(req\.auth!\.accessToken\)/);
  for (const route of [postRoute, patchRoute]) {
    assert.match(route, /requireRole\("owner", "admin"\)/);
    assert.match(route, /requireSensitiveAuth/);
  }
  // Adding a number checks global uniqueness before insert, mirroring the
  // existing /twilio/activate ownership check.
  assert.match(postRoute, /PHONE_NUMBER_ALREADY_ASSIGNED/);
  // A workspace's primary number cannot be deactivated out from under it.
  assert.match(patchRoute, /PHONE_NUMBER_PRIMARY_CANNOT_DEACTIVATE/);
});

test('activating the legacy single-number Twilio integration also creates the matching workspace_phone_numbers row, so existing workspaces show up in the new numbers list', () => {
  const activateAt = integrationsSource.indexOf('"/twilio/activate"');
  const nextRouteAt = integrationsSource.indexOf('const phoneNumberCreateSchema');
  const activateRoute = integrationsSource.slice(activateAt, nextRouteAt);
  assert.match(activateRoute, /\.from\("workspace_phone_numbers"\)\.upsert\(/);
  assert.match(activateRoute, /onConflict: "phone_number"/);
  assert.match(activateRoute, /is_primary: true/);
});
