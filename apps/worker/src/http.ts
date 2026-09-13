import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { isHexString, keccak256, toUtf8Bytes } from 'ethers';
import { PermanentRelayError } from './retry.js';
import { assertPublicEvidence, publicEvidenceFromJob } from './evidence.js';
import type { JobQueue } from './queue.js';
import type { RelayReadiness } from './types.js';
import { assertUsageReceipt } from './usage-receipt.js';

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
      if (request.method === 'POST' && url.pathname === '/metadata') {
        const rate = limiter.consume(clientAddress(request));
        setRateHeaders(response, options, rate);
        if (!rate.allowed)
          return sendError(
            response,
            429,
            'RATE_LIMITED',
            'Too many metadata uploads. Wait for the rate-limit window to reset.',
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
        if (
          !body.document ||
          typeof body.document !== 'object' ||
          Array.isArray(body.document)
        )
          throw new PermanentRelayError(
            'document must be a machine metadata object.',
            'INVALID_METADATA',
          );
        try {
          assertPublicEvidence(body.document);
        } catch (error) {
          throw new PermanentRelayError(
            error instanceof Error ? error.message : 'Metadata is not public.',
            'INVALID_METADATA',
          );
        }
        const document = canonicalize(
          body.document as Record<string, unknown>,
        ) as Record<string, unknown>;
        const contentDigest = keccak256(toUtf8Bytes(JSON.stringify(document)));
        const uri = `${requestOrigin(request)}/metadata/${contentDigest}`;
        const commitment = keccak256(toUtf8Bytes(uri));
        const metadata = {
          contentDigest,
          commitment,
          uri,
          document,
          createdAt: new Date().toISOString(),
        };
        await queue.putMetadata(metadata);
        return send(response, 201, metadata);
      }
      if (request.method === 'POST' && url.pathname === '/jobs') {
        const rate = limiter.consume(clientAddress(request));
        setRateHeaders(response, options, rate);
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
      if (request.method === 'POST' && url.pathname === '/device-handoffs') {
        const rate = limiter.consume(clientAddress(request));
        setRateHeaders(response, options, rate);
        if (!rate.allowed)
          return sendError(
            response,
            429,
            'RATE_LIMITED',
            'Too many device handoffs. Wait before creating another.',
            true,
          );
        requireJson(request);
        const body = await readJson(request);
        if (
          typeof body.sourceTransactionHash !== 'string' ||
          !isHexString(body.sourceTransactionHash, 32)
        )
          throw new PermanentRelayError(
            'sourceTransactionHash must be a 32-byte hash.',
            'INVALID_TRANSACTION_HASH',
          );
        const job = await queue.find(body.sourceTransactionHash);
        if (
          !job ||
          !['completed', 'duplicate'].includes(job.phase) ||
          !job.machineId ||
          !job.payer ||
          !job.orderId ||
          !job.accessExpiresAt
        )
          return sendError(
            response,
            409,
            'ACCESS_NOT_READY',
            'A completed, fully correlated AccessPass is required.',
            true,
          );
        const now = nowMilliseconds(options);
        const accessExpiry = Number(job.accessExpiresAt) * 1_000;
        if (!Number.isSafeInteger(accessExpiry) || accessExpiry <= now + 5_000)
          return sendError(
            response,
            409,
            'ACCESS_EXPIRED',
            'The AccessPass has expired or is too close to expiry.',
            false,
          );
        const timestamp = new Date(now).toISOString();
        const handoff = {
          schema: 'proofkey.device-handoff.v1' as const,
          nonce: randomBytes(32).toString('hex'),
          machineId: job.machineId.toLowerCase(),
          payer: job.payer,
          orderId: job.orderId.toLowerCase(),
          sourceTransactionHash: job.sourceTransactionHash.toLowerCase(),
          accessExpiresAt: job.accessExpiresAt,
          createdAt: timestamp,
          expiresAt: new Date(
            Math.min(now + 120_000, accessExpiry),
          ).toISOString(),
        };
        await queue.createDeviceHandoff(handoff);
        return send(response, 201, handoff);
      }
      const handoffMatch = /^\/device-handoffs\/([0-9a-fA-F]{64})$/.exec(
        url.pathname,
      );
      if (request.method === 'GET' && handoffMatch?.[1]) {
        const handoff = await queue.getDeviceHandoff(handoffMatch[1]);
        return handoff
          ? send(response, 200, handoff)
          : sendError(
              response,
              404,
              'HANDOFF_NOT_FOUND',
              'Device handoff not found.',
              false,
            );
      }
      const claimMatch = /^\/device-handoffs\/([0-9a-fA-F]{64})\/claim$/.exec(
        url.pathname,
      );
      if (request.method === 'POST' && claimMatch?.[1]) {
        const existing = await queue.getDeviceHandoff(claimMatch[1]);
        if (!existing)
          return sendError(
            response,
            404,
            'HANDOFF_NOT_FOUND',
            'Device handoff not found.',
            false,
          );
        const now = nowMilliseconds(options);
        if (Date.parse(existing.expiresAt) <= now)
          return sendError(
            response,
            410,
            'HANDOFF_EXPIRED',
            'This QR handoff has expired.',
            false,
          );
        const claimToken = randomBytes(32).toString('hex');
        const claimed = await queue.claimDeviceHandoff(
          claimMatch[1],
          secretHash(claimToken),
          new Date(now).toISOString(),
        );
        return claimed
          ? send(response, 200, { handoff: claimed, claimToken })
          : sendError(
              response,
              409,
              'HANDOFF_ALREADY_CLAIMED',
              'This QR handoff was already claimed by a device.',
              false,
            );
      }
      const receiptMatch =
        /^\/device-handoffs\/([0-9a-fA-F]{64})\/receipts$/.exec(url.pathname);
      if (request.method === 'POST' && receiptMatch?.[1]) {
        requireJson(request);
        const claimToken = request.headers['x-proofkey-claim-token'];
        if (
          typeof claimToken !== 'string' ||
          !/^[0-9a-f]{64}$/.test(claimToken)
        )
          return sendError(
            response,
            401,
            'INVALID_CLAIM_TOKEN',
            'The device claim token is missing or invalid.',
            false,
          );
        const handoff = await queue.getDeviceHandoff(receiptMatch[1]);
        if (!handoff)
          return sendError(
            response,
            404,
            'HANDOFF_NOT_FOUND',
            'Device handoff not found.',
            false,
          );
        const body = await readJson(request);
        try {
          assertUsageReceipt(handoff, body as never);
        } catch (error) {
          throw new PermanentRelayError(
            error instanceof Error ? error.message : 'Receipt is invalid.',
            'INVALID_RECEIPT',
          );
        }
        const updated = await queue.putDeviceReceipt(
          receiptMatch[1],
          secretHash(claimToken),
          body as never,
        );
        return updated
          ? send(response, 201, updated)
          : sendError(
              response,
              409,
              'RECEIPT_REJECTED',
              'The claim token, receipt order, or session state is invalid.',
              false,
            );
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
      const metadataMatch = /^\/metadata\/(0x[0-9a-fA-F]{64})$/.exec(
        url.pathname,
      );
      if (request.method === 'GET' && metadataMatch?.[1]) {
        const metadata = await queue.getMetadataByDigest(metadataMatch[1]);
        if (!metadata)
          return sendError(
            response,
            404,
            'METADATA_NOT_FOUND',
            'Machine metadata was not found.',
            false,
          );
        response.setHeader(
          'Cache-Control',
          'public, max-age=31536000, immutable',
        );
        return send(response, 200, {
          ...metadata.document,
          uri: metadata.uri,
          contentDigest: metadata.contentDigest,
          commitment: metadata.commitment,
        });
      }
      const commitmentMatch =
        /^\/metadata\/commitments\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname);
      if (request.method === 'GET' && commitmentMatch?.[1]) {
        const metadata = await queue.getMetadataByCommitment(
          commitmentMatch[1],
        );
        if (!metadata)
          return sendError(
            response,
            404,
            'METADATA_NOT_FOUND',
            'Machine metadata commitment was not found.',
            false,
          );
        response.setHeader('Cache-Control', 'public, max-age=300');
        return send(response, 200, {
          ...metadata.document,
          uri: metadata.uri,
          contentDigest: metadata.contentDigest,
          commitment: metadata.commitment,
        });
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

function requireJson(request: IncomingMessage): void {
  if (
    !request.headers['content-type']
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new PermanentRelayError(
      'Content-Type must be application/json.',
      'UNSUPPORTED_CONTENT_TYPE',
    );
}

function nowMilliseconds(options: RelayHttpOptions): number {
  return options.now?.() ?? Date.now();
}

function secretHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function setRateHeaders(
  response: ServerResponse,
  options: RelayHttpOptions,
  rate: { remaining: number; resetsAt: number },
): void {
  response.setHeader('RateLimit-Limit', String(options.rateLimit.requests));
  response.setHeader('RateLimit-Remaining', String(rate.remaining));
  response.setHeader(
    'RateLimit-Reset',
    String(Math.ceil(rate.resetsAt / 1_000)),
  );
}

function requestOrigin(request: IncomingMessage): string {
  const forwardedProtocol = request.headers['x-forwarded-proto'];
  const protocol = (
    Array.isArray(forwardedProtocol)
      ? forwardedProtocol[0]
      : forwardedProtocol?.split(',')[0]
  )?.trim();
  const forwardedHost = request.headers['x-forwarded-host'];
  const host =
    (Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost?.split(',')[0]
    )?.trim() ?? request.headers.host;
  const resolvedProtocol = protocol === 'https' ? 'https' : 'http';
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host))
    throw new PermanentRelayError('Request host is invalid.', 'INVALID_HOST');
  return `${resolvedProtocol}://${host}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
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
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-ProofKey-Claim-Token',
  );
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
