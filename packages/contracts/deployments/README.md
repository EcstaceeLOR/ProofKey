# Deployment records

`npm run deploy:sepolia --workspace @proofkey/contracts` writes `sepolia.json` here after a successful deployment. The record includes contract and payment-token addresses, transaction and block hashes, block numbers, deployer, chain ID, timestamp, and an explorer URL.

`npm run deploy:cc3 --workspace @proofkey/contracts` writes `cc3-testnet.json` with the complete Creditcoin authorization stack and its one-time `AccessPass` authorizer initialization transaction.

Review the output before committing a deployment record. Never commit deployment keys or RPC credentials.
