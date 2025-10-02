import React from "react";
import IntervalQuiz from "./components/IntervalQuiz";

export default function App() {
  return (
    <div className="app">
      <h1>Interval Quiz</h1>
      <p className="muted">
        You’ll see a root pitch and an interval. Type the resulting pitch
        (enharmonics accepted, e.g., F# = Gb).
      </p>
      <IntervalQuiz />
      <footer className="footer">
        <span>Tip: press Enter to submit, “n” for next.</span>
      </footer>
    </div>
  );
}