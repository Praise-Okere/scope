import { SESSION_ID, summarize } from "@/lib/cards";
import { vault } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const card = SESSION_ID.test(sessionId) ? await vault.get(sessionId) : null;
  if (!card) return Response.json({ error: "Session not found" }, { status: 404 });
  const now = Date.now();
  const summary = summarize(card, now);
  return Response.json(
    {
      ...summary,
      usable: summary.status === "active",
      secondsRemaining: summary.status === "active" ? Math.floor((card.expiresAt - now) / 1000) : 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
