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
    const metadata = {
      contentDigest: `0x${'12'.repeat(32)}`,
      commitment: `0x${'34'.repeat(32)}`,
      uri: `https://relay.example/metadata/0x${'12'.repeat(32)}`,
      document: { name: 'Persistent Loader' },
      createdAt: '2026-09-13T12:00:00.000Z',
    };
    await restartedProcess.putMetadata(metadata);
    assert.equal(
      (await restartedProcess.getMetadataByDigest(metadata.contentDigest))
        ?.document.name,
      'Persistent Loader',
    );
    assert.equal(
      (await restartedProcess.getMetadataByCommitment(metadata.commitment))
        ?.uri,
      metadata.uri,
    );
    const handoff = {
      schema: 'proofkey.device-handoff.v1' as const,
      nonce: '56'.repeat(32),
      machineId: `0x${'67'.repeat(32)}`,
      payer: '0x1111111111111111111111111111111111111111',
      orderId: `0x${'78'.repeat(32)}`,
      sourceTransactionHash: hash,
      accessExpiresAt: '2000000000',
      createdAt: '2026-09-13T12:00:00.000Z',
      expiresAt: '2026-09-13T12:02:00.000Z',
    };
    await restartedProcess.createDeviceHandoff(handoff);
    assert.equal(
      (await restartedProcess.getDeviceHandoff(handoff.nonce))?.orderId,
      handoff.orderId,
    );
    assert.ok(
      await restartedProcess.claimDeviceHandoff(
        handoff.nonce,
        '89'.repeat(32),
        '2026-09-13T12:00:10.000Z',
      ),
    );
    assert.equal(
      await restartedProcess.claimDeviceHandoff(
        handoff.nonce,
        '90'.repeat(32),
        '2026-09-13T12:00:11.000Z',
      ),
      undefined,
    );
    const recovered = await restartedProcess.claimNext(
      'worker-after-restart',
      1_000,
    );
    assert.equal(recovered?.sourceTransactionHash, hash);
    await restartedProcess.release(hash, 'worker-after-restart');
    await restartedProcess.close();
  },
);
