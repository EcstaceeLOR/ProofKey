import { NetworkRelayAdapter } from './adapter.js';
import { loadConfig } from './config.js';
import { RelayExecutor } from './executor.js';
import { createRelayHttpServer } from './http.js';
import { RelayQueue } from './queue.js';
import { ProofRelay } from './relay.js';
import { JsonConsoleReporter } from './reporter.js';
import { PostgresJobStore } from './store.js';
import type { RelayReadiness } from './types.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new PostgresJobStore(config.databaseUrl, {
    ssl: config.databaseSsl,
  });
  await store.initialize();
  const adapter = new NetworkRelayAdapter(config);
  const relay = new ProofRelay(adapter, store, new JsonConsoleReporter(), {
    maxAttempts: config.retryAttempts,
    baseDelayMs: config.retryBaseDelayMs,
  });
  const executor = new RelayExecutor(relay, store, {
    pollIntervalMs: config.queuePollMs,
    leaseDurationMs: config.leaseDurationMs,
    leaseHeartbeatMs: config.leaseHeartbeatMs,
  });
  const readiness = async (): Promise<RelayReadiness> => {
    const [database, network] = await Promise.all([
      store.isReady(),
      adapter.readiness(),
    ]);
    const checks: RelayReadiness['checks'] = {
      api: { status: 'ready' },
      database: database
        ? { status: 'ready' }
        : { status: 'unavailable', code: 'DATABASE_UNAVAILABLE' },
      ...network,
    };
    const ready = Object.values(checks).every(
      (check) => check.status === 'ready',
    );
    return { status: ready ? 'ready' : 'degraded', checks };
  };
  const server = createRelayHttpServer(new RelayQueue(store), {
    allowedOrigins: config.frontendOrigins,
    readiness,
    rateLimit: {
      requests: config.rateLimitRequests,
      windowMs: config.rateLimitWindowMs,
    },
  });
  const controller = new AbortController();
  const executorTask = executor
    .run(controller.signal)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `${JSON.stringify({ service: 'proofkey-executor', status: 'failed', message })}\n`,
      );
      process.exitCode = 1;
    });

  server.listen(config.serverPort, config.serverHost, () => {
    process.stdout.write(
      `${JSON.stringify({ service: 'proofkey-relay', status: 'listening', host: config.serverHost, port: config.serverPort })}\n`,
    );
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    controller.abort();
    server.close(() => {
      void executorTask.finally(() => store.close());
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ service: 'proofkey-relay', status: 'failed', message })}\n`,
  );
  process.exitCode = 1;
});
