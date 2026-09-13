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
  'function approve(address spender,uint256 amount) returns (bool)',
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
  expiresAt: bigint;
}

export type PaymentUpdate =
  | { stage: 'approving'; transactionHash?: string }
  | { stage: 'paying'; transactionHash?: string }
  | { stage: 'confirming'; transactionHash: string };

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

export class PaymentClient {
  private readonly readProvider: JsonRpcProvider;
  private readonly creditcoinProvider: JsonRpcProvider;

  constructor(private readonly config: AppConfig) {
    this.readProvider = new JsonRpcProvider(config.sepoliaRpcUrl);
    this.creditcoinProvider = new JsonRpcProvider(config.creditcoinRpcUrl);
  }

  async loadOffer(): Promise<MachineOffer> {
    const [sourceNetwork, destinationNetwork] = await Promise.all([
      this.readProvider.getNetwork(),
      this.creditcoinProvider.getNetwork(),
    ]);
    if (sourceNetwork.chainId !== BigInt(sepoliaChainId))
      throw new Error(
        `Machine RPC is on chain ${sourceNetwork.chainId}; expected Sepolia 11155111.`,
      );
    if (destinationNetwork.chainId !== 102031n)
      throw new Error(
        `Creditcoin RPC is on chain ${destinationNetwork.chainId}; expected CC3 testnet 102031.`,
      );
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
      registry.getFunction('machineOffers')(this.config.machineId),
      registry.getFunction('paymentToken')(),
      machineRegistry.getFunction('machines')(this.config.machineId),
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

  async payForUsage(
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
    if (!offer.active)
      throw new Error('This machine is currently unavailable.');

    const amount = totalForDuration(offer.pricePerSecond, durationSeconds);
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
        transactionHash: approval.hash as string,
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
      this.config.machineId,
      durationSeconds,
      hexlify(randomBytes(32)),
    );
    const transactionHash = transaction.hash as string;
    onUpdate({ stage: 'confirming', transactionHash });
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1)
      throw new Error('Usage payment reverted.');

    for (const log of receipt.logs) {
      try {
        const parsed = registryInterface.parseLog(log);
        if (parsed?.name !== 'UsagePaid') continue;
        return {
          transactionHash,
          orderId: parsed.args.orderId as string,
          expiresAt:
            (parsed.args.startTime as bigint) +
            (parsed.args.duration as bigint),
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
