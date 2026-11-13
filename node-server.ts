import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { app, finalizeApp } from './server';
import { env } from './server/env';
import { startBusinessBrainWorker } from './server/ai/businessBrainWorker';
import { openaiConfigured } from './server/providers/openai';
import { startAutomationRunner } from './server/automation/runner';
import { attachReceptionistWebSocket } from './server/ws/receptionistSocket';

async function startServer() {
  // One HTTP server for the API, the SPA, the receptionist WebSocket and (in
  // dev) Vite's HMR socket, so everything is reachable through a single port.
  const server = http.createServer(app);
  let vite: Awaited<ReturnType<typeof import('vite').createServer>> | null = null;
  // Runtime mode controls whether Vite middleware is needed. Deployment stage
  // separately controls production secret enforcement, allowing a compiled
  // local preview without falsely declaring it a production deployment.
  if (env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    // Without hmr.server, Vite opens HMR on a separate port (24678) that
    // previews, tunnels and reverse proxies don't forward, leaving the client
    // stuck on "[vite] connecting..." and reload-looping.
    const hmr = process.env.DISABLE_HMR === 'true' ? false : { server };
    // Vite's DNS-rebinding guard answers 403 "Blocked request. This host is
    // not allowed" to any Host other than localhost, which breaks previews,
    // tunnels and LAN access. Dev-only server; narrow it with
    // DEV_ALLOWED_HOSTS=host1,host2 if you want the guard back.
    const allowedHosts = process.env.DEV_ALLOWED_HOSTS
      ? process.env.DEV_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
      : true;
    vite = await createViteServer({ server: { middlewareMode: true, hmr, allowedHosts }, appType: 'spa' });
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
  app.get('/{*splat}', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (vite) {
      try {
        const template = await readFile(path.join(process.cwd(), 'index.html'), 'utf8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).type('html').send(html);
        return;
      } catch (error) {
        next(error);
        return;
      }
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });

  finalizeApp();
  server.listen(env.PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', message: 'Jobrin.ai server started', port: env.PORT, environment: env.NODE_ENV }));
    if (env.SUPABASE_SERVICE_ROLE_KEY && openaiConfigured()) startBusinessBrainWorker();
    if (env.SUPABASE_SERVICE_ROLE_KEY) startAutomationRunner();
  });
  attachReceptionistWebSocket(server);
}

void startServer();
