import { issueCard, parseCardRequest } from "@/lib/cards";
import { payerIsRevoked, vault } from "@/lib/vault";
import { paymentRequired, readPayment, settlePayment, verifyPayment, x402Config } from "@/lib/x402";

export const dynamic = "force-dynamic";

function resourceUrl(req: Request): string {
  const base = process.env.PUBLIC_BASE_URL;
  return base ? new URL("/api/generate-card", base).toString() : new URL(req.url).toString();
}

export async function POST(req: Request) {
  if (!x402Config()) {
    return Response.json({ error: "Server not configured: set PAY_TO_ADDRESS" }, { status: 500 });
  }
  // Validate before asking for money so a bad request is never charged.
  const input = parseCardRequest(await req.json().catch(() => null));
  if (!input) return Response.json({ error: "Invalid input" }, { status: 400 });

  const resource = resourceUrl(req);
  const payment = readPayment(req, resource);
  if (payment === null) return paymentRequired(resource);
  if (typeof payment === "string") return paymentRequired(resource, payment);

  const verified = await verifyPayment(payment);
  if (!verified.ok) return paymentRequired(resource, verified.reason);

  // Kill switch: a payer with any revoked card is blocked before it is charged.
  if (await payerIsRevoked(verified.payer)) {
    return Response.json({ error: "Credential revoked by user" }, { status: 403 });
  }

  const settled = await settlePayment(payment);
  if (!settled.ok) return paymentRequired(resource, settled.reason);

  const card = issueCard({ ...input, payerAddress: verified.payer, paymentTx: settled.transaction });
  await vault.put(card);

  return Response.json(
    {
      success: true,
      sessionId: card.sessionId,
      card: { number: card.cardNumber, cvv: card.cvv, expiry: card.cardExpiry },
      merchantLock: card.merchantLock,
      spendLimit: card.spendLimit,
      currency: "USD",
      createdAt: new Date(card.createdAt).toISOString(),
      expiresAt: new Date(card.expiresAt).toISOString(),
      paymentTx: card.paymentTx,
    },
    { headers: { ...settled.header, "Cache-Control": "no-store" } },
  );
}
