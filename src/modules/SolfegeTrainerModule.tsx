// src/modules/SolfegeTrainerModule.tsx
import React from "react";
import MicAnswer from "../components/MicAnswer";
import { startPitchClass } from "../utils/audio";
import { addSemitones, PC_TO_NAME } from "../utils/music";

/** ===== Degrees & solfege mapping ===== */
type DegreeId =
  | "1" | "b2" | "2" | "b3" | "3" | "4" | "#4" | "5" | "b6" | "6" | "b7" | "7";

type Degree = {
  id: DegreeId;
  name: string;        // solfege
  semitones: number;   // relative to root
};

const DEGREES: Degree[] = [
  { id: "1",  name: "Do", semitones: 0 },
  { id: "b2", name: "Ra", semitones: 1 },
  { id: "2",  name: "Re", semitones: 2 },
  { id: "b3", name: "Me", semitones: 3 },
  { id: "3",  name: "Mi", semitones: 4 },
  { id: "4",  name: "Fa", semitones: 5 },
  { id: "#4", name: "Fi", semitones: 6 }, // (= b5)
  { id: "5",  name: "So", semitones: 7 },
  { id: "b6", name: "Le", semitones: 8 },
  { id: "6",  name: "La", semitones: 9 },
  { id: "b7", name: "Te", semitones: 10 },
  { id: "7",  name: "Ti", semitones: 11 },
];

const DEG_BY_ID: Record<DegreeId, Degree> =
  Object.fromEntries(DEGREES.map(d => [d.id, d])) as any;

/** ===== Mode presets (relative to Do) ===== */
const PRESETS: Record<string, DegreeId[]> = {
  "Ionian (Major)": ["1","2","3","4","5","6","7"],
  "Dorian": ["1","2","b3","4","5","6","b7"],
  "Phrygian": ["1","b2","b3","4","5","b6","b7"],
  "Lydian": ["1","2","3","#4","5","6","7"],
  "Mixolydian": ["1","2","3","4","5","6","b7"],
  "Aeolian (Natural minor)": ["1","2","b3","4","5","b6","b7"],
  "Locrian": ["1","b2","b3","4","#4","b6","b7"],
};

/** ===== Storage keys ===== */
const K_SELECTED = "solfege.selected.v1";
const K_ROOT_PC = "solfege.rootPc.v1";
const K_ROOT_OCT = "solfege.rootOct.v1";
const K_MIC = "solfege.mic.v1";

/** ===== Helpers ===== */
function randomOf<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }

function loadSelected(): Set<DegreeId> {
  try {
    const raw = localStorage.getItem(K_SELECTED);
    if (raw) {
      const ids = JSON.parse(raw) as DegreeId[];
      const valid = ids.filter((id) => DEG_BY_ID[id]);
      if (valid.length) return new Set(valid);
    }
  } catch {}
  // default: minor pentatonic-ish to start pleasant
  return new Set<DegreeId>(["1","b3","4","5","b7"]);
}

function saveSelected(sel: Set<DegreeId>) {
  try { localStorage.setItem(K_SELECTED, JSON.stringify(Array.from(sel))); } catch {}
}

export default function SolfegeTrainerModule() {
  // Selection of degrees (functions)
  const [selected, setSelected] = React.useState<Set<DegreeId>>(loadSelected);
  React.useEffect(() => { saveSelected(selected); }, [selected]);

  // Root (pitch class + octave)
  const [rootPc, setRootPc] = React.useState<number>(() => {
    const raw = localStorage.getItem(K_ROOT_PC);
    return raw ? Number(raw) : 0; // C
  });
  const [rootOct, setRootOct] = React.useState<number>(() => {
    const raw = localStorage.getItem(K_ROOT_OCT);
    return raw ? Number(raw) : 4;
  });
  React.useEffect(() => { try { localStorage.setItem(K_ROOT_PC, String(rootPc)); } catch {} }, [rootPc]);
  React.useEffect(() => { try { localStorage.setItem(K_ROOT_OCT, String(rootOct)); } catch {} }, [rootOct]);

  // Mic enabled
  const [micEnabled, setMicEnabled] = React.useState<boolean>(() => (localStorage.getItem(K_MIC) ?? "true") === "true");
  React.useEffect(() => { try { localStorage.setItem(K_MIC, String(micEnabled)); } catch {} }, [micEnabled]);

  // Current target
  type Target = { id: DegreeId; name: string; semitones: number; answerPc: number; };
  const [target, setTarget] = React.useState<Target | null>(null);

  // Audio play/suspend
  const [isPlayingRoot, setIsPlayingRoot] = React.useState(false);
  const [isPlayingTarget, setIsPlayingTarget] = React.useState(false);
  const stopRef = React.useRef<null | (() => void)>(null);
  const suspendMic = isPlayingRoot || isPlayingTarget;

  // Timing (answer hold)
  const HOLD_MS = 500;
  const CENTS_TOL = 25;

  // Question creation
  function pickTarget() {
    const ids = Array.from(selected);
    if (ids.length === 0) { setTarget(null); return; }
    const chosen = randomOf(ids);
    const d = DEG_BY_ID[chosen];
    const answerPc = addSemitones(rootPc, d.semitones);
    setTarget({ id: d.id, name: d.name, semitones: d.semitones, answerPc });
  }

  React.useEffect(() => { pickTarget(); }, []);
  React.useEffect(() => { pickTarget(); }, [selected, rootPc]);

  // On correct via mic
  const handleMicCorrect = React.useCallback(() => {
    // brief lock then new target
    setTimeout(() => pickTarget(), 180);
  }, []);

  // Audio previews (suspend mic while playing)
  function startPlay(pc: number, oct: number) {
    try {
      stopRef.current?.();
      stopRef.current = startPitchClass(pc, oct, "sine");
      return true;
    } catch { return false; }
  }
  function stopPlay() {
    try { stopRef.current?.(); } catch {}
    stopRef.current = null;
  }

  function holdRoot() {
    setIsPlayingRoot(true);
    const ok = startPlay(rootPc, rootOct);
    if (!ok) setIsPlayingRoot(false);
  }
  function stopRoot() { stopPlay(); setIsPlayingRoot(false); }

  function holdTarget() {
    if (!target) return;
    setIsPlayingTarget(true);
    const ok = startPlay(target.answerPc, rootOct);
    if (!ok) setIsPlayingTarget(false);
  }
  function stopTarget() { stopPlay(); setIsPlayingTarget(false); }

  // UI pieces
  function toggleDegree(id: DegreeId, checked: boolean) {
    const next = new Set(selected);
    checked ? next.add(id) : next.delete(id);
    setSelected(next);
  }
  function loadPreset(ids: DegreeId[]) {
    setSelected(new Set(ids));
  }

  // Build entries from PC_TO_NAME (Record<number, string>), sorted by pc
  const ROOT_ENTRIES = React.useMemo(
    () =>
      Object.entries(PC_TO_NAME as Record<number, string>)
        .map(([pc, name]) => ({ pc: Number(pc), name }))
        .sort((a, b) => a.pc - b.pc),
    []
  );

  return (
    <div className="panel">
      {/* ===== Target card ===== */}
      {target ? (
        <>
          <div className="question-hero" style={{ marginTop: 2 }}>
            <div className="hero-block">
              <div className="hero-label">Solfege</div>
              <div className="hero-note">{target.name}</div>
            </div>
            <div className="hero-block">
              <div className="hero-label">Function</div>
              <div className="hero-interval">
                <span className="hero-name">{target.id}</span>
              </div>
            </div>
            <div className="hero-block">
              <div className="hero-label">Root (1)</div>
              <div className="hero-note">{(PC_TO_NAME as Record<number,string>)[rootPc]}</div>
            </div>
          </div>
          <div className="hero-sub muted centered" style={{ marginTop: 6 }}>
            Sing/play <strong>{target.name}</strong> (degree {target.id}) relative to {(PC_TO_NAME as Record<number,string>)[rootPc]}.
          </div>

          <div className="row center" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
            <button
              className="button"
              title="Hold to hear the ROOT (1)"
              aria-pressed={isPlayingRoot}
              onMouseDown={holdRoot}
              onMouseUp={stopRoot}
              onMouseLeave={stopRoot}
              onTouchStart={(e) => { e.preventDefault(); holdRoot(); }}
              onTouchEnd={stopRoot}
            >
              ▶ Hold: Root (Do)
            </button>
            <button
              className="button"
              title="Hold to hear the TARGET"
              aria-pressed={isPlayingTarget}
              onMouseDown={holdTarget}
              onMouseUp={stopTarget}
              onMouseLeave={stopTarget}
              onTouchStart={(e) => { e.preventDefault(); holdTarget(); }}
              onTouchEnd={stopTarget}
            >
              ▶ Hold: Target ({target.name})
            </button>
            <button
              className="button"
              onClick={() => pickTarget()}
              title="Skip to next target"
            >
              Next
            </button>
          </div>

          {/* Mic listener (no tuner here; suggest adding Tuner module) */}
          {micEnabled && (
            <>
              <MicAnswer
                enabled={micEnabled}
                suspend={suspendMic}
                targetPc={target.answerPc}
                onHeard={() => {}}
                onCorrect={handleMicCorrect}
                holdMs={HOLD_MS}
                centsTolerance={CENTS_TOL}
              />
              <p className="muted centered" style={{ marginTop: 6 }}>
                Need visuals? Add the <strong>Chromatic Tuner</strong> module from the menu (☰).
              </p>
            </>
          )}
        </>
      ) : (
        <p className="muted centered" style={{ marginTop: 8 }}>
          Choose at least one degree in Settings.
        </p>
      )}

      {/* ===== Settings ===== */}
      <div className="settings-divider" />

      <div className="settings-grid">
        {/* Root selection */}
        <section className="settings-section">
          <h4>Root (1) preview &amp; selection</h4>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="check" style={{ gap: 8 }}>
              <span>Root note</span>
              <select
                className="select"
                value={rootPc}
                onChange={(e) => setRootPc(Number(e.target.value))}
              >
                {ROOT_ENTRIES.map(({ pc, name }) => (
                  <option key={pc} value={pc}>{name}</option>
                ))}
              </select>
            </label>
            <label className="check" style={{ gap: 8 }}>
              <span>Octave</span>
              <select
                className="select"
                value={rootOct}
                onChange={(e) => setRootOct(Number(e.target.value))}
              >
                {[2,3,4,5].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="check" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={micEnabled}
                onChange={(e) => setMicEnabled(e.target.checked)}
              />
              <span>Use microphone to detect when the pitch is correct</span>
            </label>
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            Hold the buttons above to preview the root and target. While audio plays, the mic is paused.
          </p>
        </section>

        <div className="settings-divider" />

        {/* Degree selection */}
        <section className="settings-section">
          <h4>Included degrees (functions)</h4>
          <div className="picker-grid" style={{ gridTemplateColumns: "repeat(6, minmax(80px, 1fr))" }}>
            {DEGREES.map(d => (
              <label key={d.id} className="check" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={selected.has(d.id)}
                  onChange={(e) => toggleDegree(d.id, e.target.checked)}
                />
                <span>{d.id} <span className="muted">({d.name})</span></span>
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
            {Object.entries(PRESETS).map(([label, ids]) => (
              <button key={label} className="chip-btn" onClick={() => loadPreset(ids)} title={`Load ${label}`}>
                {label}
              </button>
            ))}
            <button className="chip-btn" onClick={() => setSelected(new Set())}>Clear</button>
            <button className="chip-btn" onClick={() => setSelected(new Set(DEGREES.map(d => d.id)))}>All</button>
          </div>
        </section>
      </div>
    </div>
  );
}
