import type { DurableJobStore, RelayJob } from './types.js';

export class MemoryDurableStore implements DurableJobStore {
  readonly jobs = new Map<string, RelayJob>();
  private readonly leases = new Map<string, string>();

  async get(transactionHash: string): Promise<RelayJob | undefined> {
    const job = this.jobs.get(transactionHash.toLowerCase());
    return job && structuredClone(job);
  }

  async create(job: RelayJob): Promise<{ job: RelayJob; created: boolean }> {
    const existing = await this.get(job.sourceTransactionHash);
    if (existing) return { job: existing, created: false };
    await this.save(job);
    return { job: structuredClone(job), created: true };
  }

  async save(job: RelayJob): Promise<void> {
    this.jobs.set(
      job.sourceTransactionHash.toLowerCase(),
      structuredClone(job),
    );
  }

  async claimNext(ownerId: string): Promise<RelayJob | undefined> {
    for (const [hash, job] of this.jobs) {
      if (
        !['completed', 'duplicate', 'failed'].includes(job.phase) &&
        !this.leases.has(hash)
      ) {
        this.leases.set(hash, ownerId);
        return structuredClone(job);
      }
    }
    return undefined;
  }

  async renewLease(
    sourceTransactionHash: string,
    ownerId: string,
  ): Promise<boolean> {
    return this.leases.get(sourceTransactionHash.toLowerCase()) === ownerId;
  }

  async release(sourceTransactionHash: string, ownerId: string): Promise<void> {
    const hash = sourceTransactionHash.toLowerCase();
    if (this.leases.get(hash) === ownerId) this.leases.delete(hash);
  }

  async isReady(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}
