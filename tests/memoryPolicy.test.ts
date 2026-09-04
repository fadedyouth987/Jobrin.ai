import assert from 'node:assert/strict';
import test from 'node:test';
import {decideMemoryStatus,robustMedian} from '../server/ai/memoryPolicy';

const base={category:'heuristic' as const,memoryKey:'communication.tone',sampleCount:1,distinctRecords:1,explicitlyConfirmed:false,contradictionCount:0,lastObservedAt:'2026-08-01T00:00:00Z'};
test('one ordinary correction cannot activate a communication rule',()=>assert.equal(decideMemoryStatus(base).status,'candidate'));
test('communication style needs five corrections across three records',()=>assert.equal(decideMemoryStatus({...base,sampleCount:5,distinctRecords:3}).status,'active'));
test('contradictory evidence challenges instead of overwriting',()=>assert.equal(decideMemoryStatus({...base,sampleCount:9,distinctRecords:6,contradictionCount:1}).status,'challenged'));
test('preferences require explicit human confirmation',()=>{assert.equal(decideMemoryStatus({...base,category:'preference',memoryKey:'customer.contact_time'}).status,'candidate');assert.equal(decideMemoryStatus({...base,category:'preference',memoryKey:'customer.contact_time',explicitlyConfirmed:true}).status,'active')});
test('pricing remains advisory even after a large sample',()=>assert.equal(decideMemoryStatus({...base,memoryKey:'pricing.optimisation',sampleCount:60,distinctRecords:60}).status,'candidate'));
test('robust duration median resists large outliers',()=>assert.equal(robustMedian([55,58,59,60,61,62,63,64,65,900]),62));
