export type RelayPhase =
  | 'queued'
  | 'source_confirmation'
  | 'attestation_wait'
  | 'proof_generation'
  | 'creditcoin_execution'
  | 'completed'
  | 'duplicate'
  | 'failed';

export interface UsagePayment {
  orderId: string;
  machineId: string;
  payer: string;
  beneficiary: string;
  startTime: string;
  duration: string;
  amount: string;
}

export interface SourceReceipt {
  blockNumber: number;
  payment: UsagePayment;
}

export interface AttestcoinProof {
  chainKey: number;
  blockHeight: number;
  encodedTransaction: string;
  merkleRoot: string;
  siblings: Array<{ hash: string; isLeft: boolean }>;
  lowerEndpointDigest: string;
  continuityRoots: string[];
}

export interface RelayJob {
  sourceTransactionHash: string;
  phase: RelayPhase;
  createdAt: string;
  updatedAt: string;
  attempts: Partial<Record<RelayPhase, number>>;
  sourceBlockNumber?: number;
  orderId?: string;
  machineId?: string;
  payer?: string;
  creditcoinTransactionHash?: string;
  failedAtPhase?: RelayPhase;
  error?: string;
}

export interface RelayStatus {
  sourceTransactionHash: string;
  phase: RelayPhase;
  timestamp: string;
  message: string;
  attempt?: number;
}

export interface JobStore {
  get(sourceTransactionHash: string): Promise<RelayJob | undefined>;
  save(job: RelayJob): Promise<void>;
}

export interface RelayAdapter {
  confirmSourceTransaction(transactionHash: string): Promise<SourceReceipt>;
  waitUntilAttested(blockNumber: number): Promise<void>;
  generateProof(transactionHash: string): Promise<AttestcoinProof>;
  isOrderProcessed(orderId: string): Promise<boolean>;
  submitProof(proof: AttestcoinProof): Promise<string>;
}

export interface StatusReporter {
  report(status: RelayStatus): void;
}
