import {
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  hexlify,
  isAddress,
  isHexString,
  randomBytes,
  type Eip1193Provider,
} from 'ethers';
import { totalForDuration } from './flow.js';
import { normalizeProofWorkerUrl } from './worker.js';

const sepoliaChainId = 11155111;
const registryAbi = [
  'function machineOffers(bytes32 machineId) view returns (address beneficiary,uint128 pricePerSecond,bool active)',
  'function paymentToken() view returns (address)',
  'function payForUsage(bytes32 machineId,uint64 duration,bytes32 paymentNonce) returns (bytes32 orderId)',
  'event UsagePaid(bytes32 indexed orderId,bytes32 indexed machineId,address indexed payer,address beneficiary,uint64 startTime,uint64 duration,uint256 amount)',
] as const;
const tokenAbi = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function mint(address recipient,uint256 amount)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
] as const;
const machineRegistryAbi = [
  'function machines(bytes32 machineId) view returns (address owner,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
] as const;
const registryInterface = new Interface(registryAbi);

export interface AppConfig {
  sepoliaRpcUrl: string;
  creditcoinRpcUrl: string;
  registryAddress: string;
  machineRegistryAddress: string;
  machineId: string;
  workerUrl: string;
  sepoliaExplorerUrl: string;
  creditcoinExplorerUrl: string;
  deviceUrl: string;
  machineName: string;
  machineLocation: string;
  creditcoinRegistryDeploymentBlock: number;
  sepoliaRegistryDeploymentBlock: number;
}

export interface MachineOffer {
  beneficiary: string;
  pricePerSecond: bigint;
  active: boolean;
  tokenAddress: string;
  tokenDecimals: number;
  tokenSymbol: string;
}

export interface PaymentResult {
  transactionHash: string;
  orderId: string;
  startTime: bigint;
  expiresAt: bigint;
}

export interface CheckoutSnapshot {
  offer: MachineOffer;
  amount: bigint;
  tokenBalance: bigint;
  nativeBalance: bigint;
  gasRequired: bigint;
  allowance: bigint;
  balanceSufficient: boolean;
  gasSufficient: boolean;
  needsApproval: boolean;
  faucetSupported: boolean;
}

export interface UsageActivity {
  orderId: string;
  transactionHash: string;
  payer: string;
  beneficiary: string;
  startTime: bigint;
  duration: bigint;
  amount: bigint;
  blockNumber: number;
}

export type PaymentUpdate =
  | { stage: 'approving'; approvalTransactionHash?: string }
  | { stage: 'paying' }
  | { stage: 'confirming'; paymentTransactionHash: string };

export function loadAppConfig(environment: ImportMetaEnv): AppConfig {
  const config: AppConfig = {
    sepoliaRpcUrl: environment.VITE_ETHEREUM_SEPOLIA_RPC_URL?.trim() ?? '',
    creditcoinRpcUrl: environment.VITE_CREDITCOIN_RPC_URL?.trim() ?? '',
    registryAddress:
      environment.VITE_USAGE_PAYMENT_REGISTRY_ADDRESS?.trim() ?? '',
    machineRegistryAddress:
      environment.VITE_MACHINE_REGISTRY_ADDRESS?.trim() ?? '',
    machineId: environment.VITE_DEMO_MACHINE_ID?.trim() ?? '',
    workerUrl: normalizeProofWorkerUrl(
      environment.VITE_PROOF_WORKER_URL,
      environment.PROD,
    ),
    sepoliaExplorerUrl: (
      environment.VITE_SEPOLIA_EXPLORER_URL ?? 'https://sepolia.etherscan.io'
    ).replace(/\/$/, ''),
    creditcoinExplorerUrl: (
      environment.VITE_CREDITCOIN_EXPLORER_URL ??
      'https://creditcoin-testnet.blockscout.com'
    ).replace(/\/$/, ''),
    deviceUrl: environment.VITE_DEVICE_SIMULATOR_URL ?? 'http://localhost:4174',
    machineName: environment.VITE_DEMO_MACHINE_NAME ?? 'Industrial Excavator',
    machineLocation:
      environment.VITE_DEMO_MACHINE_LOCATION ?? 'Lagos Demo Yard · Bay 04',
    creditcoinRegistryDeploymentBlock: parseDeploymentBlock(
      environment.VITE_MACHINE_REGISTRY_DEPLOYMENT_BLOCK,
      5_476_972,
    ),
    sepoliaRegistryDeploymentBlock: parseDeploymentBlock(
      environment.VITE_USAGE_PAYMENT_REGISTRY_DEPLOYMENT_BLOCK,
      11_691_302,
    ),
  };
  if (!config.sepoliaRpcUrl)
    throw new Error('Set VITE_ETHEREUM_SEPOLIA_RPC_URL to load the machine.');
  if (!config.creditcoinRpcUrl)
    throw new Error(
      'Set VITE_CREDITCOIN_RPC_URL to validate the machine on Creditcoin.',
    );
  if (!isAddress(config.registryAddress))
    throw new Error('Set a valid VITE_USAGE_PAYMENT_REGISTRY_ADDRESS.');
  if (!isAddress(config.machineRegistryAddress))
    throw new Error('Set a valid VITE_MACHINE_REGISTRY_ADDRESS.');
  if (!isHexString(config.machineId, 32))
    throw new Error('Set VITE_DEMO_MACHINE_ID to a bytes32 value.');
  return {
    ...config,
    registryAddress: getAddress(config.registryAddress),
    machineRegistryAddress: getAddress(config.machineRegistryAddress),
  };
}

function parseDeploymentBlock(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('Registry deployment blocks must be positive integers.');
  return parsed;
}

export class PaymentClient {
  private readonly readProvider: JsonRpcProvider;
  private readonly creditcoinProvider: JsonRpcProvider;

  constructor(private readonly config: AppConfig) {
    this.readProvider = new JsonRpcProvider(
      config.sepoliaRpcUrl,
      sepoliaChainId,
      { staticNetwork: true },
    );
    this.creditcoinProvider = new JsonRpcProvider(
      config.creditcoinRpcUrl,
      102031,
      { staticNetwork: true },
    );
  }

  async loadOffer(machineId = this.config.machineId): Promise<MachineOffer> {
    const [sourceChainId, destinationChainId] = await Promise.all([
      this.readProvider.send('eth_chainId', []),
      this.creditcoinProvider.send('eth_chainId', []),
    ]);
    if (BigInt(sourceChainId as string) !== BigInt(sepoliaChainId))
      throw new Error(`Machine RPC is not Ethereum Sepolia ${sepoliaChainId}.`);
    if (BigInt(destinationChainId as string) !== 102031n)
      throw new Error('Creditcoin RPC is not CC3 testnet 102031.');
    const registry = new Contract(
      this.config.registryAddress,
      registryAbi,
      this.readProvider,
    );
    const machineRegistry = new Contract(
      this.config.machineRegistryAddress,
      machineRegistryAbi,
      this.creditcoinProvider,
    );
    const [offer, tokenAddress, machine] = await Promise.all([
      registry.getFunction('machineOffers')(machineId),
      registry.getFunction('paymentToken')(),
      machineRegistry.getFunction('machines')(machineId),
    ]);
    if (
      getAddress(offer.beneficiary as string) !==
      getAddress(machine.owner as string)
    )
      throw new Error(
        'Machine owner is not synchronized across Sepolia and Creditcoin.',
      );
    if ((offer.pricePerSecond as bigint) !== (machine.tariff as bigint))
      throw new Error(
        'Machine tariff is not synchronized across Sepolia and Creditcoin.',
      );
    const token = new Contract(
      tokenAddress as string,
      tokenAbi,
      this.readProvider,
    );
    const [decimals, symbol] = await Promise.all([
      token.getFunction('decimals')(),
      token.getFunction('symbol')(),
    ]);
    return {
      beneficiary: getAddress(offer.beneficiary as string),
      pricePerSecond: offer.pricePerSecond as bigint,
      active: (offer.active as boolean) && (machine.active as boolean),
      tokenAddress: getAddress(tokenAddress as string),
      tokenDecimals: Number(decimals),
      tokenSymbol: symbol as string,
    };
  }

  async inspectCheckout(
    machineId: string,
    expectedOffer: MachineOffer,
    durationSeconds: number,
    account: string,
  ): Promise<CheckoutSnapshot> {
    const offer = await this.loadOffer(machineId);
    assertFreshOffer(expectedOffer, offer);
    if (!offer.active)
      throw new Error('This machine is currently unavailable.');
    const amount = totalForDuration(offer.pricePerSecond, durationSeconds);
    const token = new Contract(offer.tokenAddress, tokenAbi, this.readProvider);
    const [tokenBalance, nativeBalance, allowance, faucetSupported, feeData] =
      await Promise.all([
        token.getFunction('balanceOf')(account) as Promise<bigint>,
        this.readProvider.getBalance(account),
        token.getFunction('allowance')(
          account,
          this.config.registryAddress,
        ) as Promise<bigint>,
        token
          .getFunction('mint')
          .staticCall(account, amount)
          .then(() => true)
          .catch(() => false),
        this.readProvider.getFeeData(),
      ]);
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const gasRequired = gasPrice * (allowance < amount ? 180_000n : 120_000n);
    return {
      offer,
      amount,
      tokenBalance,
      nativeBalance,
      gasRequired,
      allowance,
      balanceSufficient: tokenBalance >= amount,
      gasSufficient: nativeBalance > 0n && nativeBalance >= gasRequired,
      needsApproval: allowance < amount,
      faucetSupported,
    };
  }

  async payForUsage(
    machineId: string,
    offer: MachineOffer,
    durationSeconds: number,
    onUpdate: (update: PaymentUpdate) => void,
    walletProvider: Eip1193Provider,
    connectedAccount: string,
  ): Promise<PaymentResult> {
    const browserProvider = new BrowserProvider(walletProvider);
    const network = await browserProvider.getNetwork();
    if (network.chainId !== BigInt(sepoliaChainId))
      throw new Error(
        `Wallet is on chain ${network.chainId}; switch to Ethereum Sepolia 11155111.`,
      );
    const signer = await browserProvider.getSigner(connectedAccount);
    const account = await signer.getAddress();
    const checkout = await this.inspectCheckout(
      machineId,
      offer,
      durationSeconds,
      account,
    );
    if (!checkout.balanceSufficient)
      throw new Error(
        `Insufficient ${offer.tokenSymbol} balance for this rental.`,
      );
    if (!checkout.gasSufficient)
      throw new Error('Sepolia ETH is required to pay transaction gas.');
    const amount = checkout.amount;
    const token = new Contract(offer.tokenAddress, tokenAbi, signer);
    const allowance = (await token.getFunction('allowance')(
      account,
      this.config.registryAddress,
    )) as bigint;
    if (allowance < amount) {
      onUpdate({ stage: 'approving' });
      const approval = await token.getFunction('approve')(
        this.config.registryAddress,
        amount,
      );
      onUpdate({
        stage: 'approving',
        approvalTransactionHash: approval.hash as string,
      });
      const approvalReceipt = await approval.wait();
      if (!approvalReceipt || approvalReceipt.status !== 1)
        throw new Error('Token approval reverted.');
    }

    onUpdate({ stage: 'paying' });
    const registry = new Contract(
      this.config.registryAddress,
      registryAbi,
      signer,
    );
    const transaction = await registry.getFunction('payForUsage')(
      machineId,
      durationSeconds,
      hexlify(randomBytes(32)),
    );
    const transactionHash = transaction.hash as string;
    onUpdate({ stage: 'confirming', paymentTransactionHash: transactionHash });
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1)
      throw new Error('Usage payment reverted.');

    return this.paymentFromReceipt(receipt, transactionHash, machineId);
  }

  async recoverPayment(transactionHash: string, machineId: string) {
    const receipt =
      (await this.readProvider.getTransactionReceipt(transactionHash)) ??
      (await this.readProvider.waitForTransaction(transactionHash, 1, 120_000));
    if (!receipt || receipt.status !== 1)
      throw new Error('Usage payment has not confirmed successfully.');
    return this.paymentFromReceipt(receipt, transactionHash, machineId);
  }

  async waitForApproval(transactionHash: string) {
    const receipt =
      (await this.readProvider.getTransactionReceipt(transactionHash)) ??
      (await this.readProvider.waitForTransaction(transactionHash, 1, 120_000));
    if (!receipt || receipt.status !== 1)
      throw new Error('Token approval did not confirm successfully.');
  }

  async mintTestTokens(
    offer: MachineOffer,
    recipient: string,
    amount: bigint,
    walletProvider: Eip1193Provider,
  ) {
    const browserProvider = new BrowserProvider(walletProvider);
    const network = await browserProvider.getNetwork();
    if (network.chainId !== BigInt(sepoliaChainId))
      throw new Error(
        'Switch to Ethereum Sepolia before requesting test tokens.',
      );
    const signer = await browserProvider.getSigner(recipient);
    const token = new Contract(offer.tokenAddress, tokenAbi, signer);
    const transaction = await token.getFunction('mint')(recipient, amount);
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1)
      throw new Error('Test-token mint reverted.');
    return transaction.hash as string;
  }

  async loadRecentUsage(
    machineId: string,
    limit = 5,
  ): Promise<UsageActivity[]> {
    const latest = await this.readProvider.getBlockNumber();
    const logs = await this.readProvider.getLogs({
      address: this.config.registryAddress,
      topics: [
        registryInterface.getEvent('UsagePaid')!.topicHash,
        null,
        machineId,
      ],
      fromBlock: this.config.sepoliaRegistryDeploymentBlock,
      toBlock: latest,
    });
    return logs
      .slice(-limit)
      .reverse()
      .flatMap((log) => {
        const event = registryInterface.parseLog(log);
        if (!event) return [];
        return [
          {
            orderId: event.args.orderId as string,
            transactionHash: log.transactionHash,
            payer: getAddress(event.args.payer as string),
            beneficiary: getAddress(event.args.beneficiary as string),
            startTime: event.args.startTime as bigint,
            duration: event.args.duration as bigint,
            amount: event.args.amount as bigint,
            blockNumber: log.blockNumber,
          },
        ];
      });
  }

  private paymentFromReceipt(
    receipt: {
      status: number | null;
      logs: readonly { topics: readonly string[]; data: string }[];
    },
    transactionHash: string,
    machineId: string,
  ): PaymentResult {
    for (const log of receipt.logs) {
      try {
        const parsed = registryInterface.parseLog(log);
        if (parsed?.name !== 'UsagePaid') continue;
        if (
          (parsed.args.machineId as string).toLowerCase() !==
          machineId.toLowerCase()
        )
          throw new Error('Confirmed payment belongs to a different machine.');
        const startTime = parsed.args.startTime as bigint;
        return {
          transactionHash,
          orderId: parsed.args.orderId as string,
          startTime,
          expiresAt: startTime + (parsed.args.duration as bigint),
        };
      } catch {
        // Ignore token-transfer and unrelated receipt logs.
      }
    }
    throw new Error(
      'Confirmed payment did not contain the expected UsagePaid event.',
    );
  }
}

export function assertFreshOffer(
  expected: MachineOffer,
  current: MachineOffer,
) {
  if (
    expected.beneficiary.toLowerCase() !== current.beneficiary.toLowerCase() ||
    expected.pricePerSecond !== current.pricePerSecond ||
    expected.tokenAddress.toLowerCase() !== current.tokenAddress.toLowerCase()
  )
    throw new Error(
      'The machine offer changed. Review the latest price and beneficiary before paying.',
    );
}
