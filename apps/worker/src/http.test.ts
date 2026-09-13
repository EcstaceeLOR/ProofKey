import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { createRelayHttpServer, type RelayHttpOptions } from './http.js';
import type { JobQueue } from './queue.js';
import type {
  DeviceHandoff,
  RelayJob,
  RelayReadiness,
  SignedUsageReceipt,
  StoredMachineMetadata,
} from './types.js';
import { usageReceiptMessage } from './usage-receipt.js';

const hash = `0x${'ab'.repeat(32)}`;
const paymentHash = `0x${'bc'.repeat(32)}`;
const orderId = `0x${'cd'.repeat(32)}`;
const machineId = `0x${'de'.repeat(32)}`;
const payer = '0x1111111111111111111111111111111111111111';
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
const handoffs = new Map<
  string,
  { handoff: DeviceHandoff; claimTokenHash?: string }
>();
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
    identifier.toLowerCase() === paymentHash
      ? {
          ...job,
          sourceTransactionHash: paymentHash,
          phase: 'completed',
          orderId,
          machineId,
          payer,
          accessExpiresAt: '2000000000',
        }
      : identifier.toLowerCase() === hash
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
  createDeviceHandoff: async (handoff) => {
    handoffs.set(handoff.nonce, { handoff });
  },
  getDeviceHandoff: async (nonce) => handoffs.get(nonce)?.handoff,
  claimDeviceHandoff: async (nonce, claimTokenHash, claimedAt) => {
    const record = handoffs.get(nonce);
    if (!record || record.claimTokenHash) return undefined;
    record.claimTokenHash = claimTokenHash;
    record.handoff = { ...record.handoff, claimedAt };
    return record.handoff;
  },
  putDeviceReceipt: async (nonce, claimTokenHash, receipt) => {
    const record = handoffs.get(nonce);
    if (!record || record.claimTokenHash !== claimTokenHash) return undefined;
    if (receipt.payload.kind === 'start' && !record.handoff.startReceipt)
      record.handoff = { ...record.handoff, startReceipt: receipt };
    else if (
      receipt.payload.kind === 'end' &&
      record.handoff.startReceipt &&
      !record.handoff.endReceipt
    )
      record.handoff = { ...record.handoff, endReceipt: receipt };
    else return undefined;
    return record.handoff;
  },
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

test('creates a short-lived one-time device handoff and stores a signed start receipt', async (context) => {
  handoffs.clear();
  const now = Date.parse('2026-09-13T12:00:00.000Z');
  const { url } = await start(context, { now: () => now });
  const createdResponse = await fetch(`${url}/device-handoffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ sourceTransactionHash: paymentHash }),
  });
  assert.equal(createdResponse.status, 201);
  const handoff = (await createdResponse.json()) as DeviceHandoff;
  assert.match(handoff.nonce, /^[0-9a-f]{64}$/);
  assert.equal(handoff.machineId, machineId);
  assert.equal(Date.parse(handoff.expiresAt) - now, 120_000);

  const claimResponse = await fetch(
    `${url}/device-handoffs/${handoff.nonce}/claim`,
    { method: 'POST' },
  );
  assert.equal(claimResponse.status, 200);
  const claim = (await claimResponse.json()) as {
    handoff: DeviceHandoff;
    claimToken: string;
  };
  assert.match(claim.claimToken, /^[0-9a-f]{64}$/);
  assert.equal(
    (
      await fetch(`${url}/device-handoffs/${handoff.nonce}/claim`, {
        method: 'POST',
      })
    ).status,
    409,
  );

  const controller = Wallet.createRandom();
  const payload = {
    schema: 'proofkey.usage-receipt.v1' as const,
    kind: 'start' as const,
    sessionId: keccak256(
      toUtf8Bytes(`proofkey-device-session:${handoff.nonce}`),
    ),
    machineId,
    payer,
    orderId,
    nonce: handoff.nonce,
    controller: controller.address,
    startedAt: '2026-09-13T12:00:10.000Z',
    endedAt: null,
    measuredDurationSeconds: 0,
    accessExpiresAt: handoff.accessExpiresAt,
  };
  const receipt: SignedUsageReceipt = {
    payload,
    signature: await controller.signMessage(usageReceiptMessage(payload)),
  };
  const stored = await fetch(
    `${url}/device-handoffs/${handoff.nonce}/receipts`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ProofKey-Claim-Token': claim.claimToken,
      },
      body: JSON.stringify(receipt),
    },
  );
  assert.equal(stored.status, 201);
  assert.equal(
    ((await stored.json()) as DeviceHandoff).startReceipt?.payload.controller,
    controller.address,
  );
});

test('rejects an expired QR claim', async (context) => {
  handoffs.clear();
  let now = Date.parse('2026-09-13T12:00:00.000Z');
  const { url } = await start(context, { now: () => now });
  const created = (await (
    await fetch(`${url}/device-handoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceTransactionHash: paymentHash }),
    })
  ).json()) as DeviceHandoff;
  now += 120_001;
  const expired = await fetch(`${url}/device-handoffs/${created.nonce}/claim`, {
    method: 'POST',
  });
  assert.equal(expired.status, 410);
  assert.equal(
    ((await expired.json()) as { error: { code: string } }).error.code,
    'HANDOFF_EXPIRED',
  );
});
