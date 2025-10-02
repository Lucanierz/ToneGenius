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
  const smoothHzRef = React.useRef<number | null>(null);
  const lastReportRef = React.useRef<number>(0);
  const lastPitchSeenRef = React.useRef<number>(0);
  const centsMedianRef = React.useRef<number[]>([]);

  // tuning knobs (adjust if you want calmer/faster)
  const REPORT_INTERVAL_MS_BASE = 60; // base ~16 fps
  const DROPOUT_MS = 160;
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
    smoothHzRef.current = null;
    centsMedianRef.current = [];
    onPitch?.(null);
  }

  async function start() {
    // bigger fft + filtering for low notes stability
    const { analyser, cleanup } = await startMicAnalyser({
      fftSize: 8192,
      filtering: true,
      hpHz: 45,
      lpHz: 1200,
      notch50: true,
      notch60: false, // set true if you're on 60Hz mains
    });
    analyserRef.current = analyser;
    cleanupRef.current = cleanup;
    setState("listening");
    heldMsRef.current = 0;
    lastTsRef.current = performance.now();
    lastReportRef.current = 0;
    lastPitchSeenRef.current = 0;
    smoothHzRef.current = null;
    centsMedianRef.current = [];
    tick();
  }

  // nearest MIDI for target pitch-class to a given MIDI float
  function nearestMidiForPc(midiFloat: number, pc: number): number {
    const k = Math.round((midiFloat - pc) / 12);
    return pc + 12 * k;
  }

  function tick() {
    const an = analyserRef.current;
    if (!an) return;

    const now = performance.now();
    const dt = Math.min(120, Math.max(0, now - (lastTsRef.current || now)));
    lastTsRef.current = now;

    // level meter
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    setLevel(Math.min(1, rms * 8));

    // --- YIN detector: excels at low frequencies
    const hz = detectPitchHzYIN(an, 30, 900, 0.12);
    if (hz && isFinite(hz)) {
      lastPitchSeenRef.current = now;

      // Adaptive exponential smoothing: stronger for low notes
      const baseTau = 180; // ms
      const extra = hz < 130 ? 200 : hz < 200 ? 120 : 40; // more smoothing for bass
      const tau = baseTau + extra;
      if (smoothHzRef.current == null) {
        smoothHzRef.current = hz;
      } else {
        const k = 1 - Math.exp(-dt / tau);
        smoothHzRef.current = smoothHzRef.current + (hz - smoothHzRef.current) * k;
      }

      // compute cents vs nearest instance of target PC (for hold logic)
      const heardPc = freqToPc(hz);
      const midiFloat = freqToMidi(hz);
      const candidateMidi = nearestMidiForPc(midiFloat, targetPc);
      const refFreq = midiToFreq(candidateMidi);
      const centsRaw = 1200 * Math.log2(hz / refFreq);

      // median over a small window to reject flickers (longer for bass)
      const win = centsMedianRef.current;
      win.push(centsRaw);
      const maxWin = hz < 130 ? 11 : 7;
      if (win.length > maxWin) win.shift();
      const centsFiltered = median(win);

      // hysteresis around tolerance boundary
      const inRange = Math.abs(centsFiltered) <= centsTolerance;
      const outRange = Math.abs(centsFiltered) > centsTolerance + HYSTERESIS_EXTRA_CENTS;

      onHeard(heardPc, inRange);
      if (inRange) {
        heldMsRef.current += dt;
        if (heldMsRef.current >= holdMs) {
          heldMsRef.current = 0;
          onCorrect();
        }
      } else if (outRange) {
        heldMsRef.current = 0;
      }

    } else {
      if (now - lastPitchSeenRef.current > 180) {
        smoothHzRef.current = null;
        centsMedianRef.current = [];
        heldMsRef.current = 0;
      }
    }

    // Throttled reporting to tuner: slower for bass to look calmer
    const reportEvery = (smoothHzRef.current && smoothHzRef.current < 130)
      ? Math.max(80, REPORT_INTERVAL_MS_BASE)
      : REPORT_INTERVAL_MS_BASE;

    if (onPitch && now - lastReportRef.current >= reportEvery) {
      lastReportRef.current = now;
      onPitch(smoothHzRef.current ?? null);
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
      <span className="muted">
        Hold the target note for {Math.round(holdMs)}ms within ±{centsTolerance}¢.
      </span>
    </div>
  );
}

/* utils (local) */
function median(a: number[]) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
