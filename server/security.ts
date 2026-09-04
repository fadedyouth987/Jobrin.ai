import crypto from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { ZodTypeAny } from 'zod';
import { env } from './env';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  (req as Request & { requestId?: string }).requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

export function securityMiddleware(): RequestHandler[] {
  const csp = env.isProduction
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      }
    : false;

  return [
    helmet({
      contentSecurityPolicy: csp,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    }),
    cors({
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'x-workspace-id', 'x-request-id', 'idempotency-key'],
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (env.allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('CORS_ORIGIN_DENIED'));
      },
    }),
  ];
}

export const globalRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
});

export const authRateLimit = rateLimit({
  windowMs: 10 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

export const billingRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'VALIDATION_FAILED',
        issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    req.body = result.data;
    next();
  };
}

export function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => void Promise.resolve(handler(req, res, next)).catch(next);
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', path: req.path });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestIdValue = (req as Request & { requestId?: string }).requestId;
  console.error(JSON.stringify({
    level: 'error',
    requestId: requestIdValue,
    method: req.method,
    path: req.path,
    message: error instanceof Error ? error.message : String(error),
  }));
  if (res.headersSent) return;
  const status = error instanceof Error && error.message === 'CORS_ORIGIN_DENIED' ? 403 : 500;
  res.status(status).json({ error: status === 403 ? 'ORIGIN_DENIED' : 'INTERNAL_ERROR', requestId: requestIdValue });
};
