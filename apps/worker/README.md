# ProofKey durable relay

The relay exposes a small HTTPS ingestion/status API and runs proof execution independently from request handling. Enqueue writes are committed to PostgreSQL before a `202 Accepted` response is returned. The executor claims jobs with expiring leases, renews its lease during long Attestcoin waits, and safely recovers unfinished work after a restart.

## API

| Route                        | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `GET /health`                | Process liveness only; never includes configuration or secrets.             |
| `GET /ready`                 | Separate database, Sepolia RPC, Creditcoin RPC, and relayer-balance checks. |
| `POST /jobs`                 | Idempotently enqueue `{ "transactionHash": "0x…" }`.                        |
| `GET /jobs/:transactionHash` | Read the public proof phase, result, or structured failure.                 |
| `GET /proofs/:identifier`    | Search by source transaction, order, query, or CC3 transaction.             |

Proof responses contain only public receipt, Attestcoin, relay-phase, and
Creditcoin execution fields. Every response passes a recursive secret-field
guard before serialization; RPC URLs, private keys, and internal paths are
never part of the public schema.

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
