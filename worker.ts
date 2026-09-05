import { httpServerHandler } from 'cloudflare:node';
import { app, finalizeApp } from './server';
import { env } from './server/env';
import { processBusinessBrainQueue } from './server/ai/businessBrainWorker';
import { processAutomationRuns } from './server/automation/runner';
import { markReceptionistEngineAttached, ReceptionistSession, verifyCallToken } from './server/ai/receptionistCall';

// Cloudflare translates Fetch API requests into Node HTTP requests so the
// existing, tested Express security and routing layer remains the API boundary.
const port = 3000;
finalizeApp();
app.listen(port);

const httpHandler = httpServerHandler({ port });

markReceptionistEngineAttached();

function safeSend(ws: { send: (data: string) => void }, payload: Record<string, unknown>) {
  try { ws.send(JSON.stringify(payload)); } catch { /* socket already closed */ }
}

// Workers runtime adapter for the same signed conversation socket that the
// Node server exposes. The upgrade is validated (token + expiry) before the
// per-call session starts; per-call state lives in this isolate for the call
// duration, with the Durable Object upgrade documented as hardening.
async function handleConversationUpgrade(request: Request, ctx: ExecutionContext): Promise<Response> {
  try {
    return await upgradeConversation(request, ctx);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: 'error', message: 'receptionist upgrade failed', error: message }));
    return new Response(`Conversation upgrade failed: ${message}`, { status: 500 });
  }
}

async function upgradeConversation(request: Request, ctx: ExecutionContext): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') || '';
  const auth = verifyCallToken(token);
  if (!auth) return new Response('Invalid call token', { status: 401 });
  // workerd returns numeric-keyed sockets: 0 = client, 1 = server.
  const pair = new WebSocketPair() as unknown as Record<number, unknown>;
  const sockets = Object.values(pair);
  const client = sockets[0] as unknown;
  const server = sockets[1] as {
    accept: () => void;
    send: (data: string) => void;
    addEventListener: (type: string, listener: (event: MessageEvent | CloseEvent) => void) => void;
  };
  server.accept();
  // HARD RULE: phone calls are always served in receptionist mode.
  const session = new ReceptionistSession({ workspaceId: auth.workspaceId, callSid: auth.callSid, mode: 'receptionist' });
  server.addEventListener('message', (event) => {
    void (async () => {
      let parsed: { type?: string; voicePrompt?: string; customParameters?: Record<string, string> };
      try { parsed = JSON.parse(String((event as MessageEvent).data)) as typeof parsed; } catch { return; }
      if (parsed.type === 'setup') {
        const from = parsed.customParameters?.fromNumber || parsed.customParameters?.From || null;
        if (from) session.fromNumber = from;
        await session.loadContext().finally(() => undefined);
        safeSend(server, { type: 'text', token: session.greeting(), last: true });
        return;
      }
      if (parsed.type === 'prompt') {
        const userText = String(parsed.voicePrompt || '').slice(0, 1000);
        if (!userText.trim()) return;
        const result = await session.handleUserText(userText).catch(() => null);
        safeSend(server, { type: 'text', token: result?.reply || 'Sorry, could you say that again for me?', last: true });
        return;
      }
    })();
  });
  server.addEventListener('close', () => { ctx.waitUntil(session.finalize().then(() => undefined, () => undefined)); });
  return new Response(null, { status: 101, webSocket: client as never });
}

export default {
  async fetch(request: Request, env2: unknown, ctx: ExecutionContext): Promise<Response | Promise<Response>> {
    const url = new URL(request.url);
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket' && url.pathname === '/api/receptionist/conversation') {
      return handleConversationUpgrade(request, ctx);
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