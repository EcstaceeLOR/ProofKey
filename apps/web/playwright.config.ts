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
      VITE_ETHEREUM_SEPOLIA_RPC_URL: 'http://127.0.0.1:1',
      VITE_CREDITCOIN_RPC_URL: 'http://127.0.0.1:1',
      VITE_USAGE_PAYMENT_REGISTRY_ADDRESS:
        '0x0000000000000000000000000000000000000001',
      VITE_MACHINE_REGISTRY_ADDRESS:
        '0x0000000000000000000000000000000000000002',
      VITE_DEMO_MACHINE_ID: `0x${'01'.repeat(32)}`,
      VITE_PROOF_WORKER_URL: 'http://127.0.0.1:1',
      VITE_DEVICE_SIMULATOR_URL: 'http://127.0.0.1:1',
      VITE_WALLETCONNECT_PROJECT_ID: '',
    },
  },
});
