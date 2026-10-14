// 효과음은 WebAudio로 즉석 합성한다(외부 음원 없음). 첫 클릭 이후에만 소리가 난다.
// 모든 소리는 하나의 버스(압축기 + 짧은 울림)를 지나 한 공간에서 나는 소리처럼 묶인다.
// 음높이는 지형을 따른다: 높은 등고선을 벨수록 높게, 환원은 아래에서 위로, 공중 추가타는 이어질수록 높게.
const SCALE = [0, 3, 5, 7, 10, 12, 15]; // 고도 0~6 → 단조 5음 음계(반음)

export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private bus: GainNode | null = null;
  private room: GainNode | null = null;
  private chain = 0;
  private chainAt = -Infinity;
  muted = false;

  unlock(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      const c = new AC();
      this.ctx = c;
      const len = c.sampleRate * 0.5;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // 버스: 소리 → bus → 압축기 → 출력, 그리고 bus → room(짧은 지연 되먹임, 고역 감쇠) → 압축기
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 8;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      const master = c.createGain();
      master.gain.value = 0.85;
      comp.connect(master).connect(c.destination);
      this.bus = c.createGain();
      this.bus.connect(comp);
      const delay = c.createDelay(0.5);
      delay.delayTime.value = 0.085;
      const fb = c.createGain();
      fb.gain.value = 0.28;
      const damp = c.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2400;
      this.room = c.createGain();
      this.room.gain.value = 0.2;
      this.bus.connect(this.room);
      this.room.connect(delay);
      delay.connect(damp).connect(fb).connect(delay);
      damp.connect(comp);
    } catch {
      this.ctx = null;
    }
  }

  private get out(): AudioNode | null {
    return this.bus;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const c = this.ctx;
    const out = this.out;
    if (!c || !out || this.muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 대역 통과 잡음. f1을 주면 주파수가 그쪽으로 미끄러진다 */
  private hiss(dur: number, vol: number, f0: number, q = 1, f1 = f0, delay = 0): void {
    const c = this.ctx;
    const out = this.out;
    if (!c || !this.noise || !out || this.muted) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.1);
    s.stop(t + dur + 0.02);
  }

  /** 측량 절단. level = 벤 등고선 중 가장 높은 고도(없으면 -1: 빈 땅을 벰) */
  slash(level = -1): void {
    this.hiss(0.08, 0.22, 5200, 2.2, 2600);
    if (level >= 0) {
      const f = 660 * 2 ** (SCALE[Math.min(6, level)] / 12);
      this.tone('triangle', f * 1.5, f, 0.12, 0.07);
      this.tone('sine', f * 3, f * 2.9, 0.18, 0.025, 0.01);
    } else this.tone('triangle', 1400, 600, 0.06, 0.035);
  }
  /** 단층 침하: 낮은 둔음 + 부서지는 잡음 알갱이. 크기에 따라 길고 무겁게 */
  collapse(size: number): void {
    const k = Math.min(1, size / 80);
    this.tone('sine', 110, 34, 0.32 + k * 0.2, 0.32 + k * 0.2);
    this.hiss(0.35 + k * 0.2, 0.16 + k * 0.08, 420, 0.8, 140);
    for (let i = 0; i < 3; i++) this.hiss(0.05, 0.08, 900 + i * 500, 3, 600, 0.05 + i * 0.06);
  }
  hit(): void {
    this.tone('square', 300, 90, 0.07, 0.09);
    this.hiss(0.04, 0.12, 2400, 1.5);
  }
  kill(): void {
    this.tone('square', 520, 90, 0.16, 0.07);
    this.hiss(0.12, 0.12, 1600, 1, 500);
  }
  /** 절대 심연으로 떨어짐: 멀어지는 하강음 */
  fall(): void {
    this.tone('sine', 520, 55, 0.7, 0.09);
    this.tone('triangle', 260, 40, 0.7, 0.04, 0.03);
  }
  shock(): void {
    this.tone('sine', 82, 34, 0.3, 0.42);
    this.hiss(0.18, 0.16, 700, 0.8, 200);
  }
  hurt(): void {
    this.tone('sawtooth', 190, 60, 0.24, 0.11);
    this.hiss(0.16, 0.14, 1100, 0.7, 300);
  }
  dash(): void {
    this.hiss(0.13, 0.11, 900, 1.4, 3200);
  }
  fire(): void {
    this.tone('square', 900, 1300, 0.06, 0.035);
  }
  /** 환원 직전 경고: 짧은 두 번의 똑딱(높아짐) */
  warn(): void {
    this.tone('sine', 1320, 1320, 0.05, 0.05);
    this.tone('sine', 1760, 1760, 0.05, 0.05, 0.12);
  }
  /** 지형 환원: 아래에서 위로 솟는 소리 */
  restore(size: number): void {
    const k = Math.min(1, size / 80);
    this.tone('sine', 90, 360, 0.24, 0.16 + k * 0.1);
    this.hiss(0.24, 0.1, 300, 0.9, 2400);
  }
  /** 지형 환원으로 적이 튕겨 오름 */
  launch(): void {
    this.tone('triangle', 330, 990, 0.2, 0.11);
    this.tone('sine', 1320, 1980, 0.16, 0.04, 0.04);
  }
  /** 무방비 적에게 들어간 공중 추가타. 1.5초 안에 이어지면 음이 한 단계씩 오른다 */
  airHit(): void {
    const c = this.ctx;
    const now = c ? c.currentTime : 0;
    this.chain = now - this.chainAt < 1.5 ? Math.min(6, this.chain + 1) : 0;
    this.chainAt = now;
    const f = 880 * 2 ** (SCALE[this.chain] / 12);
    this.hiss(0.05, 0.22, 6000, 1.2, 3000);
    this.tone('sine', 150, 55, 0.16, 0.26);
    this.tone('triangle', f, f * 0.98, 0.26, 0.09);
    this.tone('triangle', f * 1.5, f * 1.49, 0.2, 0.045, 0.01);
  }
  blocked(): void {
    this.tone('triangle', 260, 180, 0.05, 0.05);
  }
  /** 새 단계(측량·환원) 시작: 두 음 */
  beat(): void {
    this.tone('triangle', 523, 523, 0.12, 0.07);
    this.tone('triangle', 784, 784, 0.18, 0.07, 0.1);
  }
  /** 구역 돌파 */
  clear(): void {
    this.tone('triangle', 523, 523, 0.14, 0.08);
    this.tone('triangle', 659, 659, 0.14, 0.08, 0.1);
    this.tone('triangle', 1047, 1047, 0.4, 0.08, 0.2);
    this.tone('sine', 82, 41, 0.4, 0.25);
  }
}
