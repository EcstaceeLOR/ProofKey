import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
  toUtf8Bytes,
  type ContractTransactionResponse,
} from 'ethers';

const SEPOLIA_CHAIN_ID = 11_155_111n;
const CREDITCOIN_CHAIN_ID = 102_031n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface CatalogMachine {
  label: string;
  tariff: string;
  uri: string;
  name: string;
  operator: { wallet: string };
}

interface DeploymentRecord {
  address: string;
  blockNumber: number;
}

interface SepoliaDeployment {
  chainId: number;
  usagePaymentRegistry: DeploymentRecord;
}

interface CreditcoinDeployment {
  chainId: number;
  machineRegistry: DeploymentRecord;
}

const machineRegistryAbi = [
  'function machines(bytes32) view returns (address owner,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
  'function registerMachine(bytes32,address,bytes32,uint128,bool)',
  'function updateController(bytes32,address)',
  'function updateMetadataHash(bytes32,bytes32)',
  'function updateTariff(bytes32,uint128)',
  'function setMachineActive(bytes32,bool)',
] as const;
const paymentRegistryAbi = [
  'function owner() view returns (address)',
  'function machineOffers(bytes32) view returns (address beneficiary,uint128 pricePerSecond,bool active)',
  'function setMachineOffer(bytes32,address,uint128,bool)',
] as const;

async function main() {
  const root = resolve(import.meta.dirname, '../../..');
  const output = resolve(
    root,
    'packages/contracts/deployments/machine-catalog-live.json',
  );
  const environmentPath = resolve(root, '.env');
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

  const [catalog, sepoliaDeployment, creditcoinDeployment] = await Promise.all([
    readJson<CatalogMachine[]>(
      resolve(root, 'apps/web/src/machine-catalog.json'),
    ),
    readJson<SepoliaDeployment>(
      resolve(root, 'packages/contracts/deployments/sepolia.json'),
    ),
    readJson<CreditcoinDeployment>(
      resolve(root, 'packages/contracts/deployments/cc3-testnet.json'),
    ),
  ]);
  assertCatalog(catalog);
  const previous = existsSync(output)
    ? await readJson<{
        machines?: Array<{
          machineId: string;
          updates?: Array<Record<string, unknown>>;
        }>;
      }>(output)
    : undefined;
  if (BigInt(sepoliaDeployment.chainId) !== SEPOLIA_CHAIN_ID)
    throw new Error('Sepolia deployment manifest has the wrong chain ID.');
  if (BigInt(creditcoinDeployment.chainId) !== CREDITCOIN_CHAIN_ID)
    throw new Error('Creditcoin deployment manifest has the wrong chain ID.');

  const privateKey = requiredPrivateKey('DEPLOYER_PRIVATE_KEY');
  const sepoliaProvider = new JsonRpcProvider(
    required('ETHEREUM_SEPOLIA_RPC_URL'),
    Number(SEPOLIA_CHAIN_ID),
    { staticNetwork: true },
  );
  const creditcoinProvider = new JsonRpcProvider(
    required('CREDITCOIN_TESTNET_RPC_URL'),
    Number(CREDITCOIN_CHAIN_ID),
    { staticNetwork: true },
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

  const sepoliaWallet = new Wallet(privateKey, sepoliaProvider);
  const creditcoinWallet = new Wallet(privateKey, creditcoinProvider);
  const owner = getAddress(sepoliaWallet.address);
  if (owner !== getAddress(creditcoinWallet.address))
    throw new Error('The configured deployer must control both networks.');
  const paymentRegistry = new Contract(
    sepoliaDeployment.usagePaymentRegistry.address,
    paymentRegistryAbi,
    sepoliaWallet,
  );
  const machineRegistry = new Contract(
    creditcoinDeployment.machineRegistry.address,
    machineRegistryAbi,
    creditcoinWallet,
  );
  if (
    getAddress((await paymentRegistry.getFunction('owner')()) as string) !==
    owner
  )
    throw new Error('DEPLOYER_PRIVATE_KEY is not the Sepolia registry owner.');

  const records = [];
  for (const machine of catalog) {
    if (getAddress(machine.operator.wallet) !== owner)
      throw new Error(`${machine.label} operator does not match the deployer.`);
    const machineId = keccak256(toUtf8Bytes(machine.label));
    const metadataHash = keccak256(toUtf8Bytes(machine.uri));
    const tariff = BigInt(machine.tariff);
    const updates: Array<Record<string, unknown>> = [];
    const current = await machineRegistry.getFunction('machines')(machineId);
    if (getAddress(current.owner as string) === ZERO_ADDRESS) {
      updates.push(
        await submit(
          'creditcoin:register',
          machine.label,
          machineRegistry.getFunction('registerMachine')(
            machineId,
            owner,
            metadataHash,
            tariff,
            true,
          ),
        ),
      );
    } else {
      if (getAddress(current.owner as string) !== owner)
        throw new Error(`${machine.label} is owned by another account.`);
      if (getAddress(current.controller as string) !== owner)
        updates.push(
          await submit(
            'creditcoin:controller',
            machine.label,
            machineRegistry.getFunction('updateController')(machineId, owner),
          ),
        );
      if ((current.metadataHash as string).toLowerCase() !== metadataHash)
        updates.push(
          await submit(
            'creditcoin:metadata',
            machine.label,
            machineRegistry.getFunction('updateMetadataHash')(
              machineId,
              metadataHash,
            ),
          ),
        );
      if ((current.tariff as bigint) !== tariff)
        updates.push(
          await submit(
            'creditcoin:tariff',
            machine.label,
            machineRegistry.getFunction('updateTariff')(machineId, tariff),
          ),
        );
      if (!(current.active as boolean))
        updates.push(
          await submit(
            'creditcoin:activate',
            machine.label,
            machineRegistry.getFunction('setMachineActive')(machineId, true),
          ),
        );
    }

    const offer = await paymentRegistry.getFunction('machineOffers')(machineId);
    if (
      getAddress(offer.beneficiary as string) !== owner ||
      (offer.pricePerSecond as bigint) !== tariff ||
      !(offer.active as boolean)
    )
      updates.push(
        await submit(
          'sepolia:offer',
          machine.label,
          paymentRegistry.getFunction('setMachineOffer')(
            machineId,
            owner,
            tariff,
            true,
          ),
        ),
      );

    const [verifiedMachine, verifiedOffer] = await Promise.all([
      machineRegistry.getFunction('machines')(machineId),
      paymentRegistry.getFunction('machineOffers')(machineId),
    ]);
    if (
      getAddress(verifiedMachine.owner as string) !== owner ||
      getAddress(verifiedMachine.controller as string) !== owner ||
      (verifiedMachine.metadataHash as string).toLowerCase() !== metadataHash ||
      (verifiedMachine.tariff as bigint) !== tariff ||
      !(verifiedMachine.active as boolean) ||
      getAddress(verifiedOffer.beneficiary as string) !== owner ||
      (verifiedOffer.pricePerSecond as bigint) !== tariff ||
      !(verifiedOffer.active as boolean)
    )
      throw new Error(`${machine.label} failed post-transaction verification.`);
    records.push({
      label: machine.label,
      name: machine.name,
      machineId,
      metadataUri: machine.uri,
      metadataHash,
      tariff: machine.tariff,
      owner,
      active: true,
      updates: [
        ...(previous?.machines?.find(
          ({ machineId: previousId }) =>
            previousId.toLowerCase() === machineId.toLowerCase(),
        )?.updates ?? []),
        ...updates,
      ],
    });
    console.log(
      `${machine.name}: synchronized${updates.length ? ` (${updates.length} update${updates.length === 1 ? '' : 's'})` : ' (no changes)'}`,
    );
  }

  await writeFile(
    output,
    `${JSON.stringify(
      {
        provenance: {
          kind: 'live-testnet-catalog',
          note: 'Public machine identity and synchronization evidence only; no secret material.',
        },
        verifiedAt: new Date().toISOString(),
        owner,
        networks: {
          creditcoin: Number(CREDITCOIN_CHAIN_ID),
          sepolia: Number(SEPOLIA_CHAIN_ID),
        },
        machines: records,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`Verified ${records.length} synchronized machine listings.`);
}

async function submit(
  action: string,
  label: string,
  pending: Promise<ContractTransactionResponse>,
) {
  const transaction = await pending;
  console.log(`${action} ${label}: ${transaction.hash}`);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1)
    throw new Error(`${action} failed for ${label}.`);
  return {
    action,
    transactionHash: transaction.hash,
    blockNumber: receipt.blockNumber,
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function assertCatalog(value: CatalogMachine[]) {
  if (!Array.isArray(value) || value.length < 5)
    throw new Error('Machine catalog must contain at least five entries.');
  const labels = new Set<string>();
  for (const machine of value) {
    if (
      !machine ||
      typeof machine.label !== 'string' ||
      typeof machine.name !== 'string' ||
      typeof machine.uri !== 'string' ||
      !machine.uri.startsWith('ipfs://proofkey/') ||
      !/^\d+$/.test(machine.tariff) ||
      BigInt(machine.tariff) <= 0n ||
      labels.has(machine.label)
    )
      throw new Error(
        'Machine catalog contains an invalid or duplicate entry.',
      );
    labels.add(machine.label);
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function requiredPrivateKey(name: string) {
  const configured = required(name);
  const value = configured.startsWith('0x') ? configured : `0x${configured}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${name} must be a 32-byte hexadecimal value.`);
  return value;
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Catalog seed failed.',
  );
  process.exitCode = 1;
});
