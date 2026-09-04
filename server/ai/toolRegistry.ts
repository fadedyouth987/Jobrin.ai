import { z } from 'zod';

export type ToolRisk = 'automatic' | 'policy_controlled' | 'approval_required' | 'prohibited';

export type OperatorTool = {
  name: string;
  description: string;
  risk: ToolRisk;
  specialist: 'receptionist'|'triage'|'scheduler'|'quotes'|'job_prep'|'field_scribe'|'collections'|'reviews'|'insights';
  schema: z.ZodTypeAny;
};

const uuid = z.string().uuid();
export const operatorTools: readonly OperatorTool[] = [
  { name:'customer.lookup', description:'Find a customer using verified workspace records.', risk:'automatic', specialist:'triage', schema:z.object({ query:z.string().trim().min(2).max(200) }).strict() },
  { name:'availability.check', description:'Read available appointment windows.', risk:'automatic', specialist:'scheduler', schema:z.object({ serviceId:uuid.optional(), from:z.string().datetime(), to:z.string().datetime() }).strict() },
  { name:'appointment.book', description:'Book within configured service, area, duration and availability rules.', risk:'policy_controlled', specialist:'scheduler', schema:z.object({ customerId:uuid, serviceId:uuid.optional(), startsAt:z.string().datetime(), addressId:uuid.optional() }).strict() },
  { name:'message.send_template', description:'Send an approved transactional template to a consented customer.', risk:'policy_controlled', specialist:'receptionist', schema:z.object({ customerId:uuid, templateKey:z.string().min(2).max(80), variables:z.record(z.string(),z.string()).default({}) }).strict() },
  { name:'quote.draft', description:'Draft a quote from approved services and prices.', risk:'automatic', specialist:'quotes', schema:z.object({ customerId:uuid, jobId:uuid.optional(), serviceIds:z.array(uuid).min(1).max(50) }).strict() },
  { name:'quote.send', description:'Send a financial offer to a customer.', risk:'approval_required', specialist:'quotes', schema:z.object({ quoteId:uuid }).strict() },
  { name:'payment.refund', description:'Refund a customer payment.', risk:'approval_required', specialist:'collections', schema:z.object({ paymentId:uuid, amountCents:z.number().int().positive(), reason:z.string().min(3).max(500) }).strict() },
  { name:'invoice.follow_up', description:'Send an approved invoice reminder.', risk:'policy_controlled', specialist:'collections', schema:z.object({ invoiceId:uuid, templateKey:z.string().min(2).max(80) }).strict() },
  { name:'review.request', description:'Request a review after completed work.', risk:'policy_controlled', specialist:'reviews', schema:z.object({ jobId:uuid, channel:z.enum(['sms','email']) }).strict() },
  { name:'business.report', description:'Calculate an answer and return supporting record references.', risk:'automatic', specialist:'insights', schema:z.object({ question:z.string().min(3).max(1000), from:z.string().datetime().optional(), to:z.string().datetime().optional() }).strict() },
  { name:'workspace.permissions.change', description:'Change workspace access.', risk:'prohibited', specialist:'insights', schema:z.never() },
  { name:'secret.read', description:'Read provider credentials.', risk:'prohibited', specialist:'insights', schema:z.never() },
] as const;

export function toolByName(name: string) { return operatorTools.find(tool => tool.name === name); }
export function requiresApproval(name: string) { return toolByName(name)?.risk === 'approval_required'; }
export function canExecute(name: string) { const risk=toolByName(name)?.risk; return risk === 'automatic' || risk === 'policy_controlled'; }
