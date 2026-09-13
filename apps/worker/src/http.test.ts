import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createRelayHttpServer, type RelayHttpOptions } from './http.js';
import type { JobQueue } from './queue.js';
import type {
  RelayJob,
  RelayReadiness,
  StoredMachineMetadata,
} from './types.js';

const hash = `0x${'ab'.repeat(32)}`;
const origin = 'https://proofkey.vercel.app';
const job: RelayJob = {
  sourceTransactionHash: hash,
  phase: 'queued',
  createdAt: '2026-09-12T18:00:00.000Z',
  updatedAt: '2026-09-12T18:00:00.000Z',
  attempts: {},
};
const ready: RelayReadiness = {
  status: 'ready',
  checks: {
    api: { status: 'ready' },
    database: { status: 'ready' },
    sourceRpc: { status: 'ready' },
    creditcoinRpc: { status: 'ready' },
    relayer: {
      status: 'ready',
      address: '0x1111111111111111111111111111111111111111',
      balanceWei: '100',
      minimumBalanceWei: '10',
    },
  },
};

let storedMetadata: StoredMachineMetadata | undefined;
const queue: JobQueue = {
  enqueue: async (transactionHash) => ({
    ...job,
    sourceTransactionHash: transactionHash,
  }),
  get: async (transactionHash) =>
    transactionHash.toLowerCase() === hash
      ? { ...job, phase: 'proof_generation' }
      : undefined,
  find: async (identifier) =>
    identifier.toLowerCase() === hash
      ? { ...job, phase: 'proof_generation' }
      : undefined,
  putMetadata: async (metadata) => {
    storedMetadata = metadata;
  },
  getMetadataByDigest: async (digest) =>
    storedMetadata?.contentDigest.toLowerCase() === digest.toLowerCase()
      ? storedMetadata
      : undefined,
  getMetadataByCommitment: async (commitment) =>
    storedMetadata?.commitment.toLowerCase() === commitment.toLowerCase()
      ? storedMetadata
      : undefined,
};

async function start(
  context: { after: (callback: () => void) => void },
  overrides: Partial<RelayHttpOptions> = {},
): Promise<{ server: Server; url: string }> {
  const server = createRelayHttpServer(queue, {
    allowedOrigins: [origin],
    readiness: async () => ready,
    rateLimit: { requests: 10, windowMs: 60_000 },
    ...overrides,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

test('accepts an allowed browser job and exposes status and readiness', async (context) => {
  const { url } = await start(context);
  const accepted = await fetch(`${url}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ transactionHash: hash }),
  });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.headers.get('access-control-allow-origin'), origin);

  const status = await fetch(`${url}/jobs/${hash}`);
  assert.equal(status.status, 200);
  assert.equal(((await status.json()) as RelayJob).phase, 'proof_generation');

  const readiness = await fetch(`${url}/ready`);
  assert.equal(readiness.status, 200);
  assert.deepEqual(await readiness.json(), ready);

  const proof = await fetch(`${url}/proofs/${hash}`);
  assert.equal(proof.status, 200);
  assert.deepEqual(await proof.json(), {
    schema: 'proofkey.public-proof.v1',
    source: { transactionHash: hash },
    relay: {
      phase: 'proof_generation',
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      attempts: {},
    },
    creditcoin: {},
  });
});

test('rejects an untrusted browser origin without a CORS grant', async (context) => {
  const { url } = await start(context);
  const response = await fetch(`${url}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://attacker.example',
    },
    body: JSON.stringify({ transactionHash: hash }),
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    'ORIGIN_NOT_ALLOWED',
  );
});

test('rate-limits repeated enqueue requests by client address', async (context) => {
  const { url } = await start(context, {
    rateLimit: { requests: 1, windowMs: 60_000 },
  });
  const request = () =>
    fetch(`${url}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ transactionHash: hash }),
    });
  assert.equal((await request()).status, 202);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.equal(
    ((await limited.json()) as { error: { code: string } }).error.code,
    'RATE_LIMITED',
  );
});

test('returns 503 readiness while keeping liveness healthy', async (context) => {
  const degraded: RelayReadiness = {
    ...ready,
    status: 'degraded',
    checks: {
      ...ready.checks,
      database: { status: 'unavailable', code: 'DATABASE_UNAVAILABLE' },
    },
  };
  const { url } = await start(context, { readiness: async () => degraded });
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/ready`)).status, 503);
});

test('stores immutable public machine metadata and resolves its commitment', async (context) => {
  storedMetadata = undefined;
  const { url } = await start(context);
  const uploaded = await fetch(`${url}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      document: {
        name: 'Autonomous Loader',
        description: 'Proof-gated loading equipment.',
        category: 'Construction',
      },
    }),
  });
  assert.equal(uploaded.status, 201);
  const record = (await uploaded.json()) as StoredMachineMetadata;
  assert.match(record.contentDigest, /^0x[0-9a-f]{64}$/);
  assert.match(record.commitment, /^0x[0-9a-f]{64}$/);
  assert.equal(record.uri, `${url}/metadata/${record.contentDigest}`);

  const content = await fetch(record.uri);
  assert.equal(content.status, 200);
  assert.equal((await content.json()).name, 'Autonomous Loader');
  assert.match(content.headers.get('cache-control') ?? '', /immutable/);

  const byCommitment = await fetch(
    `${url}/metadata/commitments/${record.commitment}`,
  );
  assert.equal(byCommitment.status, 200);
  assert.equal((await byCommitment.json()).uri, record.uri);
});

test('rejects secret-bearing metadata before durable storage', async (context) => {
  storedMetadata = undefined;
  const { url } = await start(context);
  const response = await fetch(`${url}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ document: { name: 'Loader', privateKey: 'nope' } }),
  });
  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    'INVALID_METADATA',
  );
  assert.equal(storedMetadata, undefined);
});
