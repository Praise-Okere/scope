# ScopeCard

Merchant-scoped, 15-minute virtual cards for AI agents, paid via x402 through PayBox, with a one-click human kill switch.

```
scopecard-plugin/   PayBox plugin (MCP tools) -> upload dist/plugin.mjs
scopecard-api/      Next.js: x402 /api/generate-card, vault, Kill Switch dashboard
```

## Quick start

```bash
./run.sh          # plugin checks + API build + 20 end-to-end tests, then serves the site
```

- Landing page: http://localhost:3000
- Kill Switch dashboard: http://localhost:3000/dashboard
- `run.sh` downloads a project-local Node 24 into `.node/` if your system Node differs.
- `./run.sh --live` skips the tests and serves with your real `scopecard-api/.env.local`.
- `cd scopecard-api && pnpm check-cdp` checks your Coinbase CDP key without printing the secret.

## How the pieces fit

1. Agent calls the plugin tool `request_scoped_card { merchantLock, spendLimit, purpose }`.
2. The plugin returns an x402 proposal: `POST <API>/api/generate-card`, max 0.01 USDC on Base mainnet.
3. PayBox fetches the 402 challenge, the user approves, PayBox pays and retries; the API verifies + settles
   via the x402 facilitator and returns the card (sessionId, PAN, CVV, 15-min expiry, fee tx hash).
4. The user revokes from the dashboard (or asks the agent: `revoke_scoped_card`). The revoked agent wallet
   gets `403 Credential revoked by user` on its next request, before any fee is settled.

Other tools: `list_scoped_cards`, `check_card_status` (agent checks before checkout). Card numbers/CVVs are
only ever returned once, in the paid response.

## Plugin

```bash
cd scopecard-plugin
pnpm install --frozen-lockfile   # Node 24, pnpm 11.11.0
pnpm test                        # typecheck, reproducible build, PayBox conformance
```

Portal configuration:
- Network host: the API hostname, e.g. `scopecard.vercel.app`
- Environment variable: `SCOPECARD_API_URL=https://scopecard.vercel.app`
- Secrets: none

## API + dashboard

```bash
cd scopecard-api
cp .env.example .env.local   # set PAY_TO_ADDRESS, CDP_API_KEY_ID, CDP_API_KEY_SECRET
pnpm install && pnpm dev
```

| Env | Purpose |
|---|---|
| `PAY_TO_ADDRESS` | Base mainnet address receiving card fees (required) |
| `CARD_FEE_ATOMIC` | Fee in atomic USDC, default `10000` ($0.01); must be <= plugin maxAmount |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | Coinbase CDP x402 facilitator (Base mainnet settlement) |
| `FACILITATOR_URL` | Optional alternative facilitator |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (or Vercel KV `KV_REST_API_*`) | Shared vault; required on Vercel, where in-memory state is per-instance |

Endpoints: `POST /api/generate-card` (x402), `GET /api/cards?status=active|revoked|expired|all`,
`GET /api/cards/:sessionId`, `POST /api/revoke { sessionId }`.

End-to-end test with a mock facilitator (no real funds):

```bash
pnpm build
PAY_TO_ADDRESS=0x2222222222222222222222222222222222222222 FACILITATOR_URL=http://localhost:3199 PORT=3100 pnpm start &
BUNDLE=../scopecard-plugin/dist/plugin.mjs node scripts/e2e.mjs
```

## MVP limits

- Card PANs are mock (4242 test BIN); no real issuing or merchant enforcement yet.
- No auth on list/revoke: single-user demo. Anyone with the URL can see summaries and revoke.
- Payments are real USDC on Base mainnet (PayBox does not support Base Sepolia).

License: MIT
# scope
