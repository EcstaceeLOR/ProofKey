# Contracts

ProofKey's Solidity contracts compile with Solidity `0.8.28`.

`UsagePaymentRegistry.sol` is the Sepolia source-of-truth for machine access payments. Its core invariants are:

- only the owner can configure machine pricing and beneficiaries;
- the payer cannot override the offer beneficiary or price;
- an order ID is domain-separated by chain, registry, machine, payer, and nonce;
- each order can settle only once;
- payment transfers directly from payer to beneficiary; and
- `UsagePaid` contains the complete authorization record consumed by the Attestcoin/Creditcoin path.

`mocks/MockUSDC.sol` is a permissionless test token and must never be used as a real asset.
