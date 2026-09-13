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

export interface CreditcoinExecution {
  transactionHash: string;
  queryId: string;
}

export interface RelayJob {
  sourceTransactionHash: string;
  phase: RelayPhase;
  createdAt: string;
  updatedAt: string;
  attempts: Partial<Record<RelayPhase, number>>;
  sourceBlockNumber?: number;
  sourcePayment?: UsagePayment;
  proof?: AttestcoinProof;
  orderId?: string;
  machineId?: string;
  payer?: string;
  accessExpiresAt?: string;
  creditcoinTransactionHash?: string;
  queryId?: string;
  failedAtPhase?: RelayPhase;
  error?: string;
  failure?: RelayFailure;
}

export interface PublicProofEvidence {
  schema: 'proofkey.public-proof.v1';
  source: {
    transactionHash: string;
    blockNumber?: number;
    payment?: UsagePayment;
  };
  relay: {
    phase: RelayPhase;
    createdAt: string;
    updatedAt: string;
    attempts: Partial<Record<RelayPhase, number>>;
    failedAtPhase?: RelayPhase;
    failure?: RelayFailure;
  };
  attestcoin?: AttestcoinProof;
  creditcoin: {
    transactionHash?: string;
    queryId?: string;
    accessExpiresAt?: string;
  };
}

export interface StoredMachineMetadata {
  contentDigest: string;
  commitment: string;
  uri: string;
  document: Record<string, unknown>;
  createdAt: string;
}

export type UsageReceiptKind = 'start' | 'end';

export interface UsageReceiptPayload {
  schema: 'proofkey.usage-receipt.v1';
  kind: UsageReceiptKind;
  sessionId: string;
  machineId: string;
  payer: string;
  orderId: string;
  nonce: string;
  controller: string;
  startedAt: string;
  endedAt: string | null;
  measuredDurationSeconds: number;
  accessExpiresAt: string;
}

export interface SignedUsageReceipt {
  payload: UsageReceiptPayload;
  signature: string;
}

export interface DeviceHandoff {
  schema: 'proofkey.device-handoff.v1';
  nonce: string;
  machineId: string;
  payer: string;
  orderId: string;
  sourceTransactionHash: string;
  accessExpiresAt: string;
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
  startReceipt?: SignedUsageReceipt;
  endReceipt?: SignedUsageReceipt;
}

export interface RelayFailure {
  code: string;
  message: string;
  phase: RelayPhase;
  retryable: boolean;
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

export interface DurableJobStore extends JobStore {
  create(job: RelayJob): Promise<{ job: RelayJob; created: boolean }>;
  find(identifier: string): Promise<RelayJob | undefined>;
  putMetadata(metadata: StoredMachineMetadata): Promise<void>;
  getMetadataByDigest(
    contentDigest: string,
  ): Promise<StoredMachineMetadata | undefined>;
  getMetadataByCommitment(
    commitment: string,
  ): Promise<StoredMachineMetadata | undefined>;
  createDeviceHandoff(handoff: DeviceHandoff): Promise<void>;
  getDeviceHandoff(nonce: string): Promise<DeviceHandoff | undefined>;
  claimDeviceHandoff(
    nonce: string,
    claimTokenHash: string,
    claimedAt: string,
  ): Promise<DeviceHandoff | undefined>;
  putDeviceReceipt(
    nonce: string,
    claimTokenHash: string,
    receipt: SignedUsageReceipt,
  ): Promise<DeviceHandoff | undefined>;
  claimNext(
    ownerId: string,
    leaseDurationMs: number,
  ): Promise<RelayJob | undefined>;
  renewLease(
    sourceTransactionHash: string,
    ownerId: string,
    leaseDurationMs: number,
  ): Promise<boolean>;
  release(sourceTransactionHash: string, ownerId: string): Promise<void>;
  isReady(): Promise<boolean>;
  close(): Promise<void>;
}

export interface ReadinessCheck {
  status: 'ready' | 'unavailable';
  code?: string;
}

export interface RelayReadiness {
  status: 'ready' | 'degraded';
  checks: {
    api: ReadinessCheck;
    database: ReadinessCheck;
    sourceRpc: ReadinessCheck;
    creditcoinRpc: ReadinessCheck;
    relayer: ReadinessCheck & {
      address?: string;
      balanceWei?: string;
      minimumBalanceWei?: string;
    };
  };
}

export interface RelayAdapter {
  confirmSourceTransaction(transactionHash: string): Promise<SourceReceipt>;
  waitUntilAttested(blockNumber: number): Promise<void>;
  generateProof(transactionHash: string): Promise<AttestcoinProof>;
  isOrderProcessed(orderId: string): Promise<boolean>;
  submitProof(proof: AttestcoinProof): Promise<CreditcoinExecution>;
}

export interface StatusReporter {
  report(status: RelayStatus): void;
}
