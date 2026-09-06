const fs = require('fs');
const file = 'e2e-full-journey.mts';
let src = fs.readFileSync(file, 'utf8');
let applied = 0;
function once(find, repl, label) {
  if (src.includes(repl)) { console.log('already:', label); return; }
  if (!src.includes(find)) { console.log('NOT FOUND:', label); process.exit(1); }
  src = src.replace(find, repl);
  applied++;
  console.log('applied:', label);
}

// 1. Finance hat simulate: add missing mode parameter
once(
  "api('POST', '/api/receptionist/simulate', { message: 'Which invoices are overdue?', mode: 'finance' }, token, w)",
  "api('POST', '/api/receptionist/simulate', { message: 'Which invoices are overdue?', mode: 'finance' }, token, w)",
  'finance hat call'
);

fs.writeFileSync(file, src);
console.log('done', applied, 'edits');