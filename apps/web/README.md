# ProofKey customer app

The customer app presents the complete pay-to-prove-to-unlock journey on one responsive screen. Machine availability, owner tariff, token details, transactions, relay status, and access expiry all come from the configured contracts or the public relay job API.

## Run locally

Copy the root `.env.example` to `.env`, configure the Sepolia and Creditcoin contracts, then start the relay API and frontend in separate terminals:

```bash
npm run serve --workspace @proofkey/worker
npm run dev --workspace @proofkey/web
```

The user connects a browser wallet, switches to Sepolia when prompted, chooses a duration, approves the payment token if necessary, and confirms `payForUsage`. The app automatically submits the confirmed transaction hash to the worker and follows every proof phase through Creditcoin execution. It never exposes the worker wallet key to the browser.

For a side-by-side recording, also run `npm run dev --workspace @proofkey/device`.
