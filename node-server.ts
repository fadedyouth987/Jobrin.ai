import path from 'node:path';
import express from 'express';
import { app, finalizeApp } from './server';
import { env } from './server/env';
import { startBusinessBrainWorker } from './server/ai/businessBrainWorker';
import { startAutomationRunner } from './server/automation/runner';
import { attachReceptionistWebSocket } from './server/ws/receptionistSocket';

async function startServer() {
  // Runtime mode controls whether Vite middleware is needed. Deployment stage
  // separately controls production secret enforcement, allowing a compiled
  // local preview without falsely declaring it a production deployment.
  if (env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist', 'client');
    app.use(express.static(distPath, {
      index: false,
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
        if (/\.[a-f0-9]{8,}\./.test(filePath)) res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
      },
    }));
  }

  const distPath = path.join(process.cwd(), 'dist', 'client');
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(distPath, 'index.html'));
  });

  finalizeApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', message: 'Jobrin.ai server started', port: env.PORT, environment: env.NODE_ENV }));
    if (env.SUPABASE_SERVICE_ROLE_KEY && env.OPENAI_API_KEY) startBusinessBrainWorker();
    if (env.SUPABASE_SERVICE_ROLE_KEY) startAutomationRunner();
  });
  attachReceptionistWebSocket(server);
}

void startServer();
