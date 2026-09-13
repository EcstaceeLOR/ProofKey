import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveWalletView,
  describeWalletError,
  formatWalletBalance,
  SEPOLIA_CHAIN_ID,
} from './state.js';

const firstAccount = `0x${'11'.repeat(20)}`;
const secondAccount = `0x${'22'.repeat(20)}`;

test('connect moves an authorized Sepolia account to the ready state', () => {
  assert.equal(
    deriveWalletView({
      status: 'connected',
      address: firstAccount,
      chainId: SEPOLIA_CHAIN_ID,
    }),
    'connected',
  );
});

test('reject produces an actionable, non-transactional explanation', () => {
  const rejection = { code: 4001, message: 'User rejected the request.' };
  assert.equal(
    deriveWalletView({ status: 'disconnected', error: rejection }),
    'rejected',
  );
  assert.match(describeWalletError(rejection), /No signature or transaction/);
});

test('disconnect clears the connected view', () => {
  assert.equal(
    deriveWalletView({ status: 'disconnected', chainId: SEPOLIA_CHAIN_ID }),
    'disconnected',
  );
});

test('account changes preserve readiness while replacing the address', () => {
  const before = {
    status: 'connected' as const,
    address: firstAccount,
    chainId: SEPOLIA_CHAIN_ID,
  };
  const after = { ...before, address: secondAccount };
  assert.notEqual(before.address, after.address);
  assert.equal(deriveWalletView(before), 'connected');
  assert.equal(deriveWalletView(after), 'connected');
});

test('chain changes require Sepolia before signing is enabled', () => {
  assert.equal(
    deriveWalletView({
      status: 'connected',
      address: firstAccount,
      chainId: 1,
    }),
    'wrong-network',
  );
  assert.equal(
    deriveWalletView({
      status: 'connected',
      address: firstAccount,
      chainId: SEPOLIA_CHAIN_ID,
    }),
    'connected',
  );
});

test('balances remain readable without inventing precision', () => {
  assert.equal(formatWalletBalance('1.23456789', 'ETH'), '1.2346 ETH');
  assert.equal(formatWalletBalance(undefined, 'ETH'), '—');
});
