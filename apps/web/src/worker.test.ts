import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProofWorkerUrl } from './worker.js';

test('normalizes a configured public relay URL', () => {
  assert.equal(
    normalizeProofWorkerUrl('https://proofkey-relay.onrender.com/', true),
    'https://proofkey-relay.onrender.com',
  );
});

test('rejects missing or malformed relay configuration', () => {
  assert.throws(
    () => normalizeProofWorkerUrl(undefined, false),
    /Set VITE_PROOF_WORKER_URL/,
  );
  assert.throws(
    () => normalizeProofWorkerUrl('not-a-url', false),
    /Set VITE_PROOF_WORKER_URL/,
  );
});

test('prevents localhost or insecure HTTP coupling in production', () => {
  assert.throws(
    () => normalizeProofWorkerUrl('http://127.0.0.1:8787', true),
    /public HTTPS proof relay/,
  );
  assert.throws(
    () => normalizeProofWorkerUrl('http://relay.example', true),
    /public HTTPS proof relay/,
  );
  assert.equal(
    normalizeProofWorkerUrl('http://127.0.0.1:8787', false),
    'http://127.0.0.1:8787',
  );
});
