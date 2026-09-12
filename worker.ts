import { httpServerHandler } from 'cloudflare:node';
import twilio from 'twilio';
import { app, finalizeApp } from './server';
import { env } from './server/env';
import { processBusinessBrainQueue } from './server/ai/businessBrainWorker';
import { processAutomationRuns } from './server/automation/runner';
import { markReceptionistEngineAttached, verifyCallToken } from './server/ai/receptionistCall';
import { ReceptionistCallDO } from './server/ai/receptionistDO';

export { ReceptionistCallDO };

// Cloudflare translates Fetch API requests into Node HTTP requests so the
// existing, tested Express security and routing layer remains the API boundary.
const port = 3000;
finalizeApp();
app.listen(port);

const httpHandler = httpServerHandler({ port });

markReceptionistEngineAttached();

// Workers runtime adapter for the same signed conversation socket that the
// Node server exposes. The upgrade is validated (token + expiry) before the
// per-call session starts; per-call state lives in this isolate for the call
// duration, with the Durable Object upgrade documented as hardening.
async function handleConversationUpgrade(request: Request, runtimeEnv: unknown, _ctx: ExecutionContext): Promise<Response> {
  const twilioSignature = request.headers.get('x-twilio-signature') || '';
  const signatureUrl = new URL(request.url);
  signatureUrl.protocol = signatureUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!env.TWILIO_AUTH_TOKEN || !twilio.validateRequest(env.TWILIO_AUTH_TOKEN, twilioSignature, signatureUrl.toString(), {})) return new Response('Invalid Twilio signature', { status: 401 });
  const token = new URL(request.url).searchParams.get('token') || '';
  const auth = verifyCallToken(token);
  if (!auth) return new Response('Invalid call token', { status: 401 });
  // Forward the upgrade to the per-call Durable Object, deterministically
  // named from the CallSid. The DO owns only this call's state.
  const doNamespace = (runtimeEnv as { RECEPTIONIST_CALL?: { idFromName: (name: string) => unknown; get: (id: unknown) => { fetch: (req: Request) => Promise<Response> } } }).RECEPTIONIST_CALL;
  if (!doNamespace) return new Response('DO not available', { status: 500 });
  const doId = doNamespace.idFromName(`receptionist-call:${auth.callSid}`);
  const stub = doNamespace.get(doId);
  const doUrl = new URL(request.url);
  doUrl.pathname = '/ws';
  doUrl.searchParams.set('w', auth.workspaceId);
  doUrl.searchParams.set('c', auth.callSid);
  doUrl.searchParams.set('t', auth.toNumber);
  doUrl.searchParams.set('h', auth.snapshotHash);
  const doRequest = new Request(doUrl.toString(), request);
  return stub.fetch(doRequest);
}

export default {
  async fetch(request: Request, env2: unknown, ctx: ExecutionContext): Promise<Response | Promise<Response>> {
    const url = new URL(request.url);
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket' && url.pathname === '/api/receptionist/conversation') {
      return handleConversationUpgrade(request, env2, ctx);
    }
    return (httpHandler as { fetch: (req: Request, e: unknown, c: ExecutionContext) => Promise<Response> | Response }).fetch(request, env2, ctx);
  },
  async scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    // Skip queue work when the service role is absent instead of throwing on
    // every cron tick — the workers stay fail-closed but silent.
    const jobs: Promise<unknown>[] = [];
    if (env.SUPABASE_SERVICE_ROLE_KEY && env.OPENAI_API_KEY) jobs.push(processBusinessBrainQueue());
    if (env.SUPABASE_SERVICE_ROLE_KEY) jobs.push(processAutomationRuns());
    if (jobs.length) {
      // The queues use atomic claims and idempotency keys, so Cloudflare's
      // at-least-once cron delivery cannot duplicate a memory extraction or an
      // automation step.
      ctx.waitUntil(Promise.all(jobs));
    }
  },
};
