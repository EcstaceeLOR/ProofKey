import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
  hexlify,
  keccak256,
  randomBytes,
  toUtf8Bytes,
  type TransactionReceipt,
} from 'ethers';

import { NetworkRelayAdapter } from './adapter.js';
import { writePublicEvidence } from './evidence.js';
import type { WorkerConfig } from './config.js';
import { withRetry } from './retry.js';

const SEPOLIA_CHAIN_ID = 11_155_111n;
const CREDITCOIN_CHAIN_ID = 102_031n;
const MACHINE_LABEL = 'proofkey.excavator.001';
const METADATA_URI = 'ipfs://proofkey/excavator/001';

interface PublicContractRecord {
  address: string;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  explorerUrl?: string;
}

interface SepoliaDeployment {
  chainId: number;
  paymentToken: PublicContractRecord & { deployedByScript: boolean };
  usagePaymentRegistry: PublicContractRecord;
}

interface CreditcoinDeployment {
  chainId: number;
  source: { chainKey: number; usagePaymentRegistry: string };
  machineRegistry: PublicContractRecord;
  accessPass: PublicContractRecord;
  proofKeyASC: PublicContractRecord;
}

const machineRegistryAbi = [
  'function machines(bytes32) view returns (address owner,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
  'function registerMachine(bytes32 machineId,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
  'function updateController(bytes32 machineId,address controller)',
  'function updateMetadataHash(bytes32 machineId,bytes32 metadataHash)',
  'function updateTariff(bytes32 machineId,uint128 tariff)',
  'function setMachineActive(bytes32 machineId,bool active)',
] as const;
const paymentRegistryAbi = [
  'function owner() view returns (address)',
  'function machineOffers(bytes32) view returns (address beneficiary,uint128 pricePerSecond,bool active)',
  'function setMachineOffer(bytes32 machineId,address beneficiary,uint128 pricePerSecond,bool active)',
  'function payForUsage(bytes32 machineId,uint64 duration,bytes32 paymentNonce) returns (bytes32 orderId)',
  'event UsagePaid(bytes32 indexed orderId,bytes32 indexed machineId,address indexed payer,address beneficiary,uint64 startTime,uint64 duration,uint256 amount)',
] as const;
const tokenAbi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function mint(address,uint256)',
] as const;
const accessPassAbi = [
  'function accessCredentials(bytes32,address) view returns (bytes32 authorizationId,uint64 expiresAt)',
  'function isAuthorized(bytes32,address) view returns (bool)',
] as const;

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '../../..');
  const environmentPath = resolve(root, '.env');
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

  const sepoliaDeployment = await readJson<SepoliaDeployment>(
    resolve(root, 'packages/contracts/deployments/sepolia.json'),
  );
  const creditcoinDeployment = await readJson<CreditcoinDeployment>(
    resolve(root, 'packages/contracts/deployments/cc3-testnet.json'),
  );
  validateManifests(sepoliaDeployment, creditcoinDeployment);

  const sepoliaExplorer = trimSlash(
    process.env.ETHEREUM_SEPOLIA_EXPLORER_URL ?? 'https://sepolia.etherscan.io',
  );
  const creditcoinExplorer = trimSlash(
    process.env.CREDITCOIN_TESTNET_EXPLORER_URL ??
      'https://creditcoin-testnet.blockscout.com',
  );
  const deployerPrivateKey = privateKey('DEPLOYER_PRIVATE_KEY');
  const workerPrivateKey = privateKey('WORKER_PRIVATE_KEY');
  const sepoliaProvider = new JsonRpcProvider(
    required('ETHEREUM_SEPOLIA_RPC_URL'),
  );
  const creditcoinProvider = new JsonRpcProvider(
    required('CREDITCOIN_TESTNET_RPC_URL'),
  );
  const [sepoliaNetwork, creditcoinNetwork] = await Promise.all([
    sepoliaProvider.getNetwork(),
    creditcoinProvider.getNetwork(),
  ]);
  if (sepoliaNetwork.chainId !== SEPOLIA_CHAIN_ID)
    throw new Error(`Sepolia RPC returned chain ${sepoliaNetwork.chainId}.`);
  if (creditcoinNetwork.chainId !== CREDITCOIN_CHAIN_ID)
    throw new Error(
      `Creditcoin RPC returned chain ${creditcoinNetwork.chainId}.`,
    );

  const deployerOnSepolia = new Wallet(deployerPrivateKey, sepoliaProvider);
  const deployerOnCreditcoin = new Wallet(
    deployerPrivateKey,
    creditcoinProvider,
  );
  const workerAddress = new Wallet(workerPrivateKey).address;
  const machineId = keccak256(toUtf8Bytes(MACHINE_LABEL));
  const metadataHash = keccak256(toUtf8Bytes(METADATA_URI));
  const tariff = positiveBigInt('DEMO_TARIFF', 2_500n);
  const duration = positiveBigInt('DEMO_DURATION_SECONDS', 86_400n);
  if (duration > 2_592_000n)
    throw new Error('DEMO_DURATION_SECONDS cannot exceed 30 days.');

  const machineRegistry = new Contract(
    creditcoinDeployment.machineRegistry.address,
    machineRegistryAbi,
    deployerOnCreditcoin,
  );
  const paymentRegistry = new Contract(
    sepoliaDeployment.usagePaymentRegistry.address,
    paymentRegistryAbi,
    deployerOnSepolia,
  );
  const paymentToken = new Contract(
    sepoliaDeployment.paymentToken.address,
    tokenAbi,
    deployerOnSepolia,
  );
  const accessPass = new Contract(
    creditcoinDeployment.accessPass.address,
    accessPassAbi,
    creditcoinProvider,
  );

  const configurationTransactions: Array<{
    purpose: string;
    transactionHash: string;
    blockNumber: number;
    explorerUrl: string;
  }> = [];
  report('configuration', 'Configuring the canonical machine on both chains.');
  await configureMachine(
    machineRegistry,
    machineId,
    deployerOnCreditcoin.address,
    metadataHash,
    tariff,
    creditcoinExplorer,
    configurationTransactions,
  );
  await configureOffer(
    paymentRegistry,
    machineId,
    deployerOnCreditcoin.address,
    tariff,
    deployerOnSepolia.address,
    sepoliaExplorer,
    configurationTransactions,
  );

  const amount = tariff * duration;
  const existingSourceTransaction =
    process.env.DEMO_SOURCE_TRANSACTION_HASH?.trim();
  let sourceTransactionHash: string;
  if (existingSourceTransaction) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(existingSourceTransaction))
      throw new Error(
        'DEMO_SOURCE_TRANSACTION_HASH must be a transaction hash.',
      );
    sourceTransactionHash = existingSourceTransaction;
  } else {
    const balance = (await paymentToken.getFunction('balanceOf')(
      deployerOnSepolia.address,
    )) as bigint;
    if (balance < amount) {
      if (!sepoliaDeployment.paymentToken.deployedByScript)
        throw new Error(
          `Payment token balance is ${balance}; ${amount} is required and the configured token is not the demo MockUSDC.`,
        );
      await recordTransaction(
        'mint demo payment tokens',
        await paymentToken.getFunction('mint')(
          deployerOnSepolia.address,
          amount - balance,
        ),
        sepoliaExplorer,
        configurationTransactions,
      );
    }
    const allowance = (await paymentToken.getFunction('allowance')(
      deployerOnSepolia.address,
      sepoliaDeployment.usagePaymentRegistry.address,
    )) as bigint;
    if (allowance < amount) {
      await recordTransaction(
        'approve usage payment',
        await paymentToken.getFunction('approve')(
          sepoliaDeployment.usagePaymentRegistry.address,
          amount,
        ),
        sepoliaExplorer,
        configurationTransactions,
      );
    }
    const paymentNonce = hexlify(randomBytes(32));
    const paymentTransaction = await paymentRegistry.getFunction('payForUsage')(
      machineId,
      duration,
      paymentNonce,
    );
    const paymentReceipt = await requiredReceipt(paymentTransaction);
    sourceTransactionHash = paymentReceipt.hash;
    report('payment_confirmed', 'Sepolia usage payment confirmed.', {
      transactionHash: sourceTransactionHash,
      blockNumber: paymentReceipt.blockNumber,
    });
  }

  const relayConfig: WorkerConfig = {
    sepoliaRpcUrl: required('ETHEREUM_SEPOLIA_RPC_URL'),
    creditcoinRpcUrl: required('CREDITCOIN_TESTNET_RPC_URL'),
    proofBuilderUrl:
      process.env.CREDITCOIN_PROOF_BUILDER_URL ??
      'https://prover.cc3-testnet.creditcoin.network',
    sourceChainKey: 1,
    sourceRegistryAddress: sepoliaDeployment.usagePaymentRegistry.address,
    proofKeyAscAddress: creditcoinDeployment.proofKeyASC.address,
    workerPrivateKey,
    sourceConfirmations: positiveNumber('SOURCE_CONFIRMATIONS', 1),
    sourceTimeoutMs: positiveNumber('SOURCE_CONFIRMATION_TIMEOUT_MS', 180_000),
    attestationPollMs: positiveNumber('ATTESTATION_POLL_INTERVAL_MS', 15_000),
    attestationTimeoutMs: positiveNumber('ATTESTATION_TIMEOUT_MS', 1_200_000),
    retryAttempts: positiveNumber('RELAY_RETRY_ATTEMPTS', 3),
    retryBaseDelayMs: positiveNumber('RELAY_RETRY_BASE_DELAY_MS', 2_000),
    stateFile: '',
    serverPort: 8787,
    serverHost: '127.0.0.1',
    frontendOrigin: 'http://localhost:5173',
  };
  const adapter = new NetworkRelayAdapter(relayConfig);
  await adapter.assertNetworks();
  const source = await adapter.confirmSourceTransaction(sourceTransactionHash);
  if (source.payment.machineId.toLowerCase() !== machineId.toLowerCase())
    throw new Error('Recorded payment is for a different demo machine.');
  report(
    'attestation_wait',
    'Waiting for Attestcoin to cover the Sepolia block.',
    {
      transactionHash: sourceTransactionHash,
      blockNumber: source.blockNumber,
      orderId: source.payment.orderId,
    },
  );
  await withRetry(() => adapter.waitUntilAttested(source.blockNumber), {
    maxAttempts: relayConfig.retryAttempts,
    baseDelayMs: relayConfig.retryBaseDelayMs,
    onAttempt: (attempt) =>
      report('attestation_attempt', 'Checking Attestcoin coverage.', {
        attempt,
      }),
  });
  report('proof_generation', 'Block attested; requesting proof material.');
  const proof = await adapter.generateProof(sourceTransactionHash);
  if (proof.chainKey !== 1 || proof.blockHeight !== source.blockNumber)
    throw new Error('Attestcoin proof does not match the source receipt.');
  report(
    'creditcoin_execution',
    'Proof generated; submitting ProofKeyASC.execute.',
  );
  const creditcoinTransactionHash = await adapter.submitProof(proof);
  const creditcoinReceipt = await creditcoinProvider.getTransactionReceipt(
    creditcoinTransactionHash,
  );
  if (!creditcoinReceipt || creditcoinReceipt.status !== 1)
    throw new Error('Creditcoin execution receipt is unavailable or reverted.');

  const credential = await accessPass.getFunction('accessCredentials')(
    machineId,
    source.payment.payer,
  );
  const authorized = (await accessPass.getFunction('isAuthorized')(
    machineId,
    source.payment.payer,
  )) as boolean;
  if (!authorized || credential.authorizationId !== source.payment.orderId)
    throw new Error(
      'Creditcoin access credential was not activated as expected.',
    );

  const sourceReceipt = await sepoliaProvider.getTransactionReceipt(
    sourceTransactionHash,
  );
  if (!sourceReceipt) throw new Error('Sepolia payment receipt disappeared.');
  const recordedAt = new Date().toISOString();
  const provenance = {
    kind: 'recorded-live',
    fresh: false,
    note: 'Historical proof captured from a successful live testnet run; replaying this file does not generate a fresh attestation.',
  } as const;
  const fixture = {
    provenance,
    recordedAt,
    source: {
      network: 'ethereum-sepolia',
      chainId: Number(SEPOLIA_CHAIN_ID),
      chainKey: proof.chainKey,
      transactionHash: sourceTransactionHash,
      blockHash: sourceReceipt.blockHash,
      blockNumber: source.blockNumber,
    },
    proof,
  };
  const evidence = {
    provenance,
    recordedAt,
    demo: {
      machineLabel: MACHINE_LABEL,
      machineId,
      metadataUri: METADATA_URI,
      metadataHash,
      tariff: tariff.toString(),
      durationSeconds: duration.toString(),
      payer: source.payment.payer,
      machineOwner: deployerOnCreditcoin.address,
      relayWorker: workerAddress,
    },
    deployments: {
      sepolia: sepoliaDeployment,
      creditcoin: creditcoinDeployment,
    },
    configurationTransactions,
    payment: {
      ...source.payment,
      transactionHash: sourceTransactionHash,
      blockHash: sourceReceipt.blockHash,
      blockNumber: source.blockNumber,
      explorerUrl: `${sepoliaExplorer}/tx/${sourceTransactionHash}`,
    },
    attestation: {
      proofBuilder: 'Attestcoin Proof Builder',
      chainKey: proof.chainKey,
      provenBlockHeight: proof.blockHeight,
      merkleRoot: proof.merkleRoot,
    },
    authorization: {
      transactionHash: creditcoinTransactionHash,
      blockHash: creditcoinReceipt.blockHash,
      blockNumber: creditcoinReceipt.blockNumber,
      explorerUrl: `${creditcoinExplorer}/tx/${creditcoinTransactionHash}`,
      authorizationId: credential.authorizationId as string,
      expiresAt: (credential.expiresAt as bigint).toString(),
      authorizedAtRecording: authorized,
    },
  };
  await writePublicEvidence(
    resolve(root, 'packages/contracts/fixtures/recorded-live-proof.json'),
    fixture,
  );
  await writePublicEvidence(
    resolve(root, 'packages/contracts/deployments/live-mvp.json'),
    evidence,
  );
  report('completed', 'Live cross-chain access authorization verified.', {
    sourceTransactionHash,
    creditcoinTransactionHash,
    orderId: source.payment.orderId,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function configureMachine(
  registry: Contract,
  machineId: string,
  owner: string,
  metadataHash: string,
  tariff: bigint,
  explorer: string,
  records: Array<{
    purpose: string;
    transactionHash: string;
    blockNumber: number;
    explorerUrl: string;
  }>,
): Promise<void> {
  const machine = await registry.getFunction('machines')(machineId);
  if (machine.owner === '0x0000000000000000000000000000000000000000') {
    await recordTransaction(
      'register demo machine',
      await registry.getFunction('registerMachine')(
        machineId,
        owner,
        metadataHash,
        tariff,
        true,
      ),
      explorer,
      records,
    );
    return;
  }
  if (getAddress(machine.owner) !== getAddress(owner))
    throw new Error(`Demo machine belongs to ${machine.owner}, not ${owner}.`);
  if (getAddress(machine.controller) !== getAddress(owner))
    await recordTransaction(
      'update demo machine controller',
      await registry.getFunction('updateController')(machineId, owner),
      explorer,
      records,
    );
  if (
    (machine.metadataHash as string).toLowerCase() !==
    metadataHash.toLowerCase()
  )
    await recordTransaction(
      'update demo machine metadata',
      await registry.getFunction('updateMetadataHash')(machineId, metadataHash),
      explorer,
      records,
    );
  if ((machine.tariff as bigint) !== tariff)
    await recordTransaction(
      'update demo machine tariff',
      await registry.getFunction('updateTariff')(machineId, tariff),
      explorer,
      records,
    );
  if (!(machine.active as boolean))
    await recordTransaction(
      'activate demo machine',
      await registry.getFunction('setMachineActive')(machineId, true),
      explorer,
      records,
    );
}

async function configureOffer(
  registry: Contract,
  machineId: string,
  beneficiary: string,
  tariff: bigint,
  expectedOwner: string,
  explorer: string,
  records: Array<{
    purpose: string;
    transactionHash: string;
    blockNumber: number;
    explorerUrl: string;
  }>,
): Promise<void> {
  const owner = getAddress((await registry.getFunction('owner')()) as string);
  if (owner !== getAddress(expectedOwner))
    throw new Error(
      `Payment registry owner is ${owner}, not ${expectedOwner}.`,
    );
  const offer = await registry.getFunction('machineOffers')(machineId);
  if (
    getAddress(offer.beneficiary) !== getAddress(beneficiary) ||
    (offer.pricePerSecond as bigint) !== tariff ||
    !(offer.active as boolean)
  ) {
    await recordTransaction(
      'configure Sepolia machine offer',
      await registry.getFunction('setMachineOffer')(
        machineId,
        beneficiary,
        tariff,
        true,
      ),
      explorer,
      records,
    );
  }
}

async function recordTransaction(
  purpose: string,
  transaction: { wait(): Promise<TransactionReceipt | null> },
  explorer: string,
  records: Array<{
    purpose: string;
    transactionHash: string;
    blockNumber: number;
    explorerUrl: string;
  }>,
): Promise<void> {
  const receipt = await requiredReceipt(transaction);
  records.push({
    purpose,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    explorerUrl: `${explorer}/tx/${receipt.hash}`,
  });
  report('configuration_transaction', purpose, {
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
  });
}

async function requiredReceipt(transaction: {
  wait(): Promise<TransactionReceipt | null>;
}): Promise<TransactionReceipt> {
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1)
    throw new Error('A live MVP transaction reverted or returned no receipt.');
  return receipt;
}

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    throw new Error(`Cannot read deployment manifest ${path}. Deploy first.`, {
      cause: error,
    });
  }
}

function validateManifests(
  sepolia: SepoliaDeployment,
  creditcoin: CreditcoinDeployment,
): void {
  if (sepolia.chainId !== Number(SEPOLIA_CHAIN_ID))
    throw new Error('sepolia.json has the wrong chain ID.');
  if (creditcoin.chainId !== Number(CREDITCOIN_CHAIN_ID))
    throw new Error('cc3-testnet.json has the wrong chain ID.');
  if (creditcoin.source.chainKey !== 1)
    throw new Error('cc3-testnet.json has the wrong Attestcoin chain key.');
  if (
    getAddress(creditcoin.source.usagePaymentRegistry) !==
    getAddress(sepolia.usagePaymentRegistry.address)
  )
    throw new Error(
      'Creditcoin deployment points at a different source registry.',
    );
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in the root .env.`);
  return value;
}

function privateKey(name: string): string {
  const configured = required(name);
  const value = configured.startsWith('0x') ? configured : `0x${configured}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${name} must be a 32-byte hexadecimal private key.`);
  return value;
}

function positiveNumber(name: string, fallback: number): number {
  const value = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}

function positiveBigInt(name: string, fallback: bigint): bigint {
  const value = process.env[name]?.trim()
    ? BigInt(process.env[name]!.trim())
    : fallback;
  if (value <= 0n) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function report(
  phase: string,
  message: string,
  details: Record<string, string | number> = {},
): void {
  process.stdout.write(
    `${JSON.stringify({ phase, message, timestamp: new Date().toISOString(), ...details })}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ phase: 'failed', message })}\n`);
  process.exitCode = 1;
});
