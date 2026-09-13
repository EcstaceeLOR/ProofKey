# ProofKey customer app

The customer app presents the complete pay-to-prove-to-unlock journey as a routed, responsive product. Machine availability, owner tariff, token details, transactions, relay status, and access expiry all come from the configured contracts or the public relay job API.

## Run locally

Copy the root `.env.example` to `.env`, configure the Sepolia and Creditcoin contracts, then start the relay API and frontend in separate terminals:

```bash
npm run serve --workspace @proofkey/worker
npm run dev --workspace @proofkey/web
```

For mobile connections, create a project in [Reown Cloud](https://cloud.reown.com) and set its public ID as `VITE_WALLETCONNECT_PROJECT_ID`. Without it, detected browser wallets and Coinbase Wallet continue to work while the mobile option clearly reports that it is unavailable.

The user chooses an EIP-6963 browser wallet, Coinbase Wallet, or WalletConnect mobile wallet; switches to Sepolia when prompted; chooses a duration; approves the payment token if necessary; and confirms `payForUsage`. The approved session reconnects silently after refresh and never requests a signature until the user starts a transaction. The app automatically submits the confirmed transaction hash to the worker and follows every proof phase through Creditcoin execution. It never exposes the worker wallet key to the browser.

After access activates, `/sessions/:sourceTransactionHash` creates a one-time QR for the public `/device/:machineId` route. The device claims it once, reads `AccessPass` and `MachineRegistry` directly from CC3 every four seconds, and fails closed on any mismatch or RPC failure. The registered controller signs the start and end receipts; the customer session and My Rentals screens recover them from the relay and verify the signatures locally.

Run wallet state and browser-fixture tests with:

```bash
npm test --workspace @proofkey/web
npm run test:e2e --workspace @proofkey/web
```

For a side-by-side flow, open the generated device link in a second browser or private window. The separate `@proofkey/device` application remains available only as a low-level authorization diagnostic.
