// 효과음은 WebAudio로 즉석 합성한다(외부 음원 없음). 첫 클릭 이후에만 소리가 난다.
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 0.4;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
    const c = this.ctx;
    if (!c || this.muted) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, freq: number, q = 1): void {
    const c = this.ctx;
    if (!c || !this.noise || this.muted) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(c.destination);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  slash(): void {
    this.hiss(0.09, 0.25, 4200, 2);
    this.tone('triangle', 1400, 500, 0.08, 0.05);
  }
  collapse(size: number): void {
    this.tone('sine', 120, 38, 0.35, Math.min(0.5, 0.2 + size / 200));
    this.hiss(0.3, 0.18, 300, 0.7);
  }
  hit(): void {
    this.tone('square', 320, 90, 0.08, 0.12);
  }
  kill(): void {
    this.tone('square', 660, 120, 0.18, 0.08);
  }
  fall(): void {
    this.tone('sine', 500, 60, 0.6, 0.1);
  }
  shock(): void {
    this.tone('sine', 90, 40, 0.25, 0.35);
    this.hiss(0.15, 0.15, 900, 0.8);
  }
  hurt(): void {
    this.tone('sawtooth', 200, 70, 0.22, 0.12);
  }
  dash(): void {
    this.hiss(0.12, 0.12, 1800, 1.2);
  }
  fire(): void {
    this.tone('square', 900, 1300, 0.06, 0.04);
  }
  /** 지형 환원으로 적이 튕겨 오름 */
  launch(): void {
    this.tone('triangle', 180, 720, 0.22, 0.12);
    this.hiss(0.18, 0.1, 1400, 1);
  }
  /** 무방비 적에게 들어간 공중 추가타 */
  airHit(): void {
    this.tone('square', 520, 160, 0.1, 0.14);
    this.tone('triangle', 1600, 900, 0.12, 0.08);
  }
  blocked(): void {
    this.tone('triangle', 260, 180, 0.05, 0.06);
  }
}
