import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RelayQueue } from './queue.js';
import { MemoryDurableStore } from './test-store.js';

const hash = `0x${'ab'.repeat(32)}`;

test('atomically returns the existing job when a transaction is re-enqueued', async () => {
  const store = new MemoryDurableStore();
  const queue = new RelayQueue(store, () => new Date('2026-09-12T18:00:00Z'));

  const first = await queue.enqueue(hash);
  await store.save({ ...first, phase: 'proof_generation' });
  const second = await queue.enqueue(hash.toUpperCase().replace('0X', '0x'));

  assert.equal(first.phase, 'queued');
  assert.equal(second.phase, 'proof_generation');
  assert.equal(store.jobs.size, 1);
});

test('rejects malformed public job input before persistence', async () => {
  const store = new MemoryDurableStore();
  const queue = new RelayQueue(store);
  await assert.rejects(
    queue.enqueue('0x1234'),
    /32-byte Sepolia transaction hash/,
  );
  assert.equal(store.jobs.size, 0);
});
