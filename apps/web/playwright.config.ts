import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && vite preview --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      VITE_ETHEREUM_SEPOLIA_RPC_URL: 'https://sepolia.rpc.proofkey.invalid',
      VITE_CREDITCOIN_RPC_URL: 'https://creditcoin.rpc.proofkey.invalid',
      VITE_USAGE_PAYMENT_REGISTRY_ADDRESS:
        '0x0000000000000000000000000000000000000001',
      VITE_MACHINE_REGISTRY_ADDRESS:
        '0x0000000000000000000000000000000000000002',
      VITE_ACCESS_PASS_ADDRESS: '0x0000000000000000000000000000000000000004',
      VITE_PROOFKEY_ASC_ADDRESS: '0x0000000000000000000000000000000000000005',
      VITE_DEMO_MACHINE_ID:
        '0xc04beae61beb9471c4f24c8788a4624988d2948a5c3d3dd0b6ba1b7602875bcc',
      VITE_PROOF_WORKER_URL: 'https://relay.invalid',
      VITE_DEVICE_SIMULATOR_URL: 'http://127.0.0.1:1',
      VITE_WALLETCONNECT_PROJECT_ID: '',
    },
  },
});
