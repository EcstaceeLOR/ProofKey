import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { JsonJobStore } from './store.js';
import type { RelayJob } from './types.js';

test('persists only the public relay job supplied to the store', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'proofkey-worker-'));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'jobs.json');
  const store = new JsonJobStore(file);
  const job: RelayJob = {
    sourceTransactionHash: `0x${'ab'.repeat(32)}`,
    phase: 'queued',
    createdAt: '2026-09-12T10:00:00.000Z',
    updatedAt: '2026-09-12T10:00:00.000Z',
    attempts: {},
  };

  await store.save(job);
  await store.save({ ...job, phase: 'source_confirmation' });
  const serialized = await readFile(file, 'utf8');
  assert.doesNotMatch(serialized, /private.?key/i);
  assert.deepEqual(await store.get(job.sourceTransactionHash), {
    ...job,
    phase: 'source_confirmation',
  });
});
