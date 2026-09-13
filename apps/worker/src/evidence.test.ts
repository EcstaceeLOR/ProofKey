import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  assertPublicEvidence,
  publicEvidenceFromJob,
  writePublicEvidence,
} from './evidence.js';

test('accepts public chain evidence and payment-token fields', () => {
  assert.doesNotThrow(() =>
    assertPublicEvidence({
      paymentToken: { address: `0x${'11'.repeat(20)}` },
      explorerUrl: 'https://example.test/tx/0x1234',
      proof: { merkleRoot: `0x${'22'.repeat(32)}` },
    }),
  );
});

test('rejects nested secret and RPC fields', () => {
  assert.throws(
    () => assertPublicEvidence({ configuration: { rpcUrl: 'https://secret' } }),
    /Refusing to persist secret-bearing field/,
  );
  assert.throws(
    () => assertPublicEvidence({ workerPrivateKey: `0x${'ab'.repeat(32)}` }),
    /Refusing to persist secret-bearing field/,
  );
  assert.throws(
    () => assertPublicEvidence({ relay: { internalPath: '/srv/proof.json' } }),
    /Refusing to persist secret-bearing field/,
  );
});

test('writes labeled public evidence without secret material', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'proofkey-evidence-'));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, 'evidence.json');
  const evidence = {
    provenance: { kind: 'recorded-live', fresh: false },
    sourceTransactionHash: `0x${'ab'.repeat(32)}`,
  };

  await writePublicEvidence(outputPath, evidence);

  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), evidence);
});

test('builds a recursively safe public proof record from a relay job', () => {
  const evidence = publicEvidenceFromJob({
    sourceTransactionHash: `0x${'ab'.repeat(32)}`,
    phase: 'completed',
    createdAt: '2026-09-13T10:00:00.000Z',
    updatedAt: '2026-09-13T10:05:00.000Z',
    attempts: { proof_generation: 1 },
    sourceBlockNumber: 123,
    sourcePayment: {
      orderId: `0x${'01'.repeat(32)}`,
      machineId: `0x${'02'.repeat(32)}`,
      payer: '0x1111111111111111111111111111111111111111',
      beneficiary: '0x2222222222222222222222222222222222222222',
      startTime: '1000',
      duration: '60',
      amount: '600',
    },
    proof: {
      chainKey: 1,
      blockHeight: 123,
      encodedTransaction: '0x01',
      merkleRoot: `0x${'03'.repeat(32)}`,
      siblings: [],
      lowerEndpointDigest: `0x${'04'.repeat(32)}`,
      continuityRoots: [],
    },
  });
  assert.equal(evidence.schema, 'proofkey.public-proof.v1');
  assert.equal(evidence.source.payment?.amount, '600');
  assert.doesNotThrow(() => assertPublicEvidence(evidence));
  assert.equal(JSON.stringify(evidence).includes('rpcUrl'), false);
});
