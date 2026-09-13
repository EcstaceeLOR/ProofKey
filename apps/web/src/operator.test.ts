import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Eip1193Provider } from 'ethers';
import {
  OperatorClient,
  assertOperatorAccount,
  createOperatorSession,
  loadOperatorSession,
  machineIdFromLabel,
  metadataDocument,
  operatorStorageKey,
  saveOperatorSession,
  switchWalletChain,
  updateOperatorSession,
  validateMachineDraft,
  type MachineDraft,
} from './operator.js';
import type { AppConfig } from './contracts.js';

const owner = '0x1111111111111111111111111111111111111111';
const draft: MachineDraft = {
  label: 'fleet.loader.042',
  name: 'Autonomous Wheel Loader',
  description: 'A proof-gated loader for an active construction site.',
  image: 'loader',
  category: 'Construction',
  city: 'Lagos',
  country: 'Nigeria',
  site: 'Lekki Yard · Bay 2',
  capabilities: 'GPS telemetry, Remote controller',
  safetyRequirements: 'Operator briefing, PPE',
  controller: owner,
  tariff: '2500',
  active: true,
};

test('creates and resumes a deterministic partial onboarding session', () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const created = createOperatorSession(owner, draft);
  const partial = updateOperatorSession(created, {
    phase: 'metadata_uploaded',
    metadata: {
      contentDigest: `0x${'12'.repeat(32)}`,
      commitment: `0x${'34'.repeat(32)}`,
      uri: `https://relay.example/metadata/0x${'12'.repeat(32)}`,
      document: { name: draft.name },
      createdAt: '2026-09-13T12:00:00.000Z',
    },
  });
  saveOperatorSession(partial);

  assert.equal(loadOperatorSession(owner)?.phase, 'metadata_uploaded');
  assert.equal(
    loadOperatorSession(owner)?.machineId,
    machineIdFromLabel(draft.label),
  );
  assert.match(operatorStorageKey(owner), /operator/);
});

test('validates onboarding and builds normalized metadata', () => {
  assert.deepEqual(validateMachineDraft(draft), []);
  assert.match(machineIdFromLabel(draft.label), /^0x[0-9a-f]{64}$/);
  const metadata = metadataDocument(draft, owner);
  assert.deepEqual(metadata.capabilities, [
    'GPS telemetry',
    'Remote controller',
  ]);
  assert.equal(metadata.operator.wallet, owner);
  assert.ok(
    validateMachineDraft({ ...draft, controller: 'wrong', tariff: '0' })
      .length >= 2,
  );
});

test('wrong operator account is rejected before mutation', () => {
  assert.throws(
    () =>
      assertOperatorAccount(
        owner,
        '0x2222222222222222222222222222222222222222',
      ),
    /does not own this operator session/,
  );
});

test('metadata upload failure cannot produce a registered session', async () => {
  const config = {
    workerUrl: 'https://relay.example',
    creditcoinRpcUrl: 'https://creditcoin.example',
    sepoliaRpcUrl: 'https://sepolia.example',
    registryAddress: '0x0000000000000000000000000000000000000001',
    machineRegistryAddress: '0x0000000000000000000000000000000000000002',
  } as AppConfig;
  const client = new OperatorClient(config);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ error: { message: 'Durable storage unavailable.' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  try {
    await assert.rejects(
      client.uploadMetadata(draft, owner),
      /Durable storage unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('network transition adds CC3 when missing and verifies the result', async () => {
  let chainId = '0xaa36a7';
  let added = false;
  const wallet = {
    request: async ({
      method,
      params,
    }: {
      method: string;
      params?: unknown[];
    }) => {
      if (method === 'wallet_switchEthereumChain') {
        if (!added)
          throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
        chainId = (params?.[0] as { chainId: string }).chainId;
        return null;
      }
      if (method === 'wallet_addEthereumChain') {
        added = true;
        chainId = (params?.[0] as { chainId: string }).chainId;
        return null;
      }
      if (method === 'eth_chainId') return chainId;
      throw new Error(`Unexpected method ${method}`);
    },
  } as Eip1193Provider;
  await switchWalletChain(wallet, {
    chainId: 102031,
    chainName: 'Creditcoin CC3 Testnet',
    rpcUrl: 'https://creditcoin.example',
    explorerUrl: 'https://explorer.example',
    nativeSymbol: 'CTC',
  });
  assert.equal(chainId, '0x18e8f');
});

test('wrong network and rejected switch remain explicit failures', async () => {
  const stuck = {
    request: async ({ method }: { method: string }) =>
      method === 'eth_chainId' ? '0xaa36a7' : null,
  } as Eip1193Provider;
  await assert.rejects(
    switchWalletChain(stuck, {
      chainId: 102031,
      chainName: 'Creditcoin CC3 Testnet',
      rpcUrl: 'https://creditcoin.example',
      explorerUrl: 'https://explorer.example',
      nativeSymbol: 'CTC',
    }),
    /did not switch/,
  );

  const rejected = {
    request: async () => {
      throw Object.assign(new Error('User rejected request'), { code: 4001 });
    },
  } as Eip1193Provider;
  await assert.rejects(
    switchWalletChain(rejected, {
      chainId: 102031,
      chainName: 'Creditcoin CC3 Testnet',
      rpcUrl: 'https://creditcoin.example',
      explorerUrl: 'https://explorer.example',
      nativeSymbol: 'CTC',
    }),
    /User rejected/,
  );
});
