/**
 * KRONA — audio.
 * A small generative Nordic-folk ensemble (frame drum, wooden flute, low
 * drone, restrained voice-like pad) plus tavern ambience and poker foley,
 * all synthesised with the Web Audio API so nothing has to be downloaded.
 */

type Bus = "music" | "ambient" | "sfx";

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  gains: Record<Bus, GainNode> | null = null;
  noise: AudioBuffer | null = null;
  private started = false;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private volumes: Record<Bus, number> = { music: 0.45, ambient: 0.5, sfx: 0.7 };
  private drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private wind: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private fireTimer: number | null = null;

  init() {
    if (this.ctx) return;
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    const mk = (v: number) => {
      const g = this.ctx!.createGain();
      g.gain.value = v;
      g.connect(this.master!);
      return g;
    };
    this.gains = { music: mk(this.volumes.music), ambient: mk(this.volumes.ambient), sfx: mk(this.volumes.sfx) };
    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  setVolume(bus: Bus, v: number) {
    this.volumes[bus] = v;
    if (this.gains) this.gains[bus].gain.value = v;
  }

  async start() {
    this.init();
    if (!this.ctx || this.started) return;
    await this.ctx.resume();
    this.started = true;
    this.startDrone();
    this.startWind();
    this.nextTime = this.ctx.currentTime + 0.2;
    this.timer = window.setInterval(() => this.schedule(), 120);
    this.fireTimer = window.setInterval(() => this.fireCrackle(), 260);
  }

  stop() {
    if (this.timer) window.clearInterval(this.timer);
    if (this.fireTimer) window.clearInterval(this.fireTimer);
    this.timer = null;
    this.fireTimer = null;
    this.started = false;
    this.drone?.osc.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
    this.drone = null;
    if (this.wind) {
      try {
        this.wind.src.stop();
      } catch {
        /* ignore */
      }
      this.wind = null;
    }
  }

  /* ------------------------- ambience ------------------------- */

  private startDrone() {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    filter.Q.value = 1.2;
    g.connect(filter);
    filter.connect(this.gains!.music);
    const osc: OscillatorNode[] = [];
    const freqs = [55, 82.5, 110.3, 164.8];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? "triangle" : "sawtooth";
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = i === 0 ? 0.22 : 0.08;
      o.connect(og);
      og.connect(g);
      o.start();
      osc.push(o);
    });
    g.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 6);
    // slow breathing of the drone
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 130;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    osc.push(lfo);
    this.drone = { osc, gain: g };
  }

  private startWind() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.gains!.ambient);
    src.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = ctx.createGain();
    lg.gain.value = 200;
    lfo.connect(lg);
    lg.connect(filter.frequency);
    lfo.start();
    this.wind = { src, gain, filter };
  }

  private fireCrackle() {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + Math.random() * 0.22;
      const src = ctx.createBufferSource();
      src.buffer = this.noise!;
      src.playbackRate.value = 0.8 + Math.random() * 0.8;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 900 + Math.random() * 2200;
      f.Q.value = 3 + Math.random() * 5;
      const g = ctx.createGain();
      const amp = 0.035 + Math.random() * 0.05;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.08);
      src.connect(f);
      f.connect(g);
      g.connect(this.gains!.ambient);
      src.start(t, Math.random() * 1.2, 0.16);
      src.stop(t + 0.2);
    }
    if (Math.random() < 0.05) this.woodCreak();
  }

  private woodCreak() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70 + Math.random() * 40, t);
    o.frequency.linearRampToValueAtTime(40, t + 0.5);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 260;
    f.Q.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(f);
    f.connect(g);
    g.connect(this.gains!.ambient);
    o.start(t);
    o.stop(t + 0.65);
  }

  /* ------------------------- music ------------------------- */

  private schedule() {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const stepDur = 0.36;
    while (this.nextTime < ctx.currentTime + 0.8) {
      const t = this.nextTime;
      const s = this.step % 32;
      // frame drum: heartbeat pulse
      if (s % 8 === 0) this.drum(t, 0.16, 62);
      if (s % 8 === 3) this.drum(t, 0.09, 54);
      if (s % 16 === 11) this.drum(t, 0.12, 78);
      // wooden flute phrase
      if (s % 32 === 0) this.flutePhrase(t);
      if (s % 32 === 16 && Math.random() < 0.6) this.flutePhrase(t);
      // plucked string accent
      if (s % 8 === 5 && Math.random() < 0.5) this.pluck(t);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  private drum(t: number, vol: number, freq: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g);
    g.connect(this.gains!.music);
    o.start(t);
    o.stop(t + 0.3);
    // skin noise
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 320;
    f.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(f);
    f.connect(ng);
    ng.connect(this.gains!.music);
    src.start(t, Math.random(), 0.12);
    src.stop(t + 0.14);
  }

  private flutePhrase(t: number) {
    // A aeolian / nordic minor
    const scale = [220, 246.94, 261.63, 293.66, 329.63, 392, 440, 493.88];
    const notes = 3 + Math.floor(Math.random() * 4);
    let idx = Math.floor(Math.random() * scale.length);
    let time = t;
    for (let i = 0; i < notes; i++) {
      const dur = 0.32 + Math.random() * 0.4;
      const freq = scale[Math.max(0, Math.min(scale.length - 1, idx))];
      this.flute(time, dur, freq, 0.075);
      idx += Math.random() < 0.5 ? -1 : 1;
      if (idx < 0) idx = 2;
      if (Math.random() < 0.25) idx += Math.random() < 0.5 ? 2 : -2;
      idx = Math.max(0, Math.min(scale.length - 1, idx));
      time += dur * (Math.random() < 0.2 ? 2 : 1);
      if (time > t + 3.4) break;
    }
  }

  private flute(t: number, dur: number, freq: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    // vibrato
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6;
    const vg = ctx.createGain();
    vg.gain.value = freq * 0.006;
    vib.connect(vg);
    vg.connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.12);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    // breath
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const bf = ctx.createBiquadFilter();
    bf.type = "bandpass";
    bf.frequency.value = freq * 2;
    bf.Q.value = 2;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(vol * 0.16, t + 0.1);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.gains!.music);
    src.connect(bf);
    bf.connect(bg);
    bg.connect(this.gains!.music);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.15);
    vib.stop(t + dur + 0.15);
    src.start(t, Math.random(), dur);
    src.stop(t + dur);
  }

  private pluck(t: number) {
    const ctx = this.ctx!;
    const freq = [110, 146.8, 164.8, 220][Math.floor(Math.random() * 4)];
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.8);
    o.connect(f);
    f.connect(g);
    g.connect(this.gains!.music);
    o.start(t);
    o.stop(t + 1);
  }

  /* ------------------------- foley ------------------------- */

  private burst(bus: Bus, opts: {
    t?: number;
    dur: number;
    freq: number;
    q: number;
    vol: number;
    type?: BiquadFilterType;
    rate?: number;
  }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = opts.t ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.playbackRate.value = opts.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? "bandpass";
    f.frequency.value = opts.freq;
    f.Q.value = opts.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.vol, t + Math.min(0.02, opts.dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.gains![bus]);
    src.start(t, Math.random() * 0.5, opts.dur + 0.05);
    src.stop(t + opts.dur + 0.08);
  }

  private ping(freq: number, vol: number, dur: number, type: OscillatorType = "sine") {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.gains!.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  cardSlide() {
    this.burst("sfx", { dur: 0.19, freq: 1500, q: 0.8, vol: 0.11, type: "bandpass", rate: 0.7 });
    this.ping(180, 0.03, 0.09, "triangle");
  }
  cardFlip() {
    this.burst("sfx", { dur: 0.07, freq: 2600, q: 1.4, vol: 0.13 });
    this.burst("sfx", { t: this.ctx ? this.ctx.currentTime + 0.05 : 0, dur: 0.13, freq: 900, q: 0.9, vol: 0.08 });
  }
  cardDeal() {
    this.burst("sfx", { dur: 0.11, freq: 2100, q: 1, vol: 0.1, rate: 1.3 });
  }
  shuffle() {
    if (!this.ctx) return;
    for (let i = 0; i < 12; i++) {
      const t = this.ctx.currentTime + i * 0.035 + Math.random() * 0.02;
      this.burst("sfx", { t, dur: 0.06, freq: 1200 + Math.random() * 1800, q: 1.6, vol: 0.075 });
    }
  }
  chips(count = 3) {
    if (!this.ctx) return;
    for (let i = 0; i < count; i++) {
      const t = this.ctx.currentTime + i * (0.035 + Math.random() * 0.03);
      const f = 1800 + Math.random() * 1500;
      this.ping(f, 0.05 + Math.random() * 0.03, 0.1, "sine");
      this.ping(f * 1.5, 0.02, 0.06, "triangle");
      this.burst("sfx", { t, dur: 0.05, freq: 3200, q: 2, vol: 0.05 });
    }
  }
  chipPush() {
    this.burst("sfx", { dur: 0.16, freq: 700, q: 0.7, vol: 0.09, type: "lowpass", rate: 0.6 });
    this.chips(2);
  }
  potAward() {
    this.chips(6);
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.1;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0, t + i * 0.08);
      g.gain.linearRampToValueAtTime(0.07, t + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.5);
      o.connect(g);
      g.connect(this.gains!.sfx);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 0.55);
    });
  }
  fold() {
    this.burst("sfx", { dur: 0.22, freq: 1100, q: 0.6, vol: 0.1, rate: 0.8 });
  }
  click() {
    this.ping(520, 0.05, 0.05, "square");
    this.burst("sfx", { dur: 0.05, freq: 2000, q: 2, vol: 0.05 });
  }
  warn() {
    this.ping(180, 0.06, 0.22, "sawtooth");
  }
}

export const audio = new AudioEngine();
