import {
  Contract,
  JsonRpcProvider,
  getAddress,
  isAddress,
  isHexString,
} from 'ethers';
import type { AuthorizationReader, AuthorizationSnapshot } from './state.js';

const accessPassAbi = [
  'function isAuthorized(bytes32 machineId,address beneficiary) view returns (bool)',
  'function accessCredentials(bytes32 machineId,address beneficiary) view returns (bytes32 authorizationId,uint64 expiresAt)',
] as const;

const machineRegistryAbi = [
  'function machines(bytes32 machineId) view returns (address owner,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
] as const;

export interface DeviceConfig {
  rpcUrl: string;
  chainId: number;
  accessPassAddress: string;
  machineRegistryAddress: string;
  machineId: string;
  beneficiary: string;
}

export function loadDeviceConfig(environment: ImportMetaEnv): DeviceConfig {
  const config = {
    rpcUrl: environment.VITE_CREDITCOIN_RPC_URL?.trim() ?? '',
    chainId: Number(environment.VITE_CREDITCOIN_CHAIN_ID ?? '102031'),
    accessPassAddress: environment.VITE_ACCESS_PASS_ADDRESS?.trim() ?? '',
    machineRegistryAddress:
      environment.VITE_MACHINE_REGISTRY_ADDRESS?.trim() ?? '',
    machineId: environment.VITE_DEMO_MACHINE_ID?.trim() ?? '',
    beneficiary: environment.VITE_DEMO_BENEFICIARY_ADDRESS?.trim() ?? '',
  };

  if (!config.rpcUrl)
    throw new Error('Set VITE_CREDITCOIN_RPC_URL to enable live reads.');
  if (!Number.isSafeInteger(config.chainId) || config.chainId < 1)
    throw new Error('VITE_CREDITCOIN_CHAIN_ID must be a positive integer.');
  if (!isAddress(config.accessPassAddress))
    throw new Error('Set a valid VITE_ACCESS_PASS_ADDRESS.');
  if (!isAddress(config.machineRegistryAddress))
    throw new Error('Set a valid VITE_MACHINE_REGISTRY_ADDRESS.');
  if (!isHexString(config.machineId, 32))
    throw new Error('Set VITE_DEMO_MACHINE_ID to a bytes32 value.');
  if (!isAddress(config.beneficiary))
    throw new Error('Set a valid VITE_DEMO_BENEFICIARY_ADDRESS.');

  return {
    ...config,
    accessPassAddress: getAddress(config.accessPassAddress),
    machineRegistryAddress: getAddress(config.machineRegistryAddress),
    machineId: config.machineId.toLowerCase(),
    beneficiary: getAddress(config.beneficiary),
  };
}

export class CreditcoinAuthorizationReader implements AuthorizationReader {
  private readonly provider: JsonRpcProvider;
  private readonly accessPass: Contract;
  private readonly machineRegistry: Contract;

  constructor(private readonly config: DeviceConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.accessPass = new Contract(
      config.accessPassAddress,
      accessPassAbi,
      this.provider,
    );
    this.machineRegistry = new Contract(
      config.machineRegistryAddress,
      machineRegistryAbi,
      this.provider,
    );
  }

  async read(): Promise<AuthorizationSnapshot> {
    const [network, authorized, credential, machine, blockNumber] =
      await Promise.all([
        this.provider.getNetwork(),
        this.accessPass.getFunction('isAuthorized')(
          this.config.machineId,
          this.config.beneficiary,
        ),
        this.accessPass.getFunction('accessCredentials')(
          this.config.machineId,
          this.config.beneficiary,
        ),
        this.machineRegistry.getFunction('machines')(this.config.machineId),
        this.provider.getBlockNumber(),
      ]);
    if (network.chainId !== BigInt(this.config.chainId)) {
      throw new Error(
        `RPC returned chain ${network.chainId}; expected Creditcoin chain ${this.config.chainId}.`,
      );
    }

    return {
      authorized: authorized as boolean,
      authorizationId: credential.authorizationId as string,
      expiresAt: credential.expiresAt as bigint,
      machineActive: machine.active as boolean,
      blockNumber,
    };
  }
}
