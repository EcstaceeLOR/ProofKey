export const productRoutes = [
  '/',
  '/explore',
  '/machines/:machineId',
  '/rent/:machineId',
  '/activity',
  '/sessions/:sourceTransactionHash',
  '/proofs/:sourceTxHash',
  '/operator',
  '/diagnostics',
  '/device/:machineId',
] as const;

export function rentalStorageKey(
  registryAddress: string,
  machineId: string,
): string {
  return `proofkey:${registryAddress.toLowerCase()}:${machineId}:source-transaction`;
}

export function isTransactionHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function machinePath(machineId: string): string {
  return `/machines/${machineId}`;
}

export function rentPath(machineId: string): string {
  return `/rent/${machineId}`;
}

export function proofPath(sourceTransactionHash: string): string {
  return `/proofs/${sourceTransactionHash}`;
}

export function compactHash(value: string, start = 8, end = 6): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function describeError(error: unknown): string {
  const candidate = error as {
    shortMessage?: string;
    message?: string;
    code?: string | number;
  };
  if (candidate.code === 4001 || candidate.code === 'ACTION_REJECTED') {
    return 'Wallet request cancelled. Nothing was charged.';
  }
  return candidate.shortMessage ?? candidate.message ?? String(error);
}
