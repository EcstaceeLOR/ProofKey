import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  type TransactionReceipt,
} from 'ethers';
import type { AppConfig } from './contracts.js';
import type { RelayPhase } from './flow.js';
import { ProofWorkerClient } from './worker.js';

export interface UsagePaymentEvidence {
  orderId: string;
  machineId: string;
  payer: string;
  beneficiary: string;
  startTime: string;
  duration: string;
  amount: string;
}

export interface AttestcoinEvidence {
  chainKey: number;
  blockHeight: number;
  encodedTransaction: string;
  merkleRoot: string;
  siblings: Array<{ hash: string; isLeft: boolean }>;
  lowerEndpointDigest: string;
  continuityRoots: string[];
}

export interface PublicProofEvidence {
  schema: 'proofkey.public-proof.v1';
  source: {
    transactionHash: string;
    blockNumber?: number;
    payment?: UsagePaymentEvidence;
  };
  relay: {
    phase: RelayPhase;
    createdAt: string;
    updatedAt: string;
    attempts: Partial<Record<RelayPhase, number>>;
    failedAtPhase?: RelayPhase;
    failure?: {
      code: string;
      message: string;
      phase: RelayPhase;
      retryable: boolean;
    };
  };
  attestcoin?: AttestcoinEvidence;
  creditcoin: {
    transactionHash?: string;
    queryId?: string;
    accessExpiresAt?: string;
  };
}

export type InvariantStatus = 'pass' | 'fail' | 'pending';

export interface ProofInvariant {
  key: string;
  label: string;
  status: InvariantStatus;
  expected: string;
  actual: string;
  explanation: string;
}

export interface ProofChainSnapshot {
  receiptStatus?: number;
  sourceTo?: string;
  sourceFrom?: string;
  payment?: UsagePaymentEvidence;
  machine?: {
    owner: string;
    tariff: string;
    active: boolean;
  };
  orderProcessed?: boolean;
  authorizationId?: string;
  accessExpiresAt?: string;
  queryId?: string;
}

export interface ProofRecord {
  evidence: PublicProofEvidence;
  chain: ProofChainSnapshot;
  invariants: ProofInvariant[];
}

const usageInterface = new Interface([
  'event UsagePaid(bytes32 indexed orderId,bytes32 indexed machineId,address indexed payer,address beneficiary,uint64 startTime,uint64 duration,uint256 amount)',
]);
const activationInterface = new Interface([
  'event ProofKeyAccessActivated(bytes32 indexed queryId,bytes32 indexed orderId,bytes32 indexed machineId,address payer,uint64 expiresAt)',
]);
const machineAbi = [
  'function machines(bytes32 machineId) view returns (address owner,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
] as const;
const proofKeyAbi = [
  'function processedOrders(bytes32 orderId) view returns (bool)',
] as const;
const accessPassAbi = [
  'function accessCredentials(bytes32 machineId,address beneficiary) view returns (bytes32 authorizationId,uint64 expiresAt)',
] as const;

export class ProofExplorerClient {
  private readonly source: JsonRpcProvider;
  private readonly creditcoin: JsonRpcProvider;
  private readonly worker: ProofWorkerClient;

  constructor(private readonly config: AppConfig) {
    this.source = new JsonRpcProvider(config.sepoliaRpcUrl, 11155111, {
      staticNetwork: true,
    });
    this.creditcoin = new JsonRpcProvider(config.creditcoinRpcUrl, 102031, {
      staticNetwork: true,
    });
    this.worker = new ProofWorkerClient(config.workerUrl);
  }

  async load(identifier: string): Promise<ProofRecord> {
    const evidence = await this.worker.getProof(identifier);
    const [transaction, receipt] = await Promise.all([
      this.source.getTransaction(evidence.source.transactionHash),
      this.source.getTransactionReceipt(evidence.source.transactionHash),
    ]);
    const payment =
      evidence.source.payment ??
      (receipt
        ? decodeUsagePayment(receipt, this.config.registryAddress)
        : undefined);
    const chain: ProofChainSnapshot = {
      receiptStatus: receipt?.status ?? undefined,
      sourceTo: transaction?.to ? getAddress(transaction.to) : undefined,
      sourceFrom: transaction?.from ? getAddress(transaction.from) : undefined,
      payment,
    };

    if (payment) {
      const machine = new Contract(
        this.config.machineRegistryAddress,
        machineAbi,
        this.creditcoin,
      );
      const proofKey = new Contract(
        this.config.proofKeyAscAddress,
        proofKeyAbi,
        this.creditcoin,
      );
      const accessPass = new Contract(
        this.config.accessPassAddress,
        accessPassAbi,
        this.creditcoin,
      );
      const [policy, processed, credential, activationReceipt] =
        await Promise.all([
          machine.getFunction('machines')(payment.machineId),
          proofKey.getFunction('processedOrders')(payment.orderId),
          accessPass.getFunction('accessCredentials')(
            payment.machineId,
            payment.payer,
          ),
          evidence.creditcoin.transactionHash
            ? this.creditcoin.getTransactionReceipt(
                evidence.creditcoin.transactionHash,
              )
            : Promise.resolve(null),
        ]);
      chain.machine = {
        owner: getAddress(policy.owner as string),
        tariff: (policy.tariff as bigint).toString(),
        active: policy.active as boolean,
      };
      chain.orderProcessed = processed as boolean;
      chain.authorizationId = credential.authorizationId as string;
      chain.accessExpiresAt = (credential.expiresAt as bigint).toString();
      chain.queryId =
        evidence.creditcoin.queryId ??
        (activationReceipt ? decodeQueryId(activationReceipt) : undefined);
    }

    const hydrated: PublicProofEvidence = {
      ...evidence,
      source: { ...evidence.source, payment },
      creditcoin: {
        ...evidence.creditcoin,
        queryId: evidence.creditcoin.queryId ?? chain.queryId,
      },
    };
    return {
      evidence: hydrated,
      chain,
      invariants: computeProofInvariants(hydrated, chain, this.config),
    };
  }
}

export function computeProofInvariants(
  evidence: PublicProofEvidence,
  chain: ProofChainSnapshot,
  config: Pick<AppConfig, 'registryAddress'>,
): ProofInvariant[] {
  const payment = chain.payment ?? evidence.source.payment;
  const proof = evidence.attestcoin;
  const invariant = (
    key: string,
    label: string,
    expected: string | undefined,
    actual: string | undefined,
    passes: boolean | undefined,
    explanation: string,
  ): ProofInvariant => ({
    key,
    label,
    expected: expected ?? 'Waiting for policy data',
    actual: actual ?? 'Waiting for evidence',
    status: passes === undefined ? 'pending' : passes ? 'pass' : 'fail',
    explanation,
  });
  const expectedAmount =
    payment && chain.machine
      ? (BigInt(chain.machine.tariff) * BigInt(payment.duration)).toString()
      : undefined;
  const computedExpiry = payment
    ? (BigInt(payment.startTime) + BigInt(payment.duration)).toString()
    : undefined;

  return [
    invariant(
      'receipt',
      'Source receipt succeeded',
      'status = 1',
      chain.receiptStatus === undefined
        ? undefined
        : `status = ${chain.receiptStatus}`,
      chain.receiptStatus === undefined ? undefined : chain.receiptStatus === 1,
      'A reverted or missing Sepolia receipt cannot authorize a machine.',
    ),
    invariant(
      'source-contract',
      'Trusted payment registry',
      getAddress(config.registryAddress),
      chain.sourceTo,
      chain.sourceTo
        ? chain.sourceTo.toLowerCase() === config.registryAddress.toLowerCase()
        : undefined,
      'The proven transaction must target ProofKey’s configured Sepolia registry.',
    ),
    invariant(
      'chain-key',
      'Attestcoin source chain',
      'chain key 1 (Ethereum Sepolia)',
      proof ? `chain key ${proof.chainKey}` : undefined,
      proof ? proof.chainKey === 1 : undefined,
      'ProofKeyASC rejects proofs from any other Attestcoin chain key.',
    ),
    invariant(
      'covered-block',
      'Covered canonical block',
      evidence.source.blockNumber?.toString() ?? 'confirmed source block',
      proof?.blockHeight.toString(),
      proof && evidence.source.blockNumber !== undefined
        ? proof.blockHeight === evidence.source.blockNumber
        : undefined,
      'The proof-builder height must be the exact block containing UsagePaid.',
    ),
    invariant(
      'payer',
      'Payer matches transaction sender',
      chain.sourceFrom ?? 'source transaction sender',
      payment?.payer,
      payment && chain.sourceFrom
        ? payment.payer.toLowerCase() === chain.sourceFrom.toLowerCase()
        : undefined,
      'This prevents a proof from granting access to a substituted payer.',
    ),
    invariant(
      'beneficiary',
      'Beneficiary matches machine owner',
      chain.machine?.owner ?? 'live Creditcoin machine owner',
      payment?.beneficiary,
      payment && chain.machine
        ? payment.beneficiary.toLowerCase() ===
            chain.machine.owner.toLowerCase()
        : undefined,
      'The Sepolia recipient must equal the owner currently registered on Creditcoin.',
    ),
    invariant(
      'machine-active',
      'Machine policy is active',
      'active = true',
      chain.machine ? `active = ${chain.machine.active}` : undefined,
      chain.machine?.active,
      'Inactive or unknown machines fail closed.',
    ),
    invariant(
      'tariff',
      'Payment matches live tariff',
      expectedAmount,
      payment?.amount,
      expectedAmount && payment
        ? BigInt(payment.amount) === BigInt(expectedAmount)
        : undefined,
      'Amount must equal Creditcoin tariff multiplied by proven duration.',
    ),
    invariant(
      'duration',
      'Duration is policy bounded',
      '1–2,592,000 seconds',
      payment ? `${payment.duration} seconds` : undefined,
      payment
        ? BigInt(payment.duration) > 0n &&
            BigInt(payment.duration) <= 2_592_000n
        : undefined,
      'ProofKey limits access grants to a maximum of 30 days.',
    ),
    invariant(
      'expiry',
      'Access expiry is deterministic',
      computedExpiry,
      chain.accessExpiresAt ?? evidence.creditcoin.accessExpiresAt,
      computedExpiry &&
        (chain.accessExpiresAt ?? evidence.creditcoin.accessExpiresAt)
        ? computedExpiry ===
            (chain.accessExpiresAt ?? evidence.creditcoin.accessExpiresAt)
        : undefined,
      'Expiry is derived only from the proven start time and duration.',
    ),
    invariant(
      'replay',
      'Order replay guard',
      ['completed', 'duplicate'].includes(evidence.relay.phase)
        ? 'processed = true'
        : 'processed after execution',
      chain.orderProcessed === undefined
        ? undefined
        : `processed = ${chain.orderProcessed}`,
      chain.orderProcessed === undefined
        ? undefined
        : ['completed', 'duplicate'].includes(evidence.relay.phase)
          ? chain.orderProcessed
          : undefined,
      'Each order and Attestcoin query can activate access only once.',
    ),
  ];
}

export function assertSafePublicEvidence(value: unknown, path = '$'): void {
  const blocked =
    /^(?:api[-_]?key|database[-_]?url|deployer[-_]?private[-_]?key|mnemonic|password|private[-_]?key|rpc[-_]?url|secret|worker[-_]?private[-_]?key|internal[-_]?path)$/i;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSafePublicEvidence(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (blocked.test(key))
      throw new Error(`Unsafe public evidence field ${path}.${key}.`);
    assertSafePublicEvidence(entry, `${path}.${key}`);
  }
}

export function downloadPublicEvidence(evidence: PublicProofEvidence): void {
  assertSafePublicEvidence(evidence);
  const blob = new Blob([`${JSON.stringify(evidence, null, 2)}\n`], {
    type: 'application/json',
  });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `proofkey-proof-${evidence.source.transactionHash}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function decodeUsagePayment(
  receipt: TransactionReceipt,
  registryAddress: string,
): UsagePaymentEvidence | undefined {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
    try {
      const event = usageInterface.parseLog(log);
      if (event?.name !== 'UsagePaid') continue;
      return {
        orderId: event.args.orderId as string,
        machineId: event.args.machineId as string,
        payer: getAddress(event.args.payer as string),
        beneficiary: getAddress(event.args.beneficiary as string),
        startTime: (event.args.startTime as bigint).toString(),
        duration: (event.args.duration as bigint).toString(),
        amount: (event.args.amount as bigint).toString(),
      };
    } catch {
      // Ignore unrelated source logs.
    }
  }
  return undefined;
}

function decodeQueryId(receipt: TransactionReceipt): string | undefined {
  for (const log of receipt.logs) {
    try {
      const event = activationInterface.parseLog(log);
      if (event?.name === 'ProofKeyAccessActivated')
        return event.args.queryId as string;
    } catch {
      // Ignore verifier and AccessPass logs.
    }
  }
  return undefined;
}
