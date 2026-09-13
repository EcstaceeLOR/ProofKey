import type {
  DeviceHandoff,
  DurableJobStore,
  RelayJob,
  SignedUsageReceipt,
  StoredMachineMetadata,
} from './types.js';

export class MemoryDurableStore implements DurableJobStore {
  readonly jobs = new Map<string, RelayJob>();
  private readonly leases = new Map<string, string>();
  readonly metadata = new Map<string, StoredMachineMetadata>();
  readonly handoffs = new Map<
    string,
    { handoff: DeviceHandoff; claimTokenHash?: string }
  >();

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

  async find(identifier: string): Promise<RelayJob | undefined> {
    const normalized = identifier.toLowerCase();
    for (const job of this.jobs.values()) {
      if (
        [
          job.sourceTransactionHash,
          job.orderId,
          job.queryId,
          job.creditcoinTransactionHash,
        ].some((value) => value?.toLowerCase() === normalized)
      )
        return structuredClone(job);
    }
    return undefined;
  }

  async putMetadata(metadata: StoredMachineMetadata): Promise<void> {
    if (!this.metadata.has(metadata.contentDigest.toLowerCase()))
      this.metadata.set(
        metadata.contentDigest.toLowerCase(),
        structuredClone(metadata),
      );
  }

  async getMetadataByDigest(
    contentDigest: string,
  ): Promise<StoredMachineMetadata | undefined> {
    const metadata = this.metadata.get(contentDigest.toLowerCase());
    return metadata && structuredClone(metadata);
  }

  async getMetadataByCommitment(
    commitment: string,
  ): Promise<StoredMachineMetadata | undefined> {
    for (const metadata of this.metadata.values())
      if (metadata.commitment.toLowerCase() === commitment.toLowerCase())
        return structuredClone(metadata);
    return undefined;
  }

  async createDeviceHandoff(handoff: DeviceHandoff): Promise<void> {
    if (this.handoffs.has(handoff.nonce))
      throw new Error('Device handoff nonce already exists.');
    this.handoffs.set(handoff.nonce, { handoff: structuredClone(handoff) });
  }

  async getDeviceHandoff(nonce: string): Promise<DeviceHandoff | undefined> {
    const record = this.handoffs.get(nonce.toLowerCase());
    return record && structuredClone(record.handoff);
  }

  async claimDeviceHandoff(
    nonce: string,
    claimTokenHash: string,
    claimedAt: string,
  ): Promise<DeviceHandoff | undefined> {
    const record = this.handoffs.get(nonce.toLowerCase());
    if (!record || record.claimTokenHash) return undefined;
    record.claimTokenHash = claimTokenHash;
    record.handoff.claimedAt = claimedAt;
    return structuredClone(record.handoff);
  }

  async putDeviceReceipt(
    nonce: string,
    claimTokenHash: string,
    receipt: SignedUsageReceipt,
  ): Promise<DeviceHandoff | undefined> {
    const record = this.handoffs.get(nonce.toLowerCase());
    if (!record || record.claimTokenHash !== claimTokenHash) return undefined;
    if (receipt.payload.kind === 'start') {
      if (record.handoff.startReceipt) return undefined;
      record.handoff.startReceipt = structuredClone(receipt);
    } else {
      if (!record.handoff.startReceipt || record.handoff.endReceipt)
        return undefined;
      record.handoff.endReceipt = structuredClone(receipt);
    }
    return structuredClone(record.handoff);
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
