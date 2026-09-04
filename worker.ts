import { httpServerHandler } from 'cloudflare:node';
import { app, finalizeApp } from './server';
import { env } from './server/env';
import { processBusinessBrainQueue } from './server/ai/businessBrainWorker';
import { processAutomationRuns } from './server/automation/runner';

// Cloudflare translates Fetch API requests into Node HTTP requests so the
// existing, tested Express security and routing layer remains the API boundary.
const port = 3000;
finalizeApp();
app.listen(port);

const httpHandler = httpServerHandler({ port });

export default {
  ...httpHandler,
  async scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    // Skip queue work when the service role is absent instead of throwing on
    // every cron tick — the workers stay fail-closed but silent.
    const jobs: Promise<unknown>[] = [];
    if (env.SUPABASE_SERVICE_ROLE_KEY && env.OPENAI_API_KEY) jobs.push(processBusinessBrainQueue());
    if (env.SUPABASE_SERVICE_ROLE_KEY) jobs.push(processAutomationRuns());
    if (jobs.length) {
      // The queues use atomic claims and idempotency keys, so Cloudflare's
      // at-least-once cron delivery cannot duplicate a memory extraction or an
      // automation step.
      ctx.waitUntil(Promise.all(jobs));
    }
  },
};
