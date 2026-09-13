export const SEPOLIA_CHAIN_ID = 11_155_111;

export type WalletConnectionStatus =
  'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export interface WalletSnapshot {
  status: WalletConnectionStatus;
  address?: string;
  chainId?: number;
  error?: unknown;
}

export type WalletView =
  'disconnected' | 'connecting' | 'connected' | 'wrong-network' | 'rejected';

export function deriveWalletView(snapshot: WalletSnapshot): WalletView {
  if (snapshot.error && isUserRejection(snapshot.error)) return 'rejected';
  if (snapshot.status === 'connecting' || snapshot.status === 'reconnecting')
    return 'connecting';
  if (!snapshot.address || snapshot.status === 'disconnected')
    return 'disconnected';
  return snapshot.chainId === SEPOLIA_CHAIN_ID ? 'connected' : 'wrong-network';
}

export function isUserRejection(error: unknown): boolean {
  const candidate = error as {
    code?: number;
    name?: string;
    message?: string;
    cause?: { code?: number };
  };
  return (
    candidate.code === 4001 ||
    candidate.cause?.code === 4001 ||
    candidate.name === 'UserRejectedRequestError' ||
    /user rejected|user denied|request rejected/i.test(candidate.message ?? '')
  );
}

export function describeWalletError(error: unknown): string {
  if (isUserRejection(error))
    return 'Connection cancelled in your wallet. No signature or transaction was requested.';
  const candidate = error as { shortMessage?: string; message?: string };
  const message = candidate.shortMessage ?? candidate.message;
  if (/provider not found|connector not found/i.test(message ?? ''))
    return 'That wallet is not available in this browser. Install or unlock it, then try again.';
  if (/switch.*not supported|unsupported.*chain/i.test(message ?? ''))
    return 'This wallet cannot switch networks automatically. Open it and select Ethereum Sepolia (11155111).';
  return message ?? 'The wallet could not complete that request.';
}

export function formatWalletBalance(
  formatted: string | undefined,
  symbol: string | undefined,
): string {
  if (!formatted || !symbol) return '—';
  const numeric = Number(formatted);
  const amount = Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : formatted;
  return `${amount} ${symbol}`;
}
