import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RelayQueue, type RelayRunner } from './queue.js';
import type { JobStore, RelayJob } from './types.js';

const hash = `0x${'ab'.repeat(32)}`;

class MemoryStore implements JobStore {
  readonly jobs = new Map<string, RelayJob>();
  async get(transactionHash: string): Promise<RelayJob | undefined> {
    return this.jobs.get(transactionHash);
  }
  async save(job: RelayJob): Promise<void> {
    this.jobs.set(job.sourceTransactionHash, structuredClone(job));
  }
}

test('queues a transaction once while relay processing is active', async () => {
  const store = new MemoryStore();
  let finish: ((job: RelayJob) => void) | undefined;
  let calls = 0;
  const runner: RelayRunner = {
    process: () => {
      calls += 1;
      return new Promise((resolve) => (finish = resolve));
    },
  };
  const queue = new RelayQueue(
    runner,
    store,
    () => new Date('2026-09-12T18:00:00Z'),
  );

  const first = await queue.enqueue(hash);
  const second = await queue.enqueue(hash);
  assert.equal(first.phase, 'queued');
  assert.equal(second.phase, 'queued');
  assert.equal(calls, 1);
  finish?.(first);
});

test('rejects malformed public job input before starting the relay', async () => {
  const store = new MemoryStore();
  const runner: RelayRunner = {
    process: async () => assert.fail('relay must not start'),
  };
  const queue = new RelayQueue(runner, store);
  await assert.rejects(
    queue.enqueue('0x1234'),
    /32-byte Sepolia transaction hash/,
  );
});
