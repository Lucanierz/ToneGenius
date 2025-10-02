// src/utils/audio.ts
// WebAudio helpers + YIN/autocorrelation pitch detection with pre-filtering.

let audioCtx: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return audioCtx;
}

export type MicAnalyserOptions = {
  fftSize?: number;          // default 8192 for steadier low notes
  filtering?: boolean;       // pre-filter input
  hpHz?: number;             // high-pass cutoff
  lpHz?: number;             // low-pass cutoff
  notch50?: boolean;         // notch 50Hz hum
  notch60?: boolean;         // notch 60Hz hum
};

/** Start mic and return {analyser, cleanup, stream}. Throws on permission error. */
export async function startMicAnalyser(opts: MicAnalyserOptions = {}): Promise<{
  analyser: AnalyserNode;
  cleanup: () => void;
  stream: MediaStream;
}> {
  const {
    fftSize = 8192,          // bigger window -> better low-frequency stability
    filtering = true,
    hpHz = 45,               // allow more low content for bass instruments
    lpHz = 1200,             // keep fundamentals; tame upper harmonics
    notch50 = true,
    notch60 = false,
  } = opts;

  const ctx = getAudioContext();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });

  const source = ctx.createMediaStreamSource(stream);

  // Optional pre-filtering: HPF -> (hum notch) -> LPF
  let lastNode: AudioNode = source;
  if (filtering) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = hpHz;
    hp.Q.value = 0.707;
    lastNode.connect(hp);
    lastNode = hp;

    if (notch50) {
      const n50 = ctx.createBiquadFilter();
      n50.type = "notch";
      n50.frequency.value = 50;
      n50.Q.value = 30;
      lastNode.connect(n50);
      lastNode = n50;
    }
    if (notch60) {
      const n60 = ctx.createBiquadFilter();
      n60.type = "notch";
      n60.frequency.value = 60;
      n60.Q.value = 30;
      lastNode.connect(n60);
      lastNode = n60;
    }

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lpHz;
    lp.Q.value = 0.707;
    lastNode.connect(lp);
    lastNode = lp;
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0.94; // steadier frames
  lastNode.connect(analyser);

  const cleanup = () => {
    try { lastNode.disconnect(); } catch {}
    try { source.disconnect(); } catch {}
    stream.getTracks().forEach((t) => t.stop());
  };

  return { analyser, cleanup, stream };
}

/** Classic autocorrelation (kept in case you need it elsewhere). */
export function detectPitchHzACF(analyser: AnalyserNode, minHz = 70, maxHz = 1200): number | null {
  const sampleRate = analyser.context.sampleRate;
  const N = analyser.fftSize;
  const buf = new Float32Array(N);
  analyser.getFloatTimeDomainData(buf);

  let rms = 0;
  for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / N);
  if (rms < 0.006) return null;

  // remove DC
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  for (let i = 0; i < N; i++) buf[i] -= mean;

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= Math.min(maxLag, N - 1); lag++) {
    let corr = 0;
    for (let i = 0; i < N - lag; i++) corr += buf[i] * buf[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  if (bestLag <= 0) return null;

  const y1 = acAtLag(buf, bestLag - 1);
  const y2 = acAtLag(buf, bestLag);
  const y3 = acAtLag(buf, bestLag + 1);
  let refined = bestLag;
  const denom = (y1 - 2 * y2 + y3);
  if (denom !== 0) refined = bestLag + 0.5 * (y1 - y3) / denom;

  const f = sampleRate / refined;
  return isFinite(f) ? f : null;
}

function acAtLag(buf: Float32Array, lag: number): number {
  if (lag < 1 || lag >= buf.length) return 0;
  let s = 0;
  for (let i = 0; i < buf.length - lag; i++) s += buf[i] * buf[i + lag];
  return s;
}

/** YIN pitch detector (De Cheveigné & Kawahara) — rock solid on low notes. */
export function detectPitchHzYIN(
  analyser: AnalyserNode,
  minHz = 30,
  maxHz = 800,
  threshold = 0.12
): number | null {
  const sr = analyser.context.sampleRate;
  const N = analyser.fftSize;
  const buf = new Float32Array(N);
  analyser.getFloatTimeDomainData(buf);

  // quick gate
  let rms = 0;
  for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / N);
  if (rms < 0.006) return null;

  // difference function d(tau)
  const maxTau = Math.min(Math.floor(sr / minHz), N - 1);
  const minTau = Math.max(2, Math.floor(sr / maxHz));
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < N - tau; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // cumulative mean normalized difference CMND
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = d[tau] * tau / running;
  }

  // absolute threshold
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (cmnd[t] < threshold) {
      // local minimum around t
      while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;

  // parabolic interpolation around tau
  const x0 = tau <= 1 ? tau : tau - 1;
  const x2 = tau + 1 > maxTau ? tau : tau + 1;
  const y0 = cmnd[x0], y1 = cmnd[tau], y2 = cmnd[x2];
  const denom = (y0 - 2 * y1 + y2);
  const betterTau = denom !== 0 ? tau + 0.5 * (y0 - y2) / denom : tau;

  const f = sr / betterTau;
  return isFinite(f) ? f : null;
}

/** Conversions */
export function freqToMidi(f: number): number { return 69 + 12 * Math.log2(f / 440); }
export function midiToFreq(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }
export function midiToPc(m: number): number { let x = Math.round(m) % 12; return x < 0 ? x + 12 : x; }
export function freqToPc(f: number): number { return midiToPc(freqToMidi(f)); }

/** Simple tone player */
export function playPitchClass(pc: number, octave = 4, ms = 700, type: OscillatorType = "sine", gainDb = -6) {
  const ctx = getAudioContext();
  const midi = (octave + 1) * 12 + pc; // C4=60
  const freq = midiToFreq(midi);

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  const linear = Math.pow(10, gainDb / 20);
  gain.gain.value = 0;

  osc.connect(gain).connect(ctx.destination);

  const now = ctx.currentTime;
  gain.gain.linearRampToValueAtTime(linear, now + 0.01);
  gain.gain.linearRampToValueAtTime(linear * 0.9, now + ms / 1000 - 0.05);
  gain.gain.linearRampToValueAtTime(0, now + ms / 1000);

  osc.start();
  osc.stop(now + ms / 1000 + 0.02);

  return () => {
    try { osc.stop(); } catch {}
    try { osc.disconnect(); } catch {}
    try { gain.disconnect(); } catch {}
  };
}
