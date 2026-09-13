import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFreshOffer, type MachineOffer } from './contracts.js';
import {
  canCreatePayment,
  checkoutBlockers,
  createRentalSession,
  MAX_DURATION_SECONDS,
  parseRentalSession,
  updateRentalSession,
  validateDuration,
} from './rental.js';

const machineId = `0x${'01'.repeat(32)}`;
const offer: MachineOffer = {
  beneficiary: `0x${'11'.repeat(20)}`,
  pricePerSecond: 2_500n,
  active: true,
  tokenAddress: `0x${'22'.repeat(20)}`,
  tokenDecimals: 6,
  tokenSymbol: 'pkUSDC',
};

test('accepts exact custom durations only within contract bounds', () => {
  assert.equal(validateDuration(1), 1);
  assert.equal(validateDuration(MAX_DURATION_SECONDS), MAX_DURATION_SECONDS);
  assert.throws(() => validateDuration(0), /1 second to 30 days/);
  assert.throws(() => validateDuration(1.5), /whole number/);
});

test('success state persists source and destination evidence', () => {
  const paid = updateRentalSession(createRentalSession(machineId), {
    phase: 'access',
    sourceTransactionHash: `0x${'33'.repeat(32)}`,
    creditcoinTransactionHash: `0x${'44'.repeat(32)}`,
    orderId: `0x${'55'.repeat(32)}`,
    startTime: '1000',
    expiresAt: '4600',
  });
  const restored = parseRentalSession(JSON.stringify(paid), machineId);
  assert.equal(restored?.phase, 'access');
  assert.equal(restored?.expiresAt, '4600');
  assert.equal(canCreatePayment(restored!), false);
});

test('rejected prompts do not invent a payment to resume', () => {
  const session = updateRentalSession(createRentalSession(machineId), {
    phase: 'payment',
  });
  assert.equal(session.sourceTransactionHash, undefined);
  assert.equal(canCreatePayment(session), true);
});

test('underfunding and missing gas block checkout independently', () => {
  assert.deepEqual(
    checkoutBlockers({ balanceSufficient: false, gasSufficient: true }),
    ['token-balance'],
  );
  assert.deepEqual(
    checkoutBlockers({ balanceSufficient: true, gasSufficient: false }),
    ['gas-balance'],
  );
});

test('stale beneficiary or tariff is rejected immediately before payment', () => {
  assert.doesNotThrow(() => assertFreshOffer(offer, { ...offer }));
  assert.throws(
    () => assertFreshOffer(offer, { ...offer, pricePerSecond: 2_501n }),
    /offer changed/,
  );
  assert.throws(
    () =>
      assertFreshOffer(offer, {
        ...offer,
        beneficiary: `0x${'99'.repeat(20)}`,
      }),
    /offer changed/,
  );
});

test('malformed persisted state is ignored after storage or RPC interruption', () => {
  assert.equal(parseRentalSession('{interrupted', machineId), undefined);
  assert.equal(
    parseRentalSession(
      JSON.stringify({
        version: 1,
        machineId,
        phase: 'relay',
        durationSeconds: 0,
      }),
      machineId,
    ),
    undefined,
  );
});
