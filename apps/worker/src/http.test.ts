import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createRelayHttpServer } from './http.js';
import type { JobQueue } from './queue.js';
import type { RelayJob } from './types.js';

const hash = `0x${'ab'.repeat(32)}`;
const job: RelayJob = {
  sourceTransactionHash: hash,
  phase: 'queued',
  createdAt: '2026-09-12T18:00:00.000Z',
  updatedAt: '2026-09-12T18:00:00.000Z',
  attempts: {},
};

test('accepts browser relay jobs and exposes their public status', async (context) => {
  const queue: JobQueue = {
    enqueue: async (transactionHash) => ({
      ...job,
      sourceTransactionHash: transactionHash,
    }),
    get: async (transactionHash) =>
      transactionHash.toLowerCase() === hash
        ? { ...job, phase: 'proof_generation' }
        : undefined,
  };
  const server = createRelayHttpServer(queue, 'http://localhost:5173');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const port = (server.address() as AddressInfo).port;

  const accepted = await fetch(`http://127.0.0.1:${port}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionHash: hash }),
  });
  assert.equal(accepted.status, 202);
  assert.equal(
    accepted.headers.get('access-control-allow-origin'),
    'http://localhost:5173',
  );

  const status = await fetch(`http://127.0.0.1:${port}/jobs/${hash}`);
  assert.equal(status.status, 200);
  assert.equal(((await status.json()) as RelayJob).phase, 'proof_generation');
});
