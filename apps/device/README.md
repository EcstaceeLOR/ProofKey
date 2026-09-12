# ProofKey machine simulator

This standalone browser view visualizes one physical machine and reads its authorization directly from `AccessPass` and `MachineRegistry` on Creditcoin CC3 testnet. It does not accept an unlock command from the worker or a private backend.

Copy `.env.example` to the repository root, supply the five `VITE_*` values, then run:

```bash
npm run dev --workspace @proofkey/device
```

The simulator starts locked, shows an unlocking state while it checks Creditcoin, unlocks only when `isAuthorized(machineId, beneficiary)` returns true, and transitions to expired at the recorded on-chain expiry. An RPC or configuration failure locks the simulator.
