import { SESSION_ID } from "@/lib/cards";
import { vault } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const card = SESSION_ID.test(sessionId) ? await vault.get(sessionId) : null;
  if (!card) return Response.json({ error: "Session not found" }, { status: 404 });
  if (!card.isRevoked) {
    card.isRevoked = true;
    card.revokedAt = Date.now();
    await vault.put(card);
  }
  return Response.json({ success: true, sessionId, message: `Card ${sessionId} revoked` });
}
