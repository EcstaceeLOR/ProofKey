import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';
import {
  deriveDeviceSession,
  usageReceiptMessage,
  verifyUsageReceipt,
  type DeviceAuthorization,
  type DeviceHandoff,
  type SignedUsageReceipt,
} from './device-session.js';

const controller = Wallet.createRandom();
const handoff: DeviceHandoff = {
  schema: 'proofkey.device-handoff.v1',
  nonce: 'ab'.repeat(32),
  machineId: `0x${'12'.repeat(32)}`,
  payer: '0x1111111111111111111111111111111111111111',
  orderId: `0x${'34'.repeat(32)}`,
  sourceTransactionHash: `0x${'56'.repeat(32)}`,
  accessExpiresAt: '200',
  createdAt: '1970-01-01T00:01:00.000Z',
  expiresAt: '1970-01-01T00:02:00.000Z',
  claimedAt: '1970-01-01T00:01:01.000Z',
};
const authorization: DeviceAuthorization = {
  authorized: true,
  authorizationId: handoff.orderId,
  expiresAt: 200n,
  machineActive: true,
  controller: controller.address,
  blockNumber: 42,
  blockTimestamp: 100,
};

test('session unlocks only for the exact live machine, payer order, and expiry', () => {
  assert.equal(
    deriveDeviceSession(handoff, undefined, 100).state,
    'awaiting_authorization',
  );
  assert.equal(
    deriveDeviceSession(handoff, authorization, 100).state,
    'unlocked',
  );
  assert.equal(
    deriveDeviceSession(
      handoff,
      { ...authorization, authorizationId: `0x${'ff'.repeat(32)}` },
      100,
    ).state,
    'fail_closed',
  );
  assert.equal(
    deriveDeviceSession(
      handoff,
      { ...authorization, machineActive: false },
      100,
    ).state,
    'fail_closed',
  );
});

test('active sessions warn before expiry and stop without extending access', () => {
  const started: DeviceHandoff = {
    ...handoff,
    startReceipt: {} as SignedUsageReceipt,
  };
  assert.equal(
    deriveDeviceSession(started, authorization, 100).state,
    'active',
  );
  assert.equal(
    deriveDeviceSession(started, authorization, 150).state,
    'expiring',
  );
  assert.equal(
    deriveDeviceSession(started, authorization, 200).state,
    'expired',
  );
  assert.equal(
    deriveDeviceSession(
      { ...started, endReceipt: {} as SignedUsageReceipt },
      authorization,
      110,
    ).state,
    'stopped',
  );
});

test('RPC failure immediately fails closed even after a successful read', () => {
  assert.equal(
    deriveDeviceSession(handoff, authorization, 100, 'RPC unavailable').state,
    'fail_closed',
  );
});

test('an invalid stored receipt forces a reconstructed session closed', () => {
  const stopped = {
    ...handoff,
    endReceipt: {} as SignedUsageReceipt,
  };
  assert.equal(
    deriveDeviceSession(
      stopped,
      authorization,
      100,
      'invalid receipt signature',
    ).state,
    'fail_closed',
  );
});

test('controller receipt verifies locally and any bound field tampering fails', async () => {
  const payload = {
    schema: 'proofkey.usage-receipt.v1' as const,
    kind: 'start' as const,
    sessionId: keccak256(
      toUtf8Bytes(`proofkey-device-session:${handoff.nonce}`),
    ),
    machineId: handoff.machineId,
    payer: handoff.payer,
    orderId: handoff.orderId,
    nonce: handoff.nonce,
    controller: controller.address,
    startedAt: '1970-01-01T00:01:40.000Z',
    endedAt: null,
    measuredDurationSeconds: 0,
    accessExpiresAt: handoff.accessExpiresAt,
  };
  const receipt: SignedUsageReceipt = {
    payload,
    signature: await controller.signMessage(usageReceiptMessage(payload)),
  };
  assert.equal(
    verifyUsageReceipt(receipt, handoff, controller.address).valid,
    true,
  );
  assert.equal(
    verifyUsageReceipt(
      { ...receipt, payload: { ...payload, orderId: `0x${'99'.repeat(32)}` } },
      handoff,
      controller.address,
    ).valid,
    false,
  );
  assert.equal(
    verifyUsageReceipt(receipt, handoff, Wallet.createRandom().address).valid,
    false,
  );
});
