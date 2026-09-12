# Recorded proof fixtures

`recorded-live-proof.json` is created only after `npm run live:mvp --workspace @proofkey/worker` completes a real Sepolia-to-Attestcoin-to-Creditcoin flow.

The fixture is historical demo evidence, not a newly generated proof. Its `provenance` object is deliberately fixed to `kind: "recorded-live"` and `fresh: false`. It contains only public chain data; never add RPC URLs, private keys, mnemonics, API keys, or other secrets.
