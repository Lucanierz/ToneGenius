import React from "react";
import MicAnswer from "../components/MicAnswer";
import SettingsDialog from "../components/SettingsDialog";
import { startPitchClass } from "../utils/audio";
import { addSemitones, PC_TO_NAME } from "../utils/music";

/** ===== Degrees & solfege mapping ===== */
type DegreeId =
  | "1" | "b2" | "2" | "b3" | "3" | "4" | "#4" | "5" | "b6" | "6" | "b7" | "7";

type Degree = {
  id: DegreeId;
  name: string;
  semitones: number;
};

const DEGREES: Degree[] = [
  { id: "1",  name: "Do", semitones: 0 },
  { id: "b2", name: "Ra", semitones: 1 },
  { id: "2",  name: "Re", semitones: 2 },
  { id: "b3", name: "Me", semitones: 3 },
  { id: "3",  name: "Mi", semitones: 4 },
  { id: "4",  name: "Fa", semitones: 5 },
  { id: "#4", name: "Fi", semitones: 6 },
  { id: "5",  name: "So", semitones: 7 },
  { id: "b6", name: "Le", semitones: 8 },
  { id: "6",  name: "La", semitones: 9 },
  { id: "b7", name: "Te", semitones: 10 },
  { id: "7",  name: "Ti", semitones: 11 },
];

const DEG_BY_ID: Record<DegreeId, Degree> =
  Object.fromEntries(DEGREES.map(d => [d.id, d])) as any;

const PRESETS: Record<string, DegreeId[]> = {
  "Ionian (Major)": ["1","2","3","4","5","6","7"],
  "Dorian": ["1","2","b3","4","5","6","b7"],
  "Phrygian": ["1","b2","b3","4","5","b6","b7"],
  "Lydian": ["1","2","3","#4","5","6","7"],
  "Mixolydian": ["1","2","3","4","5","6","b7"],
  "Aeolian (Natural minor)": ["1","2","b3","4","5","b6","b7"],
  "Locrian": ["1","b2","b3","4","#4","b6","b7"],
};

const K_SELECTED  = "solfege.selected.v2";
const K_ROOT_PC   = "solfege.rootPc.v1";
const K_ROOT_OCT  = "solfege.rootOct.v1";
const K_MIC       = "solfege.mic.v1";
const K_MAX_JUMP  = "solfege.maxJump.v1";

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
  return new Set<DegreeId>(["1","b3","4","5","b7"]);
}
function saveSelected(sel: Set<DegreeId>) {
  try { localStorage.setItem(K_SELECTED, JSON.stringify(Array.from(sel))); } catch {}
}
function pcDistanceSemis(a: number, b: number): number {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

export default function SolfegeTrainerModule() {
  const [selected, setSelected] = React.useState<Set<DegreeId>>(loadSelected);
  React.useEffect(() => { saveSelected(selected); }, [selected]);

  const [rootPc, setRootPc] = React.useState<number>(() => {
    const raw = localStorage.getItem(K_ROOT_PC);
    return raw ? Number(raw) : 0;
  });
  const [rootOct, setRootOct] = React.useState<number>(() => {
    const raw = localStorage.getItem(K_ROOT_OCT);
    return raw ? Number(raw) : 4;
  });
  React.useEffect(() => { try { localStorage.setItem(K_ROOT_PC, String(rootPc)); } catch {} }, [rootPc]);
  React.useEffect(() => { try { localStorage.setItem(K_ROOT_OCT, String(rootOct)); } catch {} }, [rootOct]);

  const [micEnabled, setMicEnabled] = React.useState<boolean>(() => (localStorage.getItem(K_MIC) ?? "true") === "true");
  React.useEffect(() => { try { localStorage.setItem(K_MIC, String(micEnabled)); } catch {} }, [micEnabled]);

  const [maxJump, setMaxJump] = React.useState<number>(() => {
    const raw = Number(localStorage.getItem(K_MAX_JUMP) ?? 12);
    return (raw >= 1 && raw <= 12) ? raw : 12;
  });
  React.useEffect(() => { try { localStorage.setItem(K_MAX_JUMP, String(maxJump)); } catch {} }, [maxJump]);

  type Target = { id: DegreeId; name: string; semitones: number; answerPc: number; };
  const [target, setTarget] = React.useState<Target | null>(null);
  const prevTargetRef = React.useRef<Target | null>(null);

  const [isPlayingRoot, setIsPlayingRoot] = React.useState(false);
  const [isPlayingTarget, setIsPlayingTarget] = React.useState(false);
  const stopRef = React.useRef<null | (() => void)>(null);
  const suspendMic = isPlayingRoot || isPlayingTarget;

  // slightly friendlier defaults (you can tweak)
  const HOLD_MS = 320;
  const CENTS_TOL = 36;

  const [openSettings, setOpenSettings] = React.useState(false);

  const ROOT_ENTRIES = React.useMemo(
    () =>
      Object.entries(PC_TO_NAME as Record<number, string>)
        .map(([pc, name]) => ({ pc: Number(pc), name }))
        .sort((a, b) => a.pc - b.pc),
    []
  );

  function pickTarget() {
    const ids = Array.from(selected);
    if (ids.length === 0) { setTarget(null); return; }

    const prev = prevTargetRef.current;
    let pool = ids;

    if (prev && maxJump < 12) {
      const prevSemis = prev.semitones % 12;
      pool = ids.filter((id) => {
        const s = DEG_BY_ID[id].semitones % 12;
        return pcDistanceSemis(prevSemis, s) <= maxJump;
      });
      if (pool.length === 0) pool = ids;
    }

    const chosen = randomOf(pool);
    const d = DEG_BY_ID[chosen];
    const answerPc = addSemitones(rootPc, d.semitones);
    const t: Target = { id: d.id, name: d.name, semitones: d.semitones, answerPc };
    setTarget(t);
    prevTargetRef.current = t;
  }

  React.useEffect(() => { pickTarget(); }, []);
  React.useEffect(() => { pickTarget(); }, [selected, rootPc, maxJump]);

  const handleMicCorrect = React.useCallback(() => {
    setTimeout(() => pickTarget(), 160);
  }, []);

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

  function toggleDegree(id: DegreeId, checked: boolean) {
    const next = new Set(selected);
    checked ? next.add(id) : next.delete(id);
    setSelected(next);
  }
  function loadPreset(ids: DegreeId[]) {
    setSelected(new Set(ids));
  }

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <button className="icon-btn" onClick={() => setOpenSettings(true)} title="Settings" aria-label="Open settings">
          ⚙️
        </button>
      </div>

      {target ? (
        <>
          <div className="centered" style={{ marginTop: 6 }}>
            <div className="hero-label" style={{ marginBottom: 6 }}>Solfege</div>
            <div className="hero-note" style={{ fontSize: "clamp(36px, 8vw, 72px)" }}>
              {target.name}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
            <div className="row center" style={{ gap: 24, marginTop: 12, flexWrap: "wrap" }}>
              <div className="hero-block" style={{ minWidth: 160, textAlign: "center" }}>
                <div className="hero-label">Root (1)</div>
                <div className="hero-note">{(PC_TO_NAME as Record<number,string>)[rootPc]}</div>
              </div>
              <div className="hero-block" style={{ minWidth: 160, textAlign: "center" }}>
                <div className="hero-label">Target Note</div>
                <div className="hero-interval" style={{ justifyContent: "center" }}>
                  <span className="hero-name">
                    {(PC_TO_NAME as Record<number,string>)[target.answerPc]}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="hero-sub muted centered" style={{ marginTop: 8 }}>
            Sing/play <strong>{target.name}</strong> → {(PC_TO_NAME as Record<number,string>)[target.answerPc]} relative to {(PC_TO_NAME as Record<number,string>)[rootPc]}. Octave doesn’t matter.
          </div>

          <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
            <div className="row center" style={{ marginTop: 14, gap: 10, flexWrap: "wrap" }}>
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
                ▶ Hold: Target ({(PC_TO_NAME as Record<number,string>)[target.answerPc]})
              </button>
              <button
                className="button"
                onClick={() => pickTarget()}
                title="Skip to next target"
              >
                Next
              </button>
            </div>
          </div>

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
              <p className="muted centered" style={{ marginTop: 8 }}>
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

      <SettingsDialog title="Solfege Settings" open={openSettings} onClose={() => setOpenSettings(false)}>
        <div className="settings-grid" style={{ justifyItems: "center", textAlign: "center" }}>
          {/* Root & Mic */}
          <section className="settings-section" style={{ width: "100%" }}>
            <h4 style={{ marginBottom: 8, textAlign: "center" }}>Root (1) &amp; Microphone</h4>
            <div className="row" style={{ flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
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
                <span>Use microphone to auto-detect the correct pitch</span>
              </label>
            </div>
            <p className="muted" style={{ marginTop: 6, textAlign: "center" }}>
              Hold the “Root” and “Target” buttons to preview tones. While audio plays, the mic is paused.
            </p>
          </section>

          <div className="settings-divider" style={{ width: "100%" }} />

          {/* Max jump */}
          <section className="settings-section" style={{ width: "100%" }}>
            <h4 style={{ marginBottom: 8, textAlign: "center" }}>Maximum jump size</h4>
            <div className="row" style={{ gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
              <label className="check" style={{ gap: 8 }}>
                <span>Limit (semitones)</span>
                <select
                  className="select"
                  value={maxJump}
                  onChange={(e) => setMaxJump(Number(e.target.value))}
                >
                  <option value={12}>No limit</option>
                  {Array.from({ length: 11 }, (_, i) => i + 1).map(n =>
                    <option key={n} value={n}>{n}</option>
                  )}
                </select>
              </label>
              <span className="muted">Restricts how far the next target can move on the circle of semitones.</span>
            </div>
          </section>

          <div className="settings-divider" style={{ width: "100%" }} />

          {/* Degrees */}
          <section className="settings-section" style={{ width: "100%" }}>
            <h4 style={{ marginBottom: 8, textAlign: "center" }}>Included degrees (functions)</h4>
            <div
              className="picker-grid"
              style={{
                gridTemplateColumns: "repeat(6, minmax(84px, 1fr))",
                maxWidth: 720,
                margin: "0 auto"
              }}
            >
              {DEGREES.map(d => (
                <label key={d.id} className="check" style={{ gap: 6, justifySelf: "center" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(d.id)}
                    onChange={(e) => toggleDegree(d.id, e.target.checked)}
                  />
                  <span>{d.id} <span className="muted">({d.name})</span></span>
                </label>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
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
      </SettingsDialog>
    </div>
  );
}
