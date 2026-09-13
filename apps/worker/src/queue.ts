import { PermanentRelayError } from './retry.js';
import type {
  DurableJobStore,
  RelayJob,
  StoredMachineMetadata,
} from './types.js';

export interface JobQueue {
  enqueue(transactionHash: string): Promise<RelayJob>;
  get(transactionHash: string): Promise<RelayJob | undefined>;
  find(identifier: string): Promise<RelayJob | undefined>;
  putMetadata(metadata: StoredMachineMetadata): Promise<void>;
  getMetadataByDigest(
    contentDigest: string,
  ): Promise<StoredMachineMetadata | undefined>;
  getMetadataByCommitment(
    commitment: string,
  ): Promise<StoredMachineMetadata | undefined>;
}

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;

export class RelayQueue implements JobQueue {
  constructor(
    private readonly store: DurableJobStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(transactionHash: string): Promise<RelayJob> {
    if (!transactionHashPattern.test(transactionHash)) {
      throw new PermanentRelayError(
        'Expected a 32-byte Sepolia transaction hash (0x + 64 hex characters).',
        'INVALID_TRANSACTION_HASH',
      );
    }
    const hash = transactionHash.toLowerCase();
    const timestamp = this.now().toISOString();
    const queued: RelayJob = {
      sourceTransactionHash: hash,
      phase: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
      attempts: {},
    };
    return (await this.store.create(queued)).job;
  }

  get(transactionHash: string): Promise<RelayJob | undefined> {
    return this.store.get(transactionHash.toLowerCase());
  }

  find(identifier: string): Promise<RelayJob | undefined> {
    return this.store.find(identifier.toLowerCase());
  }

  putMetadata(metadata: StoredMachineMetadata): Promise<void> {
    return this.store.putMetadata(metadata);
  }

  getMetadataByDigest(contentDigest: string) {
    return this.store.getMetadataByDigest(contentDigest);
  }

  getMetadataByCommitment(commitment: string) {
    return this.store.getMetadataByCommitment(commitment);
  }
}
