import { httpServerHandler } from 'cloudflare:node';
import { app, finalizeApp } from './server';
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
    // The queues use atomic claims and idempotency keys, so Cloudflare's
    // at-least-once cron delivery cannot duplicate a memory extraction or an
    // automation step.
    ctx.waitUntil(Promise.all([
      processBusinessBrainQueue(),
      processAutomationRuns(),
    ]));
  },
};
