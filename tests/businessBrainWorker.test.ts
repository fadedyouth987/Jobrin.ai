import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../server/ai/businessBrainWorker.ts',import.meta.url),'utf8');
test('learning worker claims only durable memory extraction events',()=>assert.match(source,/event_key','memory\.extract_requested'/));
test('learning worker dead-letters bounded failures',()=>{assert.match(source,/attempts>=5/);assert.match(source,/dead_letter/)});
test('model extraction cannot directly promote memory',()=>{assert.match(source,/decideMemoryStatus/);assert.doesNotMatch(source,/status:candidate\.status/)});
test('one feedback event is immutable evidence for each candidate',()=>assert.match(source,/feedback_event_id:feedback\.id/));
