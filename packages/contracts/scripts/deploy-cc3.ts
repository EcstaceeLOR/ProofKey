import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { artifacts } from 'hardhat';
import {
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  getAddress,
} from 'ethers';

const CREDITCOIN_TESTNET_CHAIN_ID = 102_031n;
const DEFAULT_EXPLORER_URL = 'https://creditcoin-testnet.blockscout.com';

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required; copy the root .env.example to .env`);
  }
  return value;
}

async function main(): Promise<void> {
  const rootDirectory = resolve(import.meta.dirname, '../../..');
  const environmentPath = resolve(rootDirectory, '.env');
  if (existsSync(environmentPath)) {
    process.loadEnvFile(environmentPath);
  }

  const rpcUrl = requiredEnvironmentVariable('CREDITCOIN_TESTNET_RPC_URL');
  const privateKey = requiredEnvironmentVariable('DEPLOYER_PRIVATE_KEY');
  const sourcePaymentRegistry = getAddress(
    requiredEnvironmentVariable('SEPOLIA_USAGE_PAYMENT_REGISTRY_ADDRESS'),
  );
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY must be a 32-byte 0x-prefixed hex value',
    );
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== CREDITCOIN_TESTNET_CHAIN_ID) {
    throw new Error(
      `Expected Creditcoin testnet chain ${CREDITCOIN_TESTNET_CHAIN_ID}, received ${network.chainId}`,
    );
  }

  const deployer = new Wallet(privateKey, provider);
  const machineRegistryArtifact =
    await artifacts.readArtifact('MachineRegistry');
  const accessPassArtifact = await artifacts.readArtifact('AccessPass');
  const proofKeyArtifact = await artifacts.readArtifact('ProofKeyASC');

  const machineRegistry = await new ContractFactory(
    machineRegistryArtifact.abi,
    machineRegistryArtifact.bytecode,
    deployer,
  ).deploy();
  const machineRegistryReceipt = await machineRegistry
    .deploymentTransaction()
    ?.wait();
  if (!machineRegistryReceipt)
    throw new Error('MachineRegistry deployment receipt unavailable');
  const machineRegistryAddress = await machineRegistry.getAddress();

  const accessPass = await new ContractFactory(
    accessPassArtifact.abi,
    accessPassArtifact.bytecode,
    deployer,
  ).deploy(machineRegistryAddress, ZeroAddress);
  const accessPassReceipt = await accessPass.deploymentTransaction()?.wait();
  if (!accessPassReceipt)
    throw new Error('AccessPass deployment receipt unavailable');
  const accessPassAddress = await accessPass.getAddress();

  const proofKey = await new ContractFactory(
    proofKeyArtifact.abi,
    proofKeyArtifact.bytecode,
    deployer,
  ).deploy(sourcePaymentRegistry, machineRegistryAddress, accessPassAddress);
  const proofKeyReceipt = await proofKey.deploymentTransaction()?.wait();
  if (!proofKeyReceipt)
    throw new Error('ProofKeyASC deployment receipt unavailable');
  const proofKeyAddress = await proofKey.getAddress();

  const initializationTransaction = await accessPass.getFunction(
    'setAttestcoinAuthorizer',
  )(proofKeyAddress);
  const initializationReceipt = await initializationTransaction.wait();
  if (!initializationReceipt)
    throw new Error('AccessPass initialization receipt unavailable');

  const explorerBaseUrl = (
    process.env.CREDITCOIN_TESTNET_EXPLORER_URL ?? DEFAULT_EXPLORER_URL
  ).replace(/\/$/, '');
  const contractRecord = (
    address: string,
    receipt: { hash: string; blockHash: string; blockNumber: number },
  ) => ({
    address,
    transactionHash: receipt.hash,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    explorerUrl: `${explorerBaseUrl}/address/${address}`,
  });
  const deployment = {
    network: 'creditcoin-testnet-cc3',
    chainId: Number(CREDITCOIN_TESTNET_CHAIN_ID),
    deployer: deployer.address,
    source: {
      network: 'ethereum-sepolia',
      chainKey: 1,
      usagePaymentRegistry: sourcePaymentRegistry,
    },
    machineRegistry: contractRecord(
      machineRegistryAddress,
      machineRegistryReceipt,
    ),
    accessPass: contractRecord(accessPassAddress, accessPassReceipt),
    proofKeyASC: contractRecord(proofKeyAddress, proofKeyReceipt),
    authorizerInitialization: {
      transactionHash: initializationReceipt.hash,
      blockHash: initializationReceipt.blockHash,
      blockNumber: initializationReceipt.blockNumber,
    },
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDirectory = resolve(import.meta.dirname, '../deployments');
  const outputPath = resolve(deploymentsDirectory, 'cc3-testnet.json');
  await mkdir(deploymentsDirectory, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(deployment, null, 2)}\n`,
    'utf8',
  );

  console.log(JSON.stringify(deployment, null, 2));
  console.log(`Deployment record written to ${outputPath}`);
}

await main();
