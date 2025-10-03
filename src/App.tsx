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

const TILES_KEY = "app.tiles.v2";
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

  // drop indicator index (0..tiles.length), or null when not dragging
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);

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

  /* ------- Drag & Drop reordering (HTML5 DnD) ------- */
  const dragIdRef = React.useRef<string | null>(null);

  function onDragStart(id: string, ev: React.DragEvent) {
    dragIdRef.current = id;
    ev.dataTransfer.setData("text/plain", id);
    ev.dataTransfer.effectAllowed = "move";
    // show initial indicator where the dragged tile currently is
    const idx = tiles.findIndex((t) => t.id === id);
    setDropIndex(idx);
  }

  function onDragOverTile(overId: string, ev: React.DragEvent<HTMLElement>) {
    ev.preventDefault(); // allow drop
    ev.dataTransfer.dropEffect = "move";

    const el = ev.currentTarget;
    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const before = ev.clientY < midY;

    const overIdx = tiles.findIndex((t) => t.id === overId);
    if (overIdx < 0) return;

    const idx = before ? overIdx : overIdx + 1;
    if (dropIndex !== idx) setDropIndex(idx);
  }

  function onDragOverCanvasEnd(ev: React.DragEvent<HTMLElement>) {
    // when dragging below the last tile, indicate append
    ev.preventDefault();
    const endIdx = tiles.length;
    if (dropIndex !== endIdx) setDropIndex(endIdx);
  }

  function onDrop(ev: React.DragEvent) {
    ev.preventDefault();
    const fromId = dragIdRef.current || ev.dataTransfer.getData("text/plain");
    const targetIndex = dropIndex;
    dragIdRef.current = null;
    setDropIndex(null);
    if (!fromId || targetIndex == null) return;

    setTiles((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === fromId);
      if (fromIdx < 0) return prev;
      let toIdx = targetIndex;
      // if dragging downwards past own position, the removal shifts the target left by 1
      if (fromIdx < toIdx) toIdx -= 1;
      if (toIdx < 0 || toIdx > prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  function onDragEnd() {
    dragIdRef.current = null;
    setDropIndex(null);
  }
  /* --------------------------------------------------- */

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
          <button
            className="icon-btn"
            aria-label="Close"
            onClick={() => setDrawerOpen(false)}
            title="Close"
          >
            ✕
          </button>
        </div>

        <ul className="drawer-list">
          {(Object.keys(MODULES) as ModuleKey[]).map((k) => {
            const def = MODULES[k];
            return (
              <li key={k}>
                <button
                  className="drawer-item"
                  onClick={() => addModule(k)}
                  title={`Add ${def.title}`}
                >
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
      <main
        className="canvas"
        // allow drop at the very end (below last tile)
        onDragOver={onDragOverCanvasEnd}
        onDrop={onDrop}
      >
        {tiles.length === 0 ? (
          <div className="empty">
            <p className="muted">No modules yet. Open the menu and add some 👇</p>
          </div>
        ) : (
          tiles.map((t, i) => {
            const Def = MODULES[t.key];
            return (
              <React.Fragment key={t.id}>
                {/* drop indicator BEFORE this tile */}
                {dropIndex === i && <div className="drop-indicator" aria-hidden />}

                <section
                  className="tile"
                  draggable
                  onDragStart={(e) => onDragStart(t.id, e)}
                  onDragOver={(e) => onDragOverTile(t.id, e)}
                  onDrop={onDrop}
                  onDragEnd={onDragEnd}
                >
                  {/* Controls bar: more spacing, no overlap */}
                  <div className="tile-controls">
                    <button
                      className="tile-close"
                      aria-label={`Remove ${Def.title}`}
                      title={`Remove ${Def.title}`}
                      onClick={() => removeTile(t.id)}
                    >
                      ✕
                    </button>
                    <div className="tile-handle" title="Drag to reorder" aria-label="Drag to reorder">
                      <span className="grip" />
                      <span className="grip" />
                      <span className="grip" />
                    </div>
                  </div>

                  {Def.render()}
                </section>

                {/* If indicator should sit AFTER last tile */}
                {i === tiles.length - 1 && dropIndex === tiles.length && (
                  <div className="drop-indicator" aria-hidden />
                )}
              </React.Fragment>
            );
          })
        )}
      </main>
    </div>
  );
}
