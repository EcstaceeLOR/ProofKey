import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RelayExecutor } from './executor.js';
import { RelayQueue } from './queue.js';
import { MemoryDurableStore } from './test-store.js';
import type { RelayJob } from './types.js';

const hash = `0x${'ef'.repeat(32)}`;

test('executes a persisted queue item independently from HTTP ingestion', async () => {
  const store = new MemoryDurableStore();
  await new RelayQueue(store).enqueue(hash);
  let calls = 0;
  const executor = new RelayExecutor(
    {
      process: async (transactionHash): Promise<RelayJob> => {
        calls += 1;
        const current = await store.get(transactionHash);
        assert.ok(current);
        const completed = { ...current, phase: 'completed' as const };
        await store.save(completed);
        return completed;
      },
    },
    store,
    {
      ownerId: 'worker-one',
      pollIntervalMs: 1,
      leaseDurationMs: 100,
      leaseHeartbeatMs: 50,
    },
  );

  assert.equal(await executor.runOnce(), true);
  assert.equal(calls, 1);
  assert.equal((await store.get(hash))?.phase, 'completed');
  assert.equal(await executor.runOnce(), false);
});
