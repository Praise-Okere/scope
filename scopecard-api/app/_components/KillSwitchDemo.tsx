"use client";

import { useState } from "react";
import s from "../landing.module.css";

type State = "active" | "confirm" | "revoked";

/** Self-contained kill-switch demo: no API calls, just the interaction. */
export default function KillSwitchDemo() {
  const [state, setState] = useState<State>("active");
  const [log, setLog] = useState<string[]>(["agent  ▸ checkout on delta.com … card accepted"]);

  function revoke() {
    setState("revoked");
    setLog((l) => [...l, "alex   ▸ REVOKE sc_7f3a9e21 (184 ms)", "agent  ▸ POST /api/generate-card", "api    ◂ 403 Credential revoked by user"]);
  }
  function reset() {
    setState("active");
    setLog(["agent  ▸ checkout on delta.com … card accepted"]);
  }

  return (
    <div className={s.demo}>
      <div className={`${s.demoCard} ${state === "revoked" ? s.demoRevoked : ""}`}>
        <div className={s.cardRow}>
          <strong>delta.com</strong>
          {state === "revoked" ? <span className={s.revokedTag}>REVOKED</span> : <span className={s.cardLive}><i /> LIVE</span>}
        </div>
        <dl className={s.demoMeta}>
          <dt>Limit</dt><dd>$450.00</dd>
          <dt>Agent</dt><dd className={s.mono}>0xA9…4F</dd>
          <dt>Session</dt><dd className={s.mono}>sc_7f3a9e21</dd>
        </dl>
        {state === "active" && <button className={s.revokeBtn} onClick={() => setState("confirm")}>[!] REVOKE</button>}
        {state === "confirm" && (
          <div className={s.confirm} role="alertdialog" aria-label="Confirm revoke">
            <p>This will permanently block the agent. Continue?</p>
            <div>
              <button className={s.ghostBtn} onClick={() => setState("active")}>Cancel</button>
              <button className={s.revokeBtnSm} onClick={revoke} autoFocus>Yes, revoke</button>
            </div>
          </div>
        )}
        {state === "revoked" && <button className={s.ghostBtn} onClick={reset}>Reset demo</button>}
      </div>
      <pre className={s.demoLog} aria-live="polite">
        {log.map((l, i) => (
          <span key={i} className={l.includes("403") ? s.bad : l.includes("REVOKE") ? s.warn : undefined}>{l}{"\n"}</span>
        ))}
      </pre>
    </div>
  );
}
