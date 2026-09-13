# Production release gate

A ProofKey deployment is complete only after this checklist passes. Build success alone is not a release signal.

## Automated gates

- `npm run check` passes formatting, type checks, unit and contract tests, and all builds.
- `npm run check:production` rejects missing public configuration, credentials embedded in URLs, localhost coupling, source maps, secret-like bundle content, missing assets, and bundle-budget regressions.
- Mocked journeys pass in Chromium, Firefox, and WebKit, including wallet connection, checkout, relay state, activity recovery, proof exploration, operator onboarding, QR handoff, device refresh, signed usage, and replay rejection.
- Axe reports no serious or critical WCAG violations on the homepage and wallet dialog; keyboard navigation and a 390-pixel viewport are exercised.

## Performance budgets

| Metric                            |  Enforced budget |
| --------------------------------- | ---------------: |
| Largest JavaScript chunk          |     380 KiB gzip |
| Largest stylesheet                |      20 KiB gzip |
| Production first contentful paint |        5 seconds |
| Target LCP                        |      2.5 seconds |
| Target INP                        | 200 milliseconds |
| Target CLS                        |              0.1 |

The chunk and paint limits fail automation. LCP, INP, and CLS are release targets checked in the Vercel production analytics view because representative field data cannot be manufactured in CI.

## Public smoke confirmation

1. Run `npm run test:smoke --workspace @proofkey/web` with `PRODUCTION_WEB_URL` and `PRODUCTION_RELAY_URL` set to the deployed HTTPS origins.
2. Confirm the homepage, machine deep link, wallet modal, recorded proof deep link, and every same-origin static asset return successfully.
3. Confirm relay `/health` returns HTTP 200 and `/ready` reports whether database, chains, and relayer are ready.
4. Open `/diagnostics` and confirm configuration, Sepolia, Creditcoin, and relay checks are green.
5. Confirm Vercel contains only public `VITE_*` configuration and Render contains server secrets. Never copy a worker key, RPC credential, or deployment token into Vercel.
6. Confirm the scheduled read-only smoke workflow has a recent green run before announcing the deployment.
