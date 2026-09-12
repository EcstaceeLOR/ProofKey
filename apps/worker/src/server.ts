import { NetworkRelayAdapter } from './adapter.js';
import { loadConfig } from './config.js';
import { createRelayHttpServer } from './http.js';
import { RelayQueue } from './queue.js';
import { ProofRelay } from './relay.js';
import { JsonConsoleReporter } from './reporter.js';
import { JsonJobStore } from './store.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const adapter = new NetworkRelayAdapter(config);
  await adapter.assertNetworks();
  const store = new JsonJobStore(config.stateFile);
  const relay = new ProofRelay(adapter, store, new JsonConsoleReporter(), {
    maxAttempts: config.retryAttempts,
    baseDelayMs: config.retryBaseDelayMs,
  });
  const server = createRelayHttpServer(
    new RelayQueue(relay, store),
    config.frontendOrigin,
  );
  server.listen(config.serverPort, config.serverHost, () => {
    process.stdout.write(
      `${JSON.stringify({ service: 'proofkey-worker', status: 'listening', host: config.serverHost, port: config.serverPort })}\n`,
    );
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ service: 'proofkey-worker', status: 'failed', message })}\n`,
  );
  process.exitCode = 1;
});
