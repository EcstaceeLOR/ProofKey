# Deployment records

`npm run deploy:sepolia --workspace @proofkey/contracts` writes `sepolia.json` here after a successful deployment. The record includes contract and payment-token addresses, transaction and block hashes, block numbers, deployer, chain ID, timestamp, and an explorer URL.

`npm run deploy:cc3 --workspace @proofkey/contracts` writes `cc3-testnet.json` with the complete Creditcoin authorization stack and its one-time `AccessPass` authorizer initialization transaction.

Review the output before committing a deployment record. Never commit deployment keys or RPC credentials.

After both deployments exist, `npm run live:mvp --workspace @proofkey/worker` performs the real cross-chain demo and writes `live-mvp.json`. That evidence file and `../fixtures/recorded-live-proof.json` are emitted only after Creditcoin reports the payer as authorized. Both are public, secret-scanned records and are explicitly labeled as historical recorded-live evidence.
