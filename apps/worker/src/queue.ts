import { PermanentRelayError } from './retry.js';
import type { JobStore, RelayJob } from './types.js';

export interface RelayRunner {
  process(transactionHash: string): Promise<RelayJob>;
}

export interface JobQueue {
  enqueue(transactionHash: string): Promise<RelayJob>;
  get(transactionHash: string): Promise<RelayJob | undefined>;
}

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;

export class RelayQueue implements JobQueue {
  private readonly active = new Map<string, Promise<void>>();

  constructor(
    private readonly relay: RelayRunner,
    private readonly store: JobStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(transactionHash: string): Promise<RelayJob> {
    if (!transactionHashPattern.test(transactionHash)) {
      throw new PermanentRelayError(
        'Expected a 32-byte Sepolia transaction hash (0x + 64 hex characters).',
      );
    }
    const hash = transactionHash.toLowerCase();
    const existing = await this.store.get(hash);
    if (existing?.phase === 'completed' || existing?.phase === 'duplicate')
      return existing;
    if (this.active.has(hash) && existing) return existing;

    const timestamp = this.now().toISOString();
    const queued: RelayJob = {
      ...(existing ?? {
        sourceTransactionHash: hash,
        createdAt: timestamp,
        attempts: {},
      }),
      phase: 'queued',
      updatedAt: timestamp,
      failedAtPhase: undefined,
      error: undefined,
    };
    await this.store.save(queued);

    const task = this.relay
      .process(hash)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => this.active.delete(hash));
    this.active.set(hash, task);
    return queued;
  }

  get(transactionHash: string): Promise<RelayJob | undefined> {
    return this.store.get(transactionHash.toLowerCase());
  }
}
