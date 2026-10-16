import { randomBytes, randomInt } from "node:crypto";

export const CARD_TTL_MS = 15 * 60 * 1000;
export const MAX_SPEND_LIMIT = 10_000;

export interface ScopedCard {
  sessionId: string;
  payerAddress: string;
  merchantLock: string;
  spendLimit: number;
  purpose?: string;
  cardNumber: string; // mock PAN for MVP
  cvv: string;
  cardExpiry: string; // MM/YY printed on the card
  createdAt: number; // epoch ms
  expiresAt: number; // createdAt + 15 min
  isRevoked: boolean;
  revokedAt?: number;
  paymentTx?: string; // Base tx hash from x402 settlement
}

export type CardStatus = "active" | "revoked" | "expired";

export const cardStatus = (c: ScopedCard, now = Date.now()): CardStatus =>
  c.isRevoked ? "revoked" : now < c.expiresAt ? "active" : "expired";

/** Public view: never includes the PAN or CVV. */
export function summarize(c: ScopedCard, now = Date.now()) {
  return {
    sessionId: c.sessionId,
    merchantLock: c.merchantLock,
    spendLimit: c.spendLimit,
    payerAddress: c.payerAddress,
    status: cardStatus(c, now),
    createdAt: new Date(c.createdAt).toISOString(),
    expiresAt: new Date(c.expiresAt).toISOString(),
    purpose: c.purpose ?? null,
    cardLast4: c.cardNumber.slice(-4),
    revokedAt: c.revokedAt ? new Date(c.revokedAt).toISOString() : null,
    paymentTx: c.paymentTx ?? null,
  };
}

const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/;
export const SESSION_ID = /^sc_[a-z0-9]{8,32}$/;

export function parseCardRequest(body: unknown): { merchantLock: string; spendLimit: number; purpose?: string } | null {
  if (!body || typeof body !== "object") return null;
  const { merchantLock, spendLimit, purpose } = body as Record<string, unknown>;
  if (typeof merchantLock !== "string" || typeof spendLimit !== "number") return null;
  const domain = merchantLock.trim().toLowerCase();
  if (domain.length > 253 || !DOMAIN.test(domain)) return null;
  if (!Number.isFinite(spendLimit) || spendLimit <= 0 || spendLimit > MAX_SPEND_LIMIT) return null;
  if (purpose !== undefined && (typeof purpose !== "string" || purpose.length > 200)) return null;
  return { merchantLock: domain, spendLimit: Math.round(spendLimit * 100) / 100, purpose: purpose?.trim() || undefined };
}

function luhnCheckDigit(partial: string): number {
  let sum = 0;
  for (let i = 0; i < partial.length; i++) {
    let d = Number(partial[partial.length - 1 - i]);
    if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function issueCard(input: { merchantLock: string; spendLimit: number; purpose?: string; payerAddress: string; paymentTx?: string }): ScopedCard {
  const now = Date.now();
  // 4242 test BIN keeps the mock PAN obviously non-live while still Luhn-valid.
  const partial = "4242" + Array.from({ length: 11 }, () => randomInt(10)).join("");
  const pan = partial + luhnCheckDigit(partial);
  const expiry = new Date(now);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return {
    sessionId: "sc_" + randomBytes(4).toString("hex"),
    payerAddress: input.payerAddress.toLowerCase(),
    merchantLock: input.merchantLock,
    spendLimit: input.spendLimit,
    purpose: input.purpose,
    cardNumber: pan.replace(/(\d{4})(?=\d)/g, "$1 "),
    cvv: String(randomInt(1000)).padStart(3, "0"),
    cardExpiry: `${String(expiry.getUTCMonth() + 1).padStart(2, "0")}/${String(expiry.getUTCFullYear()).slice(-2)}`,
    createdAt: now,
    expiresAt: now + CARD_TTL_MS,
    isRevoked: false,
    paymentTx: input.paymentTx,
  };
}
