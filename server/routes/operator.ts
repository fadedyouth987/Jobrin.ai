import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireWorkspace, type AuthenticatedRequest } from '../supabase';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('ai.basic'));

router.post('/command', validateBody(z.object({ command: z.string().trim().min(2).max(2000) })), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const command = req.body.command.toLowerCase();

  if (/who.*owe|outstanding|unpaid invoice/.test(command)) {
    const { data, error } = await db.from('invoices').select('id,invoice_number,balance_due_cents,due_at,status,customer_id,customers(display_name)').eq('workspace_id', req.workspaceId!).in('status',['sent','viewed','part_paid','overdue']).gt('balance_due_cents',0).order('due_at',{ascending:true});
    if (error) return res.status(500).json({ error:'COMMAND_QUERY_FAILED' });
    const total=(data??[]).reduce((sum:number,row:any)=>sum+Number(row.balance_due_cents||0),0);
    return res.json({ kind:'table', title:'Outstanding invoices', summary:`${data?.length||0} invoices have a balance owing.`, totalCents:total, rows:data??[], readOnly:true });
  }

  if (/today|happening/.test(command)) {
    const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);
    const { data, error }=await db.from('jobs').select('id,job_number,title,status,scheduled_start,address_text,customers(display_name)').eq('workspace_id',req.workspaceId!).gte('scheduled_start',start.toISOString()).lt('scheduled_start',end.toISOString()).order('scheduled_start');
    if(error)return res.status(500).json({error:'COMMAND_QUERY_FAILED'});
    return res.json({kind:'timeline',title:"Today's jobs",summary:`${data?.length||0} jobs are scheduled today.`,rows:data??[],readOnly:true});
  }

  if (/lead source|source.*money|made.*money/.test(command)) {
    const {data,error}=await db.from('revenue_attributions').select('source,revenue_cents').eq('workspace_id',req.workspaceId!);
    if(error)return res.status(500).json({error:'COMMAND_QUERY_FAILED'});
    const totals=new Map<string,number>();for(const row of data??[])totals.set(row.source,(totals.get(row.source)||0)+Number(row.revenue_cents||0));
    const rows=[...totals].map(([source,revenue_cents])=>({source,revenue_cents})).sort((a,b)=>b.revenue_cents-a.revenue_cents);
    return res.json({kind:'table',title:'Revenue by source',summary:rows[0]?`${rows[0].source} is currently the highest attributed source.`:'No attributed revenue yet.',rows,readOnly:true});
  }

  if (/follow.?up.*quote|quotes.*older/.test(command)) {
    const threshold=new Date(Date.now()-3*86_400_000).toISOString();
    const {data,error}=await db.from('quotes').select('id,quote_number,total_cents,status,sent_at,customers(display_name)').eq('workspace_id',req.workspaceId!).in('status',['sent','viewed']).lt('sent_at',threshold).order('sent_at');
    if(error)return res.status(500).json({error:'COMMAND_QUERY_FAILED'});
    return res.json({kind:'proposal',title:'Quote follow-up proposal',summary:`I found ${data?.length||0} sent quotes older than three days. Sending messages is approval-gated and provider delivery is not enabled by this read-only command.`,rows:data??[],approvalRequired:true,readOnly:true});
  }

  return res.json({kind:'help',title:'Command Centre',summary:'This hardened build currently executes read-only revenue commands and produces approval-gated proposals for writes.',suggestions:['What\'s happening today?','Who owes us money?','Which lead source made the most money?','Follow up quotes older than three days.'],readOnly:true});
}));

export default router;
