import React from "react";
import {
  startMicAnalyser,
  detectPitchHzYIN,
  freqToPc,
  freqToMidi,
} from "../utils/audio";

type Props = {
  enabled: boolean;
  suspend?: boolean;         // pause mic (e.g., while playing target)
  targetPc: number;          // 0..11
  onHeard: (heardPc: number, ok: boolean) => void;
  onCorrect: () => void;
  onPitch?: (hz: number | null) => void; // optional tuner feed
  holdMs?: number;           // default 500
  centsTolerance?: number;   // default ±25
};

/* One-Euro Filter (adaptive low-pass) */
class OneEuro {
  private freq: number;
  private minCut: number;
  private beta: number;
  private dcut: number;
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

/** Signed cents offset to a pitch-class using modular MIDI math (no ref freq). */
function centsToPitchClass(midiFloat: number, targetPc: number): number {
  // distance in semitones from target pitch-class (wrap to [-6, +6))
  const diffSemis = midiFloat - targetPc;                // can be any real
  const wrapped = diffSemis - 12 * Math.round(diffSemis / 12); // nearest octave of that PC
  return wrapped * 100;                                   // signed cents
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
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const cleanupRef = React.useRef<() => void>(() => {});
  const rafRef = React.useRef<number | null>(null);

  // time + hold
  const lastTsRef = React.useRef<number>(0);
  const heldMsRef = React.useRef<number>(0);

  // smoothing + gating
  const euroRef = React.useRef<OneEuro>(new OneEuro(60, 1.2, 0.01, 1.5));
  const lastPitchSeenRef = React.useRef<number>(0);
  const centsMedianRef = React.useRef<number[]>([]);
  const lastReportRef = React.useRef<number>(0);

  // knobs
  const REPORT_INTERVAL_MS = 60;
  const YIN_THRESHOLD = 0.10;          // a bit more sensitive
  const HYSTERESIS_EXTRA_CENTS = 5;     // gentle boundary

  React.useEffect(() => {
    if (!enabled || suspend) { stop(); return; }
    start().catch(() => { onPitch?.(null); });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, suspend, targetPc]);

  function stop() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { cleanupRef.current(); } catch {}
    analyserRef.current = null;
    heldMsRef.current = 0;
    centsMedianRef.current = [];
    onPitch?.(null);
  }

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
    heldMsRef.current = 0;
    lastTsRef.current = performance.now();
    lastReportRef.current = 0;
    lastPitchSeenRef.current = 0;
    euroRef.current = new OneEuro(60, 1.2, 0.01, 1.5);
    centsMedianRef.current = [];
    tick();
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

    // YIN pitch
    const hzRaw = detectPitchHzYIN(an, 30, 900, YIN_THRESHOLD);
    let hzSmooth: number | null = null;

    if (hzRaw && isFinite(hzRaw)) {
      lastPitchSeenRef.current = now;
      hzSmooth = euroRef.current.filter(hzRaw, dt);

      const midiFloat = freqToMidi(hzSmooth);
      // robust cents-from-target-PC (avoids ref freq rounding quirks)
      const centsRaw = centsToPitchClass(midiFloat, targetPc);

      // short median to reject flickers (longer for bass)
      const win = centsMedianRef.current;
      const maxWin = hzSmooth < 130 ? 9 : 5;
      win.push(centsRaw);
      if (win.length > maxWin) win.shift();
      const centsFiltered = median(win);

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
      // silence/unstable: gentle grace before reset
      if (now - lastPitchSeenRef.current > 220) {
        hzSmooth = null;
        centsMedianRef.current = [];
        heldMsRef.current = 0;
      }
    }

    if (onPitch && now - lastReportRef.current >= REPORT_INTERVAL_MS) {
      lastReportRef.current = now;
      onPitch(hzSmooth ?? null);
    }

    rafRef.current = requestAnimationFrame(tick);
  }

  if (!enabled) return null;
  return null;
}
