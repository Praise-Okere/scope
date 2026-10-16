import type { ScopedCard } from "./cards";

/**
 * Card vault. Uses Upstash Redis (or Vercel KV) over REST when configured so
 * every serverless instance sees the same cards and revocations; otherwise an
 * in-process Map, which only works on a single long-running server.
 */
interface Vault {
  get(id: string): Promise<ScopedCard | null>;
  put(card: ScopedCard): Promise<void>;
  all(): Promise<ScopedCard[]>;
}

const KEY = "scopecard:cards";

function redisVault(url: string, token: string): Vault {
  async function cmd(...args: string[]): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (!res.ok || data.error) throw new Error(`Vault error: ${data.error ?? res.status}`);
    return data.result;
  }
  return {
    async get(id) {
      const raw = await cmd("HGET", KEY, id);
      return typeof raw === "string" ? (JSON.parse(raw) as ScopedCard) : null;
    },
    async put(card) {
      await cmd("HSET", KEY, card.sessionId, JSON.stringify(card));
    },
    async all() {
      const flat = ((await cmd("HGETALL", KEY)) as string[] | null) ?? [];
      const cards: ScopedCard[] = [];
      for (let i = 1; i < flat.length; i += 2) cards.push(JSON.parse(flat[i]!) as ScopedCard);
      return cards;
    },
  };
}

function memoryVault(): Vault {
  const g = globalThis as { __scopecardVault?: Map<string, ScopedCard> };
  const map = (g.__scopecardVault ??= new Map());
  return {
    async get(id) { return map.get(id) ?? null; },
    async put(card) { map.set(card.sessionId, card); },
    async all() { return [...map.values()]; },
  };
}

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export const vault: Vault = redisUrl && redisToken ? redisVault(redisUrl, redisToken) : memoryVault();

export async function payerIsRevoked(addr: string): Promise<boolean> {
  const payer = addr.toLowerCase();
  return (await vault.all()).some((c) => c.payerAddress === payer && c.isRevoked);
}
