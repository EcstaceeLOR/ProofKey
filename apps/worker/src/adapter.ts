import { proofProvider } from '@gluwa/usc-sdk';
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
  type Log,
  type TransactionReceipt,
} from 'ethers';
import type { WorkerConfig } from './config.js';
import { PermanentRelayError } from './retry.js';
import type {
  AttestcoinProof,
  CreditcoinExecution,
  RelayAdapter,
  SourceReceipt,
  UsagePayment,
} from './types.js';

const usagePaymentInterface = new Interface([
  'event UsagePaid(bytes32 indexed orderId, bytes32 indexed machineId, address indexed payer, address beneficiary, uint64 startTime, uint64 duration, uint256 amount)',
]);
const proofKeyAbi = [
  'function execute(uint8 action,uint64 chainKey,uint64 blockHeight,bytes encodedTransaction,bytes32 merkleRoot,tuple(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] continuityRoots) returns (bool)',
  'function processedOrders(bytes32 orderId) view returns (bool)',
] as const;
const activationInterface = new Interface([
  'event ProofKeyAccessActivated(bytes32 indexed queryId,bytes32 indexed orderId,bytes32 indexed machineId,address payer,uint64 expiresAt)',
]);

export class NetworkRelayAdapter implements RelayAdapter {
  private readonly sourceProvider: JsonRpcProvider;
  private readonly creditcoinProvider: JsonRpcProvider;
  private readonly proofBuilder: proofProvider.service.ProofBuilder;
  private readonly contract: Contract;
  private readonly relayer: Wallet;
  private readonly sourceRegistryAddress: string;

  constructor(private readonly config: WorkerConfig) {
    this.sourceProvider = new JsonRpcProvider(config.sepoliaRpcUrl);
    this.creditcoinProvider = new JsonRpcProvider(config.creditcoinRpcUrl);
    this.proofBuilder = new proofProvider.service.ProofBuilder(
      config.sourceChainKey,
      config.proofBuilderUrl,
    );
    this.relayer = new Wallet(config.workerPrivateKey, this.creditcoinProvider);
    this.contract = new Contract(
      config.proofKeyAscAddress,
      proofKeyAbi,
      this.relayer,
    );
    this.sourceRegistryAddress = getAddress(config.sourceRegistryAddress);
  }

  async assertNetworks(): Promise<void> {
    const [source, destination] = await Promise.all([
      this.sourceProvider.getNetwork(),
      this.creditcoinProvider.getNetwork(),
    ]);
    if (source.chainId !== 11155111n)
      throw new PermanentRelayError(
        `Sepolia RPC returned chain ID ${source.chainId}; expected 11155111.`,
      );
    if (destination.chainId !== 102031n)
      throw new PermanentRelayError(
        `Creditcoin testnet RPC returned chain ID ${destination.chainId}; expected 102031.`,
      );
    if (this.config.sourceChainKey !== 1)
      throw new PermanentRelayError(
        'ProofKeyASC supports Sepolia Attestcoin chain key 1 only.',
      );
  }

  async readiness(): Promise<{
    sourceRpc: { status: 'ready' | 'unavailable'; code?: string };
    creditcoinRpc: { status: 'ready' | 'unavailable'; code?: string };
    relayer: {
      status: 'ready' | 'unavailable';
      code?: string;
      address: string;
      balanceWei?: string;
      minimumBalanceWei: string;
    };
  }> {
    const [source, destination, balance] = await Promise.allSettled([
      withTimeout(
        Promise.all([
          this.sourceProvider.getNetwork(),
          this.sourceProvider.getBlockNumber(),
        ]).then(([network]) => network),
      ),
      withTimeout(
        Promise.all([
          this.creditcoinProvider.getNetwork(),
          this.creditcoinProvider.getBlockNumber(),
        ]).then(([network]) => network),
      ),
      withTimeout(this.creditcoinProvider.getBalance(this.relayer.address)),
    ]);
    const minimum = BigInt(this.config.relayerMinimumBalanceWei);
    const balanceWei =
      balance.status === 'fulfilled' ? balance.value : undefined;
    const funded = balanceWei !== undefined && balanceWei >= minimum;
    return {
      sourceRpc:
        source.status === 'fulfilled' && source.value.chainId === 11155111n
          ? { status: 'ready' }
          : {
              status: 'unavailable',
              code:
                source.status === 'fulfilled'
                  ? 'SOURCE_RPC_WRONG_CHAIN'
                  : 'SOURCE_RPC_UNAVAILABLE',
            },
      creditcoinRpc:
        destination.status === 'fulfilled' &&
        destination.value.chainId === 102031n
          ? { status: 'ready' }
          : {
              status: 'unavailable',
              code:
                destination.status === 'fulfilled'
                  ? 'CREDITCOIN_RPC_WRONG_CHAIN'
                  : 'CREDITCOIN_RPC_UNAVAILABLE',
            },
      relayer: {
        status: funded ? 'ready' : 'unavailable',
        code: funded ? undefined : 'RELAYER_BALANCE_LOW',
        address: this.relayer.address,
        balanceWei: balanceWei?.toString(),
        minimumBalanceWei: minimum.toString(),
      },
    };
  }

  async confirmSourceTransaction(
    transactionHash: string,
  ): Promise<SourceReceipt> {
    const receipt = await this.sourceProvider.waitForTransaction(
      transactionHash,
      this.config.sourceConfirmations,
      this.config.sourceTimeoutMs,
    );
    if (!receipt)
      throw new Error(
        `Sepolia transaction ${transactionHash} was not confirmed before timeout.`,
      );
    if (receipt.status !== 1)
      throw new PermanentRelayError(
        `Sepolia transaction ${transactionHash} reverted.`,
        'SOURCE_TRANSACTION_REVERTED',
      );
    if (!receipt.to || getAddress(receipt.to) !== this.sourceRegistryAddress)
      throw new PermanentRelayError(
        `Sepolia transaction target is ${receipt.to ?? 'contract creation'}; expected ${this.sourceRegistryAddress}.`,
        'SOURCE_CONTRACT_MISMATCH',
      );
    const payment = this.parseUsagePayment(receipt);
    if (payment.payer !== getAddress(receipt.from))
      throw new PermanentRelayError(
        `UsagePaid payer ${payment.payer} does not match transaction sender ${getAddress(receipt.from)}.`,
        'SOURCE_PAYER_MISMATCH',
      );
    return { blockNumber: receipt.blockNumber, payment };
  }

  async waitUntilAttested(blockNumber: number): Promise<void> {
    await this.proofBuilder.waitUntilHeightAttested(
      this.config.sourceChainKey,
      blockNumber,
      this.config.attestationPollMs,
      this.config.attestationTimeoutMs,
    );
  }

  async generateProof(transactionHash: string): Promise<AttestcoinProof> {
    const result = await this.proofBuilder.getProof(transactionHash);
    if (!result.success || !result.data)
      throw new Error(
        `Attestcoin Proof Builder rejected the transaction: ${result.error ?? 'no proof returned'}.`,
      );
    return {
      chainKey: result.data.chainKey,
      blockHeight: result.data.headerNumber,
      encodedTransaction: result.data.txBytes,
      merkleRoot: result.data.merkleProof.root,
      siblings: result.data.merkleProof.siblings,
      lowerEndpointDigest: result.data.continuityProof.lowerEndpointDigest,
      continuityRoots: result.data.continuityProof.roots,
    };
  }

  async isOrderProcessed(orderId: string): Promise<boolean> {
    return (await this.contract.getFunction('processedOrders')(
      orderId,
    )) as boolean;
  }

  async submitProof(proof: AttestcoinProof): Promise<CreditcoinExecution> {
    const transaction = await this.contract.getFunction('execute')(
      0,
      proof.chainKey,
      proof.blockHeight,
      proof.encodedTransaction,
      proof.merkleRoot,
      proof.siblings,
      proof.lowerEndpointDigest,
      proof.continuityRoots,
    );
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1)
      throw new Error('Creditcoin proof transaction reverted.');
    for (const log of receipt.logs) {
      if (
        getAddress(log.address) !== getAddress(this.config.proofKeyAscAddress)
      )
        continue;
      const event = activationInterface.parseLog(log);
      if (event?.name === 'ProofKeyAccessActivated')
        return {
          transactionHash: transaction.hash as string,
          queryId: event.args.queryId as string,
        };
    }
    throw new Error('Creditcoin execution omitted ProofKeyAccessActivated.');
  }

  private parseUsagePayment(receipt: TransactionReceipt): UsagePayment {
    const payments: UsagePayment[] = [];
    for (const log of receipt.logs.filter(
      (entry: Log) => getAddress(entry.address) === this.sourceRegistryAddress,
    )) {
      try {
        const parsed = usagePaymentInterface.parseLog(log);
        if (parsed?.name !== 'UsagePaid') continue;
        payments.push({
          orderId: parsed.args.orderId as string,
          machineId: parsed.args.machineId as string,
          payer: getAddress(parsed.args.payer as string),
          beneficiary: getAddress(parsed.args.beneficiary as string),
          startTime: (parsed.args.startTime as bigint).toString(),
          duration: (parsed.args.duration as bigint).toString(),
          amount: (parsed.args.amount as bigint).toString(),
        });
      } catch {
        // Ignore unrelated logs from the configured source registry.
      }
    }
    if (payments.length !== 1)
      throw new PermanentRelayError(
        `Expected exactly one UsagePaid event from ${this.sourceRegistryAddress}; found ${payments.length}.`,
        'USAGE_PAYMENT_EVENT_INVALID',
      );
    return payments[0]!;
  }
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Readiness probe timed out.')),
          5_000,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
