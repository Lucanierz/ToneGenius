// src/modules/ClaveModule.tsx
import React from "react";
import { getAudioContext } from "../utils/audio";
import "../styles/clave.css";

/**
 * 12-step sequencer with metronome-defined beat.
 * - BPM = metronome beats per minute (constant).
 * - Subdivision N ∈ {2,3,4} = metronome clicks every N steps.
 *   => step duration = (60 / BPM) / N
 *   => beats per bar = 12 / N
 * - Live edits apply instantly; playhead dots show current step.
 */

type Subdiv = 2 | 3 | 4;

const MIN_BPM = 20;
const MAX_BPM = 300;

// Tap tempo
const TAP_RESET_MS = 1200;
const TAP_MIN_S = 0.18;
const TAP_MAX_S = 2.5;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export default function ClaveModule() {
  // 12-step on/off pattern
  const [steps, setSteps] = React.useState<boolean[]>(() => {
    try {
      const raw = localStorage.getItem("seq12.steps");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 12) return arr.map(Boolean);
      }
    } catch {}
    // default: empty pattern
    return new Array(12).fill(false);
  });
  // ref so scheduler always uses latest pattern without restart
  const stepsRef = React.useRef<boolean[]>(steps);
  React.useEffect(() => { stepsRef.current = steps; }, [steps]);

  // Transport
  const [running, setRunning] = React.useState(false);

  // Subdivision: metronome ticks every N steps (2,3,4)
  const [everyN, setEveryN] = React.useState<Subdiv>(() => {
    const raw = Number(localStorage.getItem("seq12.N") ?? 3);
    return raw === 2 || raw === 3 || raw === 4 ? (raw as Subdiv) : 3;
  });

  // BPM = metronome speed (constant across N)
  const [bpm, setBpm] = React.useState<number>(() => {
    const s = localStorage.getItem("seq12.bpm");
    const v = s ? Number(s) : 120;
    return clamp(v, MIN_BPM, MAX_BPM);
  });
  // clearable input UX
  const [bpmInput, setBpmInput] = React.useState<string>(() =>
    String(clamp(Number(localStorage.getItem("seq12.bpm") ?? 120), MIN_BPM, MAX_BPM))
  );

  React.useEffect(() => { try { localStorage.setItem("seq12.steps", JSON.stringify(steps)); } catch {} }, [steps]);
  React.useEffect(() => { try { localStorage.setItem("seq12.N", String(everyN)); } catch {} }, [everyN]);
  React.useEffect(() => { try { localStorage.setItem("seq12.bpm", String(bpm)); } catch {} }, [bpm]);

  // ===== Timing derived from BPM and N =====
  const spStep = React.useMemo(() => (60 / bpm) / everyN, [bpm, everyN]);

  // ===== Scheduler =====
  const schedulerRef = React.useRef<number | null>(null);
  const nextStepTimeRef = React.useRef(0);
  const stepIndexRef = React.useRef(0);

  // Playhead indicator
  const [activeStep, setActiveStep] = React.useState<number>(-1);

  React.useEffect(() => {
    // Re-align cleanly on BPM/subdivision change
    if (!running) return;
    stop();
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spStep]);

  function toggleStep(i: number) {
    setSteps(prev => {
      const next = prev.slice();
      next[i] = !next[i];
      return next;
    });
  }

  /* ---------- Sounds ---------- */

  // metronome tick: only at beat starts (every N steps). Downbeat stronger (step 0).
  function metronomeSound(when: number, isDownbeat: boolean) {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = isDownbeat ? 900 : 660;
    const a = 0.002, d = 0.045;
    const lvl = isDownbeat ? 0.16 : 0.11;

    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(lvl, when + a);
    g.gain.exponentialRampToValueAtTime(0.0005, when + a + d);

    osc.connect(g).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + a + d + 0.02);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch {} };
  }

  // sequencer hit (clave-ish): short percussive click; always disconnects
  function hitSound(when: number) {
    const ctx = getAudioContext();

    // deterministic tiny ping
    const ping = ctx.createOscillator();
    ping.type = "square";
    ping.frequency.value = 2100;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 2.0;

    const g = ctx.createGain();
    const a = 0.001;  // 1ms attack
    const d = 0.04;   // 40ms decay

    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.25, when + a);
    g.gain.exponentialRampToValueAtTime(0.0005, when + d);

    ping.connect(bp).connect(g).connect(ctx.destination);

    ping.start(when);
    ping.stop(when + d + 0.02);
    ping.onended = () => { try { ping.disconnect(); bp.disconnect(); g.disconnect(); } catch {} };
  }

  /* ---------- Scheduler loop ---------- */

  function scheduleAhead() {
    const ctx = getAudioContext();
    const lookAhead = 0.12; // seconds

    while (nextStepTimeRef.current < ctx.currentTime + lookAhead) {
      const s = stepIndexRef.current % 12;
      const isDownbeat = s === 0;
      const isBeatStart = (s % everyN) === 0; // metronome only here

      // update playhead immediately for UI
      setActiveStep(s);

      if (isBeatStart) metronomeSound(nextStepTimeRef.current, isDownbeat);
      if (stepsRef.current[s]) hitSound(nextStepTimeRef.current);

      // advance to next step
      nextStepTimeRef.current += spStep;
      stepIndexRef.current = (stepIndexRef.current + 1) % 12;
    }

    schedulerRef.current = window.setTimeout(scheduleAhead, 25);
  }

  function start() {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const startAt = ctx.currentTime + 0.06;
    stepIndexRef.current = 0;       // start bar on downbeat
    nextStepTimeRef.current = startAt;
    setActiveStep(11);              // so first visible change is step 0
    scheduleAhead();
    setRunning(true);
  }

  function stop() {
    if (schedulerRef.current != null) clearTimeout(schedulerRef.current);
    schedulerRef.current = null;
    setRunning(false);
    setActiveStep(-1);
  }
  React.useEffect(() => () => stop(), []);

  /* ---------- Tap & BPM input ---------- */

  const tapsRef = React.useRef<number[]>([]);
  const lastTapRef = React.useRef<number>(0);

  function tap() {
    const now = performance.now();
    const last = lastTapRef.current;
    lastTapRef.current = now;

    if (!last || now - last > TAP_RESET_MS) {
      tapsRef.current = [];
      return;
    }
    const delta = (now - last) / 1000;
    if (delta < TAP_MIN_S || delta > TAP_MAX_S) { tapsRef.current = []; return; }

    const buf = tapsRef.current;
    const avg = buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : delta;
    const dev = Math.abs(delta - avg) / Math.max(0.001, avg);

    if (dev > 0.35) {
      const snapped = clamp(Math.round(60 / delta), MIN_BPM, MAX_BPM);
      setBpm(snapped); setBpmInput(String(snapped));
      tapsRef.current = [delta];
      return;
    }
    buf.push(delta);
    if (buf.length > 4) buf.shift();

    const weights = [0.6, 0.25, 0.1, 0.05].slice(0, buf.length);
    const wsum = weights.reduce((a,b)=>a+b,0);
    const norm = weights.map(w=>w/wsum);
    let wavg = 0;
    for (let i=0;i<buf.length;i++) wavg += buf[buf.length-1-i] * norm[i];

    const tapped = clamp(Math.round(60 / wavg), MIN_BPM, MAX_BPM);
    setBpm(tapped); setBpmInput(String(tapped));
  }

  function commitBpm() {
    const n = Number(bpmInput);
    if (!Number.isFinite(n)) { setBpmInput(String(bpm)); return; }
    const clamped = clamp(Math.round(n), MIN_BPM, MAX_BPM);
    setBpm(clamped);
    setBpmInput(String(clamped));
  }

  /* ---------- UI helpers ---------- */
  function meterLabel(n: Subdiv) {
    return n === 2 ? "6/4" : n === 3 ? "4/4 (triplet grid)" : "3/4";
  }

  return (
    <div className="panel">
      {/* Controls */}
      <div className="centered" style={{ marginBottom: 10 }}>
        <div className="row center" style={{ gap: 10, flexWrap: "wrap" }}>
          {/* Transport */}
          <button
            className="icon-btn"
            onClick={() => (running ? stop() : start())}
            title={running ? "Stop" : "Start"}
            aria-label={running ? "Stop" : "Start"}
          >
            {running ? "⏹" : "▶"}
          </button>

          {/* BPM (metronome speed; constant across subdivision) */}
          <label className="check" style={{ gap: 6 }}>
            <span>BPM</span>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={bpmInput}
              placeholder={`${bpm}`}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "" || /^[0-9]{0,3}$/.test(raw)) setBpmInput(raw);
              }}
              onBlur={commitBpm}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitBpm(); } }}
              style={{ width: 110, textAlign: "center", fontWeight: 700, fontSize: 18 }}
            />
          </label>

          <button className="button tap-big" onClick={tap} title="Tap tempo">Tap</button>

          {/* Subdivision (metronome click every N steps) */}
          <label className="check" style={{ gap: 6 }}>
            <span>Metronome</span>
            <select
              className="select"
              value={everyN}
              onChange={(e) => setEveryN(Number(e.target.value) as Subdiv)}
              title="Click every Nth step"
            >
              <option value={2}>every 2nd — {meterLabel(2)}</option>
              <option value={3}>every 3rd — {meterLabel(3)}</option>
              <option value={4}>every 4th — {meterLabel(4)}</option>
            </select>
          </label>
        </div>
      </div>

      {/* Step grid */}
      <div className="clave-grid centered" role="group" aria-label="12-step sequencer">
        {steps.map((on, i) => {
          const isBeatStart = (i % everyN) === 0; // visual guide for metronome placement
          const isDown = i === 0;
          const isActive = i === activeStep;
          return (
            <button
              key={i}
              className={`step ${on ? "on" : "off"} ${isBeatStart ? "beat" : ""} ${isDown ? "down" : ""}`}
              title={`Step ${i + 1}${on ? " (on)" : ""}`}
              onClick={() => toggleStep(i)}
              style={isActive ? { boxShadow: "inset 0 0 0 3px var(--accent)" } : undefined}
            >
              <span className="glyph" aria-hidden>{on ? "x" : "·"}</span>
            </button>
          );
        })}
      </div>

      {/* Playhead dots (under the grid) */}
      <div
        className="centered"
        style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 6, maxWidth: 680, marginLeft: "auto", marginRight: "auto" }}
      >
        {Array.from({ length: 12 }).map((_, i) => {
          const on = i === activeStep;
          return (
            <span
              key={`dot-${i}`}
              aria-hidden
              style={{
                height: 10,
                borderRadius: 999,
                background: on ? "var(--accent)" : "var(--border)",
                transition: "background 60ms linear",
              }}
            />
          );
        })}
      </div>

      <p className="muted centered" style={{ marginTop: 8 }}>
        BPM sets beat speed; subdivision sets beat every Nth step. Pattern edits apply instantly; the 12 steps loop deterministically.
      </p>
    </div>
  );
}
