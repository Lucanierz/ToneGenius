// src/App.tsx
import React from "react";
import IntervalQuiz from "./components/IntervalQuiz";
import ChromaticTunerModule from "./modules/ChromaticTunerModule";
import { applyTheme, getSavedTheme, toggleTheme, type Theme } from "./utils/theme";
import MetronomeModule from "./modules/MetronomeModule";


type ModuleKey = "quiz" | "tuner" | "metro";

const MODULES: Record<ModuleKey, { title: string; component: React.ReactNode }> = {
  quiz: { title: "Interval Quiz", component: <IntervalQuiz /> },
  tuner: { title: "Chromatic Tuner", component: <ChromaticTunerModule /> },
  metro: { title: "Metronome", component: <MetronomeModule /> }, // ⬅️ here
};

export default function App() {
  const [open, setOpen] = React.useState(false);
  const [mod, setMod] = React.useState<ModuleKey>(() => {
    const saved = localStorage.getItem("app.module") as ModuleKey | null;
    return saved === "tuner" ? "tuner" : "quiz";
  });
  const [theme, setTheme] = React.useState<Theme>(() => getSavedTheme());

  // Apply theme on mount & whenever it changes
  React.useEffect(() => { applyTheme(theme); }, [theme]);

  React.useEffect(() => {
    localStorage.setItem("app.module", mod);
  }, [mod]);

  function select(m: ModuleKey) {
    setMod(m);
    setOpen(false);
  }

  function toggleThemeClick() {
    const t = toggleTheme();
    setTheme(t);
  }

  return (
    <div className="app-root">
      {/* Hamburger toggles open/close and morphs into X */}
      <button
        className={`hamburger ${open ? "open" : ""}`}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        title="Menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span />
        <span />
        <span />
      </button>

      {/* Side drawer */}
      <div className={`drawer ${open ? "open" : ""}`} onClick={() => setOpen(false)}>
        <nav className="drawer-panel" onClick={(e) => e.stopPropagation()}>
          <div className="drawer-header">
            <strong>Modules</strong>
            <button className="drawer-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>

          <ul className="drawer-list">
            <li>
              <button
                className={`drawer-item ${mod === "quiz" ? "active" : ""}`}
                onClick={() => select("quiz")}
              >
                <span className="icon" aria-hidden>🎯</span>
                <span>Interval Quiz</span>
              </button>
            </li>

            <li>
              <button
                className={`drawer-item ${mod === "tuner" ? "active" : ""}`}
                onClick={() => select("tuner")}
              >
                <span className="icon" aria-hidden>🎚️</span>
                <span>Chromatic Tuner</span>
              </button>
            </li>

            <li>
              <button
                className={`drawer-item ${mod === "metro" ? "active" : ""}`}
                onClick={() => select("metro")}
              >
                <span className="icon" aria-hidden>🥁</span>
                <span>Metronome</span>
              </button>
            </li>
          </ul>


          <div className="drawer-footer">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleThemeClick}
              aria-label="Toggle theme"
              title={theme === "light" ? "Switch to dark" : "Switch to light"}
            >
              <span className="theme-icon">{theme === "light" ? "🌙" : "☀️"}</span>
              <span className="theme-text">{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
            </button>

            <small className="drawer-tip">
              Tip: press <span className="kbd">Esc</span> to close
            </small>
          </div>
        </nav>
      </div>

      {/* Current module content */}
      <div className="app-content">
        {MODULES[mod].component}
      </div>

      {/* Close on ESC */}
      <EscCatcher onEsc={() => setOpen(false)} />
    </div>
  );
}

function EscCatcher({ onEsc }: { onEsc: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onEsc(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEsc]);
  return null;
}
