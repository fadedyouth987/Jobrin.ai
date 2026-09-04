import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireWorkspace, type AuthenticatedRequest, writeAudit } from '../supabase';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('hiring.core'));
router.use(requireRole('owner', 'admin', 'manager'));

const openingInput = z.object({
  title: z.string().trim().min(2).max(160),
  trade: z.string().trim().max(100).default(''),
  location: z.string().trim().max(160).default(''),
  employment_type: z.enum(['full_time', 'part_time', 'casual', 'apprenticeship', 'subcontractor']),
  summary: z.string().trim().max(5000).default(''),
  requirements: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  status: z.enum(['draft', 'open', 'paused']).default('draft'),
});

const candidateInput = z.object({
  full_name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  suburb: z.string().trim().max(100).default(''),
  experience_summary: z.string().trim().max(5000).default(''),
  licences: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  availability: z.string().trim().max(500).default(''),
  source: z.string().trim().min(1).max(100).default('direct'),
  privacy_notice_version: z.string().trim().min(1).max(80),
  consent_captured_at: z.string().datetime({ offset: true }),
});

const stages = ['applied', 'screening', 'interview', 'trial', 'offered', 'hired', 'rejected', 'withdrawn'] as const;
type ApplicationStage = (typeof stages)[number];
const applicationInput = z.object({
  job_opening_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  notes: z.string().trim().max(5000).default(''),
});

const transitions: Record<ApplicationStage, ApplicationStage[]> = {
  applied: ['screening', 'rejected', 'withdrawn'],
  screening: ['interview', 'rejected', 'withdrawn'],
  interview: ['trial', 'offered', 'rejected', 'withdrawn'],
  trial: ['offered', 'rejected', 'withdrawn'],
  offered: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: ['screening'],
  withdrawn: ['screening'],
};

export function canTransitionApplication(from: ApplicationStage, to: ApplicationStage) {
  return transitions[from].includes(to);
}

router.get('/openings', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const [{ data: openings, error: openingError }, { data: applications, error: applicationError }] = await Promise.all([
    db.from('job_openings').select('id,title,trade,location,employment_type,summary,requirements,status,created_at,updated_at').eq('workspace_id', req.workspaceId!).order('created_at', { ascending: false }),
    db.from('candidate_applications').select('job_opening_id,stage').eq('workspace_id', req.workspaceId!),
  ]);
  if (openingError || applicationError) return res.status(500).json({ error: 'HIRING_OPENINGS_LOAD_FAILED' });
  const counts = new Map<string, number>();
  for (const application of applications ?? []) counts.set(application.job_opening_id, (counts.get(application.job_opening_id) ?? 0) + 1);
  res.json({ openings: (openings ?? []).map((opening) => ({ ...opening, application_count: counts.get(opening.id) ?? 0 })) });
}));

router.post('/openings', validateBody(openingInput), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('job_openings').insert({ ...req.body, workspace_id: req.workspaceId!, created_by: req.auth!.userId }).select('*').single();
  if (error) return res.status(400).json({ error: 'HIRING_OPENING_CREATE_FAILED', message: error.message });
  await writeAudit(req, 'hiring.opening.created', 'job_opening', data.id, { status: data.status, trade: data.trade });
  res.status(201).json({ opening: data });
}));

router.get('/applications', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const openingId = String(req.query.opening_id || '').trim();
  let query = db.from('candidate_applications')
    .select('id,job_opening_id,candidate_id,stage,notes,stage_changed_at,created_at,job_openings(title,trade,location,status),candidates(full_name,email,phone,suburb,experience_summary,licences,availability,source,consent_captured_at)')
    .eq('workspace_id', req.workspaceId!)
    .order('created_at', { ascending: false })
    .limit(250);
  if (openingId) {
    if (!/^[0-9a-fA-F-]{36}$/.test(openingId)) return res.status(400).json({ error: 'INVALID_OPENING_ID' });
    query = query.eq('job_opening_id', openingId);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'HIRING_APPLICATIONS_LOAD_FAILED' });
  res.json({ applications: data ?? [] });
}));

router.post('/candidates', validateBody(candidateInput), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const payload = { ...req.body, email: req.body.email?.toLowerCase() || null, phone: req.body.phone || null, workspace_id: req.workspaceId!, created_by: req.auth!.userId };
  const { data, error } = await db.from('candidates').insert(payload).select('*').single();
  if (error) {
    if (/duplicate/i.test(error.message)) return res.status(409).json({ error: 'CANDIDATE_ALREADY_EXISTS' });
    return res.status(400).json({ error: 'CANDIDATE_CREATE_FAILED', message: error.message });
  }
  await writeAudit(req, 'hiring.candidate.created', 'candidate', data.id, { source: data.source, consentCaptured: true });
  res.status(201).json({ candidate: data });
}));

router.post('/applications', validateBody(applicationInput), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('candidate_applications').insert({ ...req.body, workspace_id: req.workspaceId!, created_by: req.auth!.userId }).select('*').single();
  if (error) {
    if (/duplicate/i.test(error.message)) return res.status(409).json({ error: 'CANDIDATE_ALREADY_APPLIED' });
    return res.status(400).json({ error: 'HIRING_APPLICATION_CREATE_FAILED', message: error.message });
  }
  await writeAudit(req, 'hiring.application.created', 'candidate_application', data.id, { openingId: data.job_opening_id, candidateId: data.candidate_id });
  res.status(201).json({ application: data });
}));

router.patch('/applications/:id/notes', validateBody(z.object({ notes: z.string().trim().max(5000) })), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('candidate_applications')
    .update({ notes: req.body.notes, updated_at: new Date().toISOString() })
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'HIRING_APPLICATION_NOTES_UPDATE_FAILED', message: error.message });
  if (!data) return res.status(404).json({ error: 'HIRING_APPLICATION_NOT_FOUND' });
  await writeAudit(req, 'hiring.application.notes.updated', 'candidate_application', data.id);
  res.json({ application: data });
}));

router.patch('/applications/:id/stage', validateBody(z.object({ stage: z.enum(stages), notes: z.string().trim().max(5000).optional() })), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: current, error: readError } = await db.from('candidate_applications').select('id,stage,notes').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (readError) return res.status(500).json({ error: 'HIRING_APPLICATION_READ_FAILED' });
  if (!current) return res.status(404).json({ error: 'HIRING_APPLICATION_NOT_FOUND' });
  const from = current.stage as ApplicationStage;
  const to = req.body.stage as ApplicationStage;
  if (!canTransitionApplication(from, to)) return res.status(409).json({ error: 'INVALID_APPLICATION_TRANSITION', from, to });
  const notes = req.body.notes ?? current.notes;
  if (to === 'rejected' && !notes.trim()) return res.status(400).json({ error: 'REJECTION_REASON_REQUIRED', message: 'Add a factual manager note before recording a rejection.' });
  const { data, error } = await db.from('candidate_applications').update({ stage: to, notes, stage_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('workspace_id', req.workspaceId!).eq('id', current.id).select('*').single();
  if (error) return res.status(400).json({ error: 'HIRING_APPLICATION_UPDATE_FAILED', message: error.message });
  await writeAudit(req, 'hiring.application.stage.changed', 'candidate_application', data.id, { from, to });
  res.json({ application: data });
}));

export default router;
