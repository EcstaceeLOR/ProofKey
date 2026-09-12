import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { PermanentRelayError } from './retry.js';
import type { JobQueue } from './queue.js';

const maximumBodyBytes = 8_192;

export function createRelayHttpServer(
  queue: JobQueue,
  frontendOrigin: string,
): Server {
  return createServer(async (request, response) => {
    setCors(response, frontendOrigin);
    if (request.method === 'OPTIONS') return send(response, 204);

    try {
      const url = new URL(request.url ?? '/', 'http://proofkey.local');
      if (request.method === 'GET' && url.pathname === '/health') {
        return send(response, 200, {
          service: 'proofkey-worker',
          status: 'ready',
        });
      }
      if (request.method === 'POST' && url.pathname === '/jobs') {
        const body = await readJson(request);
        if (typeof body.transactionHash !== 'string') {
          throw new PermanentRelayError('transactionHash must be a string.');
        }
        return send(response, 202, await queue.enqueue(body.transactionHash));
      }
      const match = /^\/jobs\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname);
      if (request.method === 'GET' && match?.[1]) {
        const job = await queue.get(match[1]);
        return job
          ? send(response, 200, job)
          : send(response, 404, { error: 'Relay job not found.' });
      }
      return send(response, 404, { error: 'Route not found.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return send(response, error instanceof PermanentRelayError ? 400 : 500, {
        error: message,
      });
    }
  });
}

function setCors(response: ServerResponse, frontendOrigin: string): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Access-Control-Allow-Origin', frontendOrigin);
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
      throw new PermanentRelayError('Request body exceeds 8 KiB.');
    }
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new PermanentRelayError('Request body must be a JSON object.');
  }
}

function send(response: ServerResponse, status: number, body?: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(body === undefined ? undefined : `${JSON.stringify(body)}\n`);
}
