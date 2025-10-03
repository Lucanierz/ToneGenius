// src/modules/PolyrhythmModule.tsx
import React from "react";
import { getAudioContext } from "../utils/audio";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
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

// Tiny blip sound (noises-free envelope)
function scheduleClick(ctx: AudioContext, when: number, freq: number, gainNode: GainNode) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;

  const t = when;
  const a = 0.001; // 1ms attack
  const d = 0.045; // 45ms total
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + a);
  env.gain.exponentialRampToValueAtTime(0.001, t + d);

  osc.connect(env).connect(gainNode);
  osc.start(t);
  osc.stop(t + d + 0.01);
}

export default function PolyrhythmModule() {
  // UI state (persist)
  const [aCount, setACount] = React.useState(() => clamp(Number(localStorage.getItem("poly.a") ?? 5), 1, 32));
  const [bCount, setBCount] = React.useState(() => clamp(Number(localStorage.getItem("poly.b") ?? 7), 1, 32));
  const [bpm, setBpm] = React.useState(() => clamp(Number(localStorage.getItem("poly.bpm") ?? 90), 20, 400));
  const [playing, setPlaying] = React.useState(false);
  const [clicks, setClicks] = React.useState(() => (localStorage.getItem("poly.clicks") ?? "true") === "true");
  const [clickVol, setClickVol] = React.useState(() => clamp(Number(localStorage.getItem("poly.clickVol") ?? 70), 0, 100));

  React.useEffect(() => { try { localStorage.setItem("poly.a", String(aCount)); } catch {} }, [aCount]);
  React.useEffect(() => { try { localStorage.setItem("poly.b", String(bCount)); } catch {} }, [bCount]);
  React.useEffect(() => { try { localStorage.setItem("poly.bpm", String(bpm)); } catch {} }, [bpm]);
  React.useEffect(() => { try { localStorage.setItem("poly.clicks", String(clicks)); } catch {} }, [clicks]);
  React.useEffect(() => { try { localStorage.setItem("poly.clickVol", String(clickVol)); } catch {} }, [clickVol]);

  // Timing & animation
  const rafRef = React.useRef<number | null>(null);
  const anchorHighResRef = React.useRef<number>(0);     // performance.now() at bar start
  const anchorAudioRef = React.useRef<number>(0);       // audioContext.currentTime at same moment
  const [progress, setProgress] = React.useState(0);    // 0..1 progress within the bar (drives SVG)

  // Audio scheduler
  const ctxRef = React.useRef<AudioContext | null>(null);
  const clickBusRef = React.useRef<GainNode | null>(null);
  const nextIndexARef = React.useRef<number>(0);
  const nextIndexBRef = React.useRef<number>(0);
  const schedTimerRef = React.useRef<number | null>(null);

  // Derived bar duration (one bar completes when both patterns realign at 0)
  // We keep visuals to a 1-bar cycle whose length is one "second per beat" (60/bpm).
  // Each pattern advances 'count' vertices per bar.
  const barSeconds = React.useMemo(() => 60 / bpm, [bpm]);

  // Update click bus volume smoothly
  React.useEffect(() => {
    const bus = clickBusRef.current;
    if (!bus) return;
    const now = bus.context.currentTime;
    const lin = Math.pow(Math.max(0, Math.min(1, clickVol / 100)), 1.6); // gentle taper
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
    if (playing) return;
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
    if (!playing) return;
    function loop() {
      const nowHr = performance.now();
      const t = (nowHr - anchorHighResRef.current) / 1000;
      const p = ((t % barSeconds) + barSeconds) % barSeconds;
      setProgress(p / barSeconds);
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [playing, barSeconds]);

  // Click scheduler loop (audio)
  React.useEffect(() => {
    if (!playing || !clicks) {
      if (schedTimerRef.current != null) clearInterval(schedTimerRef.current);
      schedTimerRef.current = null;
      return;
    }
    const ctx = ctxRef.current!;
    const LOOKAHEAD_MS = 25;     // scheduler wakeup
    const SCHEDULE_AHEAD = 0.15; // schedule this much into the future

    const tick = () => {
      const now = ctx.currentTime;
      const base = anchorAudioRef.current;
      const bus = clickBusRef.current!;
      const aStep = barSeconds / aCount;
      const bStep = barSeconds / bCount;

      // schedule A pattern
      while (true) {
        const tEvent = base + nextIndexARef.current * aStep;
        if (tEvent < now - 0.01) { // missed by tempo change; catch up
          nextIndexARef.current++;
          continue;
        }
        if (tEvent > now + SCHEDULE_AHEAD) break;

        // Will this event coincide with a B event? (accent)
        const bIdxApprox = Math.round((tEvent - base) / bStep);
        const tB = base + bIdxApprox * bStep;
        const coincide = Math.abs(tB - tEvent) < 0.008; // 8ms window

        scheduleClick(ctx, tEvent, coincide ? 1600 : 1100, bus);
        nextIndexARef.current++;
      }

      // schedule B pattern
      while (true) {
        const tEvent = base + nextIndexBRef.current * bStep;
        if (tEvent < now - 0.01) {
          nextIndexBRef.current++;
          continue;
        }
        if (tEvent > now + SCHEDULE_AHEAD) break;

        const aIdxApprox = Math.round((tEvent - base) / aStep);
        const tA = base + aIdxApprox * aStep;
        const coincide = Math.abs(tA - tEvent) < 0.008;

        scheduleClick(ctx, tEvent, coincide ? 1200 : 700, bus);
        nextIndexBRef.current++;
      }

      // rollover indices every bar to keep numbers small
      const maxIdx = Math.ceil((now - base + SCHEDULE_AHEAD) / Math.min(aStep, bStep)) + 2;
      const modA = Math.max(aCount, 1);
      const modB = Math.max(bCount, 1);
      if (nextIndexARef.current > maxIdx + modA) nextIndexARef.current = nextIndexARef.current % modA;
      if (nextIndexBRef.current > maxIdx + modB) nextIndexBRef.current = nextIndexBRef.current % modB;
    };

    schedTimerRef.current = window.setInterval(tick, LOOKAHEAD_MS);
    return () => { if (schedTimerRef.current != null) clearInterval(schedTimerRef.current); schedTimerRef.current = null; };
  }, [playing, clicks, aCount, bCount, barSeconds]);

  // If BPM changes while playing, reset anchors to keep A/V in lock
  React.useEffect(() => {
    if (playing) resetAnchors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barSeconds, aCount, bCount]);

  // --- SVG drawing ---
  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const rPoly = 140;
  const rDotA = 112;
  const rDotB = 88;

  const strokeA = "var(--accent, #3b82f6)";
  const strokeB = "var(--ok, #22c55e)";
  const dotA = "var(--accent, #3b82f6)";
  const dotB = "var(--ok, #22c55e)";
  const gridColor = "var(--border)";

  // Angles for moving dots
  const angA = -Math.PI / 2 + progress * aCount * Math.PI * 2;
  const angB = -Math.PI / 2 + progress * bCount * Math.PI * 2;
  const dotAX = cx + rDotA * Math.cos(angA);
  const dotAY = cy + rDotA * Math.sin(angA);
  const dotBX = cx + rDotB * Math.cos(angB);
  const dotBY = cy + rDotB * Math.sin(angB);

  function vertices(n: number, radius: number) {
    const vs: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      vs.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
    }
    return vs;
  }
  function nearVertex(p: number, n: number, tol = 0.03) {
    const f = (p * n) % 1;
    return Math.min(f, 1 - f) < tol;
  }
  const pulseA = nearVertex(progress, aCount);
  const pulseB = nearVertex(progress, bCount);

  return (
    <div className="panel">
      {/* Controls (centered in body) */}
      <div className="centered" style={{ marginTop: 6 }}>
        <div className="row center" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="check" style={{ gap: 6 }}>
            <span>A</span>
            <input
              className="input"
              inputMode="numeric"
              value={aCount}
              onChange={(e) => setACount(clamp(Number(e.target.value || "0"), 1, 32))}
              style={{ width: 72, textAlign: "center" }}
              aria-label="A count"
            />
          </label>
          <span className="badge">vs</span>
          <label className="check" style={{ gap: 6 }}>
            <span>B</span>
            <input
              className="input"
              inputMode="numeric"
              value={bCount}
              onChange={(e) => setBCount(clamp(Number(e.target.value || "0"), 1, 32))}
              style={{ width: 72, textAlign: "center" }}
              aria-label="B count"
            />
          </label>
          <label className="check" style={{ gap: 6 }}>
            <span>BPM</span>
            <input
              className="input"
              inputMode="numeric"
              value={bpm}
              onChange={(e) => setBpm(clamp(Number(e.target.value || "0"), 20, 400))}
              style={{ width: 86, textAlign: "center" }}
              aria-label="Tempo (BPM)"
            />
          </label>

          <button className="button" onClick={() => (playing ? stop() : start())}>
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>

          <label className="check" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={clicks}
              onChange={(e) => setClicks(e.target.checked)}
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
            />
          </label>
        </div>
      </div>

      {/* Visualization */}
      <div className="centered" style={{ marginTop: 10 }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${aCount} against ${bCount} polyrhythm`}
        >
          {/* guide rings */}
          <circle cx={cx} cy={cy} r={rDotB - 14} fill="none" stroke={gridColor} strokeDasharray="2 6" />
          <circle cx={cx} cy={cy} r={rDotA + 14} fill="none" stroke={gridColor} strokeDasharray="2 6" />

          {/* A polygon + vertices */}
          <path d={polygonPath(cx, cy, rPoly, aCount)} fill="none" stroke={strokeA} strokeWidth={2} opacity={0.65} />
          {vertices(aCount, rDotA).map((v, i) => (
            <circle key={`av-${i}`} cx={v.x} cy={v.y} r={3} fill={strokeA} opacity={0.6} />
          ))}

          {/* B polygon + vertices */}
          <path d={polygonPath(cx, cy, rPoly, bCount)} fill="none" stroke={strokeB} strokeWidth={2} opacity={0.65} />
          {vertices(bCount, rDotB).map((v, i) => (
            <circle key={`bv-${i}`} cx={v.x} cy={v.y} r={3} fill={strokeB} opacity={0.6} />
          ))}

          {/* moving dots */}
          <circle cx={dotAX} cy={dotAY} r={pulseA ? 8 : 6} fill={dotA} stroke="var(--bg)" strokeWidth={2} />
          <circle cx={dotBX} cy={dotBY} r={pulseB ? 8 : 6} fill={dotB} stroke="var(--bg)" strokeWidth={2} />

          {/* center */}
          <circle cx={cx} cy={cy} r={2} fill={gridColor} />
        </svg>

        <div className="muted" style={{ marginTop: 8 }}>
          Dots rotate at speeds proportional to counts and “pulse” on each vertex/beat. Clicks accent when both hit together.
        </div>
      </div>
    </div>
  );
}
