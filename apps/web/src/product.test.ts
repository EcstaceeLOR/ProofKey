import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactHash,
  isTransactionHash,
  machinePath,
  productRoutes,
  proofPath,
  rentalStorageKey,
  rentPath,
} from './product.js';

test('Product V1 exposes every required route', () => {
  assert.deepEqual(productRoutes, [
    '/',
    '/explore',
    '/machines/:machineId',
    '/rent/:machineId',
    '/activity',
    '/sessions/:sourceTransactionHash',
    '/proofs/:sourceTxHash',
    '/operator',
    '/diagnostics',
    '/device/:machineId',
  ]);
});

test('transaction hashes are validated before proof lookup', () => {
  assert.equal(isTransactionHash(`0x${'a1'.repeat(32)}`), true);
  assert.equal(isTransactionHash('0x1234'), false);
  assert.equal(isTransactionHash(`0x${'z'.repeat(64)}`), false);
});

test('product links preserve their route identifiers', () => {
  assert.equal(machinePath('machine-7'), '/machines/machine-7');
  assert.equal(rentPath('machine-7'), '/rent/machine-7');
  assert.equal(proofPath(`0x${'b'.repeat(64)}`), `/proofs/0x${'b'.repeat(64)}`);
});

test('rental recovery state is namespaced by registry and machine', () => {
  assert.equal(
    rentalStorageKey('0xABCDEF', 'machine-7'),
    'proofkey:0xabcdef:machine-7:source-transaction',
  );
});

test('long hashes are compacted without changing short identifiers', () => {
  assert.equal(compactHash('machine-7'), 'machine-7');
  assert.equal(compactHash('0x1234567890abcdef'), '0x123456…abcdef');
});
