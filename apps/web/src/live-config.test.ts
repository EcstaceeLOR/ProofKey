import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAppConfig } from './contracts.js';
import { liveTestnetConfig } from './live-config.js';

test('boots the committed live testnet deployment without Vercel variables', () => {
  const config = loadAppConfig({ PROD: true } as unknown as ImportMetaEnv);
  assert.equal(config.sepoliaRpcUrl, liveTestnetConfig.sepoliaRpcUrl);
  assert.equal(config.creditcoinRpcUrl, liveTestnetConfig.creditcoinRpcUrl);
  assert.equal(
    config.registryAddress,
    liveTestnetConfig.usagePaymentRegistryAddress,
  );
  assert.equal(
    config.machineRegistryAddress,
    liveTestnetConfig.machineRegistryAddress,
  );
  assert.equal(config.machineId, liveTestnetConfig.machineId);
  assert.equal(config.workerUrl, liveTestnetConfig.workerUrl);
});

test('explicit public deployment values override every safe default', () => {
  const config = loadAppConfig({
    PROD: true,
    VITE_ETHEREUM_SEPOLIA_RPC_URL: 'https://sepolia.example',
    VITE_CREDITCOIN_RPC_URL: 'https://creditcoin.example',
    VITE_USAGE_PAYMENT_REGISTRY_ADDRESS:
      '0x0000000000000000000000000000000000000011',
    VITE_MACHINE_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000012',
    VITE_ACCESS_PASS_ADDRESS: '0x0000000000000000000000000000000000000013',
    VITE_PROOFKEY_ASC_ADDRESS: '0x0000000000000000000000000000000000000014',
    VITE_DEMO_MACHINE_ID: `0x${'15'.repeat(32)}`,
    VITE_PROOF_WORKER_URL: 'https://relay.example/',
  } as unknown as ImportMetaEnv);
  assert.equal(config.sepoliaRpcUrl, 'https://sepolia.example');
  assert.equal(config.creditcoinRpcUrl, 'https://creditcoin.example');
  assert.equal(config.workerUrl, 'https://relay.example');
  assert.equal(
    config.registryAddress,
    '0x0000000000000000000000000000000000000011',
  );
});
