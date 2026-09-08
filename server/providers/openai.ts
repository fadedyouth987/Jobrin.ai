import { env } from '../env';

// OpenAI is format-gated like the other providers: a placeholder or junk value
// must read as "not configured" so AI features fail safe to their deterministic
// fallbacks instead of making real calls that 401 on every turn. Real keys are
// long and start with sk- (including the sk-proj- project form).
export function openaiConfigured() {
  return env.OPENAI_API_KEY.startsWith('sk-') && env.OPENAI_API_KEY.length >= 20;
}