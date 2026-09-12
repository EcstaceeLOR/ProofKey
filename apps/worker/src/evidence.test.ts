import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assertPublicEvidence, writePublicEvidence } from './evidence.js';

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
