// Diagnose Coinbase CDP x402 facilitator credentials without printing the secret.
//   pnpm check-cdp            (reads .env.local)
import { createFacilitatorConfig } from "@coinbase/x402";

const clean = (v) => {
  if (!v) return undefined;
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s.replace(/\\n/g, "\n");
};

const rawId = process.env.CDP_API_KEY_ID;
const rawSecret = process.env.CDP_API_KEY_SECRET;
const id = clean(rawId);
const secret = clean(rawSecret);
let problems = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { problems++; console.log(`  ✗ ${m}`); };
const info = (m) => console.log(`  · ${m}`);

console.log("\n1. Values present");
if (!rawId) bad("CDP_API_KEY_ID is missing (add it to scopecard-api/.env.local)"); else ok(`CDP_API_KEY_ID set (${rawId.length} chars)`);
if (!rawSecret) bad("CDP_API_KEY_SECRET is missing"); else ok(`CDP_API_KEY_SECRET set (${rawSecret.length} chars)`);
if (!id || !secret) { console.log("\nFix the missing values and run again.\n"); process.exit(1); }

console.log("\n2. Format");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (uuid.test(id)) ok("Key ID looks like a CDP key ID (UUID)");
else if (/^organizations\/[^/]+\/apiKeys\/[^/]+$/.test(id)) ok("Key ID is the legacy organizations/…/apiKeys/… name");
else bad("Key ID is not a UUID or organizations/…/apiKeys/… name — did you paste the secret, a client key, or a project ID here?");

let kind = "unknown";
if (/-----BEGIN EC PRIVATE KEY-----/.test(secret)) {
  kind = "EC (ES256) PEM";
  if (!secret.includes("\n")) bad("EC PEM secret has no line breaks — paste the whole block, or keep the \\n escapes");
  else if (!/-----END EC PRIVATE KEY-----/.test(secret)) bad("EC PEM secret is cut off (no END line)");
  else ok("Secret is an EC PEM block with line breaks");
} else if (/^[A-Za-z0-9+/]+={0,2}$/.test(secret) && Buffer.from(secret, "base64").length === 64) {
  kind = "Ed25519";
  ok("Secret is an Ed25519 key (base64, 64 bytes)");
} else if (uuid.test(secret)) {
  bad("Secret looks like a UUID — ID and secret are probably swapped");
} else {
  bad(`Secret is not Ed25519 base64 or an EC PEM block (${secret.length} chars after cleanup). Make sure it is a *Secret API key*, not a Client API key.`);
}
if (rawSecret !== secret || rawId !== id) info("Quotes, spaces or literal \\n were cleaned up (the API does the same)");
info(`Key type: ${kind}`);

console.log("\n3. Sign a request");
const config = createFacilitatorConfig(id, secret);
let headers;
try {
  headers = await config.createAuthHeaders();
  ok("JWT signed locally");
} catch (e) {
  bad(`Could not sign with this secret: ${e.message}`);
  console.log("\nThe secret is malformed. Create a new Secret API key in the CDP portal and paste it again.\n");
  process.exit(1);
}

console.log("\n4. Call the Coinbase x402 facilitator");
const res = await fetch(`${config.url}/supported`, { headers: headers.supported, signal: AbortSignal.timeout(10_000) }).catch((e) => ({ error: e }));
if (res.error) {
  bad(`Network error reaching api.cdp.coinbase.com: ${res.error.message}`);
} else {
  const text = await res.text();
  if (res.ok) {
    ok(`HTTP ${res.status} — Coinbase accepted the key`);
    let kinds = [];
    try { kinds = JSON.parse(text).kinds ?? []; } catch {}
    const base = kinds.filter((k) => k.network === "eip155:8453" || k.network === "base");
    if (base.some((k) => k.scheme === "exact")) ok("Base mainnet 'exact' payments are supported for this key");
    else bad(`Base mainnet 'exact' not listed. Networks offered: ${[...new Set(kinds.map((k) => k.network))].join(", ") || "none"}`);
  } else {
    bad(`HTTP ${res.status} from Coinbase: ${text.slice(0, 300)}`);
    if (res.status === 401) info("401 = Coinbase rejected the signature: wrong ID/secret pair, deleted key, or a Client key instead of a Secret key.");
    if (res.status === 403) info("403 = key lacks permission or an IP allowlist blocks this machine/Vercel. Edit the key in the CDP portal and remove the IP restriction.");
  }
}

console.log(problems ? `\n${problems} problem(s) found — fix the ✗ lines above.\n` : "\nAll good: this key will work for ScopeCard.\n");
process.exit(problems ? 1 : 0);
