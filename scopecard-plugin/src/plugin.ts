import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { proposeX402, x402OutputSchema } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";
const DEFAULT_API_URL = "https://scopecard.vercel.app";
// Maximum x402 fee per card, in atomic USDC (6 decimals): 10000 = $0.01.
const CARD_FEE_ATOMIC = "10000";
const MAX_SPEND_LIMIT = 10_000;

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/, "Use a bare merchant domain such as delta.com");
const sessionId = z.string().regex(/^sc_[a-z0-9]{8,32}$/, "Session IDs look like sc_7f3a9e21");
const cardStatus = z.enum(["active", "revoked", "expired"]);

const cardSummary = z.object({
  sessionId: z.string(),
  merchantLock: z.string(),
  spendLimit: z.number(),
  payerAddress: z.string(),
  status: cardStatus,
  createdAt: z.string(),
  expiresAt: z.string(),
});
const listOutput = z.object({ count: z.number().int().nonnegative(), cards: z.array(cardSummary) }).strict();
// Parse the API response leniently (extra fields are dropped), declare the output strictly.
const statusResponse = cardSummary.extend({ usable: z.boolean(), secondsRemaining: z.number().int().nonnegative() });
const statusOutput = statusResponse.strict();
const revokeOutput = z.object({ success: z.boolean(), sessionId: z.string(), message: z.string() }).strict();

class ApiError extends Error {}

function apiBase(): string {
  const raw = process.env.SCOPECARD_API_URL?.trim() || DEFAULT_API_URL;
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ApiError("SCOPECARD_API_URL must be an https:// origin.");
  }
  return url.origin;
}

async function callApi(path: string, init?: { method: "POST"; body: unknown }): Promise<unknown> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: init?.method ?? "GET",
    headers: init ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
    body: init ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(4_000),
    redirect: "error",
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(typeof message === "string" && message.length <= 200 ? message : `ScopeCard API returned HTTP ${response.status}.`);
  }
  return data;
}

function failure(error: unknown) {
  const text = error instanceof ApiError
    ? error.message
    : "ScopeCard API is unavailable. Check the plugin's network host and SCOPECARD_API_URL, then retry explicitly.";
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function createServer() {
  const server = new McpServer(
    { name: "scopecard", version: "1.0.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "request_scoped_card",
    {
      title: "Request a merchant-scoped virtual card",
      description:
        "Proposes a $0.01 USDC x402 payment on Base to ScopeCard for one virtual card that only works at merchantLock, " +
        "is capped at spendLimit USD, and expires 15 minutes after issue. After the user approves, the paid response " +
        "contains the sessionId and card details. The user can revoke it at any time.",
      inputSchema: z.object({
        merchantLock: domain.describe("Merchant domain the card is locked to, e.g. delta.com"),
        spendLimit: z.number().positive().max(MAX_SPEND_LIMIT).describe("Hard spend cap in USD, at most 10000"),
        purpose: z.string().trim().min(1).max(200).optional().describe("Short note shown on the user's kill-switch dashboard"),
      }).strict(),
      outputSchema: x402OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ merchantLock, spendLimit, purpose }) => {
      try {
        const proposal = proposeX402({
          chain: "eip155:8453",
          url: `${apiBase()}/api/generate-card`,
          method: "POST",
          body: { merchantLock, spendLimit, ...(purpose ? { purpose } : {}) },
          maxAmount: CARD_FEE_ATOMIC,
        });
        return {
          ...proposal,
          content: [{
            type: "text" as const,
            text: `Proposed a paid ScopeCard request (max 0.01 USDC on Base) for a card locked to ${merchantLock} with a $${spendLimit.toFixed(2)} limit. Nothing has been paid yet; PayBox will ask the user to approve.`,
          }],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_scoped_cards",
    {
      title: "List scoped cards",
      description: "Lists ScopeCard virtual cards by status (default active). Never returns card numbers or CVVs.",
      inputSchema: z.object({ status: z.enum(["active", "revoked", "expired", "all"]).optional() }).strict(),
      outputSchema: listOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ status }) => {
      try {
        const data = listOutput.parse(await callApi(`/api/cards?status=${status ?? "active"}`));
        const lines = data.cards.map((c) => `${c.sessionId} ${c.merchantLock} $${c.spendLimit.toFixed(2)} ${c.status} until ${c.expiresAt}`);
        return {
          content: [{ type: "text" as const, text: data.count ? lines.join("\n") : `No ${status ?? "active"} cards.` }],
          structuredContent: data,
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "check_card_status",
    {
      title: "Check a scoped card",
      description: "Checks whether a ScopeCard session is still usable. Call this right before checkout; stop if usable is false.",
      inputSchema: z.object({ sessionId }).strict(),
      outputSchema: statusOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ sessionId }) => {
      try {
        const data = statusResponse.parse(await callApi(`/api/cards/${sessionId}`));
        const text = data.usable
          ? `${sessionId} is active for ${data.merchantLock} ($${data.spendLimit.toFixed(2)}), ${data.secondsRemaining}s remaining.`
          : `${sessionId} is ${data.status}. Do not use this card.`;
        return { content: [{ type: "text" as const, text }], structuredContent: data };
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "revoke_scoped_card",
    {
      title: "Revoke a scoped card",
      description:
        "Permanently revokes a ScopeCard session. Afterwards the card stops working and its paying agent wallet is blocked " +
        "from issuing new cards. Only call this when the user asks to revoke or kill a card.",
      inputSchema: z.object({ sessionId }).strict(),
      outputSchema: revokeOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ sessionId }) => {
      try {
        const data = revokeOutput.parse(await callApi("/api/revoke", { method: "POST", body: { sessionId } }));
        return { content: [{ type: "text" as const, text: data.message }], structuredContent: data };
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
