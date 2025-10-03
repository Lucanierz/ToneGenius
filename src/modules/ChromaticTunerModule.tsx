// src/modules/ChromaticTunerModule.tsx
import React from "react";
import Tuner from "../components/Tuner";
import { startMicAnalyser, detectPitchHzYIN } from "../utils/audio";

export default function ChromaticTunerModule() {
  const [listening, setListening] = React.useState<boolean>(() => (localStorage.getItem("tuner.listen") ?? "true") === "true");
  const [hz, setHz] = React.useState<number | null>(null);

  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const cleanupRef = React.useRef<() => void>(() => {});
  const rafRef = React.useRef<number | null>(null);

  // smoothing state
  const lastTsRef = React.useRef<number>(0);
  const smoothHzRef = React.useRef<number | null>(null);
  const lastReportRef = React.useRef<number>(0);

  React.useEffect(() => { localStorage.setItem("tuner.listen", String(listening)); }, [listening]);

  React.useEffect(() => {
    if (!listening) { stop(); setHz(null); return; }
    start().catch(() => setListening(false));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  async function start() {
    const { analyser, cleanup } = await startMicAnalyser({
      fftSize: 8192,
      filtering: true,
      hpHz: 45,
      lpHz: 1200,
      notch50: true,
      notch60: false,
    });
    analyserRef.current = analyser;
    cleanupRef.current = cleanup;
    lastTsRef.current = performance.now();
    lastReportRef.current = 0;
    smoothHzRef.current = null;
    tick();
  }

  function stop() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { cleanupRef.current(); } catch {}
    analyserRef.current = null;
  }

  function tick() {
    const an = analyserRef.current;
    if (!an) return;

    const now = performance.now();
    const dt = Math.min(120, Math.max(0, now - (lastTsRef.current || now)));
    lastTsRef.current = now;

    const raw = detectPitchHzYIN(an, 30, 900, 0.12);

    // adaptive smoothing by pitch (calmer for bass)
    if (raw && isFinite(raw)) {
      const baseTau = 180; // ms
      const extra = raw < 130 ? 200 : raw < 200 ? 120 : 40;
      const tau = baseTau + extra;
      if (smoothHzRef.current == null) smoothHzRef.current = raw;
      else {
        const k = 1 - Math.exp(-dt / tau);
        smoothHzRef.current = smoothHzRef.current + (raw - smoothHzRef.current) * k;
      }
    } else {
      // gentle decay to null when no pitch
      if (smoothHzRef.current != null) {
        const k = 1 - Math.exp(-dt / 250);
        smoothHzRef.current = smoothHzRef.current + (0 - smoothHzRef.current) * k;
        if (Math.abs(smoothHzRef.current) < 1e-3) smoothHzRef.current = null;
      }
    }

    // throttle UI updates
    if (now - lastReportRef.current >= 60) {
      lastReportRef.current = now;
      setHz(smoothHzRef.current ?? null);
    }

    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Chromatic Tuner</div>
        <label className="check">
          <input
            type="checkbox"
            checked={listening}
            onChange={(e) => setListening(e.target.checked)}
          />
          <span>Listen</span>
        </label>
      </div>

      <div className="row center">
        <Tuner hz={hz} />
      </div>

      <p className="muted" style={{ textAlign: "center" }}>
        The tuner shows how close the incoming sound is to the nearest equal-tempered pitch.
      </p>
    </div>
  );
}
