import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { test } from 'node:test';
import { PostgresJobStore } from './store.js';
import type { RelayJob } from './types.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaName = 'proofkey_integration';
const hash = `0x${'ab'.repeat(32)}`;
const job: RelayJob = {
  sourceTransactionHash: hash,
  phase: 'queued',
  createdAt: '2026-09-12T10:00:00.000Z',
  updatedAt: '2026-09-12T10:00:00.000Z',
  attempts: {},
};

test(
  'Postgres atomically deduplicates and recovers an expired in-flight lease',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.end();

    const firstProcess = new PostgresJobStore(databaseUrl, { schemaName });
    const first = await firstProcess.create(job);
    const duplicate = await firstProcess.create({
      ...job,
      phase: 'source_confirmation',
    });
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.job.phase, 'queued');
    assert.equal(
      (await firstProcess.claimNext('worker-before-restart', 20))?.phase,
      'queued',
    );
    await firstProcess.close();

    await delay(35);
    const restartedProcess = new PostgresJobStore(databaseUrl, { schemaName });
    const recovered = await restartedProcess.claimNext(
      'worker-after-restart',
      1_000,
    );
    assert.equal(recovered?.sourceTransactionHash, hash);
    await restartedProcess.release(hash, 'worker-after-restart');
    await restartedProcess.close();
  },
);
