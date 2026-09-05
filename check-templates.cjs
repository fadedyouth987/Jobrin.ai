const fs = require('fs');
const s = fs.readFileSync('server/routes/operations.ts', 'utf8');
const lines = s.split('\n');
let inTemplate = false;
let templateStart = -1;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (ch === '\\' && j < line.length - 1) { j++; continue; }
    if (ch === '`') {
      inTemplate = !inTemplate;
      if (inTemplate) {
        templateStart = i + 1;
        console.log('TEMPLATE OPEN: L' + (i + 1));
      } else {
        if (templateStart > 0) {
          // check if this close is far from the open (suspicious)
          if (i + 1 - templateStart > 3) {
            console.log('TEMPLATE CLOSE: L' + (i + 1) + ' (opened L' + templateStart + ', span ' + (i + 1 - templateStart) + ' lines)');
          }
          templateStart = -1;
        }
      }
    }
  }
}
console.log('final template state:', inTemplate ? 'STILL OPEN' : 'closed');