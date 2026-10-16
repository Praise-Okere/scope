import Link from "next/link";
import FlowTerminal from "./_components/FlowTerminal";
import HeroParticles from "./_components/HeroParticles";
import KillSwitchDemo from "./_components/KillSwitchDemo";
import s from "./landing.module.css";

const FEARS = [
  { q: "What if it overspends?", a: "Hard spend cap per card, up to $10,000. The limit is set by the task, not the agent’s mood.", n: "01", tag: "spendLimit" },
  { q: "What if it buys from the wrong merchant?", a: "Every card is locked to one merchant domain. delta.com means delta.com.", n: "02", tag: "merchantLock" },
  { q: "What if it keeps charging after I’m done?", a: "Cards self-destruct after 15 minutes, and you can kill any of them instantly.", n: "03", tag: "expiresAt + revoke" },
];

const STEPS = [
  { n: "1", t: "Agent asks", d: "Your agent calls request_scoped_card with a merchant, a limit and a purpose." },
  { n: "2", t: "API sends a bill", d: "ScopeCard answers HTTP 402: pay 0.01 USDC on Base. A bill, in code." },
  { n: "3", t: "PayBox pays", d: "You approve in PayBox, your wallet signs, and the request is retried with proof of payment." },
  { n: "4", t: "Card in hand", d: "Back comes a virtual card locked to the merchant, capped and ticking down from 15:00." },
];

const TOOLS = [
  { name: "request_scoped_card", sig: "{ merchantLock, spendLimit, purpose? }", d: "Proposes the x402 payment and returns a scoped card once approved." },
  { name: "check_card_status", sig: "{ sessionId }", d: "Is the card still usable? Agents check right before checkout." },
  { name: "list_scoped_cards", sig: "{ status? }", d: "Active, revoked or expired. Never exposes card numbers or CVVs." },
  { name: "revoke_scoped_card", sig: "{ sessionId }", d: "“Kill that card.” Blocks the card and the paying agent wallet." },
];

const TICKER = ["x402 native", "Base · USDC", "Merchant-locked", "15-minute TTL", "One-click revoke", "PayBox plugin", "403 in < 500 ms", "No private keys"];
const HEADLINE = ["A", "safe", "trigger", "finger", "for", "AI", "agents."];

export default function Landing() {
  return (
    <div className={s.page}>
      <header className={s.nav}>
        <Link href="/" className={s.logo}>◆ ScopeCard</Link>
        <nav className={s.navLinks}>
          <a href="#how">How it works</a>
          <a href="#kill-switch">Kill switch</a>
          <a href="#tools">Tools</a>
          <a href="#start">Get started</a>
        </nav>
        <Link href="/dashboard" className={s.navCta}>Open dashboard →</Link>
      </header>

      <main>
        <section className={s.hero}>
          <div className={s.heroCopy}>
            <span className={s.eyebrow}><i className={s.dot} /> A plugin for PayBox · MoonPay Hackathon</span>
            <h1 className={s.h1}>
              {HEADLINE.map((w, i) => (
                <span key={i} className={s.word} style={{ "--i": i } as React.CSSProperties}>
                  <span className={w === "trigger" || w === "finger" ? s.outline : undefined}>{w}</span>
                </span>
              ))}
            </h1>
            <p className={s.lede}>
              Agents can plan anything but they can’t pay for anything. ScopeCard hands them a virtual card that only works
              at one merchant, up to one limit, for fifteen minutes, and gives you the kill switch.
            </p>
            <div className={s.ctaRow}>
              <a href="#start" className={s.primaryBtn}>Install the plugin</a>
              <Link href="/dashboard" className={s.secondaryBtn}>See the kill switch</Link>
            </div>
            <dl className={s.heroStats}>
              <div><dt>Card fee</dt><dd>$0.01</dd></div>
              <div><dt>Lifetime</dt><dd>15 min</dd></div>
              <div><dt>Revoke</dt><dd>&lt;500 ms</dd></div>
            </dl>
          </div>
          <HeroParticles />
        </section>

        <div className={s.ticker} aria-hidden>
          <div className={s.tickerTrack}>
            {[...TICKER, ...TICKER].map((t, i) => <span key={i}>{t}<b>◆</b></span>)}
          </div>
        </div>

        <section className={s.section}>
          <h2 className={s.h2}>Nobody hands an agent their real card.<br /><span className={s.muted}>So don’t.</span></h2>
          <div className={s.fears}>
            {FEARS.map((f) => (
              <article key={f.n} className={s.fear}>
                <span className={s.fearNum}>{f.n}</span>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
                <code>{f.tag}</code>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className={`${s.section} ${s.dark}`}>
          <div className={`${s.split} ${s.inner}`}>
            <div>
              <span className={s.kicker}>How it works</span>
              <h2 className={s.h2}>402 in. Card out.<br /><span className={s.muted}>403 when you say so.</span></h2>
              <ol className={s.steps}>
                {STEPS.map((st) => (
                  <li key={st.n}>
                    <span className={s.stepNum}>{st.n}</span>
                    <div><strong>{st.t}</strong><p>{st.d}</p></div>
                  </li>
                ))}
              </ol>
            </div>
            <FlowTerminal />
          </div>
        </section>

        <section id="kill-switch" className={s.section}>
          <div className={s.split}>
            <div>
              <span className={s.kicker}>The kill switch</span>
              <h2 className={s.h2}>One tap.<br /><span className={s.coral}>Agent stopped.</span></h2>
              <p className={s.body}>
                Every live card shows up on your dashboard with its merchant, limit and countdown. Hit REVOKE and the card
                dies. The agent wallet that paid for it is blocked from issuing new cards before it is ever charged again.
                Try it →
              </p>
            </div>
            <KillSwitchDemo />
          </div>
        </section>

        <section id="tools" className={s.section}>
          <span className={s.kicker}>For agents</span>
          <h2 className={s.h2}>Four tools. <span className={s.muted}>That’s the whole API.</span></h2>
          <div className={s.tools}>
            {TOOLS.map((t) => (
              <article key={t.name} className={s.tool}>
                <code className={s.toolName}>{t.name}</code>
                <code className={s.toolSig}>{t.sig}</code>
                <p>{t.d}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="start" className={`${s.section} ${s.dark}`}>
          <div className={s.inner}>
            <span className={s.kicker}>Get started</span>
            <h2 className={s.h2}>Live in three moves.</h2>
            <div className={s.startGrid}>
              <article className={s.startCard}>
                <span className={s.stepNum}>1</span>
                <h3>Enable it in PayBox</h3>
                <p>Find ScopeCard under your PayBox plugins and switch it on. Your agent discovers it with <code>discover_plugins</code>.</p>
              </article>
              <article className={s.startCard}>
                <span className={s.stepNum}>2</span>
                <h3>Ask your agent to buy</h3>
                <p>“Book the $400 Delta fare.” The agent requests a card for <code>delta.com</code> capped at $450, and you approve the $0.01 fee.</p>
              </article>
              <article className={s.startCard}>
                <span className={s.stepNum}>3</span>
                <h3>Keep the kill switch open</h3>
                <p>Watch the card count down on the dashboard. Revoke it the moment anything looks off.</p>
              </article>
            </div>
            <div className={s.ctaRow}>
              <Link href="/dashboard" className={s.primaryBtnLight}>Open the kill switch →</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <span className={s.logo}>◆ ScopeCard</span>
        <span>Built for the MoonPay PayBox Hackathon · Chapter 1</span>
        <span className={s.muted}>Card numbers are test-mode only.</span>
      </footer>
    </div>
  );
}
