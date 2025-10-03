export type Theme = "light" | "dark";

const KEY = "app.theme";

export function getSavedTheme(): Theme {
  const t = (localStorage.getItem(KEY) as Theme | null) || "dark";
  return t === "light" ? "light" : "dark";
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", t);
  localStorage.setItem(KEY, t);
}

export function toggleTheme(): Theme {
  const next = getSavedTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}
