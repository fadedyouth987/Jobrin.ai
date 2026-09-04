const target = process.argv[2];

if (!['staging', 'production'].includes(target)) {
  throw new Error('Usage: node scripts/assert-browser-config.mjs <staging|production>');
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
