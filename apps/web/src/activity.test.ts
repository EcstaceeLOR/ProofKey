import assert from 'node:assert/strict';
import test from 'node:test';
import type { UsageActivity } from './contracts.js';
import type { RelayJob } from './flow.js';
import {
  correlateRental,
  mergeOptimisticRentals,
  paginateRentals,
  readOptimisticRentals,
  type CorrelationState,
} from './activity.js';

const orderId = `0x${'11'.repeat(32)}`;
const machineId = `0x${'22'.repeat(32)}`;
const sourceTransactionHash = `0x${'33'.repeat(32)}`;
const payer = `0x${'44'.repeat(20)}`;
const payment: UsageActivity = {
  orderId,
  machineId,
  transactionHash: sourceTransactionHash,
  payer,
  beneficiary: `0x${'55'.repeat(20)}`,
  startTime: 900n,
  duration: 500n,
  amount: 1_250_000n,
  blockNumber: 100,
};
const chain: CorrelationState = {
  processed: false,
  authorizationId: `0x${'00'.repeat(32)}`,
  accessExpiresAt: 0,
  authorized: false,
  creditcoinTimestamp: 1_000,
};
const queued: RelayJob = {
  sourceTransactionHash,
  phase: 'queued',
  orderId,
  machineId,
  payer,
};

test('correlates pending through active and expired using Creditcoin time', () => {
  assert.equal(correlateRental(payment, queued, chain).status, 'pending');
  const active = correlateRental(
    payment,
    { ...queued, phase: 'completed' },
    {
      ...chain,
      processed: true,
      authorizationId: orderId,
      accessExpiresAt: 1_400,
      authorized: true,
      activationTransactionHash: `0x${'66'.repeat(32)}`,
    },
  );
  assert.equal(active.status, 'active');
  assert.equal(active.expiresAt, 1_400);
  const expired = correlateRental(
    payment,
    { ...queued, phase: 'completed' },
    {
      ...chain,
      processed: true,
      authorizationId: orderId,
      accessExpiresAt: 1_400,
      authorized: false,
      creditcoinTimestamp: 1_401,
      activationTransactionHash: `0x${'66'.repeat(32)}`,
    },
  );
  assert.equal(expired.status, 'expired');
});

test('classifies missing and failed relay work with an explicit next action', () => {
  const missing = correlateRental(payment, undefined, chain);
  assert.equal(missing.status, 'action-required');
  assert.match(missing.nextAction, /Resume/);
  const failed = correlateRental(
    payment,
    { ...queued, phase: 'failed', error: 'proof unavailable' },
    chain,
  );
  assert.equal(failed.status, 'failed');
  assert.equal(failed.diagnostic, 'proof unavailable');
});

test('fails closed when relay and on-chain correlations conflict', () => {
  const record = correlateRental(
    payment,
    { ...queued, orderId: `0x${'99'.repeat(32)}` },
    chain,
  );
  assert.equal(record.status, 'action-required');
  assert.equal(record.stateLabel, 'Correlation conflict');
  assert.match(record.diagnostic ?? '', /order ID conflicts/);
});

test('optimistic payments disappear when authoritative chain history arrives', () => {
  const authoritative = correlateRental(payment, queued, chain);
  const optimistic = [
    {
      machineId,
      sourceTransactionHash,
      durationSeconds: 500,
      account: payer,
      phase: 'confirming' as const,
      updatedAt: new Date().toISOString(),
    },
  ];
  assert.equal(mergeOptimisticRentals([authoritative], optimistic).length, 1);
  assert.equal(mergeOptimisticRentals([], optimistic)[0]?.optimistic, true);
});

test('local pending recovery is wallet-scoped and pagination is stable', () => {
  const other = `0x${'77'.repeat(20)}`;
  const values = [
    JSON.stringify({
      version: 1,
      machineId,
      durationSeconds: 500,
      phase: 'confirming',
      account: payer,
      sourceTransactionHash,
      updatedAt: new Date().toISOString(),
    }),
    JSON.stringify({
      version: 1,
      machineId,
      durationSeconds: 500,
      phase: 'confirming',
      account: other,
      sourceTransactionHash: `0x${'88'.repeat(32)}`,
      updatedAt: new Date().toISOString(),
    }),
  ];
  const storage = {
    length: values.length,
    key: (index: number) => `proofkey:0xregistry:${index}:source-transaction`,
    getItem: (key: string) => values[Number(key.split(':')[2])] ?? null,
  };
  const recovered = readOptimisticRentals(storage, '0xregistry', payer);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.account, payer);
  const records = Array.from({ length: 7 }, (_, index) => ({
    ...correlateRental(payment, queued, chain),
    sourceTransactionHash: `0x${String(index).padStart(64, '0')}`,
  }));
  const result = paginateRentals(records, 'pending', 2, 6);
  assert.equal(result.items.length, 1);
  assert.equal(result.page, 2);
});
