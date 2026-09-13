import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  getAddress,
  isAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
  type Eip1193Provider,
} from 'ethers';
import type { AppConfig } from './contracts.js';

const accessPassAbi = [
  'function isAuthorized(bytes32 machineId,address beneficiary) view returns (bool)',
  'function accessCredentials(bytes32 machineId,address beneficiary) view returns (bytes32 authorizationId,uint64 expiresAt)',
] as const;
const machineRegistryAbi = [
  'function machines(bytes32 machineId) view returns (address owner,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
] as const;

export type DeviceSessionState =
  | 'awaiting_authorization'
  | 'unlocked'
  | 'active'
  | 'expiring'
  | 'expired'
  | 'stopped'
  | 'fail_closed';

export interface UsageReceiptPayload {
  schema: 'proofkey.usage-receipt.v1';
  kind: 'start' | 'end';
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

export interface DeviceAuthorization {
  authorized: boolean;
  authorizationId: string;
  expiresAt: bigint;
  machineActive: boolean;
  controller: string;
  blockNumber: number;
  blockTimestamp: number;
}

export interface DerivedDeviceSession {
  state: DeviceSessionState;
  reason: string;
}

export function deriveDeviceSession(
  handoff: DeviceHandoff,
  authorization: DeviceAuthorization | undefined,
  nowSeconds: number,
  rpcError?: string,
): DerivedDeviceSession {
  if (rpcError)
    return {
      state: 'fail_closed',
      reason: `Creditcoin check failed: ${rpcError}`,
    };
  if (handoff.endReceipt)
    return {
      state: 'stopped',
      reason: 'A signed end receipt closed the session.',
    };
  if (!authorization)
    return {
      state: 'awaiting_authorization',
      reason: 'Waiting for an independent Creditcoin authorization read.',
    };
  const accessExpiry = Number(authorization.expiresAt);
  if (accessExpiry <= nowSeconds)
    return {
      state: 'expired',
      reason: 'The AccessPass reached its on-chain expiry.',
    };
  if (!authorization.machineActive)
    return {
      state: 'fail_closed',
      reason: 'The machine is inactive on Creditcoin.',
    };
  if (!authorization.authorized)
    return {
      state: 'fail_closed',
      reason: 'Creditcoin denied this payer access.',
    };
  if (
    authorization.authorizationId.toLowerCase() !==
    handoff.orderId.toLowerCase()
  )
    return {
      state: 'fail_closed',
      reason: 'The live AccessPass belongs to a different order.',
    };
  if (authorization.expiresAt.toString() !== handoff.accessExpiresAt)
    return {
      state: 'fail_closed',
      reason: 'The handoff expiry does not match the live AccessPass.',
    };
  if (!handoff.startReceipt)
    return {
      state: 'unlocked',
      reason: 'Authorization verified. Ready to start.',
    };
  if (accessExpiry - nowSeconds <= 60)
    return {
      state: 'expiring',
      reason: 'Session is active but its AccessPass expires within one minute.',
    };
  return {
    state: 'active',
    reason: 'Session active with continuous chain checks.',
  };
}

export function usageReceiptMessage(payload: UsageReceiptPayload): string {
  return [
    'ProofKey Usage Receipt v1',
    `kind=${payload.kind}`,
    `sessionId=${payload.sessionId.toLowerCase()}`,
    `machineId=${payload.machineId.toLowerCase()}`,
    `payer=${payload.payer.toLowerCase()}`,
    `orderId=${payload.orderId.toLowerCase()}`,
    `nonce=${payload.nonce.toLowerCase()}`,
    `controller=${payload.controller.toLowerCase()}`,
    `startedAt=${payload.startedAt}`,
    `endedAt=${payload.endedAt ?? ''}`,
    `measuredDurationSeconds=${payload.measuredDurationSeconds}`,
    `accessExpiresAt=${payload.accessExpiresAt}`,
  ].join('\n');
}

export function verifyUsageReceipt(
  receipt: SignedUsageReceipt,
  handoff: DeviceHandoff,
  registeredController: string,
): { valid: boolean; reason: string; signer?: string } {
  try {
    const payload = receipt.payload;
    if (
      payload.schema !== 'proofkey.usage-receipt.v1' ||
      !isHexString(payload.sessionId, 32) ||
      !isAddress(payload.controller) ||
      payload.machineId.toLowerCase() !== handoff.machineId.toLowerCase() ||
      payload.payer.toLowerCase() !== handoff.payer.toLowerCase() ||
      payload.orderId.toLowerCase() !== handoff.orderId.toLowerCase() ||
      payload.nonce.toLowerCase() !== handoff.nonce.toLowerCase() ||
      payload.accessExpiresAt !== handoff.accessExpiresAt
    )
      return {
        valid: false,
        reason: 'Receipt fields do not match the handoff.',
      };
    const expectedSessionId = keccak256(
      toUtf8Bytes(`proofkey-device-session:${handoff.nonce}`),
    );
    if (payload.sessionId.toLowerCase() !== expectedSessionId.toLowerCase())
      return {
        valid: false,
        reason: 'Receipt session ID does not match the handoff nonce.',
      };
    const startedAt = Date.parse(payload.startedAt);
    const endedAt = payload.endedAt ? Date.parse(payload.endedAt) : undefined;
    const accessExpiresAt = Number(payload.accessExpiresAt) * 1_000;
    if (!Number.isFinite(startedAt) || startedAt > accessExpiresAt)
      return { valid: false, reason: 'Receipt start time is invalid.' };
    if (
      (payload.kind === 'start' &&
        (payload.endedAt !== null || payload.measuredDurationSeconds !== 0)) ||
      (payload.kind === 'end' &&
        (!endedAt ||
          endedAt < startedAt ||
          endedAt > accessExpiresAt ||
          Math.floor((endedAt - startedAt) / 1_000) !==
            payload.measuredDurationSeconds ||
          handoff.startReceipt?.payload.startedAt !== payload.startedAt ||
          handoff.startReceipt?.payload.sessionId.toLowerCase() !==
            payload.sessionId.toLowerCase()))
    )
      return {
        valid: false,
        reason: 'Receipt timing or session binding is invalid.',
      };
    const signer = verifyMessage(
      usageReceiptMessage(payload),
      receipt.signature,
    );
    if (getAddress(signer) !== getAddress(registeredController))
      return {
        valid: false,
        reason: 'Signature is not from the registered machine controller.',
        signer,
      };
    return {
      valid: true,
      reason: 'Controller signature verified locally.',
      signer,
    };
  } catch {
    return {
      valid: false,
      reason: 'Receipt signature or encoding is invalid.',
    };
  }
}

export function deviceClaimStorageKey(nonce: string): string {
  return `proofkey:device-claim:${nonce.toLowerCase()}`;
}

export function customerHandoffStorageKey(
  sourceTransactionHash: string,
): string {
  return `proofkey:customer-handoff:${sourceTransactionHash.toLowerCase()}`;
}

export class DeviceHandoffClient {
  constructor(private readonly baseUrl: string) {}

  create(sourceTransactionHash: string): Promise<DeviceHandoff> {
    return this.request('/device-handoffs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceTransactionHash }),
    });
  }

  get(nonce: string): Promise<DeviceHandoff> {
    return this.request(`/device-handoffs/${nonce}`);
  }

  claim(
    nonce: string,
  ): Promise<{ handoff: DeviceHandoff; claimToken: string }> {
    return this.request(`/device-handoffs/${nonce}/claim`, { method: 'POST' });
  }

  submitReceipt(
    nonce: string,
    claimToken: string,
    receipt: SignedUsageReceipt,
  ): Promise<DeviceHandoff> {
    return this.request(`/device-handoffs/${nonce}/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ProofKey-Claim-Token': claimToken,
      },
      body: JSON.stringify(receipt),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const body = (await response.json().catch(() => undefined)) as
      T | { error?: { message?: string } } | undefined;
    if (!response.ok)
      throw new Error(
        (body as { error?: { message?: string } } | undefined)?.error
          ?.message ?? `Device relay returned HTTP ${response.status}.`,
      );
    return body as T;
  }
}

export class CreditcoinDeviceReader {
  private readonly provider: JsonRpcProvider;
  private readonly accessPass: Contract;
  private readonly machines: Contract;

  constructor(private readonly config: AppConfig) {
    this.provider = new JsonRpcProvider(config.creditcoinRpcUrl, 102031, {
      staticNetwork: true,
    });
    this.accessPass = new Contract(
      config.accessPassAddress,
      accessPassAbi,
      this.provider,
    );
    this.machines = new Contract(
      config.machineRegistryAddress,
      machineRegistryAbi,
      this.provider,
    );
  }

  async read(machineId: string, payer: string): Promise<DeviceAuthorization> {
    const [chainId, authorized, credential, machine, blockNumber] =
      await Promise.all([
        this.provider.send('eth_chainId', []),
        this.accessPass.getFunction('isAuthorized')(machineId, payer),
        this.accessPass.getFunction('accessCredentials')(machineId, payer),
        this.machines.getFunction('machines')(machineId),
        this.provider.getBlockNumber(),
      ]);
    if (BigInt(chainId as string) !== 102031n)
      throw new Error('The device RPC is not Creditcoin CC3 testnet.');
    const block = await this.provider.getBlock(blockNumber);
    if (!block) throw new Error('The latest Creditcoin block is unavailable.');
    return {
      authorized: authorized as boolean,
      authorizationId: credential.authorizationId as string,
      expiresAt: credential.expiresAt as bigint,
      machineActive: machine.active as boolean,
      controller: getAddress(machine.controller as string),
      blockNumber,
      blockTimestamp: block.timestamp,
    };
  }
}

export async function signUsageReceipt(
  walletProvider: Eip1193Provider,
  connectedAccount: string,
  handoff: DeviceHandoff,
  controller: string,
  kind: 'start' | 'end',
  chainTimestamp: number,
): Promise<SignedUsageReceipt> {
  if (getAddress(connectedAccount) !== getAddress(controller))
    throw new Error(
      'Connect the controller wallet registered for this machine.',
    );
  const startPayload = handoff.startReceipt?.payload;
  const startedAt =
    kind === 'end' && startPayload
      ? startPayload.startedAt
      : new Date(chainTimestamp * 1_000).toISOString();
  const endedAt =
    kind === 'end'
      ? new Date(
          Math.min(chainTimestamp, Number(handoff.accessExpiresAt)) * 1_000,
        ).toISOString()
      : null;
  const measuredDurationSeconds = endedAt
    ? Math.max(
        0,
        Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1_000),
      )
    : 0;
  const payload: UsageReceiptPayload = {
    schema: 'proofkey.usage-receipt.v1',
    kind,
    sessionId:
      startPayload?.sessionId ??
      keccak256(toUtf8Bytes(`proofkey-device-session:${handoff.nonce}`)),
    machineId: handoff.machineId,
    payer: getAddress(handoff.payer),
    orderId: handoff.orderId,
    nonce: handoff.nonce,
    controller: getAddress(controller),
    startedAt,
    endedAt,
    measuredDurationSeconds,
    accessExpiresAt: handoff.accessExpiresAt,
  };
  const signer = await new BrowserProvider(walletProvider).getSigner(
    connectedAccount,
  );
  return {
    payload,
    signature: await signer.signMessage(usageReceiptMessage(payload)),
  };
}

export async function switchDeviceWalletToCreditcoin(
  provider: Eip1193Provider,
): Promise<void> {
  const chainId = '0x18e8f';
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: 'Creditcoin CC3 Testnet',
          nativeCurrency: { name: 'Creditcoin', symbol: 'CTC', decimals: 18 },
          rpcUrls: ['https://rpc.cc3-testnet.creditcoin.network'],
          blockExplorerUrls: ['https://creditcoin-testnet.blockscout.com'],
        },
      ],
    });
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  }
  const current = await provider.request({ method: 'eth_chainId' });
  if (BigInt(current as string) !== 102031n)
    throw new Error('Wallet did not switch to Creditcoin CC3 testnet.');
}
