import React from "react";
import { INTERVALS, Interval } from "../data/intervals";

const STORAGE_KEY = "intervalQuiz.selectedIntervals.v1";

type Props = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
};

function loadDefaultSelection(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  // default: everything selected
  return new Set(INTERVALS.map(i => i.id));
}

export function useIntervalSelection(): [Set<string>, (next: Set<string>) => void] {
  const [selected, setSelected] = React.useState<Set<string>>(loadDefaultSelection);
  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected)));
    } catch {}
  }, [selected]);
  return [selected, setSelected];
}

export default function IntervalPicker({ selected, onChange }: Props) {
  const groups = React.useMemo(() => {
    const map: Record<Interval["group"], Interval[]> = { simple: [], extensions: [] };
    INTERVALS.forEach(i => map[i.group].push(i));
    return map;
  }, []);

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    checked ? next.add(id) : next.delete(id);
    onChange(next);
  }

  function selectAll(group?: "simple" | "extensions") {
    const next = new Set(selected);
    (group ? groups[group] : INTERVALS).forEach(i => next.add(i.id));
    onChange(next);
  }
  function clearAll(group?: "simple" | "extensions") {
    const next = new Set(selected);
    (group ? groups[group] : INTERVALS).forEach(i => next.delete(i.id));
    onChange(next);
  }

  return (
    <div className="picker">
      {(["simple","extensions"] as const).map((g) => (
        <div key={g} className="picker-section">
          <div className="picker-header">
            <strong>{g === "simple" ? "Simple" : "Extensions"}</strong>
            <div className="picker-actions">
              <button className="chip-btn" onClick={() => selectAll(g)}>All</button>
              <button className="chip-btn" onClick={() => clearAll(g)}>None</button>
            </div>
          </div>
          <div className="picker-grid">
            {groups[g].map((it) => (
              <label key={it.id} className="check">
                <input
                  type="checkbox"
                  checked={selected.has(it.id)}
                  onChange={(e) => toggle(it.id, e.target.checked)}
                />
                <span>{it.id}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="picker-footer">
        <button className="chip-btn" onClick={() => selectAll()}>Select all</button>
        <button className="chip-btn" onClick={() => clearAll()}>Clear all</button>
      </div>
    </div>
  );
}
