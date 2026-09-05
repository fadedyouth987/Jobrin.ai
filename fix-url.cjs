const fs = require('fs');
const file = 'worker.ts';
let src = fs.readFileSync(file, 'utf8');
const find = 'const token = *** URL(request.url).searchParams.get(\'token\') || \'\';';
const repl = 'const token = ***';
if (!src.includes(find)) { console.log('NOT FOUND'); process.exit(1); }
src = src.replace(find, repl);
fs.writeFileSync(file, src);
console.log('fixed redacted URL in worker.ts');