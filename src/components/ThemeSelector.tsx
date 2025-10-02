import React from "react";
import { useTheme } from "../theme";

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong>Appearance</strong>
      <div style={{ display: "flex", gap: 10 }}>
        <label className="check">
          <input
            type="radio"
            name="theme"
            checked={theme === "light"}
            onChange={() => setTheme("light")}
          />
          <span>Light</span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="theme"
            checked={theme === "dark"}
            onChange={() => setTheme("dark")}
          />
          <span>Dark</span>
        </label>
      </div>
    </div>
  );
}
