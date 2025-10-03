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

  React.useEffect(() => { try { localStorage.setItem("tone.mode", mode); } catch {} }, [mode]);
  React.useEffect(() => { try { localStorage.setItem("tone.wave", wave); } catch {} }, [wave]);
  React.useEffect(() => { try { localStorage.setItem("tone.pc", String(pc)); } catch {} }, [pc]);
  React.useEffect(() => { try { localStorage.setItem("tone.oct", String(oct)); } catch {} }, [oct]);
  React.useEffect(() => { try { localStorage.setItem("tone.hz", hzInput); } catch {} }, [hzInput]);

  // Audio graph refs
  const oscRef = React.useRef<OscillatorNode | null>(null);
  const gainRef = React.useRef<GainNode | null>(null);

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

    // modest level
    gain.gain.value = dbToLinear(-8);

    osc.connect(gain).connect(ctx.destination);
    osc.start();

    oscRef.current = osc;
    gainRef.current = gain;
  }

  function stopGraph() {
    const osc = oscRef.current;
    const gain = gainRef.current;
    oscRef.current = null;
    gainRef.current = null;
    try { osc?.stop(); } catch {}
    try { osc?.disconnect(); } catch {}
    try { gain?.disconnect(); } catch {}
  }

  // Start/stop
  React.useEffect(() => {
    if (playing) {
      ensureGraph();
    } else {
      stopGraph();
    }
    // cleanup on unmount
    return () => {};
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
        // smooth small ramp
        if (osc.frequency.value <= 0) {
          osc.frequency.value = f;
        } else {
          osc.frequency.exponentialRampToValueAtTime(f, now + 0.05);
        }
      } catch {
        osc.frequency.value = f;
      }
    }
  }, [targetHz]);

  // Stop audio when unmounting
  React.useEffect(() => stopGraph, []);

  function togglePlay() {
    setPlaying((p) => !p);
  }

  return (
    <div className="panel">
      {/* Simple inline header for this module (since your app renders a tile bar already) */}
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

      {/* Controls */}
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

      {/* Transport */}
      <div className="centered" style={{ marginTop: 16 }}>
        <button className="button" onClick={togglePlay} aria-pressed={playing}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
      </div>
    </div>
  );
}

/* ---------- utils ---------- */
function dbToLinear(db: number) {
  return Math.pow(10, db / 20);
}
