import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProofRelay } from './relay.js';
import type {
  AttestcoinProof,
  JobStore,
  RelayAdapter,
  RelayJob,
  RelayStatus,
  SourceReceipt,
  StatusReporter,
} from './types.js';

const hash = `0x${'ab'.repeat(32)}`;
const orderId = `0x${'01'.repeat(32)}`;
const machineId = `0x${'02'.repeat(32)}`;

const sourceReceipt: SourceReceipt = {
  blockNumber: 7_654_321,
  payment: {
    orderId,
    machineId,
    payer: '0x1111111111111111111111111111111111111111',
    beneficiary: '0x2222222222222222222222222222222222222222',
    startTime: '1720000000',
    duration: '3600',
    amount: '3600000000000000000',
  },
};

const proof: AttestcoinProof = {
  chainKey: 1,
  blockHeight: sourceReceipt.blockNumber,
  encodedTransaction: '0x01',
  merkleRoot: `0x${'03'.repeat(32)}`,
  siblings: [{ hash: `0x${'04'.repeat(32)}`, isLeft: true }],
  lowerEndpointDigest: `0x${'05'.repeat(32)}`,
  continuityRoots: [`0x${'06'.repeat(32)}`],
};

class MemoryStore implements JobStore {
  readonly jobs = new Map<string, RelayJob>();
  async get(transactionHash: string): Promise<RelayJob | undefined> {
    return this.jobs.get(transactionHash);
  }
  async save(job: RelayJob): Promise<void> {
    this.jobs.set(job.sourceTransactionHash, structuredClone(job));
  }
}

class MemoryReporter implements StatusReporter {
  readonly statuses: RelayStatus[] = [];
  report(status: RelayStatus): void {
    this.statuses.push(status);
  }
}

class FakeAdapter implements RelayAdapter {
  confirmations = 0;
  attestationWaits = 0;
  proofRequests = 0;
  submissions = 0;
  processed = false;
  submitFailures = 0;

  async confirmSourceTransaction(): Promise<SourceReceipt> {
    this.confirmations += 1;
    return sourceReceipt;
  }
  async waitUntilAttested(): Promise<void> {
    this.attestationWaits += 1;
  }
  async generateProof(): Promise<AttestcoinProof> {
    this.proofRequests += 1;
    return proof;
  }
  async isOrderProcessed(): Promise<boolean> {
    return this.processed;
  }
  async submitProof(): Promise<string> {
    this.submissions += 1;
    if (this.submissions <= this.submitFailures)
      throw new Error('temporary Creditcoin RPC failure');
    return `0x${'cd'.repeat(32)}`;
  }
}

const createRelay = (adapter = new FakeAdapter()) => {
  const store = new MemoryStore();
  const reporter = new MemoryReporter();
  const relay = new ProofRelay(adapter, store, reporter, {
    maxAttempts: 3,
    baseDelayMs: 1,
    sleep: async () => undefined,
    now: () => new Date('2026-09-12T10:00:00.000Z'),
  });
  return { adapter, store, reporter, relay };
};

test('processes a UsagePaid transaction through every observable phase', async () => {
  const { relay, reporter } = createRelay();
  const result = await relay.process(hash);

  assert.equal(result.phase, 'completed');
  assert.equal(result.orderId, orderId);
  assert.equal(result.sourceBlockNumber, sourceReceipt.blockNumber);
  assert.equal(result.accessExpiresAt, '1720003600');
  assert.equal(result.creditcoinTransactionHash, `0x${'cd'.repeat(32)}`);
  const transitions = reporter.statuses
    .filter((status) => status.attempt === undefined)
    .map((status) => status.phase);
  assert.deepEqual(transitions, [
    'source_confirmation',
    'attestation_wait',
    'proof_generation',
    'creditcoin_execution',
    'completed',
  ]);
});

test('treats a repeated completed job as a harmless duplicate', async () => {
  const { relay, adapter } = createRelay();
  await relay.process(hash);
  const duplicate = await relay.process(hash.toUpperCase().replace('0X', '0x'));

  assert.equal(duplicate.phase, 'duplicate');
  assert.equal(adapter.confirmations, 1);
  assert.equal(adapter.submissions, 1);
});

test('skips proof generation when the order is already processed on-chain', async () => {
  const adapter = new FakeAdapter();
  adapter.processed = true;
  const { relay } = createRelay(adapter);
  const result = await relay.process(hash);

  assert.equal(result.phase, 'duplicate');
  assert.equal(adapter.proofRequests, 0);
  assert.equal(adapter.submissions, 0);
});

test('bounds retries and records an actionable failed phase', async () => {
  const adapter = new FakeAdapter();
  adapter.submitFailures = 99;
  const { relay, store } = createRelay(adapter);

  await assert.rejects(
    relay.process(hash),
    /creditcoin_execution: temporary Creditcoin RPC failure/,
  );
  assert.equal(adapter.submissions, 3);
  const failed = await store.get(hash);
  assert.equal(failed?.phase, 'failed');
  assert.equal(failed?.failedAtPhase, 'creditcoin_execution');
  assert.equal(failed?.attempts.creditcoin_execution, 3);
});

test('rejects malformed hashes before touching either network', async () => {
  const { relay, adapter } = createRelay();
  await assert.rejects(
    relay.process('0x1234'),
    /32-byte Sepolia transaction hash/,
  );
  assert.equal(adapter.confirmations, 0);
});
