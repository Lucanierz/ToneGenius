import React from "react";
import { INTERVALS } from "../data/intervals";
import {
  ROOT_POOL,
  randomOf,
  toPitchClass,
  addSemitones,
  PC_TO_NAME,
  isEnharmonicallyEqual,
  normalizeNoteInput,
} from "../utils/music";
import IntervalPicker, { useIntervalSelection } from "./IntervalPicker";
import SettingsDialog from "./SettingsDialog";
import ThemeSelector from "./ThemeSelector";
import MicAnswer from "./MicAnswer";
import Tuner from "./Tuner";
import { playPitchClass } from "../utils/audio";

type Direction = "up" | "down";
type DirectionSetting = "up" | "down" | "both";

type Question = {
  root: string;
  intervalId: string;
  semitones: number;
  answerPc: number;
  dir: Direction;
};

function resolveDir(setting: DirectionSetting): Direction {
  if (setting === "both") return Math.random() < 0.5 ? "up" : "down";
  return setting;
}

function makeQuestion(allowedIds: Set<string>, dirSetting: DirectionSetting): Question {
  const pool = INTERVALS.filter((i) => allowedIds.has(i.id));
  const interval = randomOf(pool);
  const root = randomOf(ROOT_POOL);
  const rootPc = toPitchClass(root)!;
  const dir = resolveDir(dirSetting);
  const delta = dir === "up" ? interval.semitones : -interval.semitones;
  const answerPc = addSemitones(rootPc, delta);
  return { root, intervalId: interval.id, semitones: interval.semitones, answerPc, dir };
}

// fast auto-advance on correct
const AUTO_NEXT_MS = 0;

type Stats = {
  correct: number; total: number; streak: number; best: number;
  totalTimeMs: number; lastTimeMs: number;
};

const STATS_STORAGE_KEY = "intervalQuizStatsV6";
function loadStats(): Stats | null {
  try { const raw = localStorage.getItem(STATS_STORAGE_KEY); return raw ? JSON.parse(raw) as Stats : null; } catch { return null; }
}
function saveStats(s: Stats) { try { localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(s)); } catch {} }
function msToSec(ms: number) { return (ms / 1000).toFixed(1); }

// sanitize input to 1 note + optional accidental
function sanitizeNoteInput(raw: string): string {
  if (!raw) return "";
  // strip spaces, normalize unicode sharps/flats
  let s = raw.replace(/\s+/g, "").replace(/♯/g, "#").replace(/♭/g, "b");
  // find first letter A-G
  const m = s.match(/[A-Ga-g]/);
  if (!m) return "";
  const note = m[0].toUpperCase();
  // look for first accidental after that
  const rest = s.slice(m.index! + 1);
  const accMatch = rest.match(/[#bB]/);
  if (accMatch) {
    const acc = accMatch[0] === "B" ? "b" : accMatch[0];
    return (note + acc).slice(0, 2);
  }
  return note;
}

export default function IntervalQuiz() {
  const [selected, setSelected] = useIntervalSelection();

  const [question, setQuestion] = React.useState<Question | null>(null);
  const [input, setInput] = React.useState("");
  const [disabled, setDisabled] = React.useState(false);
  const [qStartedAt, setQStartedAt] = React.useState<number>(() => Date.now());
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // mic + playback settings (persisted)
  const [micEnabled, setMicEnabled] = React.useState<boolean>(() => (localStorage.getItem("intervalQuiz.mic") ?? "false") === "true");
  const [playOctave, setPlayOctave] = React.useState<number>(() => Number(localStorage.getItem("intervalQuiz.octave") ?? 4));
  const [wave, setWave] = React.useState<OscillatorType>(() => (localStorage.getItem("intervalQuiz.wave") as OscillatorType) || "sine");
  React.useEffect(() => { localStorage.setItem("intervalQuiz.mic", String(micEnabled)); }, [micEnabled]);
  React.useEffect(() => { localStorage.setItem("intervalQuiz.octave", String(playOctave)); }, [playOctave]);
  React.useEffect(() => { localStorage.setItem("intervalQuiz.wave", wave); }, [wave]);

  // direction (persisted)
  const [dirSetting, setDirSetting] = React.useState<DirectionSetting>(() => {
    const raw = localStorage.getItem("intervalQuiz.direction") as DirectionSetting | null;
    return raw === "up" || raw === "down" || raw === "both" ? raw : "up";
  });
  React.useEffect(() => { localStorage.setItem("intervalQuiz.direction", dirSetting); }, [dirSetting]);

  // tuner + play suppression
  const [lastPitchHz, setLastPitchHz] = React.useState<number | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);

  // accept window config
  const HOLD_MS = 500;
  const CENTS_TOL = 25;

  // stats
  const [stats, setStats] = React.useState<Stats>(() =>
    loadStats() ?? { correct: 0, total: 0, streak: 0, best: 0, totalTimeMs: 0, lastTimeMs: 0 }
  );
  React.useEffect(() => { saveStats(stats); }, [stats]);

  function startNewQuestion() {
    if (selected.size === 0) {
      setQuestion(null); setInput(""); setDisabled(true); return;
    }
    const q = makeQuestion(selected, dirSetting);
    setQuestion(q);
    setQStartedAt(Date.now());
    setInput("");
    setDisabled(false);
    setLastPitchHz(null);
    setIsPlaying(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  React.useEffect(() => { startNewQuestion(); }, []);                       // mount
  React.useEffect(() => { startNewQuestion(); }, [selected, dirSetting]);   // selection/direction change

  function registerAttempt(ok: boolean, elapsed: number) {
    setStats((s) => {
      const total = s.total + 1;
      const correct = s.correct + (ok ? 1 : 0);
      const streak = ok ? s.streak + 1 : 0;
      const best = Math.max(s.best, streak);
      const totalTimeMs = ok ? s.totalTimeMs + elapsed : s.totalTimeMs;
      return { correct, total, streak, best, totalTimeMs, lastTimeMs: elapsed };
    });

    if (ok) {
      setDisabled(true);
      window.setTimeout(() => startNewQuestion(), AUTO_NEXT_MS);
    } else {
      // imperative pulse every time (re-triggers even on rapid Enter)
      const el = inputRef.current;
      if (el) {
        el.classList.remove("shake", "error-flash");
        // Force reflow twice to ensure restart across browsers
        void el.offsetWidth; void el.offsetWidth;
        el.classList.add("shake", "error-flash");
      }
      // leave input text untouched; user can press Enter repeatedly
    }
  }

  function submit() {
    if (disabled || !question) return;
    const elapsed = Date.now() - qStartedAt;
    const normalized = normalizeNoteInput(input);
    if (!normalized) {
      // still trigger red if empty/invalid
      registerAttempt(false, elapsed);
      return;
    }
    const expectedName = PC_TO_NAME[question.answerPc];
    const ok = isEnharmonicallyEqual(normalized, expectedName);
    registerAttempt(ok, elapsed);
  }

  function next() { startNewQuestion(); }

  // Global hotkeys — ignore while typing in inputs/selects/contentEditable
  React.useEffect(() => {
    function isTypingTarget(el: EventTarget | null) {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return; // typing 'n' or 's' is allowed
      const k = e.key.toLowerCase();
      if (k === "n") next();
      if (k === "s") setIsSettingsOpen((v) => !v);
      // no global Enter — only the input handles Enter
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qStartedAt]);

  const accuracy = stats.total === 0 ? 100 : Math.round((stats.correct / stats.total) * 100);
  const avgMs = stats.correct === 0 ? 0 : Math.round(stats.totalTimeMs / stats.correct);

  // mic callbacks
  const handleMicHeard = React.useCallback((_heardPc: number, _ok: boolean) => {}, []);
  const handleMicCorrect = React.useCallback(() => {
    if (!question || disabled) return;
    const elapsed = Date.now() - qStartedAt;
    registerAttempt(true, elapsed);
  }, [question, disabled, qStartedAt]);

  // play target (suspend mic while playing)
  function playTarget() {
    if (!question) return;
    const dur = 800; // ms
    setIsPlaying(true);
    const stop = playPitchClass(question.answerPc, playOctave, dur, wave);
    window.setTimeout(() => {
      try { stop && stop(); } catch {}
      setIsPlaying(false);
    }, dur + 40);
  }

  const dirArrow = question?.dir === "down" ? "↓" : "↑";

  return (
    <div className="panel">
      {/* Header */}
      <div className="panel-header">
        <div className="panel-title">Training</div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Open settings"
          title="Settings (S)"
          onClick={() => setIsSettingsOpen(true)}
        >⚙️</button>
      </div>

      {/* Stats */}
      <div className="controls row" style={{ marginTop: 6 }}>
        <span className="badge">Correct: {stats.correct}</span>
        <span className="badge">Tries: {stats.total}</span>
        <span className="badge">Accuracy: {accuracy}%</span>
        <span className="badge">Streak: {stats.streak}</span>
        <span className="badge">Best: {stats.best}</span>
        <span className="badge">Avg: {stats.correct ? `${msToSec(avgMs)}s` : "—"}</span>
        <span className="badge">Last: {stats.total ? `${msToSec(stats.lastTimeMs)}s` : "—"}</span>
      </div>

      {/* Question */}
      {selected.size === 0 ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Open <span className="kbd">Settings</span> to choose intervals to practice.
        </p>
      ) : question && (
        <div className="question centered">
          <div className="row center">
            <div className="big">Root: {question.root}</div>
            <div className="big">
              Interval: {question.intervalId}{" "}
              <span className="dir-arrow" title={question.dir === "down" ? "Down" : "Up"}>
                {dirArrow}
              </span>
            </div>
          </div>

          {/* centered main input box */}
          <div className="row center">
            <input
              ref={inputRef}
              className="input"
              placeholder="Type pitch (e.g., Gb)"
              value={input}
              onChange={(e) => setInput(sanitizeNoteInput(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
                // Prevent typing more than 2 chars or invalid chars in realtime
                const key = e.key;
                if (key.length === 1) {
                  const tentative = sanitizeNoteInput(input + key);
                  // If adding this char doesn't change or exceeds 2 chars, block it and handle sanitize onChange anyway
                  if (tentative.length > 2) {
                    e.preventDefault();
                  }
                }
              }}
              autoCapitalize="characters"
              autoCorrect="off"
              autoFocus
              disabled={disabled}
              maxLength={2}
              inputMode="text"
            />
            <button type="button" className="button" onClick={submit} disabled={disabled}>Check</button>
            <button type="button" className="button" onClick={next}>Next (n)</button>
            <button
              type="button"
              className="button"
              onClick={playTarget}
              title="Play target pitch (chosen octave)"
              disabled={isPlaying}
            >
              ▶ Play target
            </button>
          </div>

          {/* Mic listening + tuner */}
          {micEnabled && (
            <>
              <MicAnswer
                enabled={micEnabled && !disabled}
                suspend={isPlaying}
                targetPc={question.answerPc}
                onHeard={handleMicHeard}
                onCorrect={handleMicCorrect}
                onPitch={setLastPitchHz}
                holdMs={HOLD_MS}
                centsTolerance={CENTS_TOL}
              />
              <div className="row center">
                <Tuner hz={lastPitchHz} />
              </div>
            </>
          )}

          <p className="muted">
            Follow the direction arrow. Input a note like <span className="kbd">A</span> or <span className="kbd">Gb</span>.
            Type the note OR enable mic and hold it in tune (±{CENTS_TOL}¢) for {HOLD_MS}ms.
          </p>
        </div>
      )}

      {/* Settings */}
      <SettingsDialog
        title="Settings"
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <ThemeSelector />
          <hr className="div" />
          {/* Direction */}
          <div style={{ display: "grid", gap: 8 }}>
            <strong>Interval direction</strong>
            <div className="row">
              {(["up","down","both"] as DirectionSetting[]).map(opt => (
                <label key={opt} className="check" style={{ gap: 8 }}>
                  <input
                    type="radio"
                    name="direction"
                    checked={dirSetting === opt}
                    onChange={() => setDirSetting(opt)}
                  />
                  <span style={{ textTransform: "capitalize" }}>{opt}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <strong>Answer method</strong>
            <label className="check">
              <input
                type="checkbox"
                checked={micEnabled}
                onChange={(e) => setMicEnabled(e.target.checked)}
              />
              <span>Enable microphone answer (play note on your instrument)</span>
            </label>
            <p className="muted" style={{ marginTop: 0 }}>
              While playing the target tone, the mic is paused to avoid pickup.
            </p>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <strong>Playback (target note)</strong>
            <div className="row">
              <label className="check" style={{ gap: 8 }}>
                <span>Octave</span>
                <select
                  className="select"
                  value={playOctave}
                  onChange={(e) => setPlayOctave(Number(e.target.value))}
                >
                  {[2,3,4,5,6].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="check" style={{ gap: 8 }}>
                <span>Wave</span>
                <select
                  className="select"
                  value={wave}
                  onChange={(e) => setWave(e.target.value as OscillatorType)}
                >
                  {["sine","triangle","square","sawtooth"].map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <hr className="div" />
          <div>
            <p className="muted" style={{ marginTop: 0 }}>
              Pick which intervals to include in your quiz.
            </p>
            <IntervalPicker selected={selected} onChange={setSelected} />
          </div>
        </div>
      </SettingsDialog>
    </div>
  );
}
