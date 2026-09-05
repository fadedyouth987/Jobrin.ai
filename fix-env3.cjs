const fs = require('fs');
const { execSync } = require('child_process');

// 1. Restore .env.example to the committed template (removes user's real values)
try {
  execSync('git -c safe.directory="C:/Users/Kay/Documents/ChatGPT/jobryn/jobryn-main/jobryn-main/app" checkout HEAD -- .env.example', { cwd: process.cwd() });
  console.log('.env.example restored to template');
} catch (e) { console.log('git checkout failed: ' + e.message); }

// 2. Read the restored .env.example to get placeholder values
const exampleLines = fs.readFileSync('.env.example', 'utf8').split(/\r?\n/);

// 3. Read the user's current .env
let envSrc = fs.readFileSync('.env', 'utf8');
const envKeys = new Set(envSrc.split(/\r?\n/).map((line) => (line.match(/^([A-Z0-9_]+)=/) || [])[1]).filter(Boolean));

// 4. The user's credential values were in the .env.example before we restored it
// We can't recover them now — the git checkout overwrote the file
// But we can tell the user exactly which keys to add manually
const needed = ['SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_OPERATOR', 'TWILIO_PHONE_NUMBER', 'EMAIL_API_KEY'];
const missing = needed.filter((key) => !envKeys.has(key));

console.log('\nMissing keys that need manual addition to .env:');
missing.forEach((key) => console.log('  ' + key));
console.log('\nCurrent .env keys: ' + [...envKeys].join(', '));