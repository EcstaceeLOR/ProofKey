import { liveTestnetConfig } from '../apps/web/src/live-config.ts';

const requiredUrls = [
  'VITE_ETHEREUM_SEPOLIA_RPC_URL',
  'VITE_CREDITCOIN_RPC_URL',
  'VITE_PROOF_WORKER_URL',
];
const requiredAddresses = [
  'VITE_USAGE_PAYMENT_REGISTRY_ADDRESS',
  'VITE_MACHINE_REGISTRY_ADDRESS',
  'VITE_ACCESS_PASS_ADDRESS',
  'VITE_PROOFKEY_ASC_ADDRESS',
];

const defaults = {
  VITE_ETHEREUM_SEPOLIA_RPC_URL: liveTestnetConfig.sepoliaRpcUrl,
  VITE_CREDITCOIN_RPC_URL: liveTestnetConfig.creditcoinRpcUrl,
  VITE_PROOF_WORKER_URL: liveTestnetConfig.workerUrl,
  VITE_USAGE_PAYMENT_REGISTRY_ADDRESS:
    liveTestnetConfig.usagePaymentRegistryAddress,
  VITE_MACHINE_REGISTRY_ADDRESS: liveTestnetConfig.machineRegistryAddress,
  VITE_ACCESS_PASS_ADDRESS: liveTestnetConfig.accessPassAddress,
  VITE_PROOFKEY_ASC_ADDRESS: liveTestnetConfig.proofKeyAscAddress,
  VITE_DEMO_MACHINE_ID: liveTestnetConfig.machineId,
};

function configuredValue(name) {
  return process.env[name]?.trim() || defaults[name];
}

const failures = [];
for (const name of requiredUrls) {
  const value = configuredValue(name);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') failures.push(`${name} must use HTTPS.`);
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname))
      failures.push(`${name} cannot reference localhost.`);
    if (url.username || url.password)
      failures.push(`${name} cannot contain embedded credentials.`);
  } catch {
    failures.push(`${name} must be a valid public URL.`);
  }
}
for (const name of requiredAddresses) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(configuredValue(name)))
    failures.push(`${name} must be a 20-byte address.`);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(configuredValue('VITE_DEMO_MACHINE_ID')))
  failures.push('VITE_DEMO_MACHINE_ID must be a 32-byte machine ID.');

if (failures.length) {
  console.error(`Production configuration failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Production public configuration is complete and URL-safe.');
