import twilio from 'twilio';
import { env } from '../env';

const e164 = /^\+[1-9]\d{7,14}$/;

export function normalizeE164(value: string) {
  return value.replace(/[^\d+]/g, '');
}

export function twilioConfigured() {
  return /^AC[a-fA-F0-9]{32}$/.test(env.TWILIO_ACCOUNT_SID)
    && env.TWILIO_AUTH_TOKEN.length >= 20
    && e164.test(normalizeE164(env.TWILIO_PHONE_NUMBER));
}

export function requireTwilioConfig() {
  if (!twilioConfigured()) throw new Error('TWILIO_NOT_CONFIGURED');
  return {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    phoneNumber: normalizeE164(env.TWILIO_PHONE_NUMBER),
  };
}

export function validateTwilioWebhook(signature: string, url: string, params: Record<string, string>) {
  const { authToken } = requireTwilioConfig();
  return twilio.validateRequest(authToken, signature, url, params);
}

// ConversationRelay signs the initial WebSocket upgrade. Twilio calculates
// that signature against the public wss:// URL, including its query string.
export function validateTwilioWebSocket(signature: string, requestUrl: string) {
  const { authToken } = requireTwilioConfig();
  const url = new URL(requestUrl);
  url.protocol = 'wss:';
  return twilio.validateRequest(authToken, signature, url.toString(), {});
}

// `from` lets a message come from the workspace's own Twilio number (e.g. the
// number the caller rang) instead of the account default. It must be a number
// on this Twilio account; anything that is not valid E.164 falls back.
export async function sendSms(input: { to: string; body: string; statusCallback?: string; from?: string | null }) {
  const config = requireTwilioConfig();
  const client = twilio(config.accountSid, config.authToken, { autoRetry: true, maxRetries: 2 });
  const from = input.from && e164.test(normalizeE164(input.from)) ? normalizeE164(input.from) : config.phoneNumber;
  return client.messages.create({
    from,
    to: normalizeE164(input.to),
    body: input.body,
    ...(input.statusCallback ? { statusCallback: input.statusCallback } : {}),
  });
}

export function emptyMessagingResponse() {
  return new twilio.twiml.MessagingResponse().toString();
}
