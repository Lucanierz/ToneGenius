import React from "react";
import IntervalQuiz from "./components/IntervalQuiz";
import MetronomeModule from "./modules/MetronomeModule";
import ChromaticTunerModule from "./modules/ChromaticTunerModule";
import "./styles/index.css";

type ModuleKey = "quiz" | "tuner" | "metro";

type ModuleDef = {
  title: string;
  icon: string;
  render: () => React.ReactNode;
};

const MODULES: Record<ModuleKey, ModuleDef> = {
  quiz:  { title: "Interval Quiz",   icon: "🎯", render: () => <IntervalQuiz /> },
  tuner: { title: "Chromatic Tuner", icon: "🎚️", render: () => <ChromaticTunerModule /> },
  metro: { title: "Metronome",       icon: "🥁", render: () => <MetronomeModule /> },
};

type Tile = { id: string; key: ModuleKey };

const TILES_KEY = "app.tiles.v3";
const THEME_KEY = "app.theme.v1";

/* ---------- helpers ---------- */
function isModuleKey(v: unknown): v is ModuleKey {
  return v === "quiz" || v === "tuner" || v === "metro";
}
function isTile(v: any): v is Tile {
  return v && typeof v === "object" && typeof v.id === "string" && isModuleKey(v.key);
}
function loadTiles(): Tile[] {
  try {
    const raw = localStorage.getItem(TILES_KEY);
    if (!raw) return [{ id: makeId("quiz", 0), key: "quiz" }];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const clean = parsed.filter(isTile) as Tile[];
      return clean.length ? clean : [{ id: makeId("quiz", 0), key: "quiz" }];
    }
  } catch {}
  return [{ id: makeId("quiz", 0), key: "quiz" }];
}
function loadTheme(): "light" | "dark" {
  const saved = (localStorage.getItem(THEME_KEY) as "light" | "dark" | null);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
let _seed = 0;
function makeId(k: ModuleKey, n?: number) {
  const i = n ?? (_seed = (_seed + 1) % 1e6);
  return `${k}-${Date.now()}-${i}`;
}
/* ----------------------------- */

export default function App() {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [theme, setTheme] = React.useState<"light" | "dark">(loadTheme);
  const [tiles, setTiles] = React.useState<Tile[]>(loadTiles);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  React.useEffect(() => {
    try { localStorage.setItem(TILES_KEY, JSON.stringify(tiles)); } catch {}
  }, [tiles]);

  function addModule(key: ModuleKey) {
    setTiles((prev) => [...prev, { id: makeId(key), key }]);
  }
  function removeTile(id: string) {
    setTiles((prev) => prev.filter((t) => t.id !== id));
  }
  function toggleTheme() {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }

  /* ======= Pointer-based drag & drop (mobile + desktop) ======= */
  const canvasRef = React.useRef<HTMLElement | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [indicatorTop, setIndicatorTop] = React.useState<number | null>(null);
  const [targetIndex, setTargetIndex] = React.useState<number | null>(null);

  const HYSTERESIS_PX = 10;

  function measureGaps() {
    const canvas = canvasRef.current!;
    const tilesEls = Array.from(canvas.querySelectorAll<HTMLElement>(".tile"));
    const rects = tilesEls.map((el) => el.getBoundingClientRect());
    const canvasTopDoc = canvas.getBoundingClientRect().top + window.scrollY;

    const gapsDocY: number[] = [];
    if (rects.length === 0) {
      gapsDocY.push(canvasTopDoc);
    } else {
      gapsDocY.push(rects[0].top + window.scrollY);
      for (let i = 0; i < rects.length - 1; i++) {
        const mid = (rects[i].bottom + rects[i + 1].top) / 2;
        gapsDocY.push(mid + window.scrollY);
      }
      gapsDocY.push(rects[rects.length - 1].bottom + window.scrollY);
    }

    function toCanvasTop(docY: number) {
      return docY - canvasTopDoc;
    }
    return { gapsDocY, toCanvasTop };
  }

  function nearestGapIndex(docY: number, prevIdx: number | null, prevDocY: number | null, gapsDocY: number[]) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < gapsDocY.length; i++) {
      const d = Math.abs(gapsDocY[i] - docY);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (prevIdx != null && prevDocY != null) {
      const prevDist = Math.abs(prevDocY - docY);
      if (bestDist > prevDist - HYSTERESIS_PX) return prevIdx;
    }
    return bestIdx;
  }

  const dragDataRef = React.useRef<{ startId: string; lastIdx: number | null; lastDocY: number | null; } | null>(null);

  function startDrag(id: string, e: React.PointerEvent) {
    setDraggingId(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const { gapsDocY, toCanvasTop } = measureGaps();
    const docY = e.clientY + window.scrollY;
    const idx = nearestGapIndex(docY, null, null, gapsDocY);

    setTargetIndex(idx);
    setIndicatorTop(toCanvasTop(gapsDocY[idx]));
    dragDataRef.current = { startId: id, lastIdx: idx, lastDocY: docY };

    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none";
  }

  function onDragMove(e: React.PointerEvent) {
    if (!dragDataRef.current || draggingId == null) return;
    const { lastIdx, lastDocY } = dragDataRef.current;
    const { gapsDocY, toCanvasTop } = measureGaps();
    const docY = e.clientY + window.scrollY;
    const idx = nearestGapIndex(docY, lastIdx, lastDocY, gapsDocY);

    if (idx !== lastIdx) {
      setTargetIndex(idx);
      setIndicatorTop(toCanvasTop(gapsDocY[idx]));
      dragDataRef.current.lastIdx = idx;
    }
    dragDataRef.current.lastDocY = docY;
  }

  function endDrag() {
    if (!dragDataRef.current || draggingId == null || targetIndex == null) {
      cleanupDrag();
      return;
    }

    const fromId = dragDataRef.current.startId;
    const toIdxRaw = targetIndex;

    setTiles((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === fromId);
      if (fromIdx < 0) return prev.slice();
      let toIdx = toIdxRaw;
      if (fromIdx < toIdx) toIdx -= 1;
      toIdx = Math.max(0, Math.min(prev.length - 1, toIdx));
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });

    cleanupDrag();
  }

  function cleanupDrag() {
    setDraggingId(null);
    setIndicatorTop(null);
    setTargetIndex(null);
    dragDataRef.current = null;
    document.body.style.userSelect = "";
    document.body.style.touchAction = "";
  }

  return (
    <div className={`app ${drawerOpen ? "drawer-open" : ""}`}>
      {/* Top bar */}
      <header className="topbar">
        <button
          className={`hamburger ${drawerOpen ? "open" : ""}`}
          aria-label="Open modules"
          onClick={() => setDrawerOpen((v) => !v)}
          title="Modules"
        >
          <span />
          <span />
          <span />
        </button>
        <div className="brand">Modules</div>
        <div style={{ width: 40 }} />
      </header>

      {/* Drawer */}
      <aside className={`drawer ${drawerOpen ? "open" : ""}`}>
        <div className="drawer-header">
          <div className="drawer-title">Add to view</div>
          <button className="icon-btn" aria-label="Close" onClick={() => setDrawerOpen(false)} title="Close">✕</button>
        </div>

        <ul className="drawer-list">
          {(Object.keys(MODULES) as ModuleKey[]).map((k) => {
            const def = MODULES[k];
            return (
              <li key={k}>
                <button className="drawer-item" onClick={() => addModule(k)} title={`Add ${def.title}`}>
                  <span className="icon" aria-hidden>{def.icon}</span>
                  <span className="label">{def.title}</span>
                  <span className="check" aria-hidden>＋</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="drawer-foot">
          <span className="muted">Click to add tiles</span>
          <div className="theme-toggle">
            <button
              className="theme-btn"
              onClick={toggleTheme}
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              aria-label="Toggle theme"
            >
              {theme === "light" ? "🌙 Dark" : "☀️ Light"}
            </button>
          </div>
        </div>
      </aside>

      {/* Backdrop */}
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      {/* Main canvas with tiles stacked */}
      <main className="canvas" ref={canvasRef}>
        {/* Absolute overlay indicator */}
        {indicatorTop != null && (
          <div className="drop-indicator-overlay" style={{ top: `${indicatorTop}px` }} aria-hidden />
        )}

        {tiles.length === 0 ? (
          <div className="empty">
            <p className="muted">No modules yet. Open the menu and add some 👇</p>
          </div>
        ) : (
          tiles.map((t) => {
            const Def = MODULES[t.key];
            const isDragging = draggingId === t.id;
            return (
              <section className={`tile ${isDragging ? "dragging" : ""}`} key={t.id}>
                {/* NEW: Tile header bar with title on the left, controls on the right */}
                <div className="tile-bar">
                  <div className="tile-title">
                    <span className="tile-icon" aria-hidden>
                      {MODULES[t.key].icon}
                    </span>
                    {MODULES[t.key].title}
                  </div>
                  <div className="tile-controls">
                    <button
                      className="tile-close"
                      aria-label={`Remove ${Def.title}`}
                      title={`Remove ${Def.title}`}
                      onClick={() => removeTile(t.id)}
                    >
                      ✕
                    </button>
                    <div
                      className="tile-handle"
                      title="Drag to reorder"
                      aria-label="Drag to reorder"
                      onPointerDown={(e) => startDrag(t.id, e)}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={cleanupDrag}
                    >
                      <span className="grip" />
                      <span className="grip" />
                      <span className="grip" />
                    </div>
                  </div>
                </div>

                {/* Render module content; we hide its internal header via CSS */}
                {Def.render()}
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
