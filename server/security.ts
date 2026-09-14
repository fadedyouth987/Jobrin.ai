import crypto from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { TimerFreeMemoryStore } from './rateLimitStore';
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
  store: new TimerFreeMemoryStore(),
  windowMs: 60_000,
  limit: 240,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
});

export const billingRateLimit = rateLimit({
  store: new TimerFreeMemoryStore(),
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

// ---------- Keyset pagination (cursor) helpers ----------
// Cursor encoding: base64url of `${created_at}|${id}` — the last row's own
// created_at + id, opaque to clients. Every paginated list endpoint orders
// by created_at desc, id desc (id as a tiebreaker for same-timestamp rows)
// and, when a cursor is supplied, filters to rows strictly after it in that
// same order via a keyset (not OFFSET) condition — so pages stay correct
// even as new rows are inserted between requests.
export function parseCursor(raw: unknown): { createdAt: string; id: string } | null {
  if (typeof raw !== 'string' || !raw) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const sepIndex = decoded.indexOf('|');
  if (sepIndex < 0) return null;
  const createdAt = decoded.slice(0, sepIndex);
  const id = decoded.slice(sepIndex + 1);
  if (!createdAt || !id || Number.isNaN(new Date(createdAt).getTime())) return null;
  if (!/^[0-9a-zA-Z_.:-]{1,120}$/.test(id)) return null;
  return { createdAt, id };
}

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

// Applies the keyset condition for a cursor onto a Supabase/PostgREST query
// builder: rows strictly after (createdAt, id) in created_at desc, id desc
// order. Column names are fixed literals from call sites, never user input.
export function applyKeysetCursor<Q extends { or: (filter: string) => Q }>(
  query: Q,
  cursor: { createdAt: string; id: string } | null,
  columns: { createdAt: string; id: string } = { createdAt: 'created_at', id: 'id' },
): Q {
  if (!cursor) return query;
  return query.or(`${columns.createdAt}.lt.${cursor.createdAt},and(${columns.createdAt}.eq.${cursor.createdAt},${columns.id}.lt.${cursor.id})`);
}

// Given rows fetched with limit+1, trims back to `limit` and reports whether
// more rows exist beyond the page plus the opaque cursor for the next one.
// `keyField` defaults to 'created_at' (the scheme used by most endpoints);
// pass e.g. 'updated_at' for the handful sorted on a different timestamp.
export function buildPage<T extends Record<string, unknown> & { id: string }>(
  rows: T[],
  limit: number,
  keyField: keyof T & string = 'created_at',
): { page: T[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { page, hasMore, nextCursor: hasMore && last ? encodeCursor(String(last[keyField]), last.id) : null };
}

// ---------- Safe database error messages ----------
// Postgres/Supabase error messages can include constraint, column and table
// names — fine for server logs, not for a client response. Map the common
// codes to a generic, still-useful message and fall back to a fixed generic
// string (never error.message) for anything else.
export function dbErrorMessage(error: { code?: string | null; message?: string } | null | undefined, fallback = 'The request could not be completed.'): string {
  switch (error?.code) {
    case '23505':
      return 'A matching record already exists.';
    case '23503':
      return 'A referenced record was not found.';
    case '23502':
      return 'A required field is missing.';
    case '23514':
      return 'The provided values do not meet a required constraint.';
    case '22P02':
      return 'One of the provided values is invalid.';
    default:
      return fallback;
  }
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
