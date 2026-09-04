import 'dotenv/config';
import { issueCallToken } from './server/ai/receptionistCall';

// Smoke test: sign a call token, open the receptionist conversation socket
// and walk one full turn cycle. Usage: tsx smoke-ws.mts [ws-base]
const base = process.argv[2] ?? 'ws://localhost:3000';
const workspaceId = '11111111-2222-3333-4444-555555555555';
const callSid = `CAsmoke${Date.now()}`;
const token = issueCallToken(workspaceId, callSid);

const ws = new WebSocket(`${base}/api/receptionist/conversation?token=${encodeURIComponent(token)}`);

function waitFor<T>(label: string, predicate: (value: any) => boolean, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${label}: timeout`)); }, timeoutMs);
    const listener = (event: MessageEvent) => {
      let data: any;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      if (predicate(data)) { cleanup(); clearTimeout(timer); resolve(data as T); }
    };
    const closer = () => { cleanup(); clearTimeout(timer); reject(new Error(`${label}: socket closed`)); };
    function cleanup() { ws.removeEventListener('message', listener); ws.removeEventListener('close', closer); }
    ws.addEventListener('message', listener);
    ws.addEventListener('close', closer);
  });
}

const fail = (message: string) => { console.error(`SMOKE FAIL: ${message}`); process.exit(1); };

ws.addEventListener('error', () => fail('socket error'));
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'setup', callSid, customParameters: { fromNumber: '+61412345678' } }));
});

const greeting = await waitFor<{ type: string; token: string }>('greeting', (m) => m.type === 'text');
console.log(`[1] greeting: "${greeting.token.slice(0, 60)}"`);

ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'Do you fix burst pipes in Salisbury?' }));
const reply1 = await waitFor<{ type: string; token: string }>('reply 1', (m) => m.type === 'text');
console.log(`[2] reply: "${reply1.token.slice(0, 80)}"`);
if (!/take a message/i.test(reply1.token)) fail('expected message-take fallback when AI key is absent');

ws.send(JSON.stringify({ type: 'prompt', voicePrompt: 'Yes, call me on 0412 345 678 about a burst pipe' }));
const reply2 = await waitFor<{ type: string; token: string }>('reply 2', (m) => m.type === 'text');
console.log(`[3] reply: "${reply2.token.slice(0, 80)}"`);
if (!/passed that to the team|passed your message/i.test(reply2.token)) fail('expected message-take confirmation');

try {
  const bad = new WebSocket(`${base}/api/receptionist/conversation?token=v1.bogus.bogus`);
  const result = await new Promise<string>((resolve) => {
    bad.addEventListener('error', () => resolve('REJECTED'));
    bad.addEventListener('open', () => resolve('ACCEPTED'));
    setTimeout(() => resolve('TIMEOUT'), 8000);
  });
  if (result !== 'REJECTED') fail(`bad token was not rejected (${result})`);
  console.log('[4] invalid token rejected: OK');
} catch {
  console.log('[4] invalid token rejected: OK (exception path)');
}

console.log('SMOKE PASS');
process.exit(0);