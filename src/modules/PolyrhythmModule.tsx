// src/modules/PolyrhythmModule.tsx
import React from "react";
import { getAudioContext } from "../utils/audio";

/* ---------------- helpers ---------------- */
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function isPosIntInRange(s: string, lo: number, hi: number): s is string {
  const n = Number(s);
  return Number.isInteger(n) && n >= lo && n <= hi;
}
function isPosNumInRange(s: string, lo: number, hi: number): s is string {
  const n = Number(s);
  return Number.isFinite(n) && n >= lo && n <= hi;
}

// Regular polygon path (SVG 'd')
function polygonPath(cx: number, cy: number, r: number, sides: number, rotate = -Math.PI / 2) {
  if (sides < 2) return "";
  let d = "";
  for (let i = 0; i < sides; i++) {
    const a = rotate + (i / sides) * Math.PI * 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  d += " Z";
  return d;
}

// Vertex list for a regular polygon
function polygonVertices(cx: number, cy: number, r: number, sides: number, rotate = -Math.PI / 2) {
  const vs: { x: number; y: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotate + (i / sides) * Math.PI * 2;
    vs.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return vs;
}

// Interpolate along polygon edges given progress measured in “vertices advanced”
function pointOnPolygon(vertices: { x: number; y: number }[], progressInVertices: number) {
  const n = vertices.length;
  if (n === 0) return { x: 0, y: 0 };
  const p = ((progressInVertices % n) + n) % n; // wrap into [0,n)
  const i = Math.floor(p);
  const t = p - i;
  const a = vertices[i];
  const b = vertices[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Tiny click blip
function scheduleClick(ctx: AudioContext, when: number, freq: number, bus: GainNode) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;

  const t = when;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + 0.001);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

  osc.connect(env).connect(bus);
  osc.start(t);
  osc.stop(t + 0.055);
}

/* ---------------- module ---------------- */
export default function PolyrhythmModule() {
  // String states (so you can clear inputs)
  const [aStr, setAStr] = React.useState<string>(() => String(clamp(Number(localStorage.getItem("poly.a") ?? 5), 1, 32)));
  const [bStr, setBStr] = React.useState<string>(() => String(clamp(Number(localStorage.getItem("poly.b") ?? 7), 1, 32)));
  const [barStr, setBarStr] = React.useState<string>(() => {
    const v = Number(localStorage.getItem("poly.barSec") ?? 1.0);
    return String(clamp(Number.isFinite(v) ? v : 1.0, 0.25, 10));
  });
  const [playing, setPlaying] = React.useState(false);
  const [clicks, setClicks] = React.useState(() => (localStorage.getItem("poly.clicks") ?? "true") === "true");
  const [clickVol, setClickVol] = React.useState(() => clamp(Number(localStorage.getItem("poly.clickVol") ?? 70), 0, 100));

  // Parsed/validated values
  const aValid = isPosIntInRange(aStr, 1, 32);
  const bValid = isPosIntInRange(bStr, 1, 32);
  const barValid = isPosNumInRange(barStr, 0.25, 10);

  const aCount = aValid ? Number(aStr) : null;
  const bCount = bValid ? Number(bStr) : null;
  const barSeconds = barValid ? Number(barStr) : null;

  // Persist when valid (won’t block typing)
  React.useEffect(() => { if (aValid) try { localStorage.setItem("poly.a", aStr); } catch {} }, [aValid, aStr]);
  React.useEffect(() => { if (bValid) try { localStorage.setItem("poly.b", bStr); } catch {} }, [bValid, bStr]);
  React.useEffect(() => { if (barValid) try { localStorage.setItem("poly.barSec", barStr); } catch {} }, [barValid, barStr]);
  React.useEffect(() => { try { localStorage.setItem("poly.clicks", String(clicks)); } catch {} }, [clicks]);
  React.useEffect(() => { try { localStorage.setItem("poly.clickVol", String(clickVol)); } catch {} }, [clickVol]);

  // Stop as soon as the bar duration is being edited (or becomes invalid)
  React.useEffect(() => {
    if (!barValid && playing) setPlaying(false);
  }, [barValid, playing]);
  // Also stop immediately when the user types into bar field
  const onBarChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    if (playing) setPlaying(false);
    setBarStr(e.target.value);
  };

  // Timing & animation
  const rafRef = React.useRef<number | null>(null);
  const anchorHighResRef = React.useRef<number>(0);  // performance.now at bar start
  const anchorAudioRef = React.useRef<number>(0);    // audio ctx time at same moment
  const [progress, setProgress] = React.useState(0); // 0..1 within bar (visuals)

  // Audio scheduler
  const ctxRef = React.useRef<AudioContext | null>(null);
  const clickBusRef = React.useRef<GainNode | null>(null);
  const nextIndexARef = React.useRef<number>(0);
  const nextIndexBRef = React.useRef<number>(0);
  const schedTimerRef = React.useRef<number | null>(null);

  // Update click bus volume smoothly
  React.useEffect(() => {
    const bus = clickBusRef.current;
    if (!bus) return;
    const now = bus.context.currentTime;
    const lin = Math.pow(Math.max(0, Math.min(1, clickVol / 100)), 1.6);
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(lin, now, 0.03);
  }, [clickVol]);

  function startAudioIfNeeded() {
    if (!ctxRef.current) {
      const ctx = getAudioContext();
      ctxRef.current = ctx;
      const bus = ctx.createGain();
      bus.gain.value = Math.pow(clickVol / 100, 1.6);
      bus.connect(ctx.destination);
      clickBusRef.current = bus;
    }
  }

  function resetAnchors() {
    const nowHr = performance.now();
    startAudioIfNeeded();
    const ctx = ctxRef.current!;
    const nowAu = ctx.currentTime;
    anchorHighResRef.current = nowHr;
    anchorAudioRef.current = nowAu;
    nextIndexARef.current = 0;
    nextIndexBRef.current = 0;
  }

  function start() {
    if (playing || !aValid || !bValid || !barValid) return;
    startAudioIfNeeded();
    resetAnchors();
    setPlaying(true);
  }
  function stop() {
    if (!playing) return;
    setPlaying(false);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (schedTimerRef.current != null) clearInterval(schedTimerRef.current);
    schedTimerRef.current = null;
  }

  // Animation loop (visuals)
  React.useEffect(() => {
    if (!playing || !barValid) return;
    function loop() {
      const nowHr = performance.now();
      const t = (nowHr - anchorHighResRef.current) / 1000;
      const p = ((t % (barSeconds!)) + (barSeconds!)) % (barSeconds!);
      setProgress(p / (barSeconds!));
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [playing, barValid, barSeconds]);

  // Click scheduler loop (audio)
  React.useEffect(() => {
    if (!playing || !clicks || !aValid || !bValid || !barValid) {
      if (schedTimerRef.current != null) clearInterval(schedTimerRef.current);
      schedTimerRef.current = null;
      return;
    }
    const ctx = ctxRef.current!;
    const LOOKAHEAD_MS = 25;
    const SCHEDULE_AHEAD = 0.15;

    const tick = () => {
      const now = ctx.currentTime;
      const base = anchorAudioRef.current;
      const bus = clickBusRef.current!;
      const aStep = (barSeconds!) / (aCount!);
      const bStep = (barSeconds!) / (bCount!);

      while (true) {
        const tEvent = base + nextIndexARef.current * aStep;
        if (tEvent < now - 0.01) { nextIndexARef.current++; continue; }
        if (tEvent > now + SCHEDULE_AHEAD) break;
        const bIdxApprox = Math.round((tEvent - base) / bStep);
        const tB = base + bIdxApprox * bStep;
        const coincide = Math.abs(tB - tEvent) < 0.008;
        scheduleClick(ctx, tEvent, coincide ? 1600 : 1100, bus);
        nextIndexARef.current++;
      }
      while (true) {
        const tEvent = base + nextIndexBRef.current * bStep;
        if (tEvent < now - 0.01) { nextIndexBRef.current++; continue; }
        if (tEvent > now + SCHEDULE_AHEAD) break;
        const aIdxApprox = Math.round((tEvent - base) / aStep);
        const tA = base + aIdxApprox * aStep;
        const coincide = Math.abs(tA - tEvent) < 0.008;
        scheduleClick(ctx, tEvent, coincide ? 1200 : 700, bus);
        nextIndexBRef.current++;
      }
      // roll indices occasionally
      const maxIdx = Math.ceil((now - base + SCHEDULE_AHEAD) / Math.min(aStep, bStep)) + 2;
      const modA = Math.max(aCount!, 1);
      const modB = Math.max(bCount!, 1);
      if (nextIndexARef.current > maxIdx + modA) nextIndexARef.current = nextIndexARef.current % modA;
      if (nextIndexBRef.current > maxIdx + modB) nextIndexBRef.current = nextIndexBRef.current % modB;
    };

    schedTimerRef.current = window.setInterval(tick, LOOKAHEAD_MS);
    return () => { if (schedTimerRef.current != null) clearInterval(schedTimerRef.current); schedTimerRef.current = null; };
  }, [playing, clicks, aValid, bValid, barValid, aCount, bCount, barSeconds]);

  // Keep A/V locked if params change mid-play
  React.useEffect(() => { if (playing && aValid && bValid && barValid) resetAnchors(); /* eslint-disable-next-line */ }, [aStr, bStr, barStr]);

  /* ---------- SVG drawing (dots ON polygon) ---------- */
  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const rPath = 120; // single path radius used for BOTH polygons so dots ride exactly on the stroke

  const strokeA = "var(--accent, #3b82f6)";
  const strokeB = "var(--ok, #22c55e)";
  const dotA = "var(--accent, #3b82f6)";
  const dotB = "var(--ok, #22c55e)";
  const gridColor = "var(--border)";

  // Precompute vertices when valid
  const vertsA = React.useMemo(
    () => (aValid ? polygonVertices(cx, cy, rPath, Number(aStr)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aValid, aStr, cx, cy, rPath]
  );
  const vertsB = React.useMemo(
    () => (bValid ? polygonVertices(cx, cy, rPath, Number(bStr)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bValid, bStr, cx, cy, rPath]
  );

  const progA = aValid ? progress * Number(aStr) : 0;
  const progB = bValid ? progress * Number(bStr) : 0;

  const posA = aValid ? pointOnPolygon(vertsA, progA) : { x: cx, y: cy };
  const posB = bValid ? pointOnPolygon(vertsB, progB) : { x: cx, y: cy };

  function nearVertex(progress01: number, n: number, tol = 0.03) {
    const f = (progress01 * n) % 1;
    return Math.min(f, 1 - f) < tol;
  }
  const pulseA = aValid && nearVertex(progress, Number(aStr));
  const pulseB = bValid && nearVertex(progress, Number(bStr));

  const canRender = aValid && bValid && barValid;

  return (
    <div className="panel">
      {/* Controls (centered, inputs allow empty) */}
      <div className="centered" style={{ marginTop: 6 }}>
        <div className="row center" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="check" style={{ gap: 6 }}>
            <span>A</span>
            <input
              className="input"
              inputMode="numeric"
              value={aStr}
              onChange={(e) => setAStr(e.target.value)}
              style={{ width: 72, textAlign: "center" }}
              aria-label="A count"
              placeholder="A"
            />
          </label>
          <span className="badge">vs</span>
          <label className="check" style={{ gap: 6 }}>
            <span>B</span>
            <input
              className="input"
              inputMode="numeric"
              value={bStr}
              onChange={(e) => setBStr(e.target.value)}
              style={{ width: 72, textAlign: "center" }}
              aria-label="B count"
              placeholder="B"
            />
          </label>

          <label className="check" style={{ gap: 6 }}>
            <span>Bar (s)</span>
            <input
              className="input"
              inputMode="decimal"
              value={barStr}
              onChange={onBarChange}
              style={{ width: 86, textAlign: "center" }}
              aria-label="Bar duration (seconds)"
              placeholder="1.0"
            />
          </label>

          <button className="button" onClick={() => (playing ? stop() : start())} disabled={!canRender}>
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>

          <label className="check" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={clicks}
              onChange={(e) => setClicks(e.target.checked)}
              disabled={!canRender}
            />
            <span>Clicks</span>
          </label>

          <label className="check" style={{ gap: 6 }}>
            <span>Vol</span>
            <input
              type="range"
              min={0}
              max={100}
              value={clickVol}
              onChange={(e) => setClickVol(Number(e.target.value))}
              style={{ width: 120 }}
              aria-label="Click volume"
              disabled={!canRender}
            />
          </label>
        </div>
      </div>

      {/* Visualization */}
      <div className="centered" style={{ marginTop: 10 }}>
        {canRender ? (
          <svg
            width={360}
            height={360}
            viewBox="0 0 360 360"
            role="img"
            aria-label={`${aCount} against ${bCount} polyrhythm`}
          >
            {/* One guide ring at path radius */}
            <circle cx={cx} cy={cy} r={rPath + 16} fill="none" stroke={gridColor} strokeDasharray="2 6" />
            <circle cx={cx} cy={cy} r={rPath - 16} fill="none" stroke={gridColor} strokeDasharray="2 6" />

            {/* Polygons (same radius) */}
            <path d={polygonPath(cx, cy, rPath, aCount!)} fill="none" stroke={strokeA} strokeWidth={2} opacity={0.75} />
            <path d={polygonPath(cx, cy, rPath, bCount!)} fill="none" stroke={strokeB} strokeWidth={2} opacity={0.75} />

            {/* Vertices (helpful markers) */}
            {vertsA.map((v, i) => <circle key={`av-${i}`} cx={v.x} cy={v.y} r={3} fill={strokeA} opacity={0.7} />)}
            {vertsB.map((v, i) => <circle key={`bv-${i}`} cx={v.x} cy={v.y} r={3} fill={strokeB} opacity={0.7} />)}

            {/* Moving dots ON the polygon stroke */}
            <circle cx={posA.x} cy={posA.y} r={pulseA ? 8 : 6} fill={dotA} stroke="var(--bg)" strokeWidth={2} />
            <circle cx={posB.x} cy={posB.y} r={pulseB ? 8 : 6} fill={dotB} stroke="var(--bg)" strokeWidth={2} />

            {/* Center mark */}
            <circle cx={cx} cy={cy} r={2} fill={gridColor} />
          </svg>
        ) : (
          <p className="muted">Enter valid A, B (1–32) and Bar seconds (0.25–10) to start.</p>
        )}

        {canRender && (
          <div className="muted" style={{ marginTop: 8 }}>
            Dots travel on the polygon edges and land on each vertex on every click. Pattern loops every{" "}
            <strong>{barSeconds!.toFixed(2)}s</strong>.
          </div>
        )}
      </div>
    </div>
  );
}
