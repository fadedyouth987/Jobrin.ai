import crypto from 'node:crypto';
import { createClient, type User } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env';

const url = env.SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = env.SUPABASE_ANON_KEY || 'missing-anon-key';
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role';

export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function createUserClient(accessToken: string) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'staff' | 'approver' | 'creator' | 'viewer';

export type AuthenticatedRequest = Request & {
  auth?: { userId: string; accessToken: string; email: string | null; user: User; aal: 'aal1' | 'aal2' | null };
  workspaceId?: string;
  workspaceRole?: WorkspaceRole;
  requestId?: string;
};

export function readAal(token: string): 'aal1' | 'aal2' | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { aal?: string };
    return payload.aal === 'aal2' ? 'aal2' : payload.aal === 'aal1' ? 'aal1' : null;
  } catch {
    return null;
  }
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });

  const authClient = createUserClient(token);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'INVALID_SESSION' });
  if (env.requireEmailVerification && data.user.email && !data.user.email_confirmed_at) {
    return res.status(403).json({ error: 'EMAIL_VERIFICATION_REQUIRED' });
  }

  req.auth = {
    userId: data.user.id,
    accessToken: token,
    email: data.user.email ?? null,
    user: data.user,
    aal: readAal(token),
  };
  next();
}

export async function requireWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  const workspaceId = String(req.headers['x-workspace-id'] || '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(workspaceId)) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

  // Tenant membership is verified through the caller's JWT and RLS. This is
  // both least-privilege and usable in development without a service-role key.
  const db = createUserClient(req.auth.accessToken);
  const { data, error } = await db
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', req.auth.userId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'TENANT_CHECK_FAILED' });
  if (!data) return res.status(403).json({ error: 'WORKSPACE_ACCESS_DENIED' });

  req.workspaceId = workspaceId;
  req.workspaceRole = data.role as WorkspaceRole;
  next();
}

export function requireRole(...allowed: WorkspaceRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.workspaceRole || !allowed.includes(req.workspaceRole)) {
      return res.status(403).json({ error: 'INSUFFICIENT_ROLE' });
    }
    next();
  };
}

export function requireActiveSubscription(featureKey?: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.workspaceId || !req.auth) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

    const db = createUserClient(req.auth.accessToken);
    const { data: subscription, error } = await db.rpc('get_workspace_access_state', {
      target_workspace: req.workspaceId,
    }).maybeSingle();
    if (error) return res.status(500).json({ error: 'SUBSCRIPTION_CHECK_FAILED' });
    if (!subscription) return res.status(402).json({ error: 'SUBSCRIPTION_REQUIRED' });
    const access = subscription as { status: string; trial_ends_at: string | null; grace_period_ends_at: string | null };

    const now = Date.now();
    const trialActive = access.status === 'trialing' && Boolean(access.trial_ends_at) && new Date(access.trial_ends_at!).getTime() > now;
    const billingActive = access.status === 'active';
    const graceActive = access.status === 'past_due' && Boolean(access.grace_period_ends_at) && new Date(access.grace_period_ends_at!).getTime() > now;
    if (!trialActive && !billingActive && !graceActive) {
      return res.status(402).json({ error: 'SUBSCRIPTION_REQUIRED', status: access.status, trialEndsAt: access.trial_ends_at });
    }

    if (featureKey) {
      const { data: entitlement, error: entitlementError } = await db
        .from('subscription_entitlements')
        .select('enabled,limit_value')
        .eq('workspace_id', req.workspaceId)
        .eq('feature_key', featureKey)
        .maybeSingle();
      if (entitlementError) return res.status(500).json({ error: 'ENTITLEMENT_CHECK_FAILED' });
      if (!entitlement?.enabled) return res.status(403).json({ error: 'FEATURE_NOT_INCLUDED', feature: featureKey });
      (req as AuthenticatedRequest & { entitlementLimit?: number | null }).entitlementLimit = entitlement.limit_value == null ? null : Number(entitlement.limit_value);
    }

    next();
  };
}

export function requireSensitiveAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!env.requireAal2Sensitive) return next();
  if (req.auth?.aal !== 'aal2') return res.status(403).json({ error: 'MFA_REQUIRED', requiredAal: 'aal2' });
  next();
}

export async function consumeWorkspaceUsage(
  req: AuthenticatedRequest,
  metricKey: string,
  quantity = 1,
): Promise<{ allowed: boolean; used?: number; limit?: number }> {
  if (!req.workspaceId || !req.requestId) return { allowed: false };
  const { data: entitlement, error } = await supabaseAdmin
    .from('subscription_entitlements')
    .select('enabled,limit_value')
    .eq('workspace_id', req.workspaceId)
    .eq('feature_key', metricKey)
    .maybeSingle();
  if (error || !entitlement?.enabled || entitlement.limit_value == null) return { allowed: false };

  const limit = Number(entitlement.limit_value);
  const { data, error: consumeError } = await supabaseAdmin.rpc('consume_workspace_usage', {
    target_workspace: req.workspaceId,
    target_metric: metricKey,
    target_quantity: quantity,
    target_limit: limit,
    target_idempotency_key: `${metricKey}:${crypto.randomUUID()}`,
  });
  if (consumeError) {
    if (/USAGE_LIMIT_EXCEEDED/i.test(consumeError.message)) return { allowed: false, limit };
    throw new Error(`USAGE_METER_FAILED:${consumeError.message}`);
  }
  return { allowed: true, used: Number(data ?? 0), limit };
}

export async function writeAudit(
  req: AuthenticatedRequest,
  action: string,
  entityType?: string,
  entityId?: string,
  details: Record<string, unknown> = {},
  severity: 'info' | 'warning' | 'critical' = 'info',
) {
  // Audit rows are trusted server records and must never be written through a
  // browser/public key. Production startup requires this key; local development
  // reports the missing capability through /api/health instead of faking writes.
  if (!req.workspaceId || !req.auth || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  await supabaseAdmin.from('audit_logs').insert({
    workspace_id: req.workspaceId,
    actor_user_id: req.auth.userId,
    action,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
    details: { ...details, requestId: req.requestId },
    ip_address: req.ip,
    severity,
  });
}
