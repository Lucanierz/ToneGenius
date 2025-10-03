// src/modules/MetronomeModule.tsx
import React from "react";
import { getAudioContext } from "../utils/audio";

type TimeSig = { num: number; den: 2 | 4 | 8 | 16 };

const MIN_BPM = 30;
const MAX_BPM = 300;

// Tap-tempo tuning
const TAP_RESET_MS = 1200;
const TAP_MIN_S = 0.18;
const TAP_MAX_S = 2.5;
const TAP_DEVIATE_FRAC = 0.35;
const TAP_WINDOW = 4;

// ---- Global downbeat sync (shared across module instances) -------------------
type GlobalSync = {
  anchor: number | null; // AudioContext time of a reference downbeat "1"
  barLen: number;        // seconds per bar (based on the *owner* instance)
  ownerId: string | null;
};
function getGlobalSync(): GlobalSync {
  const w = window as any;
  if (!w.__metroSync) {
    w.__metroSync = { anchor: null, barLen: 0, ownerId: null } as GlobalSync;
  }
  return w.__metroSync as GlobalSync;
}
function makeInstanceId() {
  return `metro-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}
function nextGlobalDownbeat(ctxTime: number): number | null {
  const s = getGlobalSync();
  if (s.anchor == null || s.barLen <= 0) return null;
  const n = Math.ceil((ctxTime - s.anchor) / s.barLen);
  return s.anchor + n * s.barLen;
}
// -----------------------------------------------------------------------------

export default function MetronomeModule() {
  const instanceIdRef = React.useRef<string>(makeInstanceId());

  const [running, setRunning] = React.useState(false);

  const [bpm, setBpm] = React.useState<number>(() => {
    const s = localStorage.getItem("metro.bpm");
    const v = s ? Number(s) : 100;
    return clamp(v, MIN_BPM, MAX_BPM);
  });
  // Separate input string so the user can clear it while typing
  const [bpmInput, setBpmInput] = React.useState<string>(() =>
    String(clamp(Number(localStorage.getItem("metro.bpm") ?? 100), MIN_BPM, MAX_BPM))
  );

  const [sig, setSig] = React.useState<TimeSig>(() => {
    try {
      const raw = localStorage.getItem("metro.sig");
      if (raw) return JSON.parse(raw) as TimeSig;
    } catch {}
    return { num: 4, den: 4 };
  });

  // drives the dot highlight
  const [activeBeat, setActiveBeat] = React.useState<number>(-1);

  React.useEffect(() => {
    try { localStorage.setItem("metro.bpm", String(bpm)); } catch {}
  }, [bpm]);
  React.useEffect(() => {
    try { localStorage.setItem("metro.sig", JSON.stringify(sig)); } catch {}
  }, [sig]);

  // scheduler
  const schedulerRef = React.useRef<number | null>(null);
  const nextTimeRef = React.useRef(0);
  const beatRef = React.useRef(0);

  // tap tempo
  const tapsRef = React.useRef<number[]>([]);
  const lastTapRef = React.useRef<number>(0);

  // seconds per beat (denominator note = beat)
  const spb = React.useMemo(() => (60 / bpm) * (4 / sig.den), [bpm, sig.den]);

  // If we are the global owner and timing changes while running, update barLen, then realign.
  React.useEffect(() => {
    if (!running) return;
    const sync = getGlobalSync();
    if (sync.ownerId === instanceIdRef.current) {
      sync.barLen = spb * sig.num;
    }
    // restart to place clicks on the new grid cleanly
    stop(false);
    start(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spb, sig.num]);

  function scheduleClick(when: number, beatIndex: number) {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const isDown = beatIndex === 0;
    const f = isDown ? 1000 : 800;
    const level = isDown ? 0.25 : 0.18;

    osc.type = "square";
    osc.frequency.value = f;

    const t0 = when;
    const a = 0.002; // 2ms attack
    const d = 0.06;  // 60ms decay

    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(level, t0 + a);
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + a + d);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + a + d + 0.02);

    osc.onended = () => {
      try { osc.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    };
  }

  // Lookahead scheduler (updates UI & schedules clicks)
  function schedulerTick() {
    const ctx = getAudioContext();
    const scheduleAhead = 0.12; // seconds
    while (nextTimeRef.current < ctx.currentTime + scheduleAhead) {
      setActiveBeat(beatRef.current);
      scheduleClick(nextTimeRef.current, beatRef.current);
      nextTimeRef.current += spb;
      beatRef.current = (beatRef.current + 1) % sig.num;
    }
    schedulerRef.current = window.setTimeout(schedulerTick, 25);
  }

  function start(setGlobalOwnerIfNone = true) {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const sync = getGlobalSync();
    const myBarLen = spb * sig.num;

    // If a global anchor exists, start on next global "1".
    // Otherwise, we become the owner and define the anchor.
    let startAt: number;
    if (sync.anchor != null && sync.barLen > 0) {
      const nd = nextGlobalDownbeat(ctx.currentTime + 0.02) ?? (ctx.currentTime + 0.06);
      startAt = nd;
    } else {
      startAt = ctx.currentTime + 0.06;
      if (setGlobalOwnerIfNone) {
        sync.anchor = startAt;
        sync.barLen = myBarLen;
        sync.ownerId = instanceIdRef.current;
      }
    }

    // Initialize local scheduler aligned to a downbeat
    nextTimeRef.current = startAt;
    beatRef.current = 0;
    setActiveBeat(0);
    schedulerTick();
    setRunning(true);
  }

  function stop(clearGlobalIfOwner = true) {
    if (schedulerRef.current != null) clearTimeout(schedulerRef.current);
    schedulerRef.current = null;
    setRunning(false);
    setActiveBeat(-1);

    if (clearGlobalIfOwner) {
      const sync = getGlobalSync();
      if (sync.ownerId === instanceIdRef.current) {
        sync.anchor = null;
        sync.barLen = 0;
        sync.ownerId = null;
      }
    }
  }
  React.useEffect(() => () => stop(), []);

  // Tap tempo (snappy)
  function tap() {
    const now = performance.now();
    const last = lastTapRef.current;
    lastTapRef.current = now;

    // First tap primes OR big gap resets
    if (!last || now - last > TAP_RESET_MS) {
      tapsRef.current = [];
      return;
    }

    const delta = (now - last) / 1000; // seconds
    // reject nonsense taps
    if (delta < TAP_MIN_S || delta > TAP_MAX_S) {
      tapsRef.current = [];
      return;
    }

    const buf = tapsRef.current;
    const recentAvg = buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : delta;
    const dev = Math.abs(delta - recentAvg) / Math.max(0.001, recentAvg);

    if (dev > TAP_DEVIATE_FRAC) {
      // Big change: snap immediately
      const snappedBpm = clamp(Math.round((60 / delta) * (sig.den / 4)), MIN_BPM, MAX_BPM);
      setBpm(snappedBpm);
      setBpmInput(String(snappedBpm));
      tapsRef.current = [delta];
      return;
    }

    // Smooth with short, weighted average (newer taps weigh more)
    buf.push(delta);
    if (buf.length > TAP_WINDOW) buf.shift();

    const weights = [0.6, 0.25, 0.1, 0.05];
    const used = buf.slice(-TAP_WINDOW);
    const wArr = weights.slice(0, used.length);
    const wSum = wArr.reduce((a, b) => a + b, 0);
    const wNorm = wArr.map((x) => x / wSum);

    let wavg = 0;
    for (let i = 0; i < used.length; i++) {
      const val = used[used.length - 1 - i]; // newest first
      wavg += val * wNorm[i];
    }

    const tappedBpm = clamp(Math.round((60 / wavg) * (sig.den / 4)), MIN_BPM, MAX_BPM);
    setBpm(tappedBpm);
    setBpmInput(String(tappedBpm));
  }

  // keyboard: Space = start/stop, T = tap
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName?.toLowerCase() === "input") return;
      const k = e.key.toLowerCase();
      if (k === " ") { e.preventDefault(); running ? stop() : start(); }
      if (k === "t") { e.preventDefault(); tap(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

  // ---- Tempo input handlers (allow empty) ------------------------------------
  function commitBpm() {
    const n = Number(bpmInput);
    if (!Number.isFinite(n)) { setBpmInput(String(bpm)); return; }
    const clamped = clamp(Math.round(n), MIN_BPM, MAX_BPM);
    setBpm(clamped);
    setBpmInput(String(clamped));
  }
  // ----------------------------------------------------------------------------

  return (
    <div className="panel">
      {/* Controls (centered, stacked) */}
      <div className="met-controls centered" style={{ marginTop: 8 }}>
        <div className="met-field">
          <label>Tempo</label>
          <div className="row center" style={{ gap: 10, flexWrap: "wrap" }}>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={bpmInput}
              placeholder={`${bpm}`}
              onChange={(e) => {
                // allow empty or digits only
                const raw = e.target.value;
                if (raw === "" || /^[0-9]{0,3}$/.test(raw)) setBpmInput(raw);
              }}
              onBlur={commitBpm}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitBpm(); } }}
              style={{ width: 110, textAlign: "center", fontWeight: 700, fontSize: 18 }}
            />

            {/* Single toggle transport button */}
            <button
              className="icon-btn"
              onClick={() => (running ? stop() : start())}
              title={running ? "Stop (Space)" : "Start (Space)"}
              aria-label={running ? "Stop metronome" : "Start metronome"}
            >
              {running ? "⏹" : "▶"}
            </button>

            {/* Big TAP button */}
            <button className="button tap-big" onClick={tap} title="Tap tempo (T)">
              Tap
            </button>
          </div>
        </div>

        <div className="met-field">
          <label>Time signature</label>
          <div className="row center">
            <select
              className="select"
              value={sig.num}
              onChange={(e) => setSig((s) => ({ ...s, num: clampInt(Number(e.target.value), 1, 12) }))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span className="big">/</span>
            <select
              className="select"
              value={sig.den}
              onChange={(e) => setSig((s) => ({ ...s, den: Number(e.target.value) as TimeSig["den"] }))}
            >
              {[2,4,8,16].map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Beat dots */}
      <div className="met-beats">
        {Array.from({ length: sig.num }).map((_, i) => (
          <span
            key={i}
            className={`beat-dot ${i === 0 ? "downbeat" : ""} ${i === activeBeat ? "active" : ""}`}
          />
        ))}
      </div>

      <p className="muted centered" style={{ marginTop: 8 }}>
        Space = start/stop • T = tap
      </p>
    </div>
  );
}

function clamp(x: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, x)); }
function clampInt(x: number, lo: number, hi: number) { return Math.round(clamp(x, lo, hi)); }
