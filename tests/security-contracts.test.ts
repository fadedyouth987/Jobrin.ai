import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const billingSource = await readFile(new URL('../server/routes/billing.ts', import.meta.url), 'utf8');
const operationsSource = await readFile(new URL('../server/routes/operations.ts', import.meta.url), 'utf8');
const settlementMigration = await readFile(new URL('../supabase/migrations/0007_secure_invoice_payment_settlement.sql', import.meta.url), 'utf8');
const communicationsSource = await readFile(new URL('../server/routes/communications.ts', import.meta.url), 'utf8');
const envSource = await readFile(new URL('../server/env.ts', import.meta.url), 'utf8');
const packageSource = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
const supabaseSource = await readFile(new URL('../server/supabase.ts', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const trialBackfillMigration = await readFile(new URL('../supabase/migrations/0009_backfill_workspace_trials.sql', import.meta.url), 'utf8');
const billingRouteSource = await readFile(new URL('../server/routes/billing.ts', import.meta.url), 'utf8');
const memberAccessMigration = await readFile(new URL('../supabase/migrations/0011_member_subscription_access.sql', import.meta.url), 'utf8');
const receptionistSource = await readFile(new URL('../server/routes/receptionist.ts', import.meta.url), 'utf8');
const receptionistMigration = await readFile(new URL('../supabase/migrations/0012_ai_receptionist_configuration.sql', import.meta.url), 'utf8');
const hiringMigration = await readFile(new URL('../supabase/migrations/0017_trade_hiring_pipeline.sql', import.meta.url), 'utf8');
const hiringSource = await readFile(new URL('../server/routes/hiring.ts', import.meta.url), 'utf8');
const deploymentHardeningMigration = await readFile(new URL('../supabase/migrations/0019_deployment_hardening.sql', import.meta.url), 'utf8');
const wranglerSource = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../worker.ts', import.meta.url), 'utf8');
const browserConfigGuard = await readFile(new URL('../scripts/assert-browser-config.mjs', import.meta.url), 'utf8');
const fieldCompletionMigration = await readFile(new URL('../supabase/migrations/0022_field_completion_pack.sql', import.meta.url), 'utf8');
const roleScopedPoliciesMigration = await readFile(new URL('../supabase/migrations/0028_field_completion_role_scoped_policies.sql', import.meta.url), 'utf8');
const workspacesSource = await readFile(new URL('../server/routes/workspaces.ts', import.meta.url), 'utf8');
const workspaceDeletionMigration = await readFile(new URL('../supabase/migrations/0030_workspace_deletion_lifecycle.sql', import.meta.url), 'utf8');
const workspacePurgeSource = await readFile(new URL('../server/automation/workspacePurge.ts', import.meta.url), 'utf8');
const automationRunnerSource = await readFile(new URL('../server/automation/runner.ts', import.meta.url), 'utf8');

test('Stripe webhooks verify signatures against the raw body before claiming events', () => {
  assert.match(billingSource, /express\.raw\(\{\s*type: ["']application\/json["']/);
  assert.match(billingSource, /stripe\.webhooks\.constructEvent\(\s*req\.body,\s*signature,\s*env\.STRIPE_WEBHOOK_SECRET,\s*\)/);
  assert.ok(billingSource.indexOf('constructEvent') < billingSource.indexOf("claim_stripe_webhook_event"));
});

test('Checkout uses dynamic payment methods and current integration identifiers', () => {
  assert.doesNotMatch(billingSource, /payment_method_types/);
  assert.doesNotMatch(operationsSource, /payment_method_types/);
  assert.match(billingSource, /integration_identifier:\s*["']jobrin-ai_subs_[a-z]{8}["']/);
  assert.match(operationsSource, /integration_identifier:\s*["']jobrin-ai_pay_[a-z]{8}["']/);
});

test('invoice settlement is restricted to the service role and is idempotent', () => {
  assert.match(settlementMigration, /revoke all on function public\.settle_stripe_invoice_payment[\s\S]*from public, anon, authenticated;/i);
  assert.match(settlementMigration, /grant execute on function public\.settle_stripe_invoice_payment[\s\S]*to service_role;/i);
  assert.match(settlementMigration, /on conflict \(workspace_id, provider, provider_payment_id\) do nothing/i);
  assert.match(settlementMigration, /for update;/i);
});

test('Twilio webhooks are signature checked before tenant data is used', () => {
  assert.match(communicationsSource, /x-twilio-signature/i);
  assert.match(communicationsSource, /validateTwilioWebhook/);
  assert.match(communicationsSource, /assignedWorkspace\(to\)/);
  assert.match(communicationsSource, /data\?\.length !== 1/);
});

test('outbound SMS requires consent, suppression checks and metered usage', () => {
  assert.match(communicationsSource, /customer_consents/);
  assert.match(communicationsSource, /suppression_entries/);
  assert.match(communicationsSource, /consumeWorkspaceUsage\(req, 'usage\.sms'\)/);
  assert.match(communicationsSource, /SMS_CONSENT_REQUIRED_OR_SUPPRESSED/);
});

test('local server auth uses the same public Supabase project as the browser without exposing service role', () => {
  assert.match(envSource, /SUPABASE_URL:\s*process\.env\.SUPABASE_URL\s*\?\?\s*process\.env\.VITE_SUPABASE_URL/);
  assert.match(envSource, /SUPABASE_ANON_KEY:\s*process\.env\.SUPABASE_ANON_KEY\s*\?\?\s*process\.env\.VITE_SUPABASE_ANON_KEY/);
  assert.match(envSource, /SUPABASE_SERVICE_ROLE_KEY:\s*process\.env\.SUPABASE_SERVICE_ROLE_KEY\s*\?\?\s*["']{2}/);
  assert.doesNotMatch(envSource, /SUPABASE_SERVICE_ROLE_KEY:.*VITE_/);
});

test('Windows development uses the trusted system certificate store for Supabase HTTPS', () => {
  assert.match(packageSource.scripts.dev, /node --use-system-ca --import \.\/scripts\/node-userinfo-fallback\.mjs --import tsx node-server\.ts/);
});

test('tenant membership checks use the authenticated user client and RLS', () => {
  const start = supabaseSource.indexOf('export async function requireWorkspace');
  const end = supabaseSource.indexOf('export function requireRole', start);
  const tenantCheck = supabaseSource.slice(start, end);
  assert.match(tenantCheck, /createUserClient\(req\.auth\.accessToken\)/);
  assert.doesNotMatch(tenantCheck, /supabaseAdmin/);
  assert.match(tenantCheck, /\.eq\('user_id', req\.auth\.userId\)/);
  assert.match(tenantCheck, /\.eq\('status', 'active'\)/);
});

test('subscription and entitlement gates use the authenticated tenant client', () => {
  const start = supabaseSource.indexOf('export function requireActiveSubscription');
  const end = supabaseSource.indexOf('export function requireSensitiveAuth', start);
  const subscriptionGate = supabaseSource.slice(start, end);
  assert.match(subscriptionGate, /createUserClient\(req\.auth\.accessToken\)/);
  assert.doesNotMatch(subscriptionGate, /supabaseAdmin/);
});

test('expired browser sessions refresh once and then fail closed', () => {
  assert.match(apiSource, /if \(response\.status === 401\)/);
  assert.match(apiSource, /supabase\.auth\.refreshSession\(\)/);
  assert.match(apiSource, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(apiSource, /SESSION_EXPIRED/);
});

test('authenticated users cannot remain on login or signup screens', () => {
  assert.match(appSource, /auth\.session\)\s*navigate\(auth\.workspaceId \? ["']\/app["'] : ["']\/onboarding["'], true\)/);
});

test('legacy workspace repair never overwrites existing billing state', () => {
  assert.match(trialBackfillMigration, /where not exists[\s\S]*public\.subscriptions/i);
  assert.match(trialBackfillMigration, /where not exists[\s\S]*public\.subscription_entitlements/i);
  assert.doesNotMatch(trialBackfillMigration, /on conflict[\s\S]*do update/i);
});

test('creating a Stripe customer preserves an existing trial or subscription state', () => {
  const start = billingRouteSource.indexOf('if (!customerId)');
  const end = billingRouteSource.indexOf('const providedKey', start);
  const customerLink = billingRouteSource.slice(start, end);
  assert.match(customerLink, /if \(existingSub\)/);
  assert.match(customerLink, /\.update\(\{[\s\S]*stripe_customer_id: customerId/);
  assert.doesNotMatch(customerLink.match(/if \(existingSub\)[\s\S]*?\} else \{/)?.[0] || '', /status:/);
});

test('team subscription gates expose minimal state only after membership verification', () => {
  assert.match(memberAccessMigration, /private\.is_workspace_member\(target_workspace\)/);
  assert.match(memberAccessMigration, /returns table\(status[\s\S]*trial_ends_at[\s\S]*grace_period_ends_at/i);
  assert.doesNotMatch(memberAccessMigration, /stripe_customer_id|stripe_subscription_id/);
  assert.match(memberAccessMigration, /revoke all[\s\S]*from public, anon/i);
  assert.match(memberAccessMigration, /grant execute[\s\S]*to authenticated, service_role/i);
});

test('trusted audit rows are never written with a browser or placeholder key', () => {
  const start = supabaseSource.indexOf('export async function writeAudit');
  const auditWriter = supabaseSource.slice(start);
  assert.match(auditWriter, /!env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(auditWriter, /supabaseAdmin\.from\('audit_logs'\)\.insert/);
  assert.doesNotMatch(auditWriter, /createUserClient/);
});

test('AI receptionist stays fail-closed until the signed live conversation engine is ready', () => {
  assert.match(receptionistSource, /if \(req\.body\.enabled\)/);
  assert.match(receptionistSource, /RECEPTIONIST_NOT_READY/);
  assert.match(receptionistSource, /twilioSignatureGuard\('\/api\/twilio\/voice'\)/);
  // The signed live engine now exists; the lock is conditional on real
  // dependencies (Twilio, AI key, HTTPS, attached engine) instead of a hard ban.
  assert.doesNotMatch(receptionistSource, /conversationRelay: false/);
  assert.match(receptionistSource, /isReceptionistEngineAttached\(\)/);
  assert.match(receptionistSource, /issueCallToken\(/);
});

test('receptionist configuration is tenant isolated and stores no provider credentials', () => {
  assert.match(receptionistMigration, /alter table public\.receptionist_profiles enable row level security/i);
  assert.match(receptionistMigration, /private\.is_workspace_member\(workspace_id\)/i);
  assert.match(receptionistMigration, /private\.has_workspace_role\(workspace_id/i);
  assert.doesNotMatch(receptionistMigration, /api_key|auth_token|secret_key/i);
});

test('hiring records are management-only, tenant-isolated and never auto-select a candidate', () => {
  assert.match(hiringMigration, /alter table public\.candidates enable row level security/i);
  assert.match(hiringMigration, /private\.has_workspace_role\(workspace_id, array\[''owner'',''admin'',''manager''\]/i);
  assert.match(hiringMigration, /Candidate application references a different workspace/i);
  assert.match(hiringMigration, /revoke delete on public\.job_openings,public\.candidates,public\.candidate_applications from authenticated/i);
  assert.match(hiringSource, /router\.use\(requireRole\('owner', 'admin', 'manager'\)\)/);
  assert.match(hiringSource, /INVALID_APPLICATION_TRANSITION/);
  assert.doesNotMatch(hiringSource, /auto(?:matically)?\s*(?:reject|hire|select)/i);
});

test('deployment hardening limits trial creation atomically and removes the unused credit RPC', () => {
  assert.match(deploymentHardeningMigration, /pg_advisory_xact_lock/);
  assert.match(deploymentHardeningMigration, /workspace_count >= 3/);
  assert.match(deploymentHardeningMigration, /revoke all on function public\.reserve_credits[\s\S]*from public, anon, authenticated;/i);
  assert.match(deploymentHardeningMigration, /create index if not exists sms_delivery_attempts_customer_fk_idx/i);
});

test('Cloudflare deployment requires a browser Supabase build configuration and runs the Brain queue on a schedule', () => {
  assert.match(packageSource.scripts['build:staging'], /assert-browser-config/);
  assert.match(packageSource.scripts['cf:dry-run'], /build:staging/);
  assert.match(browserConfigGuard, /VITE_SUPABASE_URL/);
  assert.match(browserConfigGuard, /VITE_SUPABASE_ANON_KEY/);
  assert.match(wranglerSource, /"crons": \["\*\/5 \* \* \* \*"\]/);
  assert.match(workerSource, /processBusinessBrainQueue/);
  // The Brain queue must run on the cron tick (directly or in a guarded jobs
  // list passed to ctx.waitUntil) and must be skipped when unconfigured.
  assert.match(workerSource, /processBusinessBrainQueue\(\)/);
  assert.match(workerSource, /ctx\.waitUntil\(Promise\.all\(jobs\)\)/);
  assert.match(workerSource, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('checklist, template and signature tables restrict writes to staff and above, not just any workspace member', () => {
  // 0022 originally gave these three tables a single "_member_all" policy
  // (private.is_workspace_member only), so a workspace member with a
  // read-only role like 'viewer' could write directly via a Supabase-client
  // call even though the Express API requires staff/manager/admin/owner.
  assert.match(fieldCompletionMigration, /_member_all/);
  const tables = ['checklist_templates', 'job_checklists', 'job_signatures'];
  for (const table of tables) {
    // The follow-up migration must drop the over-permissive policy and
    // split it into a member-scoped read policy plus a role-scoped write
    // policy, matching the "_staff_write" pattern used for customers/jobs/
    // invoices in 0005_least_privilege_rbac.sql.
    assert.match(roleScopedPoliciesMigration, new RegExp(`drop policy if exists %I on public\\.%I.*${table}.*_member_all|_member_all`));
  }
  assert.match(roleScopedPoliciesMigration, /for select to authenticated using \(private\.is_workspace_member\(workspace_id\)\)/);
  assert.match(roleScopedPoliciesMigration, /array\[''owner'',''admin'',''manager'',''staff''\]::public\.workspace_role\[\]/);
  assert.match(roleScopedPoliciesMigration, /_staff_write/);
  assert.match(roleScopedPoliciesMigration, /checklist_templates.*job_checklists.*job_signatures|job_checklists.*job_signatures.*checklist_templates/s);
});

test('workspace deletion request and cancel are owner-only and require AAL2 step-up', () => {
  const requestStart = workspacesSource.indexOf("router.post('/deletion/request'");
  const requestEnd = workspacesSource.indexOf("router.post('/deletion/cancel'");
  const requestRoute = workspacesSource.slice(requestStart, requestEnd);
  assert.ok(requestStart >= 0, 'deletion/request route must exist');
  assert.match(requestRoute, /requireRole\('owner'\)/);
  assert.match(requestRoute, /requireSensitiveAuth/);
  assert.match(requestRoute, /requireWorkspace/);

  const cancelStart = requestEnd;
  const cancelEnd = workspacesSource.indexOf("router.post('/deletion/request-account'");
  const cancelRoute = workspacesSource.slice(cancelStart, cancelEnd);
  assert.ok(cancelEnd > cancelStart, 'deletion/cancel route must exist');
  assert.match(cancelRoute, /requireRole\('owner'\)/);
  assert.match(cancelRoute, /requireSensitiveAuth/);
  // Cancel must run before the pending-deletion workspace would otherwise be
  // rejected by requireWorkspace -- it marks the request with
  // allowPendingWorkspaceDeletion ahead of requireWorkspace in the chain.
  assert.match(cancelRoute, /allowPendingWorkspaceDeletion,\s*requireWorkspace/);

  // The self-service account-level path must never call deleteUser directly;
  // it defers actual auth-account removal to the scheduled purge job.
  const accountRoute = workspacesSource.slice(workspacesSource.indexOf("router.post('/deletion/request-account'"));
  assert.doesNotMatch(accountRoute, /auth\.admin\.deleteUser/);
  assert.match(accountRoute, /role === 'owner'/);
});

test('requireWorkspace treats a workspace with a pending deletion request as inaccessible for normal routes', () => {
  const start = supabaseSource.indexOf('export async function requireWorkspace');
  const end = supabaseSource.indexOf('export function allowPendingWorkspaceDeletion', start);
  const tenantCheck = supabaseSource.slice(start, end);
  assert.ok(end > start, 'allowPendingWorkspaceDeletion must be defined right after requireWorkspace');
  assert.match(tenantCheck, /deletion_requested_at/);
  assert.match(tenantCheck, /!req\.allowPendingWorkspaceDeletion/);
  assert.match(tenantCheck, /res\.status\(410\)/);
  assert.match(tenantCheck, /WORKSPACE_DELETION_PENDING/);

  // allowPendingWorkspaceDeletion only flips a request-scoped flag -- it must
  // never itself bypass the membership/role checks requireWorkspace and
  // requireRole still perform.
  const allowStart = end;
  const allowEnd = supabaseSource.indexOf('export function requireRole', allowStart);
  const allowFn = supabaseSource.slice(allowStart, allowEnd);
  assert.match(allowFn, /req\.allowPendingWorkspaceDeletion = true/);
  assert.doesNotMatch(allowFn, /workspace_members|supabaseAdmin/);
});

test('the scheduled purge job only touches workspaces past their scheduled_for date and outside a legal hold', () => {
  assert.match(workspacePurgeSource, /legal_hold_active/);
  assert.match(workspacePurgeSource, /\.eq\('legal_hold_active', false\)/);
  assert.match(workspacePurgeSource, /\.lte\('deletion_scheduled_for', new Date\(\)\.toISOString\(\)\)/);
  // Defensive re-check with the pure predicate, not just the query filters.
  assert.match(workspacePurgeSource, /if \(!isEligibleForPurge\(row\)\) continue;/);
  // Relies on the existing on-delete-cascade FKs rather than hand-written
  // per-table cleanup.
  assert.match(workspacePurgeSource, /\.from\('workspaces'\)\.delete\(\)\.eq\('id', workspace\.id\)/);
  // The purge audit row is written before the delete, since audit_logs also
  // cascades on workspace_id.
  const auditAt = workspacePurgeSource.indexOf("action: 'workspace.purged'");
  const deleteAt = workspacePurgeSource.indexOf(".from('workspaces').delete()");
  assert.ok(auditAt >= 0 && deleteAt > auditAt, 'purge audit must be written before the workspace row is deleted');
  // Owner account revocation only happens once no other owned workspace remains.
  assert.match(workspacePurgeSource, /shouldRevokeOwnerAccount\(count \?\? 0\)/);
  assert.match(workspacePurgeSource, /auth\.admin\.deleteUser/);
});

test('the deletion lifecycle migration adds paired, indexed columns and never reuses a bare deleted_at', () => {
  assert.match(workspaceDeletionMigration, /deletion_requested_at timestamptz/);
  assert.match(workspaceDeletionMigration, /deletion_scheduled_for timestamptz/);
  assert.match(workspaceDeletionMigration, /create index workspaces_pending_deletion_idx/);
  assert.match(workspaceDeletionMigration, /workspaces_deletion_pair_check/);
  assert.doesNotMatch(workspaceDeletionMigration, /add column deleted_at/);
});

test('the workspace purge job runs on the same existing tick as the automation runner and the Cloudflare cron, rather than a new timer', () => {
  assert.match(automationRunnerSource, /purgeScheduledWorkspaceDeletions/);
  // Both jobs run from the single runSafely() tick, not a second setInterval.
  const setIntervalCount = (automationRunnerSource.match(/setInterval/g) || []).length;
  assert.equal(setIntervalCount, 1);
  assert.match(workerSource, /purgeScheduledWorkspaceDeletions/);
});
