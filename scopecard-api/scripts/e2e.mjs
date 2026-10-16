// End-to-end: mock x402 facilitator + running ScopeCard API + built plugin bundle.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const API = process.env.API ?? "http://localhost:3100";
const BUNDLE = process.env.BUNDLE;
const PAY_TO = "0x2222222222222222222222222222222222222222";
const A = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const B = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
let settleCalls = 0;

// --- mock facilitator ---------------------------------------------------
const fac = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const { paymentPayload } = JSON.parse(body);
  const from = paymentPayload.payload.authorization.from;
  const bad = paymentPayload.payload.signature === "0xbad";
  res.setHeader("Content-Type", "application/json");
  if (req.url.endsWith("/verify")) {
    res.end(JSON.stringify(bad ? { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", payer: from } : { isValid: true, payer: from }));
  } else if (req.url.endsWith("/settle")) {
    settleCalls++;
    res.end(JSON.stringify({ success: true, transaction: "0x" + String(settleCalls).padStart(64, "f"), network: "eip155:8453", payer: from }));
  } else { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => fac.listen(3199, r));

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64");
const card = { merchantLock: "delta.com", spendLimit: 450, purpose: "Book NYC -> LAX error fare" };
const post = (path, body, headers = {}) =>
  fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

function v2Payment(from, { amount = "10000", sig = "0xgood" } = {}) {
  return b64({
    x402Version: 2,
    resource: { url: API + "/api/generate-card" },
    accepted: { scheme: "exact", network: "eip155:8453", amount, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: PAY_TO, maxTimeoutSeconds: 120, extra: { name: "USD Coin", version: "2" } },
    payload: { signature: sig, authorization: { from, to: PAY_TO, value: amount, validAfter: "0", validBefore: "9999999999", nonce: "0x" + "1".repeat(64) } },
  });
}
const v1Payment = (from) => b64({ x402Version: 1, scheme: "exact", network: "base", payload: { signature: "0xgood", authorization: { from, to: PAY_TO, value: "10000" } } });

// --- plugin harness (one process per call, like PayBox) ----------------
async function callTool(name, args, apiUrl = API) {
  const child = spawn(process.execPath, [BUNDLE], { env: { PATH: process.env.PATH, SCOPECARD_API_URL: apiUrl }, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  } } }) + "\n");
  for await (const line of lines) {
    const msg = JSON.parse(line);
    if (msg.id === 1) { child.kill(); return msg.result; }
  }
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); }
}

let cardA, cardB;
await step("400 on invalid merchant", async () => {
  const r = await post("/api/generate-card", { merchantLock: "not a domain", spendLimit: 5 });
  assert.equal(r.status, 400);
});
await step("400 on spendLimit over $10,000 cap", async () => {
  assert.equal((await post("/api/generate-card", { merchantLock: "delta.com", spendLimit: 10001 })).status, 400);
});
await step("402 with v1 body + v2 PAYMENT-REQUIRED header", async () => {
  const r = await post("/api/generate-card", card);
  assert.equal(r.status, 402);
  const v1 = await r.json();
  assert.equal(v1.x402Version, 1);
  assert.equal(v1.accepts[0].network, "base");
  assert.equal(v1.accepts[0].maxAmountRequired, "10000");
  const v2 = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString());
  assert.equal(v2.x402Version, 2);
  assert.equal(v2.accepts[0].network, "eip155:8453");
  assert.equal(v2.accepts[0].amount, "10000");
  assert.equal(v2.accepts[0].payTo, PAY_TO);
});
await step("402 when payment amount differs from requirement", async () => {
  const r = await post("/api/generate-card", card, { "PAYMENT-SIGNATURE": v2Payment(A, { amount: "1" }) });
  assert.equal(r.status, 402);
});
await step("402 when facilitator rejects signature (no settle)", async () => {
  const before = settleCalls;
  const r = await post("/api/generate-card", card, { "PAYMENT-SIGNATURE": v2Payment(A, { sig: "0xbad" }) });
  assert.equal(r.status, 402);
  assert.equal(settleCalls, before);
});
await step("200 card for valid v2 payment (agent A) + PAYMENT-RESPONSE", async () => {
  const r = await post("/api/generate-card", card, { "PAYMENT-SIGNATURE": v2Payment(A) });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("payment-response"));
  cardA = await r.json();
  assert.match(cardA.sessionId, /^sc_[0-9a-f]{8}$/);
  assert.equal(cardA.merchantLock, "delta.com");
  assert.equal(cardA.spendLimit, 450);
  assert.equal(Date.parse(cardA.expiresAt) - Date.parse(cardA.createdAt), 15 * 60 * 1000);
  assert.match(cardA.card.number, /^4242 \d{4} \d{4} \d{4}$/);
  assert.match(cardA.paymentTx, /^0x/);
});
await step("200 card for valid v1 X-PAYMENT (agent B)", async () => {
  const r = await post("/api/generate-card", { merchantLock: "amazon.com", spendLimit: 80 }, { "X-PAYMENT": v1Payment(B) });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("x-payment-response"));
  cardB = await r.json();
});
await step("plugin request_scoped_card -> x402 proposal for this API", async () => {
  const res = await callTool("request_scoped_card", card, "https://scopecard.example.com");
  const p = res.structuredContent["io.paybox/transactionProposal"];
  assert.ok(Date.parse(p.expiresAt) - Date.now() <= 300_000);
  assert.equal(p.kind, "x402");
  assert.equal(p.chain, "eip155:8453");
  assert.equal(p.payment.maxAmount, "10000");
  assert.equal(p.request.method, "POST");
  assert.equal(p.request.url, "https://scopecard.example.com/api/generate-card");
  assert.deepEqual(p.request.body, card);
});
await step("plugin request_scoped_card rejects bad domain", async () => {
  const res = await callTool("request_scoped_card", { merchantLock: "https://delta.com/x", spendLimit: 10 });
  assert.ok(res.isError, JSON.stringify(res).slice(0, 200));
});
await step("plugin request_scoped_card refuses plain-http API for x402", async () => {
  assert.equal((await callTool("request_scoped_card", card)).isError, true);
});
await step("plugin list_scoped_cards shows both, no PAN/CVV", async () => {
  const res = await callTool("list_scoped_cards", {});
  assert.ok(!res.isError, JSON.stringify(res));
  assert.equal(res.structuredContent.count, 2);
  assert.ok(!JSON.stringify(res).includes(cardA.card.number.replace(/ /g, "").slice(4, 12)));
});
await step("plugin check_card_status: active", async () => {
  const res = await callTool("check_card_status", { sessionId: cardA.sessionId });
  assert.equal(res.structuredContent.usable, true);
  assert.ok(res.structuredContent.secondsRemaining > 800);
});
await step("plugin revoke_scoped_card", async () => {
  const res = await callTool("revoke_scoped_card", { sessionId: cardA.sessionId });
  assert.equal(res.structuredContent.success, true);
});
await step("plugin check_card_status: revoked, unusable", async () => {
  const res = await callTool("check_card_status", { sessionId: cardA.sessionId });
  assert.equal(res.structuredContent.status, "revoked");
  assert.equal(res.structuredContent.usable, false);
});
await step("plugin check_card_status: unknown session -> isError", async () => {
  const res = await callTool("check_card_status", { sessionId: "sc_00000000" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Session not found/);
});
await step("revoked agent A retries -> 403, never charged", async () => {
  const before = settleCalls;
  const r = await post("/api/generate-card", card, { "PAYMENT-SIGNATURE": v2Payment(A.toLowerCase()) });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: "Credential revoked by user" });
  assert.equal(settleCalls, before);
});
await step("agent B unaffected -> 200", async () => {
  const r = await post("/api/generate-card", card, { "PAYMENT-SIGNATURE": v2Payment(B) });
  assert.equal(r.status, 200);
});
await step("GET /api/cards?status=revoked / active filters", async () => {
  const rev = await (await fetch(API + "/api/cards?status=revoked")).json();
  const act = await (await fetch(API + "/api/cards?status=active")).json();
  assert.equal(rev.count, 1);
  assert.equal(act.count, 2);
});
await step("revoke unknown -> 404", async () => {
  assert.equal((await post("/api/revoke", { sessionId: "sc_deadbeef" })).status, 404);
});
await step("revocation latency < 500ms", async () => {
  const t = performance.now();
  await post("/api/revoke", { sessionId: cardB.sessionId });
  assert.ok(performance.now() - t < 500);
});

fac.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
