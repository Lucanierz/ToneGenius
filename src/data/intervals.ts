export type Interval = {
  id: string;       // short label shown to user
  semitones: number; // modulo-12 distance
  group: "simple" | "extensions";
};

/**
 * Intervals you want to drill. All “compound” ones map mod 12.
 * Add/remove freely.
 */
export const INTERVALS: Interval[] = [
  // simple
  { id: "m2", semitones: 1, group: "simple" },
  { id: "M2", semitones: 2, group: "simple" },
  { id: "m3", semitones: 3, group: "simple" },
  { id: "M3", semitones: 4, group: "simple" },
  { id: "P4", semitones: 5, group: "simple" },
  { id: "TT", semitones: 6, group: "simple" }, // Tritone
  { id: "P5", semitones: 7, group: "simple" },
  { id: "m6", semitones: 8, group: "simple" },
  { id: "M6", semitones: 9, group: "simple" },
  { id: "m7", semitones: 10, group: "simple" },
  { id: "M7", semitones: 11, group: "simple" },

  // extensions (mod 12)
  { id: "b9", semitones: 1, group: "extensions" },
  { id: "9",  semitones: 2, group: "extensions" },
  { id: "#9", semitones: 3, group: "extensions" },
  { id: "11", semitones: 5, group: "extensions" },
  { id: "#11",semitones: 6, group: "extensions" },
  { id: "b13",semitones: 8, group: "extensions" },
  { id: "13", semitones: 9, group: "extensions" },
];
