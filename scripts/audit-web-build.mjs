import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const output = join(root, 'apps', 'web', 'dist');
const indexPath = join(output, 'index.html');
const failures = [];
if (!existsSync(indexPath))
  failures.push('apps/web/dist/index.html is missing.');

const files = existsSync(output) ? walk(output) : [];
const textFiles = files.filter((file) =>
  ['.html', '.js', '.css', '.json', '.map'].includes(extname(file)),
);
if (files.some((file) => extname(file) === '.map'))
  failures.push('Production source maps must not be published.');

const combined = textFiles
  .filter((file) => extname(file) !== '.map')
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
const forbidden = [
  {
    pattern:
      /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(?:4173|4174|4175|5173|8787)/i,
    label: 'ProofKey localhost URL',
  },
  {
    pattern: /VITE_DEVICE_SIMULATOR_URL/i,
    label: 'retired device simulator configuration',
  },
  {
    pattern: /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
    label: 'GitHub credential',
  },
  { pattern: /sk_live_[A-Za-z0-9]{16,}/, label: 'live payment secret' },
  { pattern: /VERCEL_TOKEN\s*[:=]\s*["'][^"']+/i, label: 'Vercel token' },
  {
    pattern: /PRIVATE_KEY\s*[:=]\s*["']0x[0-9a-fA-F]{64}/i,
    label: 'private key',
  },
];
for (const check of forbidden)
  if (check.pattern.test(combined))
    failures.push(`Client bundle contains a forbidden ${check.label}.`);

for (const name of [
  'VITE_ETHEREUM_SEPOLIA_RPC_URL',
  'VITE_CREDITCOIN_RPC_URL',
  'VITE_PROOF_WORKER_URL',
  'VITE_USAGE_PAYMENT_REGISTRY_ADDRESS',
  'VITE_MACHINE_REGISTRY_ADDRESS',
  'VITE_ACCESS_PASS_ADDRESS',
  'VITE_PROOFKEY_ASC_ADDRESS',
  'VITE_DEMO_MACHINE_ID',
]) {
  const value = process.env[name];
  if (!value || !combined.toLowerCase().includes(value.toLowerCase()))
    failures.push(`${name} was not emitted into the production bundle.`);
}

if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8');
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value) => value?.startsWith('/assets/'));
  for (const asset of assets) {
    const path = join(output, asset.slice(1));
    if (!existsSync(path))
      failures.push(`Referenced asset is missing: ${asset}`);
  }
}

const budgets = { '.js': 380 * 1024, '.css': 20 * 1024 };
for (const file of files) {
  const extension = extname(file);
  const budget = budgets[extension];
  if (!budget) continue;
  const compressed = gzipSync(readFileSync(file)).byteLength;
  if (compressed > budget)
    failures.push(
      `${relative(output, file)} is ${Math.ceil(compressed / 1024)} KiB gzip; budget is ${budget / 1024} KiB.`,
    );
}

if (failures.length) {
  console.error(`Production bundle audit failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `Production bundle audit passed (${files.length} files, no secrets, localhost references, missing assets, or budget violations).`,
);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
