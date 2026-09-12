import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration, progressFromJob, totalForDuration } from './flow.js';

const job = (phase: Parameters<typeof progressFromJob>[0]['phase']) => ({
  sourceTransactionHash: `0x${'ab'.repeat(32)}`,
  phase,
});

test('never reports verification before Creditcoin execution succeeds', () => {
  for (const phase of [
    'queued',
    'source_confirmation',
    'attestation_wait',
    'proof_generation',
    'creditcoin_execution',
    'failed',
  ] as const) {
    assert.equal(progressFromJob(job(phase)).verified, false, phase);
  }
});

test('completed and on-chain duplicate jobs are verified', () => {
  assert.equal(progressFromJob(job('completed')).verified, true);
  assert.equal(progressFromJob(job('duplicate')).verified, true);
});

test('maps Attestcoin and Creditcoin phases to clear journey steps', () => {
  assert.equal(progressFromJob(job('attestation_wait')).active, 'proof');
  assert.equal(progressFromJob(job('proof_generation')).active, 'proof');
  assert.equal(progressFromJob(job('creditcoin_execution')).active, 'unlock');
});

test('calculates exact token units without floating point arithmetic', () => {
  assert.equal(totalForDuration(2_500n, 1_800), 4_500_000n);
  assert.throws(() => totalForDuration(2_500n, 0), /positive integer/);
});

test('formats rental windows for first-time users', () => {
  assert.equal(formatDuration(3_600), '1 hour');
  assert.equal(formatDuration(14_400), '4 hours');
  assert.equal(formatDuration(900), '15 minutes');
});
