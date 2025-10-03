import React from "react";
import { getAudioContext } from "../utils/audio";
import "../styles/clave.css";

/**
 * 12-step clave sequencer with internal metronome.
 * - Click steps to toggle hits: shown as “x” (on) or “·” (off)
 * - Tempo controls (clearable input + play/stop + tap)
 * - Subdivision controls (grouping of the 12 pulses) — drives the metronome feel:
 *     2 → 6/8 feel  (6 beats per bar, dotted-quarter vibe)
 *     3 → 4/4 feel  (4 beats per bar, quarter-note vibe)
 *     4 → 3/4 feel  (3 beats per bar)
 *     6 → 2/4 feel  (2 beats per bar)
 *
 * Tempo BPM applies to the "beat"; each beat = `group` pulses; there are 12/group beats per bar.
 */

type Grouping = 2 | 3 | 4 | 6;

const MIN_BPM = 30;
const MAX_BPM = 300;

// Tap-tempo
const TAP_RESET_MS = 1200;
const TAP_MIN_S = 0.18;
const TAP_MAX_S = 2.5;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

// A couple of useful presets (you can add more)
const PRESETS: Record<string, boolean[]> = {
  "Son (3-2)": [true,false,false,true,false,false,false,true,false,true,false,false],
  "Rumba (3-2)": [true,false,false,true,false,false,false,true,false,false,true,false],
  "Bossa (simpl.)": [true,false,false,false,true,false,false,true,false,false,true,false],
  "All 12": new Array(12).fill(true),
  "Empty": new Array(12).fill(false),
};

export default function ClaveModule() {
  // Pattern state (12 pulses)
  const [steps, setSteps] = React.useState<boolean[]>(() => {
    try {
      const raw = localStorage.getItem("clave.steps");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 12) return parsed.map(Boolean);
      }
    } catch {}
    return PRESETS["Son (3-2)"];
  });

  // Transport/metronome state
  const [running, setRunning] = React.useState(false);
  const [group, setGroup] = React.useState<Grouping>(() => {
    const raw = Number(localStorage.getItem("clave.group") ?? 3);
    return (raw === 2 || raw === 3 || raw === 4 || raw === 6) ? raw : 3;
  });

  const [bpm, setBpm] = React.useState<number>(() => {
    const s = localStorage.getItem("clave.bpm");
    const v = s ? Number(s) : 96;
    return clamp(v, MIN_BPM, MAX_BPM);
  });
  // Clearable input UX (like your metronome)
  const [bpmInput, setBpmInput] = React.useState<string>(() => String(
    clamp(Number(localStorage.getItem("clave.bpm") ?? 96), MIN_BPM, MAX_BPM)
  ));

  React.useEffect(() => { try { localStorage.setItem("clave.steps", JSON.stringify(steps)); } catch {} }, [steps]);
  React.useEffect(() => { try { localStorage.setItem("clave.group", String(group)); } catch {} }, [group]);
  React.useEffect(() => { try { localStorage.setItem("clave.bpm", String(bpm)); } catch {} }, [bpm]);

  // Scheduler
  const schedulerRef = React.useRef<number | null>(null);
  const nextPulseTimeRef = React.useRef(0);
  const pulseIndexRef = React.useRef(0);

  // Tap-tempo
  const lastTapRef = React.useRef<number>(0);
  const tapsRef = React.useRef<number[]>([]);

  // Derived timing
  const beatsPerBar = 12 / group;      // e.g., group=3 ⇒ 4 beats in a 12-pulse bar
  const spb = 60 / bpm;                 // seconds per beat
  const spp = spb / group;              // seconds per pulse (12 pulses per bar)

  // If running and timing changes, re-align to bar start cleanly
  React.useEffect(() => {
    if (!running) return;
    stop();
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spp, group]);

  function toggleStep(i: number) {
    setSteps(prev => {
      const next = prev.slice();
      next[i] = !next[i];
      return next;
    });
  }

  // Audio: short ticks (metronome) + sharper clave hit
  function clickSound(when: number, down: boolean, mid: boolean) {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // downbeat (pulse 0) a bit brighter, beat ticks medium, others quiet if needed
    let f = down ? 1400 : (mid ? 1000 : 800);
    let level = down ? 0.22 : (mid ? 0.17 : 0.12);

    osc.type = "square";
    osc.frequency.value = f;

    const a = 0.002; // 2ms attack
    const d = 0.05;  // 50ms decay
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + a);
    gain.gain.exponentialRampToValueAtTime(0.0006, when + a + d);

    osc.connect(gain).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + a + d + 0.02);
    osc.onended = () => { try { osc.disconnect(); } catch {}; try { gain.disconnect(); } catch {}; };
  }

  function claveSound(when: number) {
    const ctx = getAudioContext();
    // simple bright "clave": short filtered noise + ping
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, 4410, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 400);
    noise.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3000;
    bp.Q.value = 2.5;

    const ping = ctx.createOscillator();
    ping.type = "square";
    ping.frequency.value = 2200;

    const gainN = ctx.createGain();
    const gainP = ctx.createGain();
    const mix = ctx.createGain();

    gainN.gain.setValueAtTime(0, when);
    gainN.gain.linearRampToValueAtTime(0.35, when + 0.002);
    gainN.gain.exponentialRampToValueAtTime(0.0005, when + 0.05);

    gainP.gain.setValueAtTime(0, when);
    gainP.gain.linearRampToValueAtTime(0.18, when + 0.002);
    gainP.gain.exponentialRampToValueAtTime(0.0005, when + 0.04);

    noise.connect(bp).connect(gainN).connect(mix);
    ping.connect(gainP).connect(mix);
    mix.connect(ctx.destination);

    noise.start(when);
    ping.start(when);
    noise.stop(when + 0.06);
    ping.stop(when + 0.06);

    const cleanup = () => {
      try { noise.disconnect(); ping.disconnect(); bp.disconnect(); gainN.disconnect(); gainP.disconnect(); mix.disconnect(); } catch {}
    };
    setTimeout(cleanup, 80);
  }

  function scheduleAhead() {
    const ctx = getAudioContext();
    const lookAhead = 0.12; // seconds

    while (nextPulseTimeRef.current < ctx.currentTime + lookAhead) {
      const p = pulseIndexRef.current % 12;
      const beatIndex = Math.floor(p / group);          // 0..beatsPerBar-1
      const isDownbeat = p === 0;
      const isBeatStart = (p % group) === 0;

      // Metronome tick (subdivision leader)
      clickSound(nextPulseTimeRef.current, isDownbeat, isBeatStart);

      // Clave hit on active steps
      if (steps[p]) {
        claveSound(nextPulseTimeRef.current);
      }

      // visual step active state can be derived from pulseIndexRef if you want flashing later

      // advance
      nextPulseTimeRef.current += spp;
      pulseIndexRef.current = (pulseIndexRef.current + 1) % 12;
    }

    schedulerRef.current = window.setTimeout(scheduleAhead, 25);
  }

  function start() {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const startAt = ctx.currentTime + 0.06;
    pulseIndexRef.current = 0;
    nextPulseTimeRef.current = startAt;
    scheduleAhead();
    setRunning(true);
  }

  function stop() {
    if (schedulerRef.current != null) clearTimeout(schedulerRef.current);
    schedulerRef.current = null;
    setRunning(false);
  }
  React.useEffect(() => () => stop(), []);

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

    // Weighted average but snap on large change
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

  // UI helpers
  function groupLabel(g: Grouping): string {
    switch (g) {
      case 2: return "6/8 feel";
      case 3: return "4/4 feel";
      case 4: return "3/4 feel";
      case 6: return "2/4 feel";
      default: return `${12/g}/?`;
    }
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

          {/* Tempo */}
          <label className="check" style={{ gap: 6 }}>
            <span>Tempo</span>
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

          {/* Grouping (subdivision) */}
          <label className="check" style={{ gap: 6 }}>
            <span>Subdivision</span>
            <select
              className="select"
              value={group}
              onChange={(e) => setGroup(Number(e.target.value) as Grouping)}
            >
              <option value={2}>2 — {groupLabel(2)}</option>
              <option value={3}>3 — {groupLabel(3)}</option>
              <option value={4}>4 — {groupLabel(4)}</option>
              <option value={6}>6 — {groupLabel(6)}</option>
            </select>
          </label>
        </div>
      </div>

      {/* Step grid */}
      <div className="clave-grid centered" role="group" aria-label="12-step clave">
        {steps.map((on, i) => {
          const isBeatStart = (i % group) === 0;
          const isDown = i === 0;
          return (
            <button
              key={i}
              className={`step ${on ? "on" : "off"} ${isBeatStart ? "beat" : ""} ${isDown ? "down" : ""}`}
              title={`Step ${i + 1}${on ? " (on)" : ""}`}
              onClick={() => toggleStep(i)}
            >
              <span className="glyph" aria-hidden>{on ? "x" : "·"}</span>
            </button>
          );
        })}
      </div>

      {/* Presets */}
      <div className="centered" style={{ marginTop: 10 }}>
        <div className="row center" style={{ flexWrap: "wrap", gap: 8 }}>
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              className="chip-btn"
              title={`Load ${name}`}
              onClick={() => setSteps(PRESETS[name].slice())}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <p className="muted centered" style={{ marginTop: 8 }}>
        12 pulses per bar. Subdivision sets how pulses group into beats (and how the metronome clicks).
      </p>
    </div>
  );
}
