export const MAX_DURATION_SECONDS = 30 * 24 * 60 * 60;

export type RentalPhase =
  | 'duration'
  | 'review'
  | 'funds'
  | 'payment'
  | 'approving'
  | 'confirming'
  | 'relay'
  | 'access';

export interface RentalSession {
  version: 1;
  machineId: string;
  durationSeconds: number;
  phase: RentalPhase;
  account?: string;
  approvalTransactionHash?: string;
  sourceTransactionHash?: string;
  orderId?: string;
  startTime?: string;
  expiresAt?: string;
  creditcoinTransactionHash?: string;
  updatedAt: string;
}

export function validateDuration(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DURATION_SECONDS)
    throw new Error(
      'Duration must be a whole number from 1 second to 30 days.',
    );
  return value;
}

export function createRentalSession(
  machineId: string,
  durationSeconds = 14_400,
): RentalSession {
  return {
    version: 1,
    machineId: machineId.toLowerCase(),
    durationSeconds: validateDuration(durationSeconds),
    phase: 'duration',
    updatedAt: new Date().toISOString(),
  };
}

export function parseRentalSession(
  raw: string | null,
  machineId: string,
): RentalSession | undefined {
  if (!raw) return undefined;
  try {
    const candidate = JSON.parse(raw) as RentalSession;
    if (
      candidate.version !== 1 ||
      candidate.machineId !== machineId.toLowerCase() ||
      !candidate.phase
    )
      return undefined;
    validateDuration(candidate.durationSeconds);
    return candidate;
  } catch {
    return undefined;
  }
}

export function updateRentalSession(
  session: RentalSession,
  update: Partial<Omit<RentalSession, 'version' | 'machineId'>>,
): RentalSession {
  return { ...session, ...update, updatedAt: new Date().toISOString() };
}

export function canCreatePayment(session: RentalSession) {
  return (
    !session.sourceTransactionHash &&
    session.phase !== 'relay' &&
    session.phase !== 'access'
  );
}

export function checkoutBlockers(readiness: {
  balanceSufficient: boolean;
  gasSufficient: boolean;
}) {
  const blockers: string[] = [];
  if (!readiness.balanceSufficient) blockers.push('token-balance');
  if (!readiness.gasSufficient) blockers.push('gas-balance');
  return blockers;
}
