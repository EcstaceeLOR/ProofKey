import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { AppConfig } from './contracts.js';
import { runDiagnostics } from './diagnostics.js';

const originalFetch = globalThis.fetch;
const config = {
  workerUrl: 'https://relay.example',
  sepoliaRpcUrl: 'https://sepolia.example',
  creditcoinRpcUrl: 'https://creditcoin.example',
} as AppConfig;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('reports ready only when relay readiness and both chain IDs pass', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'alive' });
    if (url.endsWith('/ready')) return Response.json({ status: 'ready' });
    return Response.json({
      result: url.includes('sepolia') ? '0xaa36a7' : '0x18e8f',
    });
  };
  const result = await runDiagnostics(config);
  assert.equal(result.status, 'ready');
  assert.equal(
    result.checks.filter((check) => check.status === 'ready').length,
    4,
  );
});

test('wrong chain and degraded relay remain explicit without leaking URLs', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'alive' });
    if (url.endsWith('/ready'))
      return Response.json({ status: 'degraded' }, { status: 503 });
    return Response.json({ result: '0x1' });
  };
  const result = await runDiagnostics(config);
  assert.equal(result.status, 'unavailable');
  assert.equal(
    result.checks.find((check) => check.id === 'relay')?.status,
    'degraded',
  );
  assert.ok(result.checks.every((check) => !check.detail.includes('example')));
});
