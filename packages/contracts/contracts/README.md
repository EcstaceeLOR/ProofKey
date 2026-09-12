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

`AccessPass.sol` stores non-transferable credentials keyed directly by machine and beneficiary. Only the configured Attestcoin authorization contract can grant or extend a credential; `isAuthorized` automatically accounts for both expiry and machine deactivation.

Contracts under `mocks/` are test-only and must not be treated as production trust anchors or assets.
