import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  assertSafePublicEvidence,
  computeProofInvariants,
  type AttestcoinEvidence,
  type PublicProofEvidence,
} from './proof.js';

interface RecordedProof {
  source: { transactionHash: string; blockNumber: number };
  proof: AttestcoinEvidence;
}

interface RecordedRun {
  demo: { tariff: string; machineOwner: string };
  deployments: {
    sepolia: { usagePaymentRegistry: { address: string } };
  };
  payment: {
    orderId: string;
    machineId: string;
    payer: string;
    beneficiary: string;
    startTime: string;
    duration: string;
    amount: string;
    transactionHash: string;
    blockNumber: number;
  };
  authorization: { expiresAt: string };
}

async function recordedFixture() {
  const [proof, run] = await Promise.all([
    readFile(
      new URL(
        '../../../packages/contracts/fixtures/recorded-live-proof.json',
        import.meta.url,
      ),
      'utf8',
    ).then((value) => JSON.parse(value) as RecordedProof),
    readFile(
      new URL(
        '../../../packages/contracts/deployments/live-mvp.json',
        import.meta.url,
      ),
      'utf8',
    ).then((value) => JSON.parse(value) as RecordedRun),
  ]);
  return { proof, run };
}

test('decodes the recorded live Attestcoin proof into passing invariants', async () => {
  const { proof, run } = await recordedFixture();
  const evidence: PublicProofEvidence = {
    schema: 'proofkey.public-proof.v1',
    source: {
      transactionHash: proof.source.transactionHash,
      blockNumber: proof.source.blockNumber,
      payment: run.payment,
    },
    relay: {
      phase: 'completed',
      createdAt: '2026-09-12T20:50:00.000Z',
      updatedAt: '2026-09-12T20:57:50.109Z',
      attempts: {},
    },
    attestcoin: proof.proof,
    creditcoin: { accessExpiresAt: run.authorization.expiresAt },
  };
  const invariants = computeProofInvariants(
    evidence,
    {
      receiptStatus: 1,
      sourceTo: run.deployments.sepolia.usagePaymentRegistry.address,
      sourceFrom: run.payment.payer,
      payment: run.payment,
      machine: {
        owner: run.demo.machineOwner,
        tariff: run.demo.tariff,
        active: true,
      },
      orderProcessed: true,
      authorizationId: run.payment.orderId,
      accessExpiresAt: run.authorization.expiresAt,
    },
    { registryAddress: run.deployments.sepolia.usagePaymentRegistry.address },
  );

  assert.equal(invariants.length, 11);
  assert.deepEqual(
    invariants.filter((item) => item.status !== 'pass'),
    [],
  );
  assert.equal(
    invariants.find((item) => item.key === 'tariff')?.expected,
    run.payment.amount,
  );
});

test('marks mismatched proof values as failures with expected and actual values', async () => {
  const { proof, run } = await recordedFixture();
  const evidence: PublicProofEvidence = {
    schema: 'proofkey.public-proof.v1',
    source: {
      transactionHash: run.payment.transactionHash,
      blockNumber: run.payment.blockNumber,
      payment: { ...run.payment, amount: '1' },
    },
    relay: {
      phase: 'failed',
      createdAt: '2026-09-12T20:50:00.000Z',
      updatedAt: '2026-09-12T20:57:50.109Z',
      attempts: {},
    },
    attestcoin: { ...proof.proof, chainKey: 2 },
    creditcoin: {},
  };
  const invariants = computeProofInvariants(
    evidence,
    {
      receiptStatus: 0,
      sourceTo: run.deployments.sepolia.usagePaymentRegistry.address,
      sourceFrom: run.payment.payer,
      payment: evidence.source.payment,
      machine: {
        owner: run.demo.machineOwner,
        tariff: run.demo.tariff,
        active: true,
      },
      orderProcessed: false,
    },
    { registryAddress: run.deployments.sepolia.usagePaymentRegistry.address },
  );
  assert.equal(
    invariants.find((item) => item.key === 'receipt')?.status,
    'fail',
  );
  assert.equal(
    invariants.find((item) => item.key === 'chain-key')?.actual,
    'chain key 2',
  );
  assert.equal(
    invariants.find((item) => item.key === 'tariff')?.status,
    'fail',
  );
});

test('raw evidence export rejects secret-bearing fields recursively', () => {
  assert.throws(
    () => assertSafePublicEvidence({ proof: { workerPrivateKey: '0xdead' } }),
    /Unsafe public evidence field/,
  );
  assert.doesNotThrow(() =>
    assertSafePublicEvidence({ proof: { merkleRoot: `0x${'12'.repeat(32)}` } }),
  );
});
