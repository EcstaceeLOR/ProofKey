import { PermanentRelayError, withRetry } from './retry.js';
import type {
  JobStore,
  RelayAdapter,
  RelayJob,
  RelayPhase,
  RelayStatus,
  StatusReporter,
} from './types.js';

export interface RelayOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;

export class ProofRelay {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep?: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(
    private readonly adapter: RelayAdapter,
    private readonly store: JobStore,
    private readonly reporter: StatusReporter,
    options: RelayOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 2_000;
    this.sleep = options.sleep;
    this.now = options.now ?? (() => new Date());
  }

  async process(transactionHash: string): Promise<RelayJob> {
    if (!transactionHashPattern.test(transactionHash)) {
      throw new PermanentRelayError(
        'Expected a 32-byte Sepolia transaction hash (0x + 64 hex characters).',
      );
    }
    const hash = transactionHash.toLowerCase();
    const previous = await this.store.get(hash);
    if (previous?.phase === 'completed' || previous?.phase === 'duplicate') {
      return this.transition(
        previous,
        'duplicate',
        'This source transaction was already relayed successfully.',
      );
    }

    let job: RelayJob = previous ?? {
      sourceTransactionHash: hash,
      phase: 'queued',
      createdAt: this.timestamp(),
      updatedAt: this.timestamp(),
      attempts: {},
    };
    await this.store.save(job);
    let activePhase: RelayPhase = 'source_confirmation';

    try {
      job = await this.transition(
        job,
        activePhase,
        'Waiting for the Sepolia payment transaction to confirm.',
      );
      const receipt = await this.runPhase(job, activePhase, () =>
        this.adapter.confirmSourceTransaction(hash),
      );
      job = {
        ...job,
        sourceBlockNumber: receipt.blockNumber,
        orderId: receipt.payment.orderId,
        machineId: receipt.payment.machineId,
        payer: receipt.payment.payer,
      };
      await this.store.save(job);

      if (
        await this.runPhase(job, activePhase, () =>
          this.adapter.isOrderProcessed(receipt.payment.orderId),
        )
      ) {
        return this.transition(
          job,
          'duplicate',
          'The proven order is already processed on Creditcoin.',
        );
      }

      activePhase = 'attestation_wait';
      job = await this.transition(
        job,
        activePhase,
        `Waiting for Sepolia block ${receipt.blockNumber} to be attested.`,
      );
      await this.runPhase(job, activePhase, () =>
        this.adapter.waitUntilAttested(receipt.blockNumber),
      );

      activePhase = 'proof_generation';
      job = await this.transition(
        job,
        activePhase,
        'Generating the Merkle and continuity proof.',
      );
      const proof = await this.runPhase(job, activePhase, () =>
        this.adapter.generateProof(hash),
      );
      if (proof.chainKey !== 1 || proof.blockHeight !== receipt.blockNumber) {
        throw new PermanentRelayError(
          `Proof identifies chain ${proof.chainKey}, block ${proof.blockHeight}; expected Sepolia chain key 1, block ${receipt.blockNumber}.`,
        );
      }

      activePhase = 'creditcoin_execution';
      job = await this.transition(
        job,
        activePhase,
        'Submitting the proof to ProofKeyASC on Creditcoin.',
      );
      let creditcoinTransactionHash: string;
      try {
        creditcoinTransactionHash = await this.runPhase(job, activePhase, () =>
          this.adapter.submitProof(proof),
        );
      } catch (error) {
        if (await this.adapter.isOrderProcessed(receipt.payment.orderId)) {
          return this.transition(
            job,
            'duplicate',
            'Another relay processed this order first.',
          );
        }
        throw error;
      }

      job = { ...job, creditcoinTransactionHash };
      return this.transition(
        job,
        'completed',
        'Proof verified and access activated on Creditcoin.',
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const errorMessage = `${activePhase}: ${reason}`;
      job = {
        ...job,
        phase: 'failed',
        failedAtPhase: activePhase,
        error: errorMessage,
        updatedAt: this.timestamp(),
      };
      await this.store.save(job);
      this.reporter.report({
        sourceTransactionHash: hash,
        phase: 'failed',
        timestamp: job.updatedAt,
        message: errorMessage,
      });
      throw new Error(errorMessage, { cause: error });
    }
  }

  private async runPhase<T>(
    job: RelayJob,
    phase: RelayPhase,
    operation: () => Promise<T>,
  ): Promise<T> {
    return withRetry(operation, {
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      sleep: this.sleep,
      onAttempt: (attempt) => {
        job.attempts[phase] = attempt;
        this.reporter.report({
          sourceTransactionHash: job.sourceTransactionHash,
          phase,
          timestamp: this.timestamp(),
          message: `Attempt ${attempt} of ${this.maxAttempts}.`,
          attempt,
        });
      },
    });
  }

  private async transition(
    job: RelayJob,
    phase: RelayPhase,
    message: string,
  ): Promise<RelayJob> {
    const next: RelayJob = {
      ...job,
      phase,
      updatedAt: this.timestamp(),
      failedAtPhase: undefined,
      error: undefined,
    };
    await this.store.save(next);
    const status: RelayStatus = {
      sourceTransactionHash: next.sourceTransactionHash,
      phase,
      timestamp: next.updatedAt,
      message,
    };
    this.reporter.report(status);
    return next;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
