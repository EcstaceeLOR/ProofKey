# ProofKey machine simulator

This standalone browser view is retained as a low-level authorization diagnostic. The production product integrates the machine experience at the public `/device/:machineId?handoff=:nonce` route in `@proofkey/web`, including one-time QR claims, continuous Creditcoin checks, and controller-signed usage receipts. Neither client accepts an unlock command from the relay.

Copy `.env.example` to the repository root, supply the five `VITE_*` values, then run:

```bash
npm run dev --workspace @proofkey/device
```

The simulator starts locked, shows an unlocking state while it checks Creditcoin, unlocks only when `isAuthorized(machineId, beneficiary)` returns true, and transitions to expired at the recorded on-chain expiry. An RPC or configuration failure locks the simulator.
