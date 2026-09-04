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

export async function sendSms(input: { to: string; body: string; statusCallback: string }) {
  const config = requireTwilioConfig();
  const client = twilio(config.accountSid, config.authToken, { autoRetry: true, maxRetries: 2 });
  return client.messages.create({
    from: config.phoneNumber,
    to: normalizeE164(input.to),
    body: input.body,
    statusCallback: input.statusCallback,
  });
}

export function emptyMessagingResponse() {
  return new twilio.twiml.MessagingResponse().toString();
}
