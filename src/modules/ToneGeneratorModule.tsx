// src/modules/ToneGeneratorModule.tsx
import React from "react";
import { getAudioContext, midiToFreq } from "../utils/audio";
import { PC_TO_NAME } from "../utils/music";

type Mode = "note" | "freq";
type Wave = OscillatorType;

const WAVES: Wave[] = ["sine", "triangle", "square", "sawtooth"];

// Build stable note options from PC_TO_NAME (0..11)
const NOTE_OPTIONS = Object.entries(PC_TO_NAME as Record<number, string>)
  .map(([pc, name]) => ({ pc: Number(pc), name }))
  .sort((a, b) => a.pc - b.pc);

// Map 0..100% -> dB (roughly -48 dB to 0 dB, with gentle curve near 0)
function percentToDb(pct: number) {
  const p = Math.max(0, Math.min(100, pct)) / 100;
  if (p <= 0) return -120; // effectively silent
  const eased = Math.pow(p, 0.7); // audio-ish taper
  return -48 + 48 * eased;
}
function dbToLinear(db: number) {
  return Math.pow(10, db / 20);
}

export default function ToneGeneratorModule() {
  // UI state (persisted)
  const [mode, setMode] = React.useState<Mode>(() => (localStorage.getItem("tone.mode") as Mode) || "note");
  const [wave, setWave] = React.useState<Wave>(() => (localStorage.getItem("tone.wave") as Wave) || "sine");

  // Note mode
  const [pc, setPc] = React.useState<number>(() => Number(localStorage.getItem("tone.pc") ?? 9)); // A by default
  const [oct, setOct] = React.useState<number>(() => Number(localStorage.getItem("tone.oct") ?? 4));

  // Frequency mode
  const [hzInput, setHzInput] = React.useState<string>(() => localStorage.getItem("tone.hz") ?? "440");

  // Transport
  const [playing, setPlaying] = React.useState(false);

  // Volume (percent, 0..100) — default 70%
  const [volumePct, setVolumePct] = React.useState<number>(() => {
    const v = Number(localStorage.getItem("tone.volPct") ?? 70);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 70;
  });

  React.useEffect(() => { try { localStorage.setItem("tone.mode", mode); } catch {} }, [mode]);
  React.useEffect(() => { try { localStorage.setItem("tone.wave", wave); } catch {} }, [wave]);
  React.useEffect(() => { try { localStorage.setItem("tone.pc", String(pc)); } catch {} }, [pc]);
  React.useEffect(() => { try { localStorage.setItem("tone.oct", String(oct)); } catch {} }, [oct]);
  React.useEffect(() => { try { localStorage.setItem("tone.hz", hzInput); } catch {} }, [hzInput]);
  React.useEffect(() => { try { localStorage.setItem("tone.volPct", String(volumePct)); } catch {} }, [volumePct]);

  // Audio graph refs
  const oscRef = React.useRef<OscillatorNode | null>(null);
  const gainRef = React.useRef<GainNode | null>(null);

  // Volume smoothing (zipper-noise fix)
  const volRafRef = React.useRef<number | null>(null);
  const desiredVolPctRef = React.useRef<number>(volumePct);

  // Envelope / smoothing constants
  const ATTACK_MS = 18;          // quick fade-in
  const RELEASE_MS = 70;         // gentle fade-out
  const VOL_TC = 0.035;          // setTargetAtTime time constant (seconds) for volume slew
  const FREQ_RAMP_S = 0.05;      // small freq ramp

  // Compute target frequency
  const targetHz = React.useMemo(() => {
    if (mode === "note") {
      const midi = (oct + 1) * 12 + pc; // C4=60
      return midiToFreq(midi);
    }
    const f = Number(hzInput);
    if (!isFinite(f) || f <= 0) return 0;
    // clamp to sane range
    return Math.max(20, Math.min(20000, f));
  }, [mode, pc, oct, hzInput]);

  function ensureGraph() {
    if (oscRef.current && gainRef.current) return;
    const ctx = getAudioContext();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = wave;
    osc.frequency.value = targetHz || 440;

    // Start silent and attack to target (prevents click)
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);

    osc.connect(gain).connect(ctx.destination);
    osc.start();

    // Apply attack towards the current desired volume
    const targetLin = dbToLinear(percentToDb(desiredVolPctRef.current));
    gain.gain.setTargetAtTime(targetLin, now, ATTACK_MS / 1000);

    oscRef.current = osc;
    gainRef.current = gain;
  }

  function stopGraph() {
    const osc = oscRef.current;
    const gain = gainRef.current;
    oscRef.current = null;
    gainRef.current = null;
    try {
      if (gain && osc) {
        const now = gain.context.currentTime;
        gain.gain.setTargetAtTime(0, now, RELEASE_MS / 1000);
        // stop a bit after release completes
        osc.stop(now + RELEASE_MS / 1000 + 0.03);
        setTimeout(() => {
          try { osc.disconnect(); } catch {}
          try { gain.disconnect(); } catch {}
        }, RELEASE_MS + 60);
        return;
      }
    } catch {}
    try { osc?.stop(); } catch {}
    try { osc?.disconnect(); } catch {}
    try { gain?.disconnect(); } catch {}
  }

  // Start/stop
  React.useEffect(() => {
    if (playing) ensureGraph();
    else stopGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Live updates: wave
  React.useEffect(() => {
    const osc = oscRef.current;
    if (!osc) return;
    try { osc.type = wave; } catch {}
  }, [wave]);

  // Live updates: frequency
  React.useEffect(() => {
    const osc = oscRef.current;
    if (!osc) return;
    const f = targetHz || 0;
    if (f > 0) {
      const now = osc.context.currentTime;
      try {
        osc.frequency.cancelScheduledValues(now);
        if (osc.frequency.value <= 0) osc.frequency.setValueAtTime(f, now);
        else osc.frequency.exponentialRampToValueAtTime(f, now + FREQ_RAMP_S);
      } catch {
        osc.frequency.value = f;
      }
    }
  }, [targetHz]);

  // Throttled, smoothed volume automation to avoid zipper noise
  React.useEffect(() => {
    desiredVolPctRef.current = volumePct;

    // only run loop while playing
    if (!playing || !gainRef.current) return;

    function tick() {
      const gain = gainRef.current!;
      const ctx = gain.context;
      const now = ctx.currentTime;
      const lin = dbToLinear(percentToDb(desiredVolPctRef.current));
      try {
        // cancel and slew towards new target smoothly
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(lin, now, VOL_TC);
      } catch {
        gain.gain.value = lin;
      }
      volRafRef.current = requestAnimationFrame(tick);
    }

    volRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (volRafRef.current != null) cancelAnimationFrame(volRafRef.current);
      volRafRef.current = null;
    };
  }, [volumePct, playing]);

  // Stop audio when unmounting
  React.useEffect(() => stopGraph, []);

  function togglePlay() {
    setPlaying((p) => !p);
  }

  return (
    <div className="panel">
      {/* Top controls: mode + wave */}
      <div className="centered" style={{ marginTop: 6 }}>
        <div className="row center" style={{ gap: 10, flexWrap: "wrap" }}>
          {/* Mode toggle */}
          <div className="row" role="tablist" aria-label="Mode" style={{ gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`chip-btn ${mode === "note" ? "active" : ""}`}
              aria-pressed={mode === "note"}
              onClick={() => setMode("note")}
            >
              Note
            </button>
            <button
              type="button"
              className={`chip-btn ${mode === "freq" ? "active" : ""}`}
              aria-pressed={mode === "freq"}
              onClick={() => setMode("freq")}
            >
              Frequency
            </button>
          </div>

          {/* Wave select */}
          <label className="check" style={{ gap: 8 }}>
            <span>Wave</span>
            <select className="select" value={wave} onChange={(e) => setWave(e.target.value as Wave)}>
              {WAVES.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Mode-specific controls */}
      {mode === "note" ? (
        <div className="centered" style={{ marginTop: 12 }}>
          <div className="row center" style={{ gap: 12, flexWrap: "wrap" }}>
            <label className="check" style={{ gap: 8 }}>
              <span>Note</span>
              <select className="select" value={pc} onChange={(e) => setPc(Number(e.target.value))}>
                {NOTE_OPTIONS.map(({ pc, name }) => (
                  <option key={pc} value={pc}>{name}</option>
                ))}
              </select>
            </label>

            <label className="check" style={{ gap: 8 }}>
              <span>Octave</span>
              <select className="select" value={oct} onChange={(e) => setOct(Number(e.target.value))}>
                {[1,2,3,4,5,6,7].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>

            <span className="badge">≈ {Math.round(targetHz)} Hz</span>
          </div>
        </div>
      ) : (
        <div className="centered" style={{ marginTop: 12 }}>
          <div className="row center" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="check" style={{ gap: 8 }}>
              <span>Frequency (Hz)</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="e.g., 440"
                value={hzInput}
                onChange={(e) => setHzInput(e.target.value)}
                style={{ width: 140, textAlign: "center" }}
              />
            </label>
            <span className="badge">
              {targetHz > 0 ? `Clamped: ${Math.round(targetHz)} Hz` : "Enter a positive number"}
            </span>
          </div>
        </div>
      )}

      {/* Volume */}
      <div className="centered" style={{ marginTop: 14 }}>
        <div className="row center" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="check" style={{ gap: 8 }}>
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volumePct}
              onChange={(e) => setVolumePct(Number(e.target.value))}
              style={{ width: 220 }}
              aria-label="Volume"
            />
          </label>
          <span className="badge">{volumePct}%</span>
        </div>
      </div>

      {/* Transport */}
      <div className="centered" style={{ marginTop: 16 }}>
        <button className="button" onClick={togglePlay} aria-pressed={playing}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
      </div>
    </div>
  );
}
