# ProofKey durable relay

The relay exposes a small HTTPS ingestion/status API and runs proof execution independently from request handling. Enqueue writes are committed to PostgreSQL before a `202 Accepted` response is returned. The executor claims jobs with expiring leases, renews its lease during long Attestcoin waits, and safely recovers unfinished work after a restart.

## API

| Route                                   | Purpose                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `GET /health`                           | Process liveness only; never includes configuration or secrets.             |
| `GET /ready`                            | Separate database, Sepolia RPC, Creditcoin RPC, and relayer-balance checks. |
| `POST /jobs`                            | Idempotently enqueue `{ "transactionHash": "0x…" }`.                        |
| `GET /jobs/:transactionHash`            | Read the public proof phase, result, or structured failure.                 |
| `GET /proofs/:identifier`               | Search by source transaction, order, query, or CC3 transaction.             |
| `POST /metadata`                        | Persist a canonical machine metadata document by content digest.            |
| `GET /metadata/:digest`                 | Read immutable content-addressed machine metadata.                          |
| `GET /metadata/commitments/:hash`       | Resolve metadata from its Creditcoin URI commitment.                        |
| `POST /device-handoffs`                 | Create a two-minute handoff from a completed source transaction.            |
| `GET /device-handoffs/:nonce`           | Read public handoff state and signed usage receipts.                        |
| `POST /device-handoffs/:nonce/claim`    | Atomically claim the QR once and return the device-only claim token.        |
| `POST /device-handoffs/:nonce/receipts` | Persist a controller-signed start or end receipt in strict order.           |

Proof responses contain only public receipt, Attestcoin, relay-phase, and
Creditcoin execution fields. Every response passes a recursive secret-field
guard before serialization; RPC URLs, private keys, claim-token hashes, and internal paths are
never part of the public schema.

Device handoffs are also durable PostgreSQL records. The QR carries only the
public nonce and route binding. Claiming creates a random device-only token,
stores only its SHA-256 hash, and atomically rejects every later claim. Receipt
payloads bind the machine ID, payer, order ID, nonce, access expiry, start/end
timestamps, and measured duration. The relay verifies the declared controller
signature before persisting either receipt; the customer additionally checks
that signer against `MachineRegistry.controller` directly from Creditcoin.

Only browser origins listed in `FRONTEND_ORIGINS` receive CORS access. Enqueue requests are bounded per client by `RELAY_RATE_LIMIT_REQUESTS` and `RELAY_RATE_LIMIT_WINDOW_MS`.

## Local development

Create a PostgreSQL database, copy the root `.env.example` to `.env`, and configure `DATABASE_URL` plus the network and contract variables. Then run:

```bash
npm run serve --workspace @proofkey/worker
```

The API and executor share a process for an economical testnet deployment, but they do not share an in-memory queue: PostgreSQL is the handoff and source of truth. Relay tables live in the dedicated `proofkey` schema. This means a terminated process cannot lose an accepted job. `FOR UPDATE SKIP LOCKED` and renewable leases also support multiple executors.

## Render deployment

The root `render.yaml` defines the public `proofkey-relay` web service. In Render, connect a managed PostgreSQL database and populate the `sync: false` values using the dashboard secret manager. Keep `WORKER_PRIVATE_KEY` only on Render; it is never a Vite variable.

After deployment:

1. Confirm `/health` returns `alive` and `/ready` reports every check as `ready`.
2. Set `VITE_PROOF_WORKER_URL=https://proofkey-relay.onrender.com` in Vercel.
3. Redeploy the frontend and submit a fresh Sepolia payment.

Render's free web tier sleeps when idle. During an active proof the frontend status polling keeps the service awake; use an always-on instance for unattended production relay guarantees.
