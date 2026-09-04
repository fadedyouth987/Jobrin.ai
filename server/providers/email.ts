import { env } from '../env';

// Transactional email is provider-gated: nothing is sent (and nothing pretends
// to be sent) until EMAIL_API_KEY and EMAIL_FROM are configured on the server.
// The current implementation uses the Resend REST API directly so no SDK
// dependency is required. Swapping to Postmark/SES later only changes this file.
export function emailConfigured() {
  return env.EMAIL_API_KEY.length >= 20 && /@/.test(env.EMAIL_FROM);
}

export type EmailInput = {
  to: string;
  subject: string;
  text: string;
};

export async function sendEmail(input: EmailInput): Promise<{ delivered: boolean; error?: string }> {
  if (!emailConfigured()) return { delivered: false, error: 'EMAIL_NOT_CONFIGURED' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) return { delivered: false, error: 'INVALID_EMAIL_ADDRESS' };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.EMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });
    if (!response.ok) {
      // Never log or return provider response bodies verbatim; they can contain
      // customer addresses. A stable code is enough for the operator UI.
      return { delivered: false, error: response.status === 429 ? 'EMAIL_RATE_LIMITED' : 'EMAIL_SEND_FAILED' };
    }
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'EMAIL_SEND_FAILED' };
  }
}