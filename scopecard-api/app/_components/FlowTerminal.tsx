"use client";

import { useEffect, useState } from "react";
import s from "../landing.module.css";

const LINES: { who: string; text: string; tone?: "ok" | "warn" | "bad" | "pb" }[] = [
  { who: "agent", text: "POST /api/generate-card  { merchantLock: \"delta.com\", spendLimit: 450 }" },
  { who: "api", text: "402 Payment Required · 0.01 USDC · eip155:8453", tone: "warn" },
  { who: "paybox", text: "Alex approves the payment · wallet signs", tone: "pb" },
  { who: "agent", text: "retry  + PAYMENT-SIGNATURE" },
  { who: "api", text: "200 OK · sc_7f3a9e21 · 4242 •••• 0402 · expires in 15:00", tone: "ok" },
  { who: "alex", text: "taps REVOKE on the kill switch", tone: "bad" },
  { who: "agent", text: "POST /api/generate-card" },
  { who: "api", text: "403 Credential revoked by user", tone: "bad" },
];

/** Replays the full ScopeCard loop line by line. */
export default function FlowTerminal() {
  const [shown, setShown] = useState(1);

  useEffect(() => {
    const t = setInterval(() => setShown((n) => (n >= LINES.length + 3 ? 1 : n + 1)), 1100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={s.terminal} role="img" aria-label="Animated log of the ScopeCard payment and revocation flow">
      <div className={s.termBar}>
        <span /><span /><span />
        <em>scopecard — live loop</em>
      </div>
      <ol className={s.termBody}>
        {LINES.slice(0, Math.min(shown, LINES.length)).map((l, i) => (
          <li key={i} className={l.tone ? s[l.tone] : undefined}>
            <span className={s.who}>{l.who}</span>
            <span>{l.text}</span>
          </li>
        ))}
        {shown <= LINES.length && <li className={s.caret} aria-hidden>▍</li>}
      </ol>
    </div>
  );
}
