import { readFileSync } from 'node:fs';

const target = process.argv[2];

if (!['staging', 'production'].includes(target)) {
  throw new Error('Usage: node scripts/assert-browser-config.mjs <staging|production>');
}

// Vite loads .env for the bundle, but plain Node scripts do not. The base
// .env still populates any values the stage file omits, while placeholders
// remain rejected.
try {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch {
  // No .env file: the operator must export values in the build environment.
}

// Stage-specific browser configuration gates. Vite reads .env plus the
// stage-specific file (.env.staging / .env.production, which override .env),
// so the gate requires the stage file to exist and to carry the publishable
// project values. Without this, a production build would silently embed the
// development project's Supabase URL into the bundle.
const stageEnvFile = target === 'staging' ? '.env.staging' : '.env.production';
try {
  for (const line of readFileSync(stageEnvFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
} catch {
  throw new Error(`${target} build requires a ${stageEnvFile} file with the ${target} project's publishable Vite values (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).`);
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
