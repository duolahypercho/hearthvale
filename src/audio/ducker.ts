/**
 * Signal-driven music ducking (a real sidechain, not a schedule): an AudioWorklet envelope
 * follower listens to the gameplay SFX key bus and writes a gain-reduction signal into the music
 * chain's `sideDuck` gain.
 *
 *   key (world SFX, not footsteps) ─► hv-duck (RMS over ~10 ms → dB → static curve → attack 30 ms /
 *                                      release 250 ms ballistics) ─► sideDuck.gain (+= g − 1)
 *
 * Curve: nothing below the threshold, then 0.35 dB of reduction per dB over it, capped at `depth`
 * (3 dB). Works identically on AudioContext and OfflineAudioContext (the offline renders load it
 * before the graph is built). Where AudioWorklet is unavailable a native-node follower (square →
 * one-pole smoothing → negative gain) stands in: symmetric ballistics, same ceiling.
 */

export const DUCK_PROCESSOR = 'hv-duck';

const SRC = `
class HvDuck extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -46, automationRate: 'k-rate' },
      { name: 'slope', defaultValue: 0.35, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 3, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.03, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.25, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.ms = 0;
    this.gr = 0;
    this.last = 0;
    this.peak = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'peak') { this.port.postMessage({ peakGr: this.peak }); this.peak = 0; }
    };
  }
  process(inputs, outputs, p) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const n = out.length;
    const inp = inputs[0] || [];
    let ss = 0;
    let ch = 0;
    for (const c of inp) {
      if (!c) continue;
      ch++;
      for (let i = 0; i < n; i++) ss += c[i] * c[i];
    }
    const pow = ch ? ss / (n * ch) : 0;
    const a = Math.exp(-n / (sampleRate * 0.01));
    this.ms = a * this.ms + (1 - a) * pow;
    const lvl = 10 * Math.log10(this.ms + 1e-12);
    const target = Math.min(p.depth[0], Math.max(0, (lvl - p.threshold[0]) * p.slope[0]));
    const T = target > this.gr ? p.attack[0] : p.release[0];
    const k = Math.exp(-n / (sampleRate * Math.max(0.001, T)));
    this.gr = target + k * (this.gr - target);
    if (this.gr > this.peak) this.peak = this.gr;
    const g = Math.pow(10, -this.gr / 20) - 1;
    const from = this.last;
    for (let i = 0; i < n; i++) out[i] = from + ((g - from) * (i + 1)) / n;
    this.last = g;
    return true;
  }
}
registerProcessor('${DUCK_PROCESSOR}', HvDuck);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Register the envelope-follower worklet on `ctx` (idempotent). Resolves false where unsupported. */
export function loadDucker(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (p) return p;
  p = (async () => {
    try {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
      const url = URL.createObjectURL(new Blob([SRC], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      return true;
    } catch {
      return false;
    }
  })();
  loaded.set(ctx, p);
  return p;
}

/**
 * Wire a follower from `key` into `target` (a gain whose intrinsic value is 1). Returns the node
 * (worklet or fallback head) so callers can keep it alive / inspect it.
 */
export function attachDucker(ctx: BaseAudioContext, key: AudioNode, target: GainNode, worklet: boolean): AudioNode {
  if (worklet) {
    const node = new AudioWorkletNode(ctx, DUCK_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    key.connect(node);
    node.connect(target.gain);
    return node;
  }
  // Fallback: power follower from native nodes. x² (WaveShaper) → 6 Hz one-pole-ish lowpass →
  // scaled negative → soft ceiling (tanh curve) so it never dips more than ~3 dB.
  const sq = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = x * x;
  }
  sq.curve = curve;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4;
  lp.Q.value = 0.5;
  const amt = ctx.createGain();
  amt.gain.value = 400;
  const ceil = ctx.createWaveShaper();
  const c2 = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c2[i] = -0.29 * Math.tanh(Math.max(0, x) * 3);
  }
  ceil.curve = c2;
  key.connect(sq).connect(lp).connect(amt).connect(ceil).connect(target.gain);
  return sq;
}
