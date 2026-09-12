import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const verifierUrl =
  'https://proxy-verifier.services.blockscout.com/api/v1/solidity/sources:verify-standard-json';

const deployments = [
  {
    name: 'MockUSDC',
    source: 'contracts/mocks/MockUSDC.sol',
    chainId: '11155111',
    address: '0x43f2a86F5652957Aa5615413D406e037162a8247',
    explorer: 'https://eth-sepolia.blockscout.com',
  },
  {
    name: 'UsagePaymentRegistry',
    source: 'contracts/UsagePaymentRegistry.sol',
    chainId: '11155111',
    address: '0xa2D8dECC5665Fc3B969A58dBCe7Ff05E074127AA',
    explorer: 'https://eth-sepolia.blockscout.com',
  },
  {
    name: 'MachineRegistry',
    source: 'contracts/MachineRegistry.sol',
    chainId: '102031',
    address: '0x43f2a86F5652957Aa5615413D406e037162a8247',
    explorer: 'https://creditcoin-testnet.blockscout.com',
  },
  {
    name: 'AccessPass',
    source: 'contracts/AccessPass.sol',
    chainId: '102031',
    address: '0xa2D8dECC5665Fc3B969A58dBCe7Ff05E074127AA',
    explorer: 'https://creditcoin-testnet.blockscout.com',
  },
  {
    name: 'ProofKeyASC',
    source: 'contracts/ProofKeyASC.sol',
    chainId: '102031',
    address: '0x79fA79C1fdc7eFaA75Bc039CdbdFc1ce109775e7',
    explorer: 'https://creditcoin-testnet.blockscout.com',
  },
];

const buildInfoDirectory = path.resolve(
  'packages/contracts/artifacts/build-info',
);

async function loadBuildInfo() {
  const filenames = (await readdir(buildInfoDirectory)).filter(
    (filename) =>
      filename.endsWith('.json') && !filename.endsWith('.output.json'),
  );

  return Promise.all(
    filenames.map(async (filename) => {
      const contents = await readFile(
        path.join(buildInfoDirectory, filename),
        'utf8',
      );
      return { filename, value: JSON.parse(contents) };
    }),
  );
}

function buildInfoFor(deployment, buildInfo) {
  const containsSource = ({ value }) =>
    Object.keys(value.input?.sources ?? {}).some((source) =>
      source.replaceAll('\\', '/').endsWith(deployment.source),
    );
  const candidates = buildInfo.filter(containsSource);
  if (candidates.length === 0) {
    throw new Error(
      `No Hardhat build input contains ${deployment.source}. Run the contract build first.`,
    );
  }

  return candidates[0];
}

async function submitToVerifierAlliance(deployment, build, compiler) {
  const response = await fetch(verifierUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contracts: [{ chainId: deployment.chainId, address: deployment.address }],
      compiler,
      input: JSON.stringify(build.value.input),
    }),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `${deployment.name}: verifier returned ${response.status}: ${body}`,
    );
  }

  return body ? JSON.parse(body) : { status: 'submitted' };
}

async function submitDirectly(deployment, build, compiler) {
  const form = new FormData();
  form.set('compiler_version', compiler);
  form.set('contract_name', `${deployment.source}:${deployment.name}`);
  form.set(
    'files[0]',
    new Blob([JSON.stringify(build.value.input)], { type: 'application/json' }),
    'standard-input.json',
  );
  form.set('autodetect_constructor_args', 'true');
  form.set('license_type', 'mit');

  const response = await fetch(
    `${deployment.explorer}/api/v2/smart-contracts/${deployment.address}/verification/via/standard-input`,
    { method: 'POST', body: form },
  );
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `${deployment.name}: explorer returned ${response.status}: ${body}`,
    );
  }

  return body ? JSON.parse(body) : { status: 'submitted-directly' };
}

async function submit(deployment, build) {
  const compiler = `v${build.value.solcLongVersion ?? '0.8.28+commit.7893614a'}`;
  const allianceResult = await submitToVerifierAlliance(
    deployment,
    build,
    compiler,
  );
  const allianceStatus =
    allianceResult.contractVerificationResults?.items?.[0]?.status;
  if (
    allianceStatus === 'FULLY_VERIFIED' ||
    allianceStatus === 'PARTIALLY_VERIFIED'
  ) {
    return allianceResult;
  }

  return submitDirectly(deployment, build, compiler);
}

async function explorerStatus(deployment) {
  const response = await fetch(
    `${deployment.explorer}/api/v2/smart-contracts/${deployment.address}`,
  );
  if (!response.ok) return { is_verified: false, status: response.status };
  return response.json();
}

const shouldSubmit = process.argv.includes('--submit');
const buildInfo = await loadBuildInfo();

for (const deployment of deployments) {
  const before = await explorerStatus(deployment);
  if (before.is_verified) {
    const match = before.is_fully_verified ? 'fully verified' : 'verified';
    console.log(
      `${deployment.name}: ${match} at ${deployment.explorer}/address/${deployment.address}`,
    );
    continue;
  }

  if (!shouldSubmit) {
    console.log(`${deployment.name}: not yet verified (run with --submit)`);
    continue;
  }

  const build = buildInfoFor(deployment, buildInfo);
  const result = await submit(deployment, build);
  console.log(`${deployment.name}: ${JSON.stringify(result)}`);
}
