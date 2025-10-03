import React from "react";
import {
  startMicAnalyser,
  detectPitchHzYIN,
  freqToPc,
  midiToFreq,
  freqToMidi,
} from "../utils/audio";

type Props = {
  enabled: boolean;
  suspend?: boolean;         // pause mic (e.g., while playing target)
  targetPc: number;          // 0..11
  onHeard: (heardPc: number, ok: boolean) => void;
  onCorrect: () => void;
  onPitch?: (hz: number | null) => void; // tuner feed
  holdMs?: number;           // default 500
  centsTolerance?: number;   // default ±25
};

/* -------- One-Euro Filter (adaptive low-pass) --------
   Smoother than a raw EMA; attenuates jitter while staying responsive.
   https://cristal.univ-lille.fr/~casiez/1euro/ */
class OneEuro {
  private freq: number;     // nominal update frequency (Hz)
  private minCut: number;   // Hz
  private beta: number;     // speed coefficient
  private dcut: number;     // derivative cutoff
  private xPrev: number | null = null;
  private dxPrev: number | null = null;

  constructor(freq = 60, minCut = 1.0, beta = 0.007, dcut = 1.0) {
    this.freq = freq; this.minCut = minCut; this.beta = beta; this.dcut = dcut;
  }
  private alpha(cut: number) {
    const te = 1.0 / Math.max(1e-6, this.freq);
    const tau = 1.0 / (2 * Math.PI * cut);
    return 1.0 / (1.0 + tau / te);
  }
  filter(x: number, dt: number): number {
    this.freq = 1.0 / Math.max(1e-6, dt);
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

export default function MicAnswer({
  enabled,
  suspend = false,
  targetPc,
  onHeard,
  onCorrect,
  onPitch,
  holdMs = 500,
  centsTolerance = 25,
}: Props) {
  const [state, setState] = React.useState<"idle" | "listening" | "denied" | "error">("idle");
  const [level, setLevel] = React.useState(0);

  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const cleanupRef = React.useRef<() => void>(() => {});
  const rafRef = React.useRef<number | null>(null);

  // time + hold
  const lastTsRef = React.useRef<number>(0);
  const heldMsRef = React.useRef<number>(0);

  // smoothing
  const euroRef = React.useRef<OneEuro>(new OneEuro(60, 1.2, 0.01, 1.5));
  const lastPitchSeenRef = React.useRef<number>(0);
  const centsMedianRef = React.useRef<number[]>([]);

  // reporting throttle
  const lastReportRef = React.useRef<number>(0);

  // knobs
  const REPORT_INTERVAL_MS_BASE = 60;
  const HYSTERESIS_EXTRA_CENTS = 7;

  React.useEffect(() => {
    if (!enabled || suspend) { stop(); return; }
    start().catch((e) => {
      const name = String((e as any)?.name || e).toLowerCase();
      setState(name.includes("notallowed") || name.includes("denied") ? "denied" : "error");
      onPitch?.(null);
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, suspend]);

  function stop() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { cleanupRef.current(); } catch {}
    analyserRef.current = null;
    setState("idle");
    setLevel(0);
    heldMsRef.current = 0;
    centsMedianRef.current = [];
    onPitch?.(null);
  }

  async function start() {
    // IMPORTANT: no compression — just optional gentle filtering in startMicAnalyser
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
    setState("listening");
    heldMsRef.current = 0;
    lastTsRef.current = performance.now();
    lastReportRef.current = 0;
    lastPitchSeenRef.current = 0;
    euroRef.current = new OneEuro(60, 1.2, 0.01, 1.5);
    centsMedianRef.current = [];
    tick();
  }

  // nearest MIDI for target pitch-class to a given MIDI float
  function nearestMidiForPc(midiFloat: number, pc: number): number {
    const k = Math.round((midiFloat - pc) / 12);
    return pc + 12 * k;
  }

  function median(a: number[]) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function tick() {
    const an = analyserRef.current;
    if (!an) return;

    const now = performance.now();
    const dt = Math.min(150, Math.max(0.001, now - (lastTsRef.current || now))) / 1000; // seconds
    lastTsRef.current = now;

    // level meter
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    setLevel(Math.min(1, rms * 8));

    // YIN pitch
    const hzRaw = detectPitchHzYIN(an, 30, 900, 0.12);
    let hzSmooth: number | null = null;

    if (hzRaw && isFinite(hzRaw)) {
      lastPitchSeenRef.current = now;
      // One-Euro smoothing directly on Hz, adaptive with dt
      hzSmooth = euroRef.current.filter(hzRaw, dt);

      // compute cents vs nearest instance of target PC (for hold logic)
      const midiFloat = freqToMidi(hzSmooth);
      const candidateMidi = nearestMidiForPc(midiFloat, targetPc);
      const refFreq = midiToFreq(candidateMidi);
      const centsRaw = 1200 * Math.log2(hzSmooth / refFreq);

      // small median over cents to reject flickers (longer for bass)
      const win = centsMedianRef.current;
      const maxWin = hzSmooth < 130 ? 11 : 7;
      win.push(centsRaw);
      if (win.length > maxWin) win.shift();
      const centsFiltered = median(win);

      // hysteresis around tolerance boundary
      const inRange = Math.abs(centsFiltered) <= centsTolerance;
      const outRange = Math.abs(centsFiltered) > centsTolerance + HYSTERESIS_EXTRA_CENTS;

      onHeard(freqToPc(hzSmooth), inRange);
      if (inRange) {
        heldMsRef.current += dt * 1000;
        if (heldMsRef.current >= holdMs) {
          heldMsRef.current = 0;
          onCorrect();
        }
      } else if (outRange) {
        heldMsRef.current = 0;
      }
    } else {
      if (now - lastPitchSeenRef.current > 180) {
        hzSmooth = null;
        centsMedianRef.current = [];
        heldMsRef.current = 0;
      }
    }

    // Throttled reporting to tuner
    const reportEvery = 60; // ms
    if (onPitch) {
      if (now - lastReportRef.current >= reportEvery) {
        lastReportRef.current = now;
        onPitch(hzSmooth ?? null);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }

  if (!enabled) return null;

  return (
    <div className="mic-row">
      <span className="badge">
        Mic:{" "}
        {state === "listening"
          ? "Listening"
          : state === "denied"
          ? "Permission denied"
          : state === "error"
          ? "Error"
          : "Idle"}
      </span>
      <div className="mic-meter" title="Input level">
        <div className="mic-level" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
    </div>
  );
}
