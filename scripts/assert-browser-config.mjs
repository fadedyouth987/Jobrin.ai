import { readFileSync } from 'node:fs';

const target = process.argv[2];

if (!['staging', 'production'].includes(target)) {
  throw new Error('Usage: node scripts/assert-browser-config.mjs <staging|production>');
}

// Vite loads .env for the bundle, but plain Node scripts do not. Accept the
// project's .env as a build-environment source so the gate reflects the same
// values Vite will embed, while still rejecting placeholders.
try {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // No .env file: the operator must export values in the build environment.
}

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const missing = required.filter((name) => {
  const value = process.env[name] || '';
  return !value || /YOUR_|REPLACE|missing/i.test(value);
});

if (missing.length) {
  throw new Error(`${target} browser configuration is missing: ${missing.join(', ')}. Provide these publishable values to the build environment; Wrangler runtime vars cannot add them to an already-built Vite bundle.`);
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(process.env.VITE_SUPABASE_URL)) {
  throw new Error('VITE_SUPABASE_URL must be an HTTPS Supabase project URL.');
}
