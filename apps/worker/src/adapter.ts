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

export class NetworkRelayAdapter implements RelayAdapter {
  private readonly sourceProvider: JsonRpcProvider;
  private readonly creditcoinProvider: JsonRpcProvider;
  private readonly proofBuilder: proofProvider.service.ProofBuilder;
  private readonly contract: Contract;
  private readonly sourceRegistryAddress: string;

  constructor(private readonly config: WorkerConfig) {
    this.sourceProvider = new JsonRpcProvider(config.sepoliaRpcUrl);
    this.creditcoinProvider = new JsonRpcProvider(config.creditcoinRpcUrl);
    this.proofBuilder = new proofProvider.service.ProofBuilder(
      config.sourceChainKey,
      config.proofBuilderUrl,
    );
    this.contract = new Contract(
      config.proofKeyAscAddress,
      proofKeyAbi,
      new Wallet(config.workerPrivateKey, this.creditcoinProvider),
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
      );
    if (!receipt.to || getAddress(receipt.to) !== this.sourceRegistryAddress)
      throw new PermanentRelayError(
        `Sepolia transaction target is ${receipt.to ?? 'contract creation'}; expected ${this.sourceRegistryAddress}.`,
      );
    const payment = this.parseUsagePayment(receipt);
    if (payment.payer !== getAddress(receipt.from))
      throw new PermanentRelayError(
        `UsagePaid payer ${payment.payer} does not match transaction sender ${getAddress(receipt.from)}.`,
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

  async submitProof(proof: AttestcoinProof): Promise<string> {
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
    return transaction.hash as string;
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
      );
    return payments[0]!;
  }
}
