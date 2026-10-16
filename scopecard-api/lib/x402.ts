import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient } from "@x402/core/http";

/**
 * Minimal x402 resource-server logic for one priced route, speaking both wire
 * versions: v2 (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE headers)
 * and v1 (JSON 402 body / X-PAYMENT / X-PAYMENT-RESPONSE).
 */

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_EIP712 = { name: "USD Coin", version: "2" };
const DESCRIPTION = "ScopeCard: generate 1 merchant-scoped virtual card";

export function x402Config() {
  const payTo = process.env.PAY_TO_ADDRESS;
  if (!payTo || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) return null;
  const amount = process.env.CARD_FEE_ATOMIC ?? "10000";
  return { payTo, amount };
}

function requirementsV2(payTo: string, amount: string) {
  return {
    scheme: "exact",
    network: "eip155:8453",
    amount,
    asset: BASE_USDC,
    payTo,
    maxTimeoutSeconds: 120,
    extra: USDC_EIP712,
  };
}

function requirementsV1(payTo: string, amount: string, resource: string) {
  return {
    scheme: "exact",
    network: "base",
    maxAmountRequired: amount,
    resource,
    description: DESCRIPTION,
    mimeType: "application/json",
    payTo,
    maxTimeoutSeconds: 120,
    asset: BASE_USDC,
    extra: USDC_EIP712,
  };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

export function paymentRequired(resource: string, error?: string): Response {
  const cfg = x402Config()!;
  const v2 = {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: { url: resource, description: DESCRIPTION, mimeType: "application/json" },
    accepts: [requirementsV2(cfg.payTo, cfg.amount)],
  };
  const v1 = {
    x402Version: 1,
    ...(error ? { error } : {}),
    accepts: [requirementsV1(cfg.payTo, cfg.amount, resource)],
  };
  return Response.json(v1, {
    status: 402,
    headers: { "PAYMENT-REQUIRED": b64(v2), "Cache-Control": "private, no-store" },
  });
}

type Payload = { x402Version: number; scheme?: string; network?: string; accepted?: Record<string, unknown>; payload?: Record<string, unknown> };

export interface DecodedPayment {
  version: 1 | 2;
  payload: Payload;
  requirements: Record<string, unknown>;
  claimedPayer: string | null;
}

/** Returns null when no payment header is present, or an error string when it is unusable. */
export function readPayment(req: Request, resource: string): DecodedPayment | string | null {
  const header = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
  if (!header) return null;
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Payload;
  } catch {
    return "Malformed payment header";
  }
  const cfg = x402Config()!;
  const auth = (payload.payload?.authorization ?? {}) as { from?: unknown };
  const claimedPayer = typeof auth.from === "string" ? auth.from : null;
  if (payload.x402Version === 2) {
    const expected = requirementsV2(cfg.payTo, cfg.amount);
    const a = payload.accepted ?? {};
    const same = (k: "scheme" | "network" | "amount" | "asset" | "payTo") =>
      String(a[k] ?? "").toLowerCase() === String(expected[k]).toLowerCase();
    if (!(same("scheme") && same("network") && same("amount") && same("asset") && same("payTo"))) {
      return "Payment does not match the advertised requirements";
    }
    return { version: 2, payload, requirements: expected, claimedPayer };
  }
  if (payload.x402Version === 1) {
    if (payload.scheme !== "exact" || payload.network !== "base") return "Unsupported payment scheme or network";
    return { version: 1, payload, requirements: requirementsV1(cfg.payTo, cfg.amount, resource), claimedPayer };
  }
  return "Unsupported x402 version";
}

/**
 * Undo common copy/paste damage to CDP credentials: wrapping quotes, stray
 * whitespace, and PEM line breaks stored as a literal "\n" (Vercel, .env files).
 */
export function cleanCdpValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).trim();
  return v.replace(/\\n/g, "\n");
}

function facilitator() {
  const url = process.env.FACILITATOR_URL;
  if (url) return new HTTPFacilitatorClient({ url });
  // Coinbase CDP facilitator.
  return new HTTPFacilitatorClient(
    createFacilitatorConfig(cleanCdpValue(process.env.CDP_API_KEY_ID), cleanCdpValue(process.env.CDP_API_KEY_SECRET)),
  );
}

export async function verifyPayment(p: DecodedPayment): Promise<{ ok: true; payer: string } | { ok: false; reason: string }> {
  try {
    // The facilitator client is typed for v2 objects but forwards v1 payloads unchanged.
    const res = await facilitator().verify(p.payload as never, p.requirements as never);
    const payer = res.payer ?? p.claimedPayer;
    if (!res.isValid || !payer) return { ok: false, reason: res.invalidReason ?? "Invalid payment signature" };
    return { ok: true, payer };
  } catch (error) {
    console.error("x402 verify failed", error);
    return { ok: false, reason: "Payment verification unavailable" };
  }
}

export async function settlePayment(p: DecodedPayment): Promise<{ ok: true; transaction: string; header: Record<string, string> } | { ok: false; reason: string }> {
  try {
    const res = await facilitator().settle(p.payload as never, p.requirements as never);
    if (!res.success) return { ok: false, reason: res.errorReason ?? "Settlement failed" };
    const name = p.version === 2 ? "PAYMENT-RESPONSE" : "X-PAYMENT-RESPONSE";
    return { ok: true, transaction: res.transaction, header: { [name]: b64(res) } };
  } catch (error) {
    console.error("x402 settle failed", error);
    return { ok: false, reason: "Payment settlement unavailable" };
  }
}
