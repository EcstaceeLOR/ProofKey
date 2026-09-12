import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Contract, JsonRpcProvider, getAddress } from 'ethers';

import { assertPublicEvidence } from './evidence.js';

interface LiveEvidence {
  provenance: { kind: string; fresh: boolean };
  demo: { machineId: string; payer: string };
  deployments: {
    sepolia: {
      chainId: number;
      paymentToken: { address: string };
      usagePaymentRegistry: { address: string };
    };
    creditcoin: {
      chainId: number;
      machineRegistry: { address: string };
      accessPass: { address: string };
      proofKeyASC: { address: string };
    };
  };
  payment: {
    orderId: string;
    transactionHash: string;
    blockNumber: number;
  };
  authorization: {
    transactionHash: string;
    blockNumber: number;
    authorizationId: string;
    expiresAt: string;
  };
}

interface RecordedProof {
  provenance: { kind: string; fresh: boolean };
  source: { transactionHash: string; blockNumber: number; chainKey: number };
  proof: { chainKey: number; blockHeight: number };
}

const proofKeyAbi = [
  'function processedOrders(bytes32 orderId) view returns (bool)',
] as const;
const accessPassAbi = [
  'function accessCredentials(bytes32,address) view returns (bytes32 authorizationId,uint64 expiresAt)',
  'function isAuthorized(bytes32,address) view returns (bool)',
] as const;

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '../../..');
  const environmentPath = resolve(root, '.env');
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);
  const evidence = await readJson<LiveEvidence>(
    resolve(root, 'packages/contracts/deployments/live-mvp.json'),
  );
  const fixture = await readJson<RecordedProof>(
    resolve(root, 'packages/contracts/fixtures/recorded-live-proof.json'),
  );
  assertPublicEvidence(evidence);
  assertPublicEvidence(fixture);
  if (evidence.provenance.kind !== 'recorded-live' || evidence.provenance.fresh)
    throw new Error('Live evidence has invalid provenance labeling.');
  if (fixture.provenance.kind !== 'recorded-live' || fixture.provenance.fresh)
    throw new Error('Proof fixture has invalid provenance labeling.');

  const sepolia = new JsonRpcProvider(required('ETHEREUM_SEPOLIA_RPC_URL'));
  const creditcoin = new JsonRpcProvider(
    required('CREDITCOIN_TESTNET_RPC_URL'),
  );
  const [sourceNetwork, destinationNetwork] = await Promise.all([
    sepolia.getNetwork(),
    creditcoin.getNetwork(),
  ]);
  if (
    sourceNetwork.chainId !== BigInt(evidence.deployments.sepolia.chainId) ||
    sourceNetwork.chainId !== 11_155_111n
  )
    throw new Error(
      'Sepolia evidence chain does not match the configured RPC.',
    );
  if (
    destinationNetwork.chainId !==
      BigInt(evidence.deployments.creditcoin.chainId) ||
    destinationNetwork.chainId !== 102_031n
  )
    throw new Error(
      'Creditcoin evidence chain does not match the configured RPC.',
    );

  const sourceAddresses = [
    evidence.deployments.sepolia.paymentToken.address,
    evidence.deployments.sepolia.usagePaymentRegistry.address,
  ];
  const destinationAddresses = [
    evidence.deployments.creditcoin.machineRegistry.address,
    evidence.deployments.creditcoin.accessPass.address,
    evidence.deployments.creditcoin.proofKeyASC.address,
  ];
  const sourceCode = await Promise.all(
    sourceAddresses.map((address) => sepolia.getCode(getAddress(address))),
  );
  const destinationCode = await Promise.all(
    destinationAddresses.map((address) =>
      creditcoin.getCode(getAddress(address)),
    ),
  );
  if ([...sourceCode, ...destinationCode].some((code) => code === '0x'))
    throw new Error('At least one recorded deployment address has no code.');

  const [paymentReceipt, authorizationReceipt] = await Promise.all([
    sepolia.getTransactionReceipt(evidence.payment.transactionHash),
    creditcoin.getTransactionReceipt(evidence.authorization.transactionHash),
  ]);
  if (
    !paymentReceipt ||
    paymentReceipt.status !== 1 ||
    paymentReceipt.blockNumber !== evidence.payment.blockNumber
  )
    throw new Error('Recorded Sepolia payment receipt did not verify.');
  if (
    !authorizationReceipt ||
    authorizationReceipt.status !== 1 ||
    authorizationReceipt.blockNumber !== evidence.authorization.blockNumber
  )
    throw new Error(
      'Recorded Creditcoin authorization receipt did not verify.',
    );

  if (
    fixture.source.transactionHash.toLowerCase() !==
      evidence.payment.transactionHash.toLowerCase() ||
    fixture.source.blockNumber !== evidence.payment.blockNumber ||
    fixture.source.chainKey !== 1 ||
    fixture.proof.chainKey !== 1 ||
    fixture.proof.blockHeight !== evidence.payment.blockNumber
  )
    throw new Error('Recorded proof fixture does not match the live evidence.');

  const proofKey = new Contract(
    evidence.deployments.creditcoin.proofKeyASC.address,
    proofKeyAbi,
    creditcoin,
  );
  const accessPass = new Contract(
    evidence.deployments.creditcoin.accessPass.address,
    accessPassAbi,
    creditcoin,
  );
  const [processed, credential, activeNow] = await Promise.all([
    proofKey.getFunction('processedOrders')(evidence.payment.orderId),
    accessPass.getFunction('accessCredentials')(
      evidence.demo.machineId,
      evidence.demo.payer,
    ),
    accessPass.getFunction('isAuthorized')(
      evidence.demo.machineId,
      evidence.demo.payer,
    ),
  ]);
  if (!processed)
    throw new Error('Recorded order is not processed on Creditcoin.');
  if (
    (credential.authorizationId as string).toLowerCase() !==
      evidence.payment.orderId.toLowerCase() ||
    evidence.authorization.authorizationId.toLowerCase() !==
      evidence.payment.orderId.toLowerCase() ||
    (credential.expiresAt as bigint).toString() !==
      evidence.authorization.expiresAt
  )
    throw new Error(
      'Recorded AccessPass credential does not match the payment.',
    );

  process.stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        provenance: evidence.provenance,
        sourceTransactionHash: evidence.payment.transactionHash,
        creditcoinTransactionHash: evidence.authorization.transactionHash,
        orderId: evidence.payment.orderId,
        activeNow: activeNow as boolean,
        expiresAt: evidence.authorization.expiresAt,
      },
      null,
      2,
    )}\n`,
  );
}

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    throw new Error(`Cannot read recorded live evidence ${path}.`, {
      cause: error,
    });
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in the root .env.`);
  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ verified: false, message })}\n`);
  process.exitCode = 1;
});
