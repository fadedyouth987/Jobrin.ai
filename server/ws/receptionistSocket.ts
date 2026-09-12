import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import twilio from 'twilio';
import { markReceptionistEngineAttached, ReceptionistSession, verifyCallToken } from '../ai/receptionistCall';
import { env } from '../env';

// Node runtime adapter for the signed receptionist conversation socket
// (used by node-server / Docker). The Cloudflare runtime intercepts the same
// path in worker.ts with a WebSocketPair; both use ReceptionistSession.

const CONVERSATION_PATH = '/api/receptionist/conversation';

function send(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function runSession(ws: WebSocket, session: ReceptionistSession, identity: { callSid: string; toNumber: string }) {
  let contextReady: Promise<void> = Promise.resolve();
  ws.on('message', (raw: unknown) => {
    let event: { type?: string; voicePrompt?: string; customParameters?: Record<string, string> };
    try {
      event = JSON.parse(String(raw)) as typeof event;
    } catch {
      return;
    }
    if (event.type === 'setup') {
      const from = event.customParameters?.fromNumber || event.customParameters?.From || null;
      const setupCallSid = event.customParameters?.callSid;
      const setupTo = event.customParameters?.toNumber;
      if ((setupCallSid && setupCallSid !== identity.callSid) || (setupTo && setupTo !== identity.toNumber)) {
        ws.close(1008, 'Call identity mismatch');
        return;
      }
      if (from) session.fromNumber = from;
      contextReady = session.loadContext();
      return;
    }
    if (event.type === 'prompt') {
      const userText = String(event.voicePrompt || '').slice(0, 1000);
      if (!userText.trim()) return;
      void contextReady
        .then(() => session.handleUserText(userText))
        .then((result) => {
          send(ws, { type: 'text', token: result.reply, last: true });
          if (result.handoffRequested) send(ws, { type: 'end', handoffData: JSON.stringify({ reasonCode: 'live-agent-handoff', reason: result.handoffReason || 'Human requested' }) });
        })
        .catch(() => send(ws, { type: 'text', token: 'Sorry, could you say that again for me?', last: true }));
      return;
    }
    if (event.type === 'dtmf' && String((event as { digit?: string; digits?: string }).digit || (event as { digits?: string }).digits || '') === '0') {
      void contextReady.then(() => {
        if (session.snapshot?.capabilities.warmTransfer) {
          send(ws, { type: 'text', token: 'Let me connect you with someone who can help.', last: true });
          send(ws, { type: 'end', handoffData: JSON.stringify({ reasonCode: 'live-agent-handoff', reason: 'Caller pressed 0' }) });
        } else send(ws, { type: 'text', token: 'I cannot connect the call right now. I can arrange a callback instead.', last: true });
      });
    }
  });
  ws.on('close', () => { void session.finalize(); });
  ws.on('error', () => { void session.finalize(); });
}

export function attachReceptionistWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(request.url || '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== CONVERSATION_PATH) return;
    const signature = String(request.headers['x-twilio-signature'] || '');
    const publicUrl = new URL(request.url || '/', env.APP_URL);
    publicUrl.protocol = publicUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    if (!env.TWILIO_AUTH_TOKEN || !twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, publicUrl.toString(), {})) {
      socket.destroy();
      return;
    }
    const auth = verifyCallToken(url.searchParams.get('token') || '');
    if (!auth) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      // HARD RULE: phone calls are always served in receptionist mode.
      const session = new ReceptionistSession({ workspaceId: auth.workspaceId, callSid: auth.callSid, expectedSnapshotHash: auth.snapshotHash, mode: 'receptionist' });
      runSession(ws, session, { callSid: auth.callSid, toNumber: auth.toNumber });
    });
  });
  markReceptionistEngineAttached();
}
