import Stripe from 'stripe';
import { env } from '../env';

// Stripe is format-gated like Twilio and email: a placeholder or junk value in
// the environment must read as "not configured" so routes fail closed with a
// clean 503 instead of constructing a client that 500s on every real call.
// Valid keys are the secret sk_test_/sk_live_ form or the restricted
// rk_test_/rk_live_ form (the same shape assertProductionSecrets enforces).
const SECRET_KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/;
const WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]{10,}$/;

export function stripeSecretConfigured() {
  return SECRET_KEY_PATTERN.test(env.STRIPE_SECRET_KEY);
}

export function stripeWebhookConfigured() {
  return WEBHOOK_SECRET_PATTERN.test(env.STRIPE_WEBHOOK_SECRET);
}

export function stripeConfigured() {
  return stripeSecretConfigured() && stripeWebhookConfigured();
}

export const stripe = stripeSecretConfigured()
  ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' })
  : null;