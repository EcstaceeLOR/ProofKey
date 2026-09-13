import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface WorkerConfig {
  databaseUrl: string;
  databaseSsl: boolean;
  sepoliaRpcUrl: string;
  creditcoinRpcUrl: string;
  proofBuilderUrl: string;
  sourceChainKey: number;
  sourceRegistryAddress: string;
  proofKeyAscAddress: string;
  workerPrivateKey: string;
  sourceConfirmations: number;
  sourceTimeoutMs: number;
  attestationPollMs: number;
  attestationTimeoutMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  queuePollMs: number;
  leaseDurationMs: number;
  leaseHeartbeatMs: number;
  relayerMinimumBalanceWei: string;
  serverPort: number;
  serverHost: string;
  frontendOrigins: string[];
  rateLimitRequests: number;
  rateLimitWindowMs: number;
}

export function loadConfig(): WorkerConfig {
  const rootEnv = resolve(import.meta.dirname, '../../..', '.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  return {
    databaseUrl: required('DATABASE_URL'),
    databaseSsl: boolean('DATABASE_SSL', false),
    sepoliaRpcUrl: required('ETHEREUM_SEPOLIA_RPC_URL'),
    creditcoinRpcUrl: required('CREDITCOIN_TESTNET_RPC_URL'),
    proofBuilderUrl:
      process.env.CREDITCOIN_PROOF_BUILDER_URL ??
      'https://prover.cc3-testnet.creditcoin.network',
    sourceChainKey: integer('SOURCE_CHAIN_KEY', 1),
    sourceRegistryAddress: required('SEPOLIA_USAGE_PAYMENT_REGISTRY_ADDRESS'),
    proofKeyAscAddress: required('PROOFKEY_ASC_ADDRESS'),
    workerPrivateKey: privateKey('WORKER_PRIVATE_KEY'),
    sourceConfirmations: integer('SOURCE_CONFIRMATIONS', 1),
    sourceTimeoutMs: integer('SOURCE_CONFIRMATION_TIMEOUT_MS', 180_000),
    attestationPollMs: integer('ATTESTATION_POLL_INTERVAL_MS', 15_000),
    attestationTimeoutMs: integer('ATTESTATION_TIMEOUT_MS', 1_200_000),
    retryAttempts: integer('RELAY_RETRY_ATTEMPTS', 3),
    retryBaseDelayMs: integer('RELAY_RETRY_BASE_DELAY_MS', 2_000),
    queuePollMs: integer('RELAY_QUEUE_POLL_MS', 2_000),
    leaseDurationMs: integer('RELAY_LEASE_DURATION_MS', 90_000),
    leaseHeartbeatMs: integer('RELAY_LEASE_HEARTBEAT_MS', 30_000),
    relayerMinimumBalanceWei: unsignedInteger(
      'RELAYER_MINIMUM_CC3_WEI',
      '10000000000000000',
    ),
    serverPort: integerFrom(['PORT', 'WORKER_PORT'], 8787),
    serverHost: process.env.WORKER_HOST?.trim() ?? '127.0.0.1',
    frontendOrigins: origins(
      process.env.FRONTEND_ORIGINS ??
        process.env.FRONTEND_ORIGIN ??
        'http://localhost:5173',
    ),
    rateLimitRequests: integer('RELAY_RATE_LIMIT_REQUESTS', 10),
    rateLimitWindowMs: integer('RELAY_RATE_LIMIT_WINDOW_MS', 60_000),
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function privateKey(name: string): string {
  const configured = required(name);
  const value = configured.startsWith('0x') ? configured : `0x${configured}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${name} must be a 32-byte hexadecimal value.`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}

function integerFrom(names: string[], fallback: number): number {
  const name = names.find((candidate) => process.env[candidate] !== undefined);
  return name ? integer(name, fallback) : fallback;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${name} must be true or false.`);
}

function unsignedInteger(name: string, fallback: string): string {
  const value = process.env[name]?.trim() ?? fallback;
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be an unsigned integer.`);
  return value;
}

function origins(raw: string): string[] {
  const values = [
    ...new Set(raw.split(',').map((value) => value.trim())),
  ].filter(Boolean);
  if (values.length === 0) throw new Error('FRONTEND_ORIGINS cannot be empty.');
  return values.map((value) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value)
      throw new Error(`Invalid browser origin ${value}.`);
    return value;
  });
}
