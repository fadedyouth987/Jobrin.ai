import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../server/ai/businessBrainWorker.ts',import.meta.url),'utf8');
test('learning worker claims only durable memory extraction events',()=>assert.match(source,/event_key','memory\.extract_requested'/));
test('learning worker dead-letters bounded failures',()=>{assert.match(source,/attempts>=5/);assert.match(source,/dead_letter/)});
test('model extraction cannot directly promote memory',()=>{assert.match(source,/decideMemoryStatus/);assert.doesNotMatch(source,/status:candidate\.status/)});
test('one feedback event is immutable evidence for each candidate',()=>assert.match(source,/feedback_event_id:feedback\.id/));

// Fix: a second corroborating candidate for the same
// (workspace_id,scope_type,scope_id,memory_key) must accumulate evidence
// instead of silently dropping on the unique-constraint collision.
test('a corroborating candidate looks up the prior memory before inserting a fresh one',()=>{
  assert.match(source,/in\('status',\['candidate','challenged'\]\)/);
  assert.match(source,/eq\('memory_key',candidate\.memoryKey\)/);
});
test('sample_count and distinct evidence records accumulate instead of resetting to 1',()=>{
  assert.match(source,/sampleCount=Number\(prior\.sample_count\|\|0\)\+1/);
  assert.match(source,/distinctKeys\.add\(`\$\{feedback\.resource_type\}:\$\{feedback\.resource_id\}`\)/);
  assert.match(source,/distinctRecords=distinctKeys\.size/);
});
test('accumulated evidence re-runs decideMemoryStatus so a promotion rule can fire automatically',()=>{
  assert.match(source,/decideMemoryStatus\(\{category:candidate\.category,memoryKey:candidate\.memoryKey,sampleCount,distinctRecords/);
  assert.match(source,/status:decision\.status,last_observed_at:feedback\.occurred_at/);
});
test('a status change on the accumulation path is still recorded as a promotion decision',()=>{
  assert.match(source,/if\(decision\.status!==prior\.status\)await supabaseAdmin\.from\('memory_promotion_decisions'\)\.insert/);
});
test('a fresh memory (no prior candidate/challenged row) still inserts sampleCount 1 as before',()=>{
  assert.match(source,/sample_count:1,sensitivity:candidate\.sensitivity/);
});
