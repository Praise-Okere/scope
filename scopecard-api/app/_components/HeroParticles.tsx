"use client";

import { useEffect, useRef } from "react";
import s from "../landing.module.css";

/**
 * Particle hero: dust swarms into a scoped card, gets scanned, is slashed by
 * REVOKE and explodes, then reforms. Dots flee the cursor. Pure canvas.
 */

type P = { x: number; y: number; vx: number; vy: number; tx: number; ty: number; delay: number; hot: number };

const CYCLE = 10_000;
const T_ASSEMBLE = 1_200;
const T_HOLD = 3_600;
const T_SLASH = 7_000;
const T_EXPLODE = 7_600;
const MAX_PARTICLES = 4_200;

const LINES: { at: number; text: string; tone?: "bad" }[] = [
  { at: 0, text: "agent ▸ POST /api/generate-card" },
  { at: 1_200, text: "api ◂ 402 Payment Required · 0.01 USDC" },
  { at: 2_600, text: "paybox ▸ approved · paid on Base" },
  { at: 3_600, text: "api ◂ 200 OK · card locked to delta.com · $450" },
  { at: T_SLASH, text: "alex ▸ REVOKE", tone: "bad" },
  { at: T_EXPLODE, text: "api ◂ 403 Credential revoked by user", tone: "bad" },
];

const INK = "20,20,20";
const CORAL = "244,91,105";

export default function HeroParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const label = labelRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, dpr = 1;
    let particles: P[] = [];
    let card = { x: 0, y: 0, w: 0, h: 0 };
    let raf = 0, start = performance.now(), lastLine = -1, exploded = false, visible = true;
    const mouse = { x: -9999, y: -9999 };

    function fontVar(name: string, fallback: string) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    }

    /** Draw the card off-screen and sample its ink pixels as particle targets. */
    function sampleTargets(): { x: number; y: number }[] {
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const o = off.getContext("2d")!;
      const cw = Math.min(W * 0.9, 470);
      const ch = cw / 1.586;
      card = { x: (W - cw) / 2, y: (H - ch) / 2, w: cw, h: ch };
      const u = cw / 470; // scale unit
      const sans = fontVar("--font-body", "system-ui");
      const mono = fontVar("--font-mono", "monospace");

      o.fillStyle = "#000";
      o.strokeStyle = "#000";
      o.lineWidth = 3 * u;
      o.beginPath();
      o.roundRect(card.x, card.y, cw, ch, 24 * u);
      o.stroke();
      // chip
      o.beginPath();
      o.roundRect(card.x + 28 * u, card.y + 78 * u, 50 * u, 38 * u, 7 * u);
      o.fill();
      o.textBaseline = "alphabetic";
      o.font = `700 ${24 * u}px ${sans}`;
      o.fillText("◆ ScopeCard", card.x + 28 * u, card.y + 50 * u);
      o.font = `700 ${18 * u}px ${mono}`;
      o.fillText("● LIVE", card.x + cw - 104 * u, card.y + 50 * u);
      o.font = `700 ${36 * u}px ${mono}`;
      o.fillText("4242 •••• 0402", card.x + 28 * u, card.y + 170 * u);
      o.font = `700 ${26 * u}px ${sans}`;
      o.fillText("delta.com", card.x + 28 * u, card.y + ch - 30 * u);
      o.fillText("$450", card.x + cw * 0.5, card.y + ch - 30 * u);
      o.fillText("15:00", card.x + cw - 100 * u, card.y + ch - 30 * u);

      const data = o.getImageData(0, 0, W, H).data;
      const gap = Math.max(2, Math.round(2.6 * Math.sqrt(u)));
      const pts: { x: number; y: number }[] = [];
      for (let y = 0; y < H; y += gap) {
        for (let x = 0; x < W; x += gap) {
          if (data[(y * W + x) * 4 + 3]! > 128) pts.push({ x, y });
        }
      }
      // Random subsample down to the budget.
      for (let i = pts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pts[i], pts[j]] = [pts[j]!, pts[i]!];
      }
      return pts.slice(0, MAX_PARTICLES);
    }

    function build() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.floor(rect.width));
      H = Math.max(1, Math.floor(rect.height));
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const targets = sampleTargets();
      particles = targets.map((t) => ({
        x: reduced ? t.x : Math.random() * W,
        y: reduced ? t.y : Math.random() * H,
        vx: 0, vy: 0, tx: t.x, ty: t.y,
        // Sweep the assembly left to right with some noise.
        delay: ((t.x - card.x) / card.w) * 900 + Math.random() * 500,
        hot: 0,
      }));
      start = performance.now();
      exploded = false;
    }

    function setLine(t: number) {
      let idx = 0;
      for (let i = 0; i < LINES.length; i++) if (t >= LINES[i]!.at) idx = i;
      if (idx === lastLine) return;
      lastLine = idx;
      label.textContent = LINES[idx]!.text;
      label.dataset.tone = LINES[idx]!.tone ?? "";
      label.classList.remove(s.tick);
      void label.offsetWidth; // restart the tick animation
      label.classList.add(s.tick);
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const t = (now - start) % CYCLE;
      if (t < 50 && exploded) exploded = false;
      setLine(t);
      ctx.clearRect(0, 0, W, H);

      // Slash geometry (bottom-left to top-right across the card).
      const ax = card.x - 30, ay = card.y + card.h + 24;
      const bx = card.x + card.w + 30, by = card.y - 24;
      const len = Math.hypot(bx - ax, by - ay);
      const slashP = t >= T_SLASH ? Math.min(1, (t - T_SLASH) / 450) : 0;
      const scanX = t >= T_HOLD && t < T_SLASH ? card.x + ((t - T_HOLD) / (T_SLASH - T_HOLD)) * card.w * 1.1 : -999;

      if (t >= T_EXPLODE && !exploded) {
        exploded = true;
        const cx = card.x + card.w / 2, cy = card.y + card.h / 2;
        for (const p of particles) {
          const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1;
          const force = 6 + Math.random() * 10 + p.hot * 8;
          p.vx = (dx / d) * force + (Math.random() - 0.5) * 6;
          p.vy = (dy / d) * force + (Math.random() - 0.5) * 6 - 2;
        }
      }

      const fade = t >= T_EXPLODE ? Math.max(0.12, 1 - (t - T_EXPLODE) / 1800) : t < T_ASSEMBLE ? 0.35 : 1;

      for (const p of particles) {
        // Cursor repulsion.
        const mdx = p.x - mouse.x, mdy = p.y - mouse.y, md2 = mdx * mdx + mdy * mdy;
        if (md2 < 9000) {
          const md = Math.sqrt(md2) || 1;
          const push = (1 - md / 95) * 3.2;
          p.vx += (mdx / md) * push;
          p.vy += (mdy / md) * push;
        }

        if (reduced) {
          // static card
        } else if (t < T_ASSEMBLE || t >= T_EXPLODE) {
          p.vx += (Math.random() - 0.5) * 0.12;
          p.vy += (Math.random() - 0.5) * 0.12;
          p.vx *= t >= T_EXPLODE ? 0.95 : 0.97;
          p.vy *= t >= T_EXPLODE ? 0.95 : 0.97;
        } else {
          const local = Math.max(0, t - T_ASSEMBLE - p.delay);
          const stiff = Math.min(0.09, local / 9000);
          p.vx = (p.vx + (p.tx - p.x) * stiff) * 0.8;
          p.vy = (p.vy + (p.ty - p.y) * stiff) * 0.8;
          if (t >= T_HOLD) { p.vx += (Math.random() - 0.5) * 0.15; p.vy += (Math.random() - 0.5) * 0.15; }
        }
        p.x += p.vx;
        p.y += p.vy;
        if (t < T_EXPLODE) { // wrap drifting dust so it never leaves the stage
          if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
          if (p.y < -10) p.y = H + 10; else if (p.y > H + 10) p.y = -10;
        }

        // Ignite particles the slash has passed through.
        if (slashP > 0 && p.hot < 1) {
          const proj = ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / (len * len);
          const dist = Math.abs((by - ay) * p.x - (bx - ax) * p.y + bx * ay - by * ax) / len;
          if (proj <= slashP && dist < 22 + Math.random() * 18) p.hot = 1;
        }
        if (t < T_SLASH) p.hot *= 0.9;

        const near = Math.abs(p.x - scanX) < 14;
        const size = near ? 2.8 : 2;
        const alpha = near ? 1 : fade * (0.55 + 0.45 * (p.hot || 0.6));
        ctx.fillStyle = p.hot > 0.5 ? `rgba(${CORAL},${Math.max(alpha, 0.4)})` : `rgba(${INK},${alpha})`;
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }

      if (scanX > card.x && scanX < card.x + card.w) {
        const g = ctx.createLinearGradient(scanX - 40, 0, scanX + 4, 0);
        g.addColorStop(0, "rgba(20,20,20,0)");
        g.addColorStop(1, "rgba(20,20,20,0.10)");
        ctx.fillStyle = g;
        ctx.fillRect(scanX - 40, card.y - 6, 44, card.h + 12);
      }
      if (slashP > 0 && t < T_EXPLODE + 250) {
        ctx.strokeStyle = `rgba(${CORAL},${t < T_EXPLODE ? 1 : 1 - (t - T_EXPLODE) / 250})`;
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + (bx - ax) * slashP, ay + (by - ay) * slashP);
        ctx.stroke();
      }
    }

    function drawStatic() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = `rgba(${INK},0.9)`;
      for (const p of particles) ctx.fillRect(p.tx - 0.85, p.ty - 0.85, 1.7, 1.7);
      label.textContent = LINES[3]!.text;
    }

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => { mouse.x = mouse.y = -9999; };

    let ro: ResizeObserver | undefined;
    let io: IntersectionObserver | undefined;
    let cancelled = false;

    document.fonts.ready.then(() => {
      if (cancelled) return;
      build();
      if (reduced) { drawStatic(); return; }
      raf = requestAnimationFrame(frame);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
      let lastW = W;
      ro = new ResizeObserver(() => {
        if (Math.abs(canvas.getBoundingClientRect().width - lastW) > 8) { build(); lastW = W; }
      });
      ro.observe(canvas);
      io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
      io.observe(canvas);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className={s.particleStage}>
      <canvas ref={canvasRef} className={s.particles} aria-label="Animation: dust forms a ScopeCard, a revoke slash cuts it and it explodes" role="img" />
      <div className={s.statusLine}>
        <i className={s.statusDot} />
        <span ref={labelRef} className={s.statusText}>agent ▸ POST /api/generate-card</span>
      </div>
    </div>
  );
}
