import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { markReceptionistEngineAttached, ReceptionistSession, verifyCallToken } from '../ai/receptionistCall';

// Node runtime adapter for the signed receptionist conversation socket
// (used by node-server / Docker). The Cloudflare runtime intercepts the same
// path in worker.ts with a WebSocketPair; both use ReceptionistSession.

const CONVERSATION_PATH = '/api/receptionist/conversation';

function send(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function runSession(ws: WebSocket, session: ReceptionistSession) {
  ws.on('message', (raw: unknown) => {
    let event: { type?: string; voicePrompt?: string; customParameters?: Record<string, string> };
    try {
      event = JSON.parse(String(raw)) as typeof event;
    } catch {
      return;
    }
    if (event.type === 'setup') {
      const from = event.customParameters?.fromNumber || event.customParameters?.From || null;
      if (from) session.fromNumber = from;
      void session.loadContext().finally(() => send(ws, { type: 'text', token: session.greeting(), last: true }));
      return;
    }
    if (event.type === 'prompt') {
      const userText = String(event.voicePrompt || '').slice(0, 1000);
      if (!userText.trim()) return;
      void session
        .handleUserText(userText)
        .then((result) => send(ws, { type: 'text', token: result.reply, last: true }))
        .catch(() => send(ws, { type: 'text', token: 'Sorry, could you say that again for me?', last: true }));
      return;
    }
    // interrupt / dtmf / media events: replies are short, nothing to cancel in v1.
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
    const auth = verifyCallToken(url.searchParams.get('token') || '');
    if (!auth) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      // HARD RULE: phone calls are always served in receptionist mode.
      const session = new ReceptionistSession({ workspaceId: auth.workspaceId, callSid: auth.callSid, mode: 'receptionist' });
      runSession(ws, session);
    });
  });
  markReceptionistEngineAttached();
}