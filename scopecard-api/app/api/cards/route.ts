import { cardStatus, summarize } from "@/lib/cards";
import { vault } from "@/lib/vault";

export const dynamic = "force-dynamic";

const FILTERS = new Set(["active", "revoked", "expired", "all"]);

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") ?? "all";
  if (!FILTERS.has(status)) return Response.json({ error: "Invalid input" }, { status: 400 });
  const now = Date.now();
  const cards = (await vault.all())
    .filter((c) => status === "all" || cardStatus(c, now) === status)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((c) => summarize(c, now));
  return Response.json({ count: cards.length, cards }, { headers: { "Cache-Control": "no-store" } });
}
