import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { artifacts } from 'hardhat';
import { ContractFactory, JsonRpcProvider, Wallet, getAddress } from 'ethers';

const SEPOLIA_CHAIN_ID = 11_155_111n;
const DEFAULT_EXPLORER_URL = 'https://sepolia.etherscan.io';

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

  const rpcUrl = requiredEnvironmentVariable('ETHEREUM_SEPOLIA_RPC_URL');
  const configuredPrivateKey = requiredEnvironmentVariable(
    'DEPLOYER_PRIVATE_KEY',
  );
  const privateKey = configuredPrivateKey.startsWith('0x')
    ? configuredPrivateKey
    : `0x${configuredPrivateKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('DEPLOYER_PRIVATE_KEY must be a 32-byte hexadecimal value');
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Expected Sepolia chain ${SEPOLIA_CHAIN_ID}, received ${network.chainId}`,
    );
  }

  const deployer = new Wallet(privateKey, provider);
  const configuredPaymentToken = process.env.PAYMENT_TOKEN_ADDRESS?.trim();
  let paymentTokenAddress: string;
  let mockTokenDeployment:
    | { transactionHash: string; blockHash: string; blockNumber: number }
    | undefined;

  if (configuredPaymentToken) {
    paymentTokenAddress = getAddress(configuredPaymentToken);
    if ((await provider.getCode(paymentTokenAddress)) === '0x') {
      throw new Error(
        `PAYMENT_TOKEN_ADDRESS has no code: ${paymentTokenAddress}`,
      );
    }
  } else {
    const mockTokenArtifact = await artifacts.readArtifact('MockUSDC');
    const mockTokenFactory = new ContractFactory(
      mockTokenArtifact.abi,
      mockTokenArtifact.bytecode,
      deployer,
    );
    const mockToken = await mockTokenFactory.deploy();
    const mockReceipt = await mockToken.deploymentTransaction()?.wait();
    if (!mockReceipt)
      throw new Error('MockUSDC deployment receipt was not available');

    paymentTokenAddress = await mockToken.getAddress();
    mockTokenDeployment = {
      transactionHash: mockReceipt.hash,
      blockHash: mockReceipt.blockHash,
      blockNumber: mockReceipt.blockNumber,
    };
  }

  const registryArtifact = await artifacts.readArtifact('UsagePaymentRegistry');
  const registryFactory = new ContractFactory(
    registryArtifact.abi,
    registryArtifact.bytecode,
    deployer,
  );
  const registry = await registryFactory.deploy(paymentTokenAddress);
  const registryReceipt = await registry.deploymentTransaction()?.wait();
  if (!registryReceipt)
    throw new Error(
      'UsagePaymentRegistry deployment receipt was not available',
    );

  const registryAddress = await registry.getAddress();
  const explorerBaseUrl = (
    process.env.ETHEREUM_SEPOLIA_EXPLORER_URL ?? DEFAULT_EXPLORER_URL
  ).replace(/\/$/, '');
  const deployment = {
    network: 'ethereum-sepolia',
    chainId: Number(SEPOLIA_CHAIN_ID),
    deployer: deployer.address,
    paymentToken: {
      address: paymentTokenAddress,
      deployedByScript: mockTokenDeployment !== undefined,
      ...mockTokenDeployment,
    },
    usagePaymentRegistry: {
      address: registryAddress,
      transactionHash: registryReceipt.hash,
      blockHash: registryReceipt.blockHash,
      blockNumber: registryReceipt.blockNumber,
      explorerUrl: `${explorerBaseUrl}/address/${registryAddress}`,
    },
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDirectory = resolve(import.meta.dirname, '../deployments');
  const outputPath = resolve(deploymentsDirectory, 'sepolia.json');
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
