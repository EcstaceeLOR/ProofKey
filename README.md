# ProofKey

ProofKey turns a proven Sepolia machine-usage payment into an access pass on Creditcoin using the Attestcoin Protocol.

This repository is an npm-workspaces monorepo containing the smart contracts, web application, and attestation worker.

## Prerequisites

- Node.js 24 or newer
- npm 11.17.0 (the version pinned in `packageManager`)

## Quick start

```bash
npm ci
cp .env.example .env
npm run check
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

`npm run check` runs the same lint, type-check, contract-test, and build gates used by CI. No funded wallet or RPC key is required for these local checks.

## Workspace layout

| Workspace            | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `packages/contracts` | Creditcoin EVM contracts and Hardhat tests       |
| `apps/worker`        | Attestcoin proof generation and Creditcoin relay |
| `apps/web`           | Operator and lender web application              |
| `apps/device`        | Fail-closed Creditcoin machine simulator         |

## Run the machine simulator

Set the public `VITE_*` device values in `.env`, then run:

```bash
npm run dev --workspace @proofkey/device
```

The standalone simulator can be displayed beside the customer UI. It polls `AccessPass.isAuthorized` and the associated credential directly on Creditcoin, visibly moves through locked, unlocking, unlocked, and expired states, and locks on RPC failure. See [`apps/device/README.md`](apps/device/README.md) for configuration details.

## Relay a payment proof

After deploying both contract stacks, set `SEPOLIA_USAGE_PAYMENT_REGISTRY_ADDRESS`, `PROOFKEY_ASC_ADDRESS`, and `WORKER_PRIVATE_KEY` in `.env`. The worker wallet only pays Creditcoin gas; it has no authority to grant access. Then relay one successful Sepolia `UsagePaid` transaction end to end:

```bash
npm run relay --workspace @proofkey/worker -- 0xYOUR_SEPOLIA_TRANSACTION_HASH
```

The command emits JSON-line status updates for `source_confirmation`, `attestation_wait`, `proof_generation`, and `creditcoin_execution`. It waits for Attestcoin to cover the source block, obtains Merkle and continuity proofs from the official Proof Builder, and calls `ProofKeyASC.execute`. Retries are bounded and failures name their phase. Re-running a completed transaction is harmless because both the local public job store and `ProofKeyASC` enforce idempotency.

Only public transaction, order, and status metadata is written to `apps/worker/data/jobs.json`. The worker private key is loaded from `.env` and is never persisted.

## Run the customer journey

With the root `.env` configured, start the worker API and customer app in separate terminals:

```bash
npm run serve --workspace @proofkey/worker
npm run dev --workspace @proofkey/web
```

The single-screen experience connects a wallet, handles Sepolia switching, settles the machine payment, submits the transaction to the proof relay automatically, displays Attestcoin/Creditcoin progress, and reveals verified access only after Creditcoin execution succeeds.

## Commands

```bash
npm run lint            # formatting/lint gate
npm run typecheck       # TypeScript checks in every workspace
npm run test            # all workspace tests
npm run test:contracts  # smart-contract tests only
npm run build           # all production builds
npm run check           # complete CI gate
```

## Deploy the payment registry to Sepolia

Set `ETHEREUM_SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` in the root `.env`, then run:

```bash
npm run deploy:sepolia --workspace @proofkey/contracts
```

If `PAYMENT_TOKEN_ADDRESS` is empty, the script deploys a permissionless `MockUSDC` for the Sepolia demo. If it is set, the script verifies that the address contains contract code and uses that ERC-20 instead. A successful run writes `packages/contracts/deployments/sepolia.json` with the registry address, transaction and block hashes, block number, deployer, payment-token details, and explorer URL.

After deploying the Sepolia registry, set `SEPOLIA_USAGE_PAYMENT_REGISTRY_ADDRESS` and deploy the proof-verification stack to Creditcoin CC3 testnet:

```bash
npm run deploy:cc3 --workspace @proofkey/contracts
```

This deploys `MachineRegistry`, a fail-closed `AccessPass`, and `ProofKeyASC`, then permanently initializes the ASC as the only access authorizer. The generated `packages/contracts/deployments/cc3-testnet.json` records every address, transaction hash, block hash, block number, and explorer URL.

## Networks

| Network                  |   Chain ID | Public RPC                                   | Explorer                                    |
| ------------------------ | ---------: | -------------------------------------------- | ------------------------------------------- |
| Ethereum Sepolia         | `11155111` | Supply your provider URL in `.env`           | `https://sepolia.etherscan.io`              |
| Creditcoin Testnet (CC3) |   `102031` | `https://rpc.cc3-testnet.creditcoin.network` | `https://creditcoin-testnet.blockscout.com` |
| Creditcoin Mainnet (CC3) |   `102030` | `https://mainnet3.creditcoin.network`        | `https://creditcoin.blockscout.com`         |

The checked-in `.env.example` contains public defaults and empty secret placeholders. Never commit `.env`, private keys, mnemonics, API tokens, or production credentials.

Official Creditcoin endpoint reference: <https://docs.creditcoin.org/smart-contract-guides/creditcoin-endpoints>

## Contribution workflow

1. Branch from `main` using `issue-<number>-<short-name>`.
2. Keep commits scoped to one issue.
3. Run `npm run check` before opening a pull request.
4. Link the issue in the pull request body with `Closes #<number>`.
   Cross-chain pay-per-use access for physical machines, powered by Creditcoin and the Attestcoin Protocol.
