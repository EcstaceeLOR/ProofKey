# Security test boundaries

The default Solidity suite is deterministic and runs entirely on the local Hardhat EVM.

- `ProofKeyASC.t.sol` etches explicit test doubles over Creditcoin's Native Query Verifier address (`0x0FD2`). Its accepting/rejecting doubles isolate receipt semantics, while its proof-binding double rejects mutations to transaction bytes, Merkle data, and continuity data. These are mock-verifier security tests, not evidence of a live Creditcoin precompile call.
- `MachineRegistryAccessPass.t.sol` tests authorization ownership, expiry, machine state, and non-transferability.
- `UsagePaymentRegistry.t.sol` tests source payment settlement and replay protection.
- `live/` is reserved for recorded or network-backed live-precompile evidence. Live evidence must include its Creditcoin transaction, source transaction, block height, chain key, and provenance.

Run the deterministic suite with:

```bash
npm run test --workspace @proofkey/contracts
```

The live suite is intentionally not simulated or represented as current network evidence.
