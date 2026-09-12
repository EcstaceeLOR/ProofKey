# Contracts

ProofKey's Solidity contracts compile with Solidity `0.8.28`.

`UsagePaymentRegistry.sol` is the Sepolia source-of-truth for machine access payments. Its core invariants are:

- only the owner can configure machine pricing and beneficiaries;
- the payer cannot override the offer beneficiary or price;
- an order ID is domain-separated by chain, registry, machine, payer, and nonce;
- each order can settle only once;
- payment transfers directly from payer to beneficiary; and
- `UsagePaid` contains the complete authorization record consumed by the Attestcoin/Creditcoin path.

`MachineRegistry.sol` stores each Creditcoin machine's owner, controller, metadata commitment, tariff, and active status. Only the recorded machine owner can change its configuration.

`AccessPass.sol` stores non-transferable credentials keyed directly by machine and beneficiary. Its Attestcoin authorizer is initialized once and cannot be replaced, so no administrator can install a proof-bypass contract. `isAuthorized` automatically accounts for both expiry and machine deactivation.

`ProofKeyASC.sol` is the sole verify-and-activate path. It calls Creditcoin's Native Query Verifier at `0x0FD2`, decodes the proven Sepolia receipt with `@gluwa/asc-contracts`, validates the immutable payment source and exact `UsagePaid` semantics, blocks query and order replay, and grants access atomically.

Contracts under `mocks/` are test-only and must not be treated as production trust anchors or assets.

The proof-security suite and the boundary between local verifier doubles and live-precompile evidence are documented in [`../test/README.md`](../test/README.md).
