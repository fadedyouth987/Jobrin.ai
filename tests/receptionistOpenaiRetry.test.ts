import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openaiChat } from '../server/ai/receptionistCall';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'server', 'ai', 'receptionistCall.ts'), 'utf8');

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const chatBody = { choices: [{ message: { content: 'Real assistant reply', tool_calls: undefined } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };

test('a transient 429 is retried and the real reply is returned, not the fallback', async () => {
  const { env } = await import('../server/env');
  const originalKey = env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  env.OPENAI_API_KEY = 'sk-test-0000000000000000000000';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return jsonResponse(429, { error: 'rate_limited' });
    return jsonResponse(200, chatBody);
  }) as unknown as typeof fetch;
  try {
    const turn = await openaiChat([{ role: 'user', content: 'Hello' }]);
    assert.equal(calls, 2);
    assert.equal(turn.configured, true);
    assert.equal(turn.message?.content, 'Real assistant reply');
  } finally {
    env.OPENAI_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test('a transient 500 is retried and eventually succeeds', async () => {
  const { env } = await import('../server/env');
  const originalKey = env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  env.OPENAI_API_KEY = 'sk-test-0000000000000000000000';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls <= 2) return jsonResponse(503, { error: 'unavailable' });
    return jsonResponse(200, chatBody);
  }) as unknown as typeof fetch;
  try {
    const turn = await openaiChat([{ role: 'user', content: 'Hello' }]);
    assert.equal(calls, 3);
    assert.equal(turn.message?.content, 'Real assistant reply');
  } finally {
    env.OPENAI_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test('retries are bounded: a persistent 429 eventually throws instead of retrying forever', async () => {
  const { env } = await import('../server/env');
  const originalKey = env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  env.OPENAI_API_KEY = 'sk-test-0000000000000000000000';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse(429, { error: 'rate_limited' });
  }) as unknown as typeof fetch;
  try {
    await assert.rejects(() => openaiChat([{ role: 'user', content: 'Hello' }]), /OPENAI_CHAT_FAILED:429/);
    // Initial attempt + bounded retries, never unbounded.
    assert.ok(calls <= 3, `expected at most 3 attempts, saw ${calls}`);
  } finally {
    env.OPENAI_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test('a permanent 4xx (not 429) fails immediately without retrying', async () => {
  const { env } = await import('../server/env');
  const originalKey = env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  env.OPENAI_API_KEY = 'sk-test-0000000000000000000000';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse(400, { error: 'bad_request' });
  }) as unknown as typeof fetch;
  try {
    await assert.rejects(() => openaiChat([{ role: 'user', content: 'Hello' }]), /OPENAI_CHAT_FAILED:400/);
    assert.equal(calls, 1);
  } finally {
    env.OPENAI_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test('a permanent 401 (invalid API key) fails immediately without retrying', async () => {
  const { env } = await import('../server/env');
  const originalKey = env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  env.OPENAI_API_KEY = 'sk-test-0000000000000000000000';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse(401, { error: 'invalid_api_key' });
  }) as unknown as typeof fetch;
  try {
    await assert.rejects(() => openaiChat([{ role: 'user', content: 'Hello' }]), /OPENAI_CHAT_FAILED:401/);
    assert.equal(calls, 1);
  } finally {
    env.OPENAI_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test('retry delay stays short — this happens on a live phone call', () => {
  assert.match(source, /OPENAI_CHAT_RETRY_DELAY_MS\s*=\s*250/);
  assert.match(source, /OPENAI_CHAT_MAX_RETRIES\s*=\s*2/);
});
