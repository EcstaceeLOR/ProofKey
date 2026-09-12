import { NetworkRelayAdapter } from './adapter.js';
import { loadConfig } from './config.js';
import { ProofRelay } from './relay.js';
import { JsonConsoleReporter } from './reporter.js';
import { JsonJobStore } from './store.js';

async function main(): Promise<void> {
  const transactionHash = process.argv[2];
  if (!transactionHash || process.argv.length > 3)
    throw new Error(
      'Usage: npm run relay --workspace @proofkey/worker -- <sepolia-transaction-hash>',
    );
  const config = loadConfig();
  const adapter = new NetworkRelayAdapter(config);
  await adapter.assertNetworks();
  const relay = new ProofRelay(
    adapter,
    new JsonJobStore(config.stateFile),
    new JsonConsoleReporter(),
    {
      maxAttempts: config.retryAttempts,
      baseDelayMs: config.retryBaseDelayMs,
    },
  );
  await relay.process(transactionHash);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ phase: 'failed', message })}\n`);
  process.exitCode = 1;
});
