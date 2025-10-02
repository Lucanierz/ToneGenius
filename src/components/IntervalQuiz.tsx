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
import ResultBadge from "./ResultBadge";
import IntervalPicker, { useIntervalSelection } from "./IntervalPicker";
import SettingsDialog from "./SettingsDialog";
import ThemeSelector from "./ThemeSelector";
import MicAnswer from "./MicAnswer";
import Tuner from "./Tuner";
import { playPitchClass } from "../utils/audio";

type Question = {
  root: string;
  intervalId: string;
  semitones: number;
  answerPc: number;
};

function makeQuestion(allowedIds: Set<string>): Question {
  const pool = INTERVALS.filter((i) => allowedIds.has(i.id));
  const interval = pool[Math.floor(Math.random() * pool.length)];
  const root = ROOT_POOL[Math.floor(Math.random() * ROOT_POOL.length)];
  const rootPc = toPitchClass(root)!;
  const answerPc = addSemitones(rootPc, interval.semitones);
  return { root, intervalId: interval.id, semitones: interval.semitones, answerPc };
}

const AUTO_NEXT_MS = 650;

type Stats = {
  correct: number; total: number; streak: number; best: number;
  totalTimeMs: number; lastTimeMs: number;
};

const STATS_STORAGE_KEY = "intervalQuizStatsV4";
function loadStats(): Stats | null {
  try { const raw = localStorage.getItem(STATS_STORAGE_KEY); return raw ? JSON.parse(raw) as Stats : null; } catch { return null; }
}
function saveStats(s: Stats) { try { localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(s)); } catch {} }
function msToSec(ms: number) { return (ms / 1000).toFixed(1); }

export default function IntervalQuiz() {
  const [selected, setSelected] = useIntervalSelection();

  const [question, setQuestion] = React.useState<Question | null>(null);
  const [input, setInput] = React.useState("");
  const [feedback, setFeedback] = React.useState<null | { ok: boolean; user: string; expectedName: string }>(null);
  const [disabled, setDisabled] = React.useState(false);
  const [qStartedAt, setQStartedAt] = React.useState<number>(() => Date.now());
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);

  // mic + playback settings (persisted)
  const [micEnabled, setMicEnabled] = React.useState<boolean>(() => (localStorage.getItem("intervalQuiz.mic") ?? "false") === "true");
  const [playOctave, setPlayOctave] = React.useState<number>(() => Number(localStorage.getItem("intervalQuiz.octave") ?? 4));
  const [wave, setWave] = React.useState<OscillatorType>(() => (localStorage.getItem("intervalQuiz.wave") as OscillatorType) || "sine");
  React.useEffect(() => { localStorage.setItem("intervalQuiz.mic", String(micEnabled)); }, [micEnabled]);
  React.useEffect(() => { localStorage.setItem("intervalQuiz.octave", String(playOctave)); }, [playOctave]);
  React.useEffect(() => { localStorage.setItem("intervalQuiz.wave", wave); }, [wave]);

  // tuner live pitch
  const [lastPitchHz, setLastPitchHz] = React.useState<number | null>(null);

  // block mic while playing target
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
      setQuestion(null); setInput(""); setFeedback(null); setDisabled(true); return;
    }
    setQuestion(makeQuestion(selected));
    setQStartedAt(Date.now());
    setInput("");
    setFeedback(null);
    setDisabled(false);
    setLastPitchHz(null);
    setIsPlaying(false);
  }

  React.useEffect(() => { startNewQuestion(); }, []);          // mount
  React.useEffect(() => { startNewQuestion(); }, [selected]);  // selection change

  function registerAttempt(ok: boolean, normalized: string, expectedName: string, elapsed: number) {
    setFeedback({ ok, user: normalized, expectedName });
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
    }
  }

  function submit() {
    if (disabled || !question) return;
    const elapsed = Date.now() - qStartedAt;
    const normalized = normalizeNoteInput(input);
    if (!normalized) return;
    const expectedName = PC_TO_NAME[question.answerPc];
    const ok = isEnharmonicallyEqual(normalized, expectedName);
    registerAttempt(ok, normalized, expectedName, elapsed);
  }

  function next() { startNewQuestion(); }

  // hotkeys
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") submit();
      if (e.key.toLowerCase() === "n") next();
      if (e.key.toLowerCase() === "s") setIsSettingsOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qStartedAt, input, disabled, question]);

  const accuracy = stats.total === 0 ? 100 : Math.round((stats.correct / stats.total) * 100);
  const avgMs = stats.correct === 0 ? 0 : Math.round(stats.totalTimeMs / stats.correct);
  const expectedName = question ? PC_TO_NAME[question.answerPc] : "";

  // mic callbacks
  const handleMicHeard = React.useCallback((heardPc: number, ok: boolean) => {
    // could surface info if desired
  }, []);
  const handleMicCorrect = React.useCallback(() => {
    if (!question || disabled) return;
    const elapsed = Date.now() - qStartedAt;
    const expectedName = PC_TO_NAME[question.answerPc];
    registerAttempt(true, "(mic)", expectedName, elapsed);
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

  return (
    <div className="panel">
      {/* Header */}
      <div className="panel-header">
        <div className="panel-title">Training</div>
        <button
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
            <div className="big">Interval: {question.intervalId}</div>
          </div>

          {/* centered main input box */}
          <div className="row center">
            <input
              className="input"
              placeholder="Type pitch (e.g., Gb)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoFocus
              disabled={disabled}
            />
            <button className="button" onClick={submit} disabled={disabled}>Check</button>
            <button className="button" onClick={next}>Next (n)</button>
            <button
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
                suspend={isPlaying}                  // <<< pause mic while playing
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

          {feedback && (
            <>
              <hr className="div" />
              {feedback.ok ? (
                <ResultBadge status="ok" message={`Correct! ${feedback.user} ✔`} />
              ) : (
                <ResultBadge
                  status="err"
                  message={`Not quite. You typed ${feedback.user}; expected ${expectedName}.`}
                />
              )}
            </>
          )}

          <p className="muted">
            Type the note OR enable mic and <em>hold</em> it in tune (±{CENTS_TOL}¢) for {HOLD_MS}ms.
            Enharmonics accepted (e.g., <span className="kbd">F#</span> = <span className="kbd">Gb</span>).
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
