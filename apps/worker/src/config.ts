import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface WorkerConfig {
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
  stateFile: string;
  serverPort: number;
  serverHost: string;
  frontendOrigin: string;
}

export function loadConfig(): WorkerConfig {
  const rootEnv = resolve(import.meta.dirname, '../../..', '.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  return {
    sepoliaRpcUrl: required('ETHEREUM_SEPOLIA_RPC_URL'),
    creditcoinRpcUrl: required('CREDITCOIN_TESTNET_RPC_URL'),
    proofBuilderUrl:
      process.env.CREDITCOIN_PROOF_BUILDER_URL ??
      'https://prover.cc3-testnet.creditcoin.network',
    sourceChainKey: integer('SOURCE_CHAIN_KEY', 1),
    sourceRegistryAddress: required('SEPOLIA_USAGE_PAYMENT_REGISTRY_ADDRESS'),
    proofKeyAscAddress: required('PROOFKEY_ASC_ADDRESS'),
    workerPrivateKey: required('WORKER_PRIVATE_KEY'),
    sourceConfirmations: integer('SOURCE_CONFIRMATIONS', 1),
    sourceTimeoutMs: integer('SOURCE_CONFIRMATION_TIMEOUT_MS', 180_000),
    attestationPollMs: integer('ATTESTATION_POLL_INTERVAL_MS', 15_000),
    attestationTimeoutMs: integer('ATTESTATION_TIMEOUT_MS', 1_200_000),
    retryAttempts: integer('RELAY_RETRY_ATTEMPTS', 3),
    retryBaseDelayMs: integer('RELAY_RETRY_BASE_DELAY_MS', 2_000),
    stateFile:
      process.env.RELAY_STATE_FILE ??
      resolve(import.meta.dirname, '../data/jobs.json'),
    serverPort: integer('WORKER_PORT', 8787),
    serverHost: process.env.WORKER_HOST?.trim() ?? '127.0.0.1',
    frontendOrigin:
      process.env.FRONTEND_ORIGIN?.trim() ?? 'http://localhost:5173',
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}
