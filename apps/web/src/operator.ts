import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  getAddress,
  isAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
  type Eip1193Provider,
} from 'ethers';
import type { AppConfig } from './contracts.js';
import type { MachineMetadata } from './machine-metadata.js';

const machineRegistryAbi = [
  'function machines(bytes32 machineId) view returns (address owner,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
  'function registerMachine(bytes32 machineId,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
  'function updateController(bytes32 machineId,address controller)',
  'function updateMetadataHash(bytes32 machineId,bytes32 metadataHash)',
  'function updateTariff(bytes32 machineId,uint128 tariff)',
  'function setMachineActive(bytes32 machineId,bool active)',
] as const;
const paymentRegistryAbi = [
  'function owner() view returns (address)',
  'function setMachineOffer(bytes32 machineId,address beneficiary,uint128 pricePerSecond,bool active)',
  'function setMachineActive(bytes32 machineId,bool active)',
] as const;

export type OperatorPhase =
  'draft' | 'metadata_uploaded' | 'cc3_confirmed' | 'complete';

export interface MachineDraft {
  label: string;
  name: string;
  description: string;
  image: string;
  category: string;
  city: string;
  country: string;
  site: string;
  capabilities: string;
  safetyRequirements: string;
  controller: string;
  tariff: string;
  active: boolean;
}

export interface UploadedMetadata {
  contentDigest: string;
  commitment: string;
  uri: string;
  document: Record<string, unknown>;
  createdAt: string;
}

export interface OperatorSession {
  version: 1;
  account: string;
  phase: OperatorPhase;
  draft: MachineDraft;
  machineId: string;
  metadata?: UploadedMetadata;
  creditcoinTransactionHash?: string;
  sepoliaTransactionHash?: string;
  updatedAt: string;
}

export interface OperatorAuthority {
  paymentRegistryOwner: string;
}

export const emptyMachineDraft: MachineDraft = {
  label: '',
  name: '',
  description: '',
  image: 'industrial-machine',
  category: '',
  city: '',
  country: '',
  site: '',
  capabilities: '',
  safetyRequirements: '',
  controller: '',
  tariff: '',
  active: true,
};

export class OperatorClient {
  private readonly creditcoin: JsonRpcProvider;
  private readonly sepolia: JsonRpcProvider;

  constructor(private readonly config: AppConfig) {
    this.creditcoin = new JsonRpcProvider(config.creditcoinRpcUrl, 102031, {
      staticNetwork: true,
    });
    this.sepolia = new JsonRpcProvider(config.sepoliaRpcUrl, 11155111, {
      staticNetwork: true,
    });
  }

  async loadAuthority(): Promise<OperatorAuthority> {
    const registry = new Contract(
      this.config.registryAddress,
      paymentRegistryAbi,
      this.sepolia,
    );
    return {
      paymentRegistryOwner: getAddress(
        (await registry.getFunction('owner')()) as string,
      ),
    };
  }

  async uploadMetadata(
    draft: MachineDraft,
    account: string,
  ): Promise<UploadedMetadata> {
    const errors = validateMachineDraft(draft);
    if (errors.length) throw new Error(errors[0]);
    const document = metadataDocument(draft, account);
    const response = await fetch(`${this.config.workerUrl}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document }),
    });
    const body = (await response.json().catch(() => undefined)) as
      UploadedMetadata | { error?: { message?: string } } | undefined;
    if (!response.ok)
      throw new Error(
        body && 'error' in body
          ? (body.error?.message ?? 'Metadata upload failed.')
          : 'Metadata upload failed.',
      );
    const uploaded = body as UploadedMetadata;
    if (
      !isHexString(uploaded.contentDigest, 32) ||
      !isHexString(uploaded.commitment, 32) ||
      keccak256(toUtf8Bytes(uploaded.uri)).toLowerCase() !==
        uploaded.commitment.toLowerCase()
    )
      throw new Error('Metadata service returned an invalid commitment.');
    return uploaded;
  }

  async registerMachine(
    session: OperatorSession,
    wallet: Eip1193Provider,
  ): Promise<string> {
    if (!session.metadata)
      throw new Error('Upload metadata before registration.');
    return this.creditcoinMutation(wallet, session.account, 'registerMachine', [
      session.machineId,
      session.draft.controller,
      session.metadata.commitment,
      BigInt(session.draft.tariff),
      session.draft.active,
    ]);
  }

  async synchronizeOffer(
    session: OperatorSession,
    wallet: Eip1193Provider,
  ): Promise<string> {
    return this.sepoliaMutation(wallet, session.account, 'setMachineOffer', [
      session.machineId,
      session.account,
      BigInt(session.draft.tariff),
      session.draft.active,
    ]);
  }

  updateController(
    machineId: string,
    controller: string,
    account: string,
    wallet: Eip1193Provider,
  ) {
    if (!isAddress(controller))
      throw new Error('Controller address is invalid.');
    return this.creditcoinMutation(wallet, account, 'updateController', [
      machineId,
      controller,
    ]);
  }

  updateMetadata(
    machineId: string,
    commitment: string,
    account: string,
    wallet: Eip1193Provider,
  ) {
    if (!isHexString(commitment, 32))
      throw new Error('Metadata commitment is invalid.');
    return this.creditcoinMutation(wallet, account, 'updateMetadataHash', [
      machineId,
      commitment,
    ]);
  }

  updateTariff(
    machineId: string,
    tariff: string,
    account: string,
    wallet: Eip1193Provider,
  ) {
    if (!positiveInteger(tariff)) throw new Error('Tariff must be positive.');
    return this.creditcoinMutation(wallet, account, 'updateTariff', [
      machineId,
      BigInt(tariff),
    ]);
  }

  setCreditcoinActive(
    machineId: string,
    active: boolean,
    account: string,
    wallet: Eip1193Provider,
  ) {
    return this.creditcoinMutation(wallet, account, 'setMachineActive', [
      machineId,
      active,
    ]);
  }

  repairOffer(
    machineId: string,
    beneficiary: string,
    tariff: bigint,
    active: boolean,
    account: string,
    wallet: Eip1193Provider,
  ) {
    return this.sepoliaMutation(wallet, account, 'setMachineOffer', [
      machineId,
      beneficiary,
      tariff,
      active,
    ]);
  }

  private async creditcoinMutation(
    wallet: Eip1193Provider,
    account: string,
    method: string,
    arguments_: unknown[],
  ) {
    await switchWalletChain(wallet, {
      chainId: 102031,
      chainName: 'Creditcoin CC3 Testnet',
      rpcUrl: this.config.creditcoinRpcUrl,
      explorerUrl: this.config.creditcoinExplorerUrl,
      nativeSymbol: 'CTC',
    });
    return sendContractTransaction(
      wallet,
      account,
      this.config.machineRegistryAddress,
      machineRegistryAbi,
      method,
      arguments_,
    );
  }

  private async sepoliaMutation(
    wallet: Eip1193Provider,
    account: string,
    method: string,
    arguments_: unknown[],
  ) {
    await switchWalletChain(wallet, {
      chainId: 11155111,
      chainName: 'Ethereum Sepolia',
      rpcUrl: this.config.sepoliaRpcUrl,
      explorerUrl: this.config.sepoliaExplorerUrl,
      nativeSymbol: 'ETH',
    });
    return sendContractTransaction(
      wallet,
      account,
      this.config.registryAddress,
      paymentRegistryAbi,
      method,
      arguments_,
    );
  }
}

export function createOperatorSession(
  account: string,
  draft: MachineDraft,
): OperatorSession {
  const normalized = getAddress(account);
  return {
    version: 1,
    account: normalized,
    phase: 'draft',
    draft,
    machineId: machineIdFromLabel(draft.label),
    updatedAt: new Date().toISOString(),
  };
}

export function updateOperatorSession(
  session: OperatorSession,
  update: Partial<Omit<OperatorSession, 'version' | 'account'>>,
): OperatorSession {
  return { ...session, ...update, updatedAt: new Date().toISOString() };
}

export function operatorStorageKey(account: string) {
  return `proofkey:operator:${account.toLowerCase()}:onboarding`;
}

export function saveOperatorSession(session: OperatorSession) {
  localStorage.setItem(
    operatorStorageKey(session.account),
    JSON.stringify(session),
  );
}

export function loadOperatorSession(
  account: string,
): OperatorSession | undefined {
  try {
    const value = localStorage.getItem(operatorStorageKey(account));
    if (!value) return undefined;
    const session = JSON.parse(value) as OperatorSession;
    if (
      session.version !== 1 ||
      session.account.toLowerCase() !== account.toLowerCase() ||
      !isHexString(session.machineId, 32)
    )
      return undefined;
    return session;
  } catch {
    return undefined;
  }
}

export function clearOperatorSession(account: string) {
  localStorage.removeItem(operatorStorageKey(account));
}

export function machineIdFromLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  if (normalized.length < 3)
    throw new Error('Machine label must contain at least 3 characters.');
  return keccak256(toUtf8Bytes(normalized));
}

export function validateMachineDraft(draft: MachineDraft): string[] {
  const errors: string[] = [];
  if (draft.label.trim().length < 3) errors.push('Machine label is required.');
  if (draft.name.trim().length < 3) errors.push('Machine name is required.');
  if (draft.description.trim().length < 12)
    errors.push('Add a useful machine description.');
  if (!draft.category.trim()) errors.push('Category is required.');
  if (!draft.city.trim() || !draft.country.trim() || !draft.site.trim())
    errors.push('Complete the machine location.');
  if (!isAddress(draft.controller))
    errors.push('Controller address is invalid.');
  if (!positiveInteger(draft.tariff))
    errors.push('Tariff must be a positive integer.');
  return errors;
}

export function assertOperatorAccount(expected: string, actual: string) {
  if (getAddress(expected) !== getAddress(actual))
    throw new Error('Connected account does not own this operator session.');
}

export function metadataDocument(
  draft: MachineDraft,
  account: string,
): Omit<MachineMetadata, 'uri'> {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    image: draft.image.trim() || 'industrial-machine',
    category: draft.category.trim(),
    location: {
      city: draft.city.trim(),
      country: draft.country.trim(),
      site: draft.site.trim(),
    },
    capabilities: commaList(draft.capabilities),
    safetyRequirements: commaList(draft.safetyRequirements),
    operator: {
      name: draft.name.trim(),
      wallet: getAddress(account),
      verified: true,
    },
  };
}

interface ChainDefinition {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeSymbol: string;
}

export async function switchWalletChain(
  wallet: Eip1193Provider,
  chain: ChainDefinition,
) {
  const chainId = `0x${chain.chainId.toString(16)}`;
  try {
    await wallet.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch (error) {
    const candidate = error as { code?: number; message?: string };
    if (
      candidate.code !== 4902 &&
      !/unrecognized chain/i.test(candidate.message ?? '')
    )
      throw error;
    await wallet.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: chain.chainName,
          nativeCurrency: {
            name: chain.nativeSymbol,
            symbol: chain.nativeSymbol,
            decimals: 18,
          },
          rpcUrls: [chain.rpcUrl],
          blockExplorerUrls: [chain.explorerUrl],
        },
      ],
    });
  }
  const current = await wallet.request({ method: 'eth_chainId' });
  if (BigInt(current as string) !== BigInt(chain.chainId))
    throw new Error(`Wallet did not switch to ${chain.chainName}.`);
}

async function sendContractTransaction(
  wallet: Eip1193Provider,
  account: string,
  address: string,
  abi: readonly string[],
  method: string,
  arguments_: unknown[],
) {
  const provider = new BrowserProvider(wallet);
  const signer = await provider.getSigner(account);
  assertOperatorAccount(account, await signer.getAddress());
  const contract = new Contract(address, abi, signer);
  const transaction = await contract.getFunction(method)(...arguments_);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1)
    throw new Error(`${method} transaction reverted.`);
  return transaction.hash as string;
}

function positiveInteger(value: string) {
  return /^\d+$/.test(value) && BigInt(value) > 0n;
}

function commaList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
