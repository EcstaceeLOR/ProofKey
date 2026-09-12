export type RelayPhase =
  | 'queued'
  | 'source_confirmation'
  | 'attestation_wait'
  | 'proof_generation'
  | 'creditcoin_execution'
  | 'completed'
  | 'duplicate'
  | 'failed';

export type JourneyStep = 'payment' | 'confirmation' | 'proof' | 'unlock';

export interface RelayJob {
  sourceTransactionHash: string;
  phase: RelayPhase;
  creditcoinTransactionHash?: string;
  accessExpiresAt?: string;
  failedAtPhase?: RelayPhase;
  error?: string;
}

export interface ProgressView {
  active: JourneyStep;
  completed: JourneyStep[];
  label: string;
  verified: boolean;
}

export function progressFromJob(job: RelayJob): ProgressView {
  switch (job.phase) {
    case 'queued':
    case 'source_confirmation':
      return {
        active: 'confirmation',
        completed: ['payment'],
        label: 'Confirming the Sepolia payment',
        verified: false,
      };
    case 'attestation_wait':
      return {
        active: 'proof',
        completed: ['payment', 'confirmation'],
        label: 'Waiting for Attestcoin coverage',
        verified: false,
      };
    case 'proof_generation':
      return {
        active: 'proof',
        completed: ['payment', 'confirmation'],
        label: 'Building Merkle + continuity proof',
        verified: false,
      };
    case 'creditcoin_execution':
      return {
        active: 'unlock',
        completed: ['payment', 'confirmation', 'proof'],
        label: 'Verifying proof on Creditcoin',
        verified: false,
      };
    case 'completed':
    case 'duplicate':
      return {
        active: 'unlock',
        completed: ['payment', 'confirmation', 'proof', 'unlock'],
        label: 'Access verified on Creditcoin',
        verified: true,
      };
    case 'failed':
      return {
        active: stepFromFailedPhase(job.failedAtPhase),
        completed: ['payment'],
        label: job.error ?? 'Cross-chain verification failed',
        verified: false,
      };
  }
}

export function totalForDuration(
  pricePerSecond: bigint,
  durationSeconds: number,
): bigint {
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1) {
    throw new Error('Duration must be a positive integer.');
  }
  return pricePerSecond * BigInt(durationSeconds);
}

export function shortenAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

export function formatDuration(durationSeconds: number): string {
  const hours = durationSeconds / 3_600;
  if (Number.isInteger(hours))
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const minutes = durationSeconds / 60;
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

function stepFromFailedPhase(phase?: RelayPhase): JourneyStep {
  if (phase === 'attestation_wait' || phase === 'proof_generation')
    return 'proof';
  if (phase === 'creditcoin_execution') return 'unlock';
  return 'confirmation';
}
