import { randomUUID } from 'node:crypto';
import type { RelayRunner } from './runner.js';
import type { DurableJobStore } from './types.js';

export interface RelayExecutorOptions {
  pollIntervalMs: number;
  leaseDurationMs: number;
  leaseHeartbeatMs: number;
  ownerId?: string;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });

export class RelayExecutor {
  private readonly ownerId: string;

  constructor(
    private readonly relay: RelayRunner,
    private readonly store: DurableJobStore,
    private readonly options: RelayExecutorOptions,
  ) {
    this.ownerId = options.ownerId ?? `relay-${randomUUID()}`;
    if (options.leaseHeartbeatMs >= options.leaseDurationMs)
      throw new Error(
        'Lease heartbeat must be shorter than the lease duration.',
      );
  }

  async run(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const processed = await this.runOnce();
      if (!processed)
        await (this.options.sleep ?? defaultSleep)(
          this.options.pollIntervalMs,
          signal,
        );
    }
  }

  async runOnce(): Promise<boolean> {
    const job = await this.store.claimNext(
      this.ownerId,
      this.options.leaseDurationMs,
    );
    if (!job) return false;

    const heartbeat = setInterval(() => {
      void this.store
        .renewLease(
          job.sourceTransactionHash,
          this.ownerId,
          this.options.leaseDurationMs,
        )
        .catch((error: unknown) => {
          process.stderr.write(
            `${JSON.stringify({ service: 'proofkey-executor', event: 'lease_renewal_failed', transactionHash: job.sourceTransactionHash, message: error instanceof Error ? error.message : String(error) })}\n`,
          );
        });
    }, this.options.leaseHeartbeatMs);
    heartbeat.unref();

    try {
      await this.relay.process(job.sourceTransactionHash);
    } catch {
      // ProofRelay persists and reports the structured terminal failure.
    } finally {
      clearInterval(heartbeat);
      await this.store.release(job.sourceTransactionHash, this.ownerId);
    }
    return true;
  }
}
