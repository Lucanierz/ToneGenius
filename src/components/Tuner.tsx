import React from "react";
import { midiToFreq, freqToMidi } from "../utils/audio";
import { PC_TO_NAME } from "../utils/music";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

type Heat = "exact" | "near" | "mid" | "far";

export default function Tuner({ hz }: { hz: number | null }) {
  // Compute nearest MIDI note + cents offset
  let displayNote = "--";
  let octave = "";
  let cents = 0;
  let absCents = 100;

  if (hz && isFinite(hz)) {
    const midiFloat = freqToMidi(hz);
    const midiNearest = Math.round(midiFloat);
    const freqNearest = midiToFreq(midiNearest);
    const centsOffset = 1200 * Math.log2(hz / freqNearest); // +/- cents to nearest tempered pitch
    cents = clamp(Math.round(centsOffset), -50, 50);
    absCents = Math.abs(centsOffset);

    const pc = ((midiNearest % 12) + 12) % 12;
    const name = PC_TO_NAME[pc] || "?";
    const oct = Math.floor(midiNearest / 12) - 1; // MIDI octave
    displayNote = name;
    octave = String(oct);
  }

  // Map closeness (irrespective of the quiz target) to color classes
  // tweak thresholds to taste
  let heat: Heat = "far";
  if (absCents <= 5) heat = "exact";
  else if (absCents <= 15) heat = "near";
  else if (absCents <= 30) heat = "mid";
  else heat = "far";

  const posPct = (cents + 50) / 100; // 0..1 across the bar

  return (
    <div className="tuner">
      <div className="tuner-note">
        <span className="tuner-note-name">{displayNote}</span>
        <span className="tuner-octave">{octave}</span>
      </div>

      <div className="tuner-meter">
        <div className="tuner-scale">
          <span>−50¢</span>
          <span>0¢</span>
          <span>+50¢</span>
        </div>

        <div className={`tuner-track ${heat}`}>
          {/* heat overlay that color-codes the whole bar */}
          <div className="tuner-heat" />
          {/* needle + center mark */}
          <div className="tuner-needle" style={{ left: `${posPct * 100}%` }} />
          <div className="tuner-center-mark" />
        </div>

        <div className="tuner-cents">
          {hz
            ? (cents > 0 ? `+${Math.round(cents)}¢ (sharp)` : `${Math.round(cents)}¢ (flat)`)
            : "—"}
        </div>
      </div>
    </div>
  );
}
