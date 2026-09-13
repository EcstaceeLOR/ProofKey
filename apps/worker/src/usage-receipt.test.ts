import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';
import type {
  DeviceHandoff,
  SignedUsageReceipt,
  UsageReceiptPayload,
} from './types.js';
import { assertUsageReceipt, usageReceiptMessage } from './usage-receipt.js';

const controller = Wallet.createRandom();
const handoff: DeviceHandoff = {
  schema: 'proofkey.device-handoff.v1',
  nonce: 'ab'.repeat(32),
  machineId: `0x${'12'.repeat(32)}`,
  payer: '0x1111111111111111111111111111111111111111',
  orderId: `0x${'34'.repeat(32)}`,
  sourceTransactionHash: `0x${'56'.repeat(32)}`,
  accessExpiresAt: '2000000000',
  createdAt: '2026-09-13T12:00:00.000Z',
  expiresAt: '2026-09-13T12:02:00.000Z',
  claimedAt: '2026-09-13T12:00:10.000Z',
};

async function signed(
  payload: UsageReceiptPayload,
): Promise<SignedUsageReceipt> {
  return {
    payload,
    signature: await controller.signMessage(usageReceiptMessage(payload)),
  };
}

test('accepts controller-signed start and end receipts with exact measured duration', async () => {
  const startPayload: UsageReceiptPayload = {
    schema: 'proofkey.usage-receipt.v1',
    kind: 'start',
    sessionId: keccak256(
      toUtf8Bytes(`proofkey-device-session:${handoff.nonce}`),
    ),
    machineId: handoff.machineId,
    payer: handoff.payer,
    orderId: handoff.orderId,
    nonce: handoff.nonce,
    controller: controller.address,
    startedAt: '2026-09-13T12:00:20.000Z',
    endedAt: null,
    measuredDurationSeconds: 0,
    accessExpiresAt: handoff.accessExpiresAt,
  };
  const startReceipt = await signed(startPayload);
  assert.doesNotThrow(() => assertUsageReceipt(handoff, startReceipt));

  const endPayload: UsageReceiptPayload = {
    ...startPayload,
    kind: 'end',
    endedAt: '2026-09-13T12:00:30.000Z',
    measuredDurationSeconds: 10,
  };
  const endReceipt = await signed(endPayload);
  assert.doesNotThrow(() =>
    assertUsageReceipt({ ...handoff, startReceipt }, endReceipt),
  );
});

test('rejects field tampering, a foreign signer, and falsified duration', async () => {
  const payload: UsageReceiptPayload = {
    schema: 'proofkey.usage-receipt.v1',
    kind: 'start',
    sessionId: keccak256(
      toUtf8Bytes(`proofkey-device-session:${handoff.nonce}`),
    ),
    machineId: handoff.machineId,
    payer: handoff.payer,
    orderId: handoff.orderId,
    nonce: handoff.nonce,
    controller: controller.address,
    startedAt: '2026-09-13T12:00:20.000Z',
    endedAt: null,
    measuredDurationSeconds: 0,
    accessExpiresAt: handoff.accessExpiresAt,
  };
  const receipt = await signed(payload);
  assert.throws(() =>
    assertUsageReceipt(handoff, {
      ...receipt,
      payload: { ...payload, orderId: `0x${'99'.repeat(32)}` },
    }),
  );
  const foreign = Wallet.createRandom();
  assert.throws(() =>
    assertUsageReceipt(handoff, {
      payload,
      signature: foreign.signingKey.sign(keccak256(toUtf8Bytes('wrong')))
        .serialized,
    }),
  );
  const endPayload: UsageReceiptPayload = {
    ...payload,
    kind: 'end',
    endedAt: '2026-09-13T12:00:30.000Z',
    measuredDurationSeconds: 9,
  };
  assert.throws(() =>
    assertUsageReceipt(
      { ...handoff, startReceipt: receipt },
      {
        payload: endPayload,
        signature: controller.signingKey.sign(
          keccak256(toUtf8Bytes(usageReceiptMessage(endPayload))),
        ).serialized,
      },
    ),
  );
});
