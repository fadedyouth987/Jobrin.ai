import { ReceptionistSession } from './receptionistCall';

type SocketAttachment = { workspaceId: string; callSid: string; toNumber: string; snapshotHash: string };
type StoredState = ReturnType<ReceptionistSession['exportState']>;

// One hibernating Durable Object per call. Only serializable state is stored;
// every wake recreates the policy engine against the signed, frozen snapshot.
export class ReceptionistCallDO {
  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/ws' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Not found', { status: 404 });
    const attachment: SocketAttachment = {
      workspaceId: url.searchParams.get('w') || '', callSid: url.searchParams.get('c') || '',
      toNumber: url.searchParams.get('t') || '', snapshotHash: url.searchParams.get('h') || '',
    };
    if (!attachment.workspaceId || !attachment.callSid || !attachment.toNumber || !attachment.snapshotHash) return new Response('Unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    (server as WebSocket & { serializeAttachment(value: unknown): void }).serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const attachment = (ws as WebSocket & { deserializeAttachment(): SocketAttachment }).deserializeAttachment();
    let event: { type?: string; voicePrompt?: string; digit?: string; digits?: string; callSid?: string; customParameters?: Record<string, string> };
    try { event = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); } catch { return; }
    if (event.type === 'setup') {
      const suppliedCallSid = event.callSid || event.customParameters?.callSid;
      const suppliedTo = event.customParameters?.toNumber;
      if ((suppliedCallSid && suppliedCallSid !== attachment.callSid) || (suppliedTo && suppliedTo !== attachment.toNumber)) ws.close(1008, 'Call identity mismatch');
      else {
        const session = new ReceptionistSession({ ...attachment, expectedSnapshotHash: attachment.snapshotHash, mode: 'receptionist', fromNumber: event.customParameters?.fromNumber || null });
        await session.loadContext();
        await this.state.storage.put('session', session.exportState());
      }
      return;
    }
    const stored = await this.state.storage.get<StoredState>('session');
    const session = new ReceptionistSession({
      ...attachment, expectedSnapshotHash: attachment.snapshotHash, mode: 'receptionist',
      fromNumber: stored?.fromNumber || event.customParameters?.fromNumber || null,
      history: stored?.history, transcript: stored?.transcript, messageTaken: stored?.messageTaken, turnIndex: stored?.turnIndex,
    });
    await session.loadContext();
    if (event.type === 'dtmf' && String(event.digit || event.digits || '') === '0') {
      if (session.snapshot?.capabilities.warmTransfer) {
        this.send(ws, { type: 'text', token: 'Let me connect you with someone who can help.', last: true });
        this.send(ws, { type: 'end', handoffData: JSON.stringify({ reasonCode: 'live-agent-handoff', reason: 'Caller pressed 0' }) });
      } else this.send(ws, { type: 'text', token: 'I cannot connect the call right now. I can arrange a callback instead.', last: true });
      return;
    }
    if (event.type !== 'prompt') return;
    const userText = String(event.voicePrompt || '').slice(0, 1000);
    if (!userText.trim()) return;
    const result = await session.handleUserText(userText).catch(() => null);
    await this.state.storage.put('session', session.exportState());
    const reply = result?.reply || 'I am having trouble with that. Please try again shortly.';
    this.send(ws, { type: 'text', token: reply, last: true });
    if (result?.handoffRequested) this.send(ws, { type: 'end', handoffData: JSON.stringify({ reasonCode: 'live-agent-handoff', reason: result.handoffReason || 'Human requested' }) });
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = (ws as WebSocket & { deserializeAttachment(): SocketAttachment }).deserializeAttachment();
    const stored = await this.state.storage.get<StoredState>('session');
    const session = new ReceptionistSession({ ...attachment, expectedSnapshotHash: attachment.snapshotHash, mode: 'receptionist', ...stored });
    await session.finalize().catch(() => null);
    ws.close(1000, 'Call complete');
  }

  private send(ws: WebSocket, payload: Record<string, unknown>) {
    try { ws.send(JSON.stringify(payload)); } catch { /* already closed */ }
  }
}
