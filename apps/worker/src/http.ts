import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { PermanentRelayError } from './retry.js';
import { publicEvidenceFromJob } from './evidence.js';
import type { JobQueue } from './queue.js';
import type { RelayReadiness } from './types.js';

const maximumBodyBytes = 8_192;

export interface RelayHttpOptions {
  allowedOrigins: string[];
  readiness: () => Promise<RelayReadiness>;
  rateLimit: {
    requests: number;
    windowMs: number;
  };
  now?: () => number;
}

interface RateLimitWindow {
  count: number;
  resetsAt: number;
}

export function createRelayHttpServer(
  queue: JobQueue,
  options: RelayHttpOptions,
): Server {
  const limiter = new FixedWindowRateLimiter(
    options.rateLimit.requests,
    options.rateLimit.windowMs,
    options.now,
  );

  return createServer(async (request, response) => {
    setBaseHeaders(response);
    const origin = request.headers.origin;
    if (origin && !options.allowedOrigins.includes(origin)) {
      return sendError(
        response,
        403,
        'ORIGIN_NOT_ALLOWED',
        'This browser origin is not allowed to use the relay.',
        false,
      );
    }
    if (origin) setCors(response, origin);
    if (request.method === 'OPTIONS') return send(response, 204);

    try {
      const url = new URL(request.url ?? '/', 'http://proofkey.local');
      if (request.method === 'GET' && url.pathname === '/health') {
        return send(response, 200, {
          service: 'proofkey-relay',
          status: 'alive',
          timestamp: new Date().toISOString(),
        });
      }
      if (request.method === 'GET' && url.pathname === '/ready') {
        const readiness = await options.readiness();
        return send(
          response,
          readiness.status === 'ready' ? 200 : 503,
          readiness,
        );
      }
      if (request.method === 'POST' && url.pathname === '/jobs') {
        const rate = limiter.consume(clientAddress(request));
        response.setHeader(
          'RateLimit-Limit',
          String(options.rateLimit.requests),
        );
        response.setHeader('RateLimit-Remaining', String(rate.remaining));
        response.setHeader(
          'RateLimit-Reset',
          String(Math.ceil(rate.resetsAt / 1_000)),
        );
        if (!rate.allowed)
          return sendError(
            response,
            429,
            'RATE_LIMITED',
            'Too many relay requests. Wait for the rate-limit window to reset.',
            true,
          );
        if (
          !request.headers['content-type']
            ?.toLowerCase()
            .startsWith('application/json')
        )
          throw new PermanentRelayError(
            'Content-Type must be application/json.',
            'UNSUPPORTED_CONTENT_TYPE',
          );
        const body = await readJson(request);
        if (typeof body.transactionHash !== 'string') {
          throw new PermanentRelayError(
            'transactionHash must be a string.',
            'INVALID_TRANSACTION_HASH',
          );
        }
        return send(response, 202, await queue.enqueue(body.transactionHash));
      }
      const match = /^\/jobs\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname);
      if (request.method === 'GET' && match?.[1]) {
        const job = await queue.get(match[1]);
        return job
          ? send(response, 200, job)
          : sendError(
              response,
              404,
              'JOB_NOT_FOUND',
              'Relay job not found.',
              false,
            );
      }
      const proofMatch = /^\/proofs\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname);
      if (request.method === 'GET' && proofMatch?.[1]) {
        const job = await queue.find(proofMatch[1]);
        return job
          ? send(response, 200, publicEvidenceFromJob(job))
          : sendError(
              response,
              404,
              'PROOF_NOT_FOUND',
              'No proof matches that source transaction, order, query, or Creditcoin transaction.',
              false,
            );
      }
      return sendError(
        response,
        404,
        'ROUTE_NOT_FOUND',
        'Route not found.',
        false,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return error instanceof PermanentRelayError
        ? sendError(response, 400, error.code, message, false)
        : sendError(
            response,
            500,
            'INTERNAL_ERROR',
            'The relay could not process this request.',
            true,
          );
    }
  });
}

class FixedWindowRateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): {
    allowed: boolean;
    remaining: number;
    resetsAt: number;
  } {
    const timestamp = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetsAt <= timestamp) {
      window = { count: 0, resetsAt: timestamp + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= this.limit,
      remaining: Math.max(0, this.limit - window.count),
      resetsAt: window.resetsAt,
    };
  }
}

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(',')[0];
  return first?.trim() || request.socket.remoteAddress || 'unknown';
}

function setBaseHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function setCors(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Vary', 'Origin');
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > maximumBodyBytes) {
      throw new PermanentRelayError(
        'Request body exceeds 8 KiB.',
        'REQUEST_TOO_LARGE',
      );
    }
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new PermanentRelayError(
      'Request body must be a JSON object.',
      'INVALID_JSON',
    );
  }
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): void {
  send(response, status, { error: { code, message, retryable } });
}

function send(response: ServerResponse, status: number, body?: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(body === undefined ? undefined : `${JSON.stringify(body)}\n`);
}
