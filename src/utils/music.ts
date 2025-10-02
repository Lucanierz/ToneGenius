export type PitchClass = number; // 0-11

// Canonical map of names -> semitone
export const NAME_TO_PC: Record<string, PitchClass> = {
  "C":0, "B#":0,
  "C#":1, "Db":1,
  "D":2,
  "D#":3, "Eb":3,
  "E":4, "Fb":4,
  "E#":5, "F":5,
  "F#":6, "Gb":6,
  "G":7,
  "G#":8, "Ab":8,
  "A":9,
  "A#":10,"Bb":10,
  "B":11,"Cb":11,
};

// A short, preferred display name for each PC (choose sharps by default)
export const PC_TO_NAME: Record<PitchClass, string> = {
  0:"C", 1:"C#", 2:"D", 3:"Eb", 4:"E", 5:"F",
  6:"F#", 7:"G", 8:"Ab", 9:"A", 10:"Bb", 11:"B"
};

export function normalizeNoteInput(input: string): string {
  // Trim + allow unicode sharps/flats
  const raw = input.trim().replace(/\s+/g, "");
  // Capture: letter + up to two accidentals
  const m = raw.match(/^([A-Ga-g])([#♯b♭]{0,2})$/);
  if (!m) return "";

  const letter = m[1].toUpperCase();
  const acc = m[2]
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    // keep # as '#', and make any 'b' accidental lowercase
    .replace(/B/g, "b");

  return letter + acc;
}


export function toPitchClass(name: string): PitchClass | null {
  const n = normalizeNoteInput(name);
  return n in NAME_TO_PC ? NAME_TO_PC[n] : null;
}

export function addSemitones(rootPc: PitchClass, delta: number): PitchClass {
  let v = (rootPc + (delta % 12));
  while (v < 0) v += 12;
  return v % 12;
}

// Accept enharmonics: compare by pitch class
export function isEnharmonicallyEqual(a: string, b: string): boolean {
  const apc = toPitchClass(a);
  const bpc = toPitchClass(b);
  return apc !== null && apc === bpc;
}

// Random helpers
export function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const ROOT_POOL = [
  "C","C#","Db","D","D#","Eb","E","F","F#","Gb","G","G#","Ab","A","A#","Bb","B",
];
