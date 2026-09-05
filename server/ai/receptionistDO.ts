// Durable Object for the AI receptionist: one DO per call, deterministically
// named from the Twilio CallSid. Owns only that call's state — the turn
// ledger, active tool action, caller consent state and handoff state. Uses
// the hibernating WebSocket API so the DO stays alive without billing for
// idle time, and SQLite for durable call state per the architecture doc.
//
// In the local Node runtime, the same session logic runs via
// server/ws/receptionistSocket.ts (no DO available).

import { ReceptionistSession } from './receptionistCall';

export class ReceptionistCallDO {
  private session: ReceptionistSession | null = null;

  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      return this.handleWebSocket(request);
    }
    return new Response('Not found', { status: 404 });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const sockets = Object.values(new WebSocketPair() as unknown as Record<number, unknown>);
    const client = sockets[0] as WebSocket;
    const server = sockets[1] as {
      accept: () => void;
      send: (data: string) => void;
      addEventListener: (type: string, listener: (event: MessageEvent | CloseEvent) => void) => void;
    };

    // Hibernating WebSocket API: the DO stays alive between messages without
    // billing, and call state persists in SQLite across hibernation cycles.
    this.state.acceptWebSocket(server as never);

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('w') || '';
    const callSid = url.searchParams.get('c') || '';
    const fromNumber = url.searchParams.get('from') || null;

    const session = new ReceptionistSession({ workspaceId, callSid, fromNumber, mode: 'receptionist' });
    this.session = session;

    server.addEventListener('message', (event) => {
      void (async () => {
        let parsed: { type?: string; voicePrompt?: string; customParameters?: Record<string, string> };
        try { parsed = JSON.parse(String((event as MessageEvent).data)) as typeof parsed; } catch { return; }
        if (parsed.type === 'setup') {
          const from = parsed.customParameters?.fromNumber || parsed.customParameters?.From || null;
          if (from) session.fromNumber = from;
          await session.loadContext().finally(() => undefined);
          const greeting = session.greeting();
          this.sendSafe(server, greeting);
          return;
        }
        if (parsed.type === 'prompt') {
          const userText = String(parsed.voicePrompt || '').slice(0, 1000);
          if (!userText.trim()) return;
          const result = await session.handleUserText(userText).catch(() => null);
          const reply = (result && result.reply) || 'Sorry, could you say that again for me?';
          this.sendSafe(server, { type: 'text', token: reply, last: true });
          return;
        }
      })();
    });

    server.addEventListener('close', () => {
      void session.finalize().then(() => undefined, () => undefined);
    });

    return new Response(null, { status: 101, webSocket: client as never });
  }

  private sendSafe(ws: { send: (data: string) => void }, payload: Record<string, unknown>): void {
    try { ws.send(JSON.stringify(payload)); } catch { /* socket closed */ }
  }
}