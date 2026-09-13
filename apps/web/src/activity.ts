import { Contract, Interface, JsonRpcProvider, getAddress } from 'ethers';
import type { AppConfig, PaymentClient, UsageActivity } from './contracts.js';
import type { RelayJob } from './flow.js';
import { isTransactionHash } from './product.js';
import type { RentalSession } from './rental.js';
import { ProofWorkerClient } from './worker.js';

const proofKeyAbi = [
  'function processedOrders(bytes32 orderId) view returns (bool)',
] as const;
const accessPassAbi = [
  'function accessCredentials(bytes32 machineId,address beneficiary) view returns (bytes32 authorizationId,uint64 expiresAt)',
  'function isAuthorized(bytes32 machineId,address beneficiary) view returns (bool)',
] as const;
const activationEvents = new Interface([
  'event ProofKeyAccessActivated(bytes32 indexed queryId,bytes32 indexed orderId,bytes32 indexed machineId,address payer,uint64 expiresAt)',
]);

export type RentalLifecycle =
  'pending' | 'active' | 'expired' | 'failed' | 'action-required';

export interface OptimisticRental {
  machineId: string;
  sourceTransactionHash: string;
  durationSeconds: number;
  account: string;
  phase: RentalSession['phase'];
  updatedAt: string;
}

export interface RentalRecord {
  orderId?: string;
  machineId: string;
  payer: string;
  beneficiary?: string;
  sourceTransactionHash: string;
  creditcoinTransactionHash?: string;
  sourceBlockNumber?: number;
  startTime?: number;
  expiresAt?: number;
  durationSeconds: number;
  amount?: string;
  status: RentalLifecycle;
  stateLabel: string;
  nextAction: string;
  relayPhase?: RelayJob['phase'];
  diagnostic?: string;
  optimistic: boolean;
}

export interface ActivitySnapshot {
  records: RentalRecord[];
  creditcoinTimestamp: number;
  indexedAt: string;
}

export interface CorrelationState {
  processed: boolean;
  authorizationId: string;
  accessExpiresAt: number;
  authorized: boolean;
  activationTransactionHash?: string;
  creditcoinTimestamp: number;
}

export function correlateRental(
  payment: UsageActivity,
  job: RelayJob | undefined,
  chain: CorrelationState,
): RentalRecord {
  const sourceExpiry = Number(payment.startTime + payment.duration);
  const conflict = correlationConflict(payment, job, chain);
  if (conflict)
    return baseRecord(payment, job, chain, {
      status: 'action-required',
      stateLabel: 'Correlation conflict',
      nextAction: 'Inspect both transactions before taking action',
      diagnostic: conflict,
    });
  if (chain.processed) {
    const ownsCurrentCredential =
      chain.authorizationId.toLowerCase() === payment.orderId.toLowerCase();
    if (
      ownsCurrentCredential &&
      chain.authorized &&
      chain.accessExpiresAt > chain.creditcoinTimestamp
    )
      return baseRecord(payment, job, chain, {
        status: 'active',
        stateLabel: 'Machine access active',
        nextAction: 'Open the device terminal',
      });
    return baseRecord(payment, job, chain, {
      status: 'expired',
      stateLabel: ownsCurrentCredential
        ? 'Access expired'
        : 'Access superseded',
      nextAction: 'Rent this machine again',
    });
  }
  if (job?.phase === 'failed')
    return baseRecord(payment, job, chain, {
      status: 'failed',
      stateLabel: 'Proof relay failed',
      nextAction: 'Resume the proof relay',
      diagnostic: job.error ?? 'The relay reported a failed job.',
    });
  if (sourceExpiry <= chain.creditcoinTimestamp)
    return baseRecord(payment, job, chain, {
      status: 'failed',
      stateLabel: 'Payment window expired before access',
      nextAction: 'Start a new rental',
    });
  if (job)
    return baseRecord(payment, job, chain, {
      status: 'pending',
      stateLabel: relayLabel(job.phase),
      nextAction: 'Track the proof or wait for completion',
    });
  return baseRecord(payment, job, chain, {
    status: 'action-required',
    stateLabel: 'Payment needs proof submission',
    nextAction: 'Resume this rental to enqueue the proof',
  });
}

function baseRecord(
  payment: UsageActivity,
  job: RelayJob | undefined,
  chain: CorrelationState,
  lifecycle: Pick<
    RentalRecord,
    'status' | 'stateLabel' | 'nextAction' | 'diagnostic'
  >,
): RentalRecord {
  return {
    orderId: payment.orderId,
    machineId: payment.machineId,
    payer: payment.payer,
    beneficiary: payment.beneficiary,
    sourceTransactionHash: payment.transactionHash,
    creditcoinTransactionHash:
      job?.creditcoinTransactionHash ?? chain.activationTransactionHash,
    sourceBlockNumber: payment.blockNumber,
    startTime: Number(payment.startTime),
    expiresAt:
      chain.accessExpiresAt || Number(payment.startTime + payment.duration),
    durationSeconds: Number(payment.duration),
    amount: payment.amount.toString(),
    relayPhase: job?.phase,
    optimistic: false,
    ...lifecycle,
  };
}

function correlationConflict(
  payment: UsageActivity,
  job: RelayJob | undefined,
  chain: CorrelationState,
) {
  if (
    job &&
    job.sourceTransactionHash.toLowerCase() !==
      payment.transactionHash.toLowerCase()
  )
    return 'Relay source transaction does not match the indexed Sepolia receipt.';
  if (
    job?.orderId &&
    job.orderId.toLowerCase() !== payment.orderId.toLowerCase()
  )
    return 'Relay order ID conflicts with the UsagePaid event.';
  if (
    job?.machineId &&
    job.machineId.toLowerCase() !== payment.machineId.toLowerCase()
  )
    return 'Relay machine ID conflicts with the UsagePaid event.';
  if (job?.payer && job.payer.toLowerCase() !== payment.payer.toLowerCase())
    return 'Relay payer conflicts with the connected wallet history.';
  if (chain.processed && !chain.activationTransactionHash)
    return 'Creditcoin reports the order processed but no activation event was found.';
  if (
    (job?.phase === 'completed' || job?.phase === 'duplicate') &&
    !chain.processed
  )
    return 'Relay reports completion but the Creditcoin replay guard is not set.';
  return undefined;
}

function relayLabel(phase: RelayJob['phase']) {
  return {
    queued: 'Queued for verification',
    source_confirmation: 'Confirming Sepolia receipt',
    attestation_wait: 'Waiting for Attestcoin coverage',
    proof_generation: 'Building inclusion proof',
    creditcoin_execution: 'Executing on Creditcoin',
    completed: 'Creditcoin execution confirmed',
    duplicate: 'Previously verified',
    failed: 'Proof relay failed',
  }[phase];
}

export function mergeOptimisticRentals(
  records: RentalRecord[],
  optimistic: readonly OptimisticRental[],
) {
  const known = new Set(
    records.map((item) => item.sourceTransactionHash.toLowerCase()),
  );
  return [
    ...optimistic
      .filter((item) => !known.has(item.sourceTransactionHash.toLowerCase()))
      .map<RentalRecord>((item) => ({
        machineId: item.machineId,
        payer: getAddress(item.account),
        sourceTransactionHash: item.sourceTransactionHash,
        durationSeconds: item.durationSeconds,
        status: 'pending',
        stateLabel: 'Waiting for Sepolia confirmation',
        nextAction: 'Return to checkout to recover the payment',
        optimistic: true,
      })),
    ...records,
  ];
}

export function readOptimisticRentals(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
  registry: string,
  account: string,
) {
  const prefix = `proofkey:${registry.toLowerCase()}:`;
  const rentals: OptimisticRental[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const session = JSON.parse(storage.getItem(key) ?? '') as RentalSession;
      if (
        !session.sourceTransactionHash ||
        !session.account ||
        !isTransactionHash(session.sourceTransactionHash)
      )
        continue;
      if (session.account.toLowerCase() !== account.toLowerCase()) continue;
      rentals.push({
        machineId: session.machineId,
        sourceTransactionHash: session.sourceTransactionHash,
        durationSeconds: session.durationSeconds,
        account: session.account,
        phase: session.phase,
        updatedAt: session.updatedAt,
      });
    } catch {
      /* Ignore legacy and malformed browser hints. */
    }
  }
  return rentals;
}

export function paginateRentals(
  records: readonly RentalRecord[],
  status: 'all' | RentalLifecycle,
  page: number,
  pageSize: number,
) {
  const filtered =
    status === 'all'
      ? [...records]
      : records.filter((item) => item.status === status);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    items: filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    total: filtered.length,
    page: safePage,
    totalPages,
  };
}

export class ActivityClient {
  private readonly creditcoin: JsonRpcProvider;
  private readonly worker: ProofWorkerClient;
  constructor(
    private readonly config: AppConfig,
    private readonly payments: PaymentClient,
  ) {
    this.creditcoin = new JsonRpcProvider(config.creditcoinRpcUrl, 102031, {
      staticNetwork: true,
    });
    this.worker = new ProofWorkerClient(config.workerUrl);
  }

  async load(
    account: string,
    optimistic: readonly OptimisticRental[],
  ): Promise<ActivitySnapshot> {
    const payments = await this.payments.loadAccountUsage(account);
    const duplicates = duplicateOrders(payments);
    const latestNumber = await this.creditcoin.getBlockNumber();
    const latestBlock = await this.creditcoin.getBlock(latestNumber);
    if (!latestBlock)
      throw new Error('Creditcoin latest block is unavailable.');
    const orderIds = [...new Set(payments.map((item) => item.orderId))];
    const activationLogs = orderIds.length
      ? await this.creditcoin.getLogs({
          address: this.config.proofKeyAscAddress,
          topics: [
            activationEvents.getEvent('ProofKeyAccessActivated')!.topicHash,
            null,
            orderIds,
          ],
          fromBlock: this.config.proofKeyAscDeploymentBlock,
          toBlock: latestNumber,
        })
      : [];
    const activations = new Map(
      activationLogs.map((log) => {
        const event = activationEvents.parseLog(log)!;
        return [
          (event.args.orderId as string).toLowerCase(),
          log.transactionHash,
        ];
      }),
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
    const records = await Promise.all(
      payments.map(async (payment) => {
        const [jobResult, processed, credential, authorized] =
          await Promise.all([
            this.worker
              .find(payment.transactionHash)
              .then((job) => ({ job }))
              .catch((error: unknown) => ({ error })),
            proofKey.getFunction('processedOrders')(
              payment.orderId,
            ) as Promise<boolean>,
            accessPass.getFunction('accessCredentials')(
              payment.machineId,
              account,
            ),
            accessPass.getFunction('isAuthorized')(
              payment.machineId,
              account,
            ) as Promise<boolean>,
          ]);
        const job = 'job' in jobResult ? jobResult.job : undefined;
        const record = correlateRental(payment, job, {
          processed,
          authorizationId: credential.authorizationId as string,
          accessExpiresAt: Number(credential.expiresAt as bigint),
          authorized,
          activationTransactionHash: activations.get(
            payment.orderId.toLowerCase(),
          ),
          creditcoinTimestamp: latestBlock.timestamp,
        });
        if (
          'error' in jobResult &&
          record.status !== 'active' &&
          record.status !== 'expired'
        ) {
          record.status = 'action-required';
          record.stateLabel = 'Relay service unavailable';
          record.nextAction = 'Retry after the relay reconnects';
          record.diagnostic =
            'The source payment is indexed, but relay state could not be fetched.';
        }
        if (duplicates.has(payment.orderId.toLowerCase())) {
          record.status = 'action-required';
          record.stateLabel = 'Duplicate order correlation';
          record.nextAction = 'Inspect the duplicated source receipts';
          record.diagnostic =
            'More than one UsagePaid event resolved to the same replay-protected order ID.';
        }
        return record;
      }),
    );
    return {
      records: mergeOptimisticRentals(records, optimistic),
      creditcoinTimestamp: latestBlock.timestamp,
      indexedAt: new Date().toISOString(),
    };
  }
}

function duplicateOrders(payments: readonly UsageActivity[]) {
  const counts = new Map<string, number>();
  for (const payment of payments)
    counts.set(
      payment.orderId.toLowerCase(),
      (counts.get(payment.orderId.toLowerCase()) ?? 0) + 1,
    );
  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([orderId]) => orderId),
  );
}
