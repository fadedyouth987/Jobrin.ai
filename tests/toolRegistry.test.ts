import assert from 'node:assert/strict';
import test from 'node:test';
import { canExecute, operatorTools, requiresApproval, toolByName } from '../server/ai/toolRegistry';

test('safe autopilot never executes prohibited or approval-required tools',()=>{
  for(const tool of operatorTools) if(['approval_required','prohibited'].includes(tool.risk)) assert.equal(canExecute(tool.name),false);
});
test('financial commitments require approval',()=>{
  assert.equal(requiresApproval('quote.send'),true); assert.equal(requiresApproval('payment.refund'),true);
});
test('tool schemas reject extra fields',()=>{
  assert.equal(toolByName('customer.lookup')?.schema.safeParse({query:'Jack',secret:'leak'}).success,false);
});
