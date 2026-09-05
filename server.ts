import express from 'express';
import { env, assertProductionSecrets } from './server/env';
import { errorHandler, globalRateLimit, notFound, requestId, securityMiddleware } from './server/security';
import workspacesRouter from './server/routes/workspaces';
import crmRouter from './server/routes/crm';
import servicesRouter from './server/routes/services';
import operationsRouter from './server/routes/operations';
import dashboardRouter from './server/routes/dashboard';
import integrationsRouter from './server/routes/integrations';
import intelligenceRouter from './server/routes/intelligence';
import operatorRouter from './server/routes/operator';
import teamRouter from './server/routes/team';
import billingRouter, { stripeWebhookRouter } from './server/routes/billing';
import communicationsRouter, { twilioWebhookRouter } from './server/routes/communications';
import { twilioConfigured } from './server/providers/twilio';
import receptionistRouter, { receptionistWebhookRouter } from './server/routes/receptionist';
import businessBrainRouter from './server/routes/businessBrain';
import hiringRouter from './server/routes/hiring';
import notificationsRouter from './server/routes/notifications';
import publicRouter from './server/routes/public';
import { emailConfigured } from './server/providers/email';

assertProductionSecrets();

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number.isFinite(Number(env.TRUST_PROXY)) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);

app.use(requestId);
app.use(...securityMiddleware());
app.use(globalRateLimit);

// Stripe signature verification must see the original raw body.
app.use('/api/stripe', stripeWebhookRouter);
// Twilio signs the original form fields, so these routes must run before the global body parsers.
app.use('/api/twilio', express.urlencoded({ extended: false, limit: '64kb' }), twilioWebhookRouter);
app.use('/api/twilio', express.urlencoded({ extended: false, limit: '64kb' }), receptionistWebhookRouter);

app.use(express.json({ limit: '512kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    product: 'Jobryn',
    version: '1.0.0-saas-foundation',
    releaseStatus: env.isProduction ? 'PRODUCTION_CONFIGURATION' : 'PRE_PRODUCTION',
    authConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
    databaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    privilegedDatabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    stripeConfigured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
    aiConfigured: Boolean((env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') || env.OPENAI_API_KEY),
    businessBrainWorkerConfigured: Boolean(env.SUPABASE_SERVICE_ROLE_KEY && env.OPENAI_API_KEY),
    messagingConfigured: twilioConfigured(),
    emailConfigured: emailConfigured(),
    automationRunnerConfigured: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/workspaces', workspacesRouter);
app.use('/api/crm', crmRouter);
app.use('/api/services', servicesRouter);
app.use('/api/operations', operationsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/intelligence', intelligenceRouter);
app.use('/api/operator', operatorRouter);
app.use('/api/team', teamRouter);
app.use('/api/billing', billingRouter);
app.use('/api/communications', communicationsRouter);
app.use('/api/receptionist', receptionistRouter);
app.use('/api/business-brain', businessBrainRouter);
app.use('/api/hiring', hiringRouter);
app.use('/api/notifications', notificationsRouter);
// Public customer-facing document links require no user session and enforce
// their own strict rate limit.
app.use('/api/public', publicRouter);

export function finalizeApp() {
  app.use('/api', notFound);
  app.use(errorHandler);
}
