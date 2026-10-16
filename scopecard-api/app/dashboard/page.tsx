"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Card = {
  sessionId: string;
  merchantLock: string;
  spendLimit: number;
  payerAddress: string;
  status: "active" | "revoked" | "expired";
  expiresAt: string;
  purpose: string | null;
  cardLast4: string;
  paymentTx: string | null;
};

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function remaining(expiresAt: string, now: number) {
  const s = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function Dashboard() {
  const [cards, setCards] = useState<Card[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loadError, setLoadError] = useState(false);
  const [confirming, setConfirming] = useState<Card | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [tab, setTab] = useState<"active" | "history">("active");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cards?status=all", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setCards(((await res.json()) as { cards: Card[] }).cards);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  async function revoke(card: Card) {
    setRevoking(true);
    try {
      await fetch("/api/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: card.sessionId }),
      });
      await load();
    } finally {
      setRevoking(false);
      setConfirming(null);
    }
  }

  // Treat countdown-expired cards as expired locally between polls.
  const live = cards.map((c) => (c.status === "active" && Date.parse(c.expiresAt) <= now ? { ...c, status: "expired" as const } : c));
  const active = live.filter((c) => c.status === "active");
  const history = live.filter((c) => c.status !== "active");
  const revokedCount = live.filter((c) => c.status === "revoked").length;
  const shown = tab === "active" ? active : history;

  return (
    <div className="shell">
      <header className="header">
        <Link href="/" className="brand"><span className="logo">◆</span> ScopeCard</Link>
        <span className="badge">PayBox Plugin</span>
      </header>

      <section className="stats" aria-label="Card stats">
        <div><span className="stat-num">{active.length}</span><span className="stat-label">Active cards</span></div>
        <div><span className="stat-num">{revokedCount}</span><span className="stat-label">Revoked</span></div>
        <div><span className="stat-num">{usd(active.reduce((s, c) => s + c.spendLimit, 0))}</span><span className="stat-label">Agent spend exposure</span></div>
      </section>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "active"} onClick={() => setTab("active")}>Active</button>
        <button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>Revoked &amp; expired</button>
      </nav>

      {loadError && <p className="notice">Can’t reach the vault. Retrying every 5 seconds…</p>}

      {shown.length === 0 ? (
        <p className="empty">
          {tab === "active" ? "No active cards. When an agent pays for a ScopeCard through PayBox it appears here." : "Nothing revoked or expired yet."}
        </p>
      ) : (
        <ul className="grid">
          {shown.map((c) => (
            <li key={c.sessionId} className={`card ${c.status}`}>
              <div className="card-top">
                <span className="merchant">{c.merchantLock}</span>
                {c.status === "active" ? <span className="live">● LIVE</span> : <span className="tag">{c.status.toUpperCase()}</span>}
              </div>
              {c.purpose && <p className="purpose">{c.purpose}</p>}
              <dl>
                <dt>Limit</dt><dd>{usd(c.spendLimit)}</dd>
                <dt>{c.status === "active" ? "Expires in" : "Expired at"}</dt>
                <dd className="mono">{c.status === "active" ? remaining(c.expiresAt, now) : new Date(c.expiresAt).toLocaleTimeString()}</dd>
                <dt>Card</dt><dd className="mono">•••• {c.cardLast4}</dd>
                <dt>Agent</dt><dd className="mono">{short(c.payerAddress)}</dd>
                {c.paymentTx && (<><dt>Fee tx</dt><dd className="mono"><a href={`https://basescan.org/tx/${c.paymentTx}`} target="_blank" rel="noreferrer">{short(c.paymentTx)}</a></dd></>)}
              </dl>
              {c.status === "active" && (
                <button className="revoke" onClick={() => setConfirming(c)}>[!] REVOKE</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={() => !revoking && setConfirming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title">Revoke {confirming.merchantLock} card?</h2>
            <p>This will permanently block the agent <span className="mono">{short(confirming.payerAddress)}</span>. Continue?</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirming(null)} disabled={revoking}>Cancel</button>
              <button className="confirm" onClick={() => revoke(confirming)} disabled={revoking} autoFocus>
                {revoking ? "Revoking…" : "Yes, revoke"}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">Built for MoonPay PayBox Hackathon · <Link href="/">About ScopeCard</Link></footer>
    </div>
  );
}
