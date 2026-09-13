import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientFault, reportClientFault } from './telemetry.js';

test('client telemetry redacts public identifiers and excludes arbitrary errors', () => {
  let record = '';
  const previous = console.warn;
  console.warn = (value) => {
    record = String(value);
  };
  try {
    reportClientFault(
      clientFault('CREDITCOIN_RPC_UNAVAILABLE', 'creditcoin_rpc', true),
      `/proofs/0x${'ab'.repeat(32)}`,
    );
  } finally {
    console.warn = previous;
  }
  const parsed = JSON.parse(record) as Record<string, unknown>;
  assert.equal(parsed.code, 'CREDITCOIN_RPC_UNAVAILABLE');
  assert.equal(parsed.route, '/proofs/:public-identifier');
  assert.equal('message' in parsed, false);
  assert.equal(record.includes('ab'.repeat(32)), false);
});
