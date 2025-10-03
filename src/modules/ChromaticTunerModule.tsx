// src/modules/ChromaticTunerModule.tsx
import React from "react";
import Tuner from "../components/Tuner";
import { startMicAnalyser, detectPitchHzYIN } from "../utils/audio";

/* One-Euro Filter (adaptive low-pass)
   https://cristal.univ-lille.fr/~casiez/1euro/ */
class OneEuro {
  private freq: number;     // nominal update frequency (Hz)
  private minCut: number;   // base cutoff (Hz)
  private beta: number;     // speed coefficient
  private dcut: number;     // cutoff for derivative
  private xPrev: number | null = null;
  private dxPrev: number | null = null;

  constructor(freq = 60, minCut = 1.2, beta = 0.01, dcut = 1.5) {
    this.freq = freq; this.minCut = minCut; this.beta = beta; this.dcut = dcut;
  }
  private alpha(cut: number) {
    const te = 1 / Math.max(1e-6, this.freq);
    const tau = 1 / (2 * Math.PI * cut);
    return 1 / (1 + tau / te);
  }
  filter(x: number, dtSeconds: number): number {
    this.freq = 1 / Math.max(1e-6, dtSeconds);
    const dx = this.xPrev == null ? 0 : (x - this.xPrev) * this.freq;
    const aD = this.alpha(this.dcut);
    const dxHat = this.dxPrev == null ? dx : aD * dx + (1 - aD) * this.dxPrev;
    const cut = this.minCut + this.beta * Math.abs(dxHat);
    const aX = this.alpha(cut);
    const xHat = this.xPrev == null ? x : aX * x + (1 - aX) * this.xPrev;
    this.xPrev = xHat; this.dxPrev = dxHat;
    return xHat;
  }
}

export default function ChromaticTunerModule() {
  const [listening, setListening] = React.useState<boolean>(
    () => (localStorage.getItem("tuner.listen") ?? "true") === "true"
  );
  const [hz, setHz] = React.useState<number | null>(null);
  const [level, setLevel] = React.useState(0); // mic meter 0..1

  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const cleanupRef = React.useRef<() => void>(() => {});
  const rafRef = React.useRef<number | null>(null);

  // smoothing state
  const lastTsRef = React.useRef<number>(0);
  const euroRef = React.useRef<OneEuro>(new OneEuro(60, 1.2, 0.01, 1.5));
  const lastReportRef = React.useRef<number>(0);

  React.useEffect(() => {
    localStorage.setItem("tuner.listen", String(listening));
  }, [listening]);

  React.useEffect(() => {
    if (!listening) { stop(); setHz(null); setLevel(0); return; }
    start().catch(() => setListening(false));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  async function start() {
    // No compressor anywhere; just optional gentle band-limiting in the analyser chain
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
    euroRef.current = new OneEuro(60, 1.2, 0.01, 1.5);
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
    const dtMs = Math.min(150, Math.max(0.001, now - (lastTsRef.current || now)));
    const dt = dtMs / 1000; // seconds
    lastTsRef.current = now;

    // mic level (RMS)
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    setLevel(Math.min(1, rms * 8));

    // pitch via YIN
    const raw = detectPitchHzYIN(an, 30, 900, 0.12);
    let smooth: number | null = null;

    if (raw && isFinite(raw)) {
      // One-Euro smoothing directly on Hz (adaptive to motion)
      smooth = euroRef.current.filter(raw, dt);
    } else {
      // gentle decay to null when no pitch
      if (hz != null) {
        const k = 1 - Math.exp(-dt / 0.25); // ~250ms decay time
        const next = hz + (0 - hz) * k;
        smooth = Math.abs(next) < 1e-3 ? null : next;
      } else {
        smooth = null;
      }
    }

    // throttle UI updates
    if (now - lastReportRef.current >= 60) {
      lastReportRef.current = now;
      setHz(smooth ?? null);
    }

    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <div className="panel">
      {/* Small in-panel toolbar since tile header hides module header */}
      <div className="centered" style={{ marginBottom: 8 }}>
        <label className="check" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={listening}
            onChange={(e) => setListening(e.target.checked)}
          />
          <span>Listen</span>
        </label>
      </div>

      {/* Centered tuner */}
      <div className="centered" style={{ marginTop: 4 }}>
        <Tuner hz={hz} />
      </div>

      {/* Mic meter under tuner (unchanged) */}
      <div className="mic-row" style={{ justifyContent: "center" }}>
        <div className="mic-meter" title="Input level" style={{ width: 360, maxWidth: "90%" }}>
          <div className="mic-level" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      </div>

      <p className="muted centered" style={{ marginTop: 8 }}>
        The tuner shows how close the incoming sound is to the nearest equal-tempered pitch.
      </p>
    </div>
  );
}
