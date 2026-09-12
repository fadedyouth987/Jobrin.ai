import { ReceptionistSession } from './receptionistCall';

type CallAttachment = { workspaceId: string; callSid: string; fromNumber: string | null };
type RelayEvent = { type?: string; callSid?: string; voicePrompt?: string; customParameters?: Record<string, string> };

// One SQLite-backed, hibernating Durable Object per Twilio Call SID.
export class ReceptionistCallDO {
  private session: ReceptionistSession | null = null;

  constructor(private state: DurableObjectState, private env: unknown) {
    void this.state.blockConcurrencyWhile(async () => {
      this.state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS call_state (
        id INTEGER PRIMARY KEY CHECK (id = 1), workspace_id TEXT NOT NULL, call_sid TEXT NOT NULL,
        from_number TEXT, history_json TEXT NOT NULL DEFAULT '[]', transcript_json TEXT NOT NULL DEFAULT '[]',
        turn_number INTEGER NOT NULL DEFAULT 0, message_taken INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL
      )`);
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/ws') return new Response('Not found', { status: 404 });
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('w') || '';
    const callSid = url.searchParams.get('c') || '';
    if (!workspaceId || !callSid) return new Response('Missing call binding', { status: 400 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const attachment: CallAttachment = { workspaceId, callSid, fromNumber: null };
    this.state.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    this.ensureState(attachment);
    await this.state.storage.setAlarm(Date.now() + 30 * 60_000);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let event: RelayEvent;
    try { event = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); } catch { return; }
    const attachment = ws.deserializeAttachment() as CallAttachment | null;
    if (!attachment) { ws.close(1008, 'Call binding missing'); return; }
    if (event.type === 'setup' && event.callSid && event.callSid !== attachment.callSid) {
      ws.close(1008, 'Call SID mismatch'); return;
    }
    if (event.type === 'setup') {
      const fromNumber = event.customParameters?.fromNumber || event.customParameters?.From || attachment.fromNumber;
      const next = { ...attachment, fromNumber: fromNumber || null };
      ws.serializeAttachment(next);
      this.ensureState(next);
      const session = await this.restoreSession(next);
      await session.loadContext();
      this.persistSession(session, next);
      // ConversationRelay already spoke the signed TwiML welcome greeting.
      // Loading context here prepares the first caller turn without repeating it.
      return;
    }
    if (event.type !== 'prompt') return;
    const text = String(event.voicePrompt || '').trim().slice(0, 1000);
    if (!text) return;
    const session = await this.restoreSession(attachment);
    await session.loadContext();
    const result = await session.handleUserText(text).catch(() => null);
    if (!result) { this.send(ws, { type: 'text', token: 'Sorry, could you say that again for me?', last: true }); return; }
    this.persistSession(session, attachment);
    this.send(ws, { type: 'text', token: result.reply, last: true });
    if (result.handoff) this.send(ws, { type: 'end-session', handoffData: JSON.stringify({ kind: 'warm_transfer', reason: result.handoff.reason }) });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as CallAttachment | null;
    if (!attachment) return;
    const session = await this.restoreSession(attachment);
    // Phase 0 does not retain caller speech or summaries by default.
    await session.finalize(false);
    await this.state.storage.deleteAll();
  }

  async alarm(): Promise<void> { await this.state.storage.deleteAll(); }

  private ensureState(attachment: CallAttachment) {
    this.state.storage.sql.exec('INSERT OR IGNORE INTO call_state (id, workspace_id, call_sid, from_number, expires_at) VALUES (1, ?, ?, ?, ?)', attachment.workspaceId, attachment.callSid, attachment.fromNumber, Date.now() + 30 * 60_000);
  }

  private async restoreSession(attachment: CallAttachment): Promise<ReceptionistSession> {
    if (this.session) return this.session;
    const row = this.state.storage.sql.exec<{ history_json: string; transcript_json: string; turn_number: number; message_taken: number; from_number: string | null }>('SELECT history_json, transcript_json, turn_number, message_taken, from_number FROM call_state WHERE id = 1').one();
    const session = new ReceptionistSession({ workspaceId: attachment.workspaceId, callSid: attachment.callSid, fromNumber: row.from_number || attachment.fromNumber, history: JSON.parse(row.history_json) });
    session.restoreForCall(JSON.parse(row.transcript_json), row.turn_number, Boolean(row.message_taken));
    this.session = session;
    return session;
  }

  private persistSession(session: ReceptionistSession, attachment: CallAttachment) {
    const snapshot = session.snapshotForCall();
    this.state.storage.sql.exec('UPDATE call_state SET from_number = ?, history_json = ?, transcript_json = ?, turn_number = ?, message_taken = ?, expires_at = ? WHERE id = 1', attachment.fromNumber, JSON.stringify(snapshot.history), JSON.stringify(snapshot.transcript), snapshot.turnNumber, snapshot.messageTaken ? 1 : 0, Date.now() + 30 * 60_000);
  }

  private send(ws: WebSocket, payload: Record<string, unknown>) { try { ws.send(JSON.stringify(payload)); } catch { /* socket closed */ } }
}
