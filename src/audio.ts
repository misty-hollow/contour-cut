// 효과음은 WebAudio로 즉석 합성한다(외부 음원 없음). 첫 클릭 이후에만 소리가 난다.
// 모든 소리는 하나의 버스(압축기 + 짧은 울림)를 지나 한 공간에서 나는 소리처럼 묶인다.
// 음높이는 지형을 따른다: 높은 등고선을 벨수록 높게, 환원은 아래에서 위로, 공중 추가타는 이어질수록 높게.
const SCALE = [0, 3, 5, 7, 10, 12, 15]; // 고도 0~6 → 단조 5음 음계(반음)

/** 구역 공기(render.ts Mood와 같은 이름) */
export type Ambience = 'rift' | 'canyon' | 'restore' | 'plain';

export class Sfx {
  private ctx: BaseAudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private bus: GainNode | null = null;
  private room: GainNode | null = null;
  private chain = 0;
  private chainAt = -Infinity;
  private amb: { gain: GainNode; stop: () => void } | null = null;
  private ambName: Ambience | null = null;
  private ambLevel = 1;
  private _muted = false;

  get muted(): boolean {
    return this._muted;
  }
  set muted(v: boolean) {
    this._muted = v;
    this.applyAmbLevel();
  }

  unlock(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.attach(new AC());
      if (this.ambName) this.ambience(this.ambName, true);
    } catch {
      this.ctx = null;
    }
  }

  /** 주어진 오디오 맥락에 버스를 만든다(실제 출력 또는 검증용 OfflineAudioContext) */
  attach(c: BaseAudioContext): void {
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
  }

  /** 오디오 맥락의 현재 시각(검증용) */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * 구역의 공기: 아주 작은 지속음. 균열 지대 = 낮은 울림과 바스락거림, 접힘 협곡 = 오르내리는 바람, 환원 구역 = 옅은 맑은 떨림.
   * 바뀌면 1초에 걸쳐 갈아 끼운다.
   */
  ambience(name: Ambience, force = false): void {
    if (!force && name === this.ambName) return;
    this.ambName = name;
    const c = this.ctx;
    const out = this.bus;
    if (!c || !out || !this.noise) return;
    const t = c.currentTime;
    if (this.amb) {
      const old = this.amb;
      old.gain.gain.setTargetAtTime(0, t, 0.3);
      setTimeout(() => old.stop(), 1500);
    }
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(out);
    const nodes: AudioScheduledSourceNode[] = [];
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    const ng = c.createGain();
    n.connect(f).connect(ng).connect(g);
    nodes.push(n);
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.connect(lg).connect(f.frequency);
    nodes.push(lfo);
    const drone = (freq: number, vol: number, type: OscillatorType = 'sine') => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const og = c.createGain();
      og.gain.value = vol;
      o.connect(og).connect(g);
      nodes.push(o);
    };
    if (name === 'canyon') {
      f.frequency.value = 900;
      f.Q.value = 0.8;
      ng.gain.value = 0.035;
      lfo.frequency.value = 0.13;
      lg.gain.value = 500;
      drone(49, 0.014);
    } else if (name === 'rift') {
      f.frequency.value = 260;
      f.Q.value = 1.2;
      ng.gain.value = 0.03;
      lfo.frequency.value = 0.07;
      lg.gain.value = 90;
      drone(41, 0.024);
      drone(61.5, 0.008);
    } else if (name === 'restore') {
      f.frequency.value = 2200;
      f.Q.value = 2;
      ng.gain.value = 0.009;
      lfo.frequency.value = 0.2;
      lg.gain.value = 600;
      drone(55, 0.012);
      drone(660, 0.004, 'triangle');
      drone(990.5, 0.003, 'triangle');
    } else {
      f.frequency.value = 500;
      f.Q.value = 0.7;
      ng.gain.value = 0.014;
      lfo.frequency.value = 0.1;
      lg.gain.value = 150;
      drone(46, 0.01);
    }
    for (const node of nodes) node.start(t);
    this.amb = {
      gain: g,
      stop: () => {
        for (const node of nodes) {
          try {
            node.stop();
          } catch {
            /* 이미 멈춤 */
          }
        }
        g.disconnect();
      },
    };
    this.applyAmbLevel(1.2);
  }

  /** 공기 크기: 1 = 플레이, 일시정지·결과 화면은 줄인다 */
  setAmbLevel(level: number): void {
    if (level === this.ambLevel) return;
    this.ambLevel = level;
    this.applyAmbLevel();
  }

  private applyAmbLevel(tc = 0.25): void {
    const c = this.ctx;
    if (!c || !this.amb) return;
    this.amb.gain.gain.setTargetAtTime(this._muted ? 0 : this.ambLevel, c.currentTime, tc);
  }

  /** 자주 나는 소리의 음높이를 ±3% 흔든다(같은 소리의 반복 피로를 줄인다) */
  private vary(): number {
    return 1 + (Math.random() - 0.5) * 0.06;
  }

  private get out(): AudioNode | null {
    return this.bus;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const c = this.ctx;
    const out = this.out;
    if (!c || !out || this._muted) return;
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
    if (!c || !this.noise || !out || this._muted) return;
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

  /** 쓰러짐: 공기가 꺼지듯 아래로 */
  down(): void {
    this.tone('sine', 220, 40, 0.9, 0.16);
    this.hiss(0.6, 0.1, 600, 0.7, 120);
  }
  /** 측량 절단. level = 벤 등고선 중 가장 높은 고도(없으면 -1: 빈 땅을 벰) */
  slash(level = -1): void {
    const v = this.vary();
    this.hiss(0.08, 0.22, 5200 * v, 2.2, 2600 * v);
    if (level >= 0) {
      const f = 660 * 2 ** (SCALE[Math.min(6, level)] / 12) * v;
      this.tone('triangle', f * 1.5, f, 0.12, 0.07);
      this.tone('sine', f * 3, f * 2.9, 0.18, 0.025, 0.01);
    } else this.tone('triangle', 1400, 600, 0.06, 0.035);
  }
  /** 단층 침하: 낮은 둔음 + 부서지는 잡음 알갱이. 크기에 따라 길고 무겁게 */
  collapse(size: number, delay = 0): void {
    const k = Math.min(1, size / 80);
    this.tone('sine', 110, 34, 0.32 + k * 0.2, 0.22 + k * 0.14, delay);
    this.hiss(0.35 + k * 0.2, 0.13 + k * 0.06, 420, 0.8, 140, delay);
    for (let i = 0; i < 3; i++) this.hiss(0.05, 0.08, 900 + i * 500, 3, 600, delay + 0.05 + i * 0.06);
  }
  hit(): void {
    const v = this.vary();
    this.tone('square', 300 * v, 90 * v, 0.07, 0.09);
    this.hiss(0.04, 0.12, 2400, 1.5);
  }
  kill(): void {
    const v = this.vary();
    this.tone('square', 520 * v, 90 * v, 0.16, 0.1);
    this.tone('sine', 130, 48, 0.2, 0.22);
    this.hiss(0.12, 0.17, 1600, 1, 500);
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
  /** 내가 맞음: 공격 성공(밝고 높은 소리)과 반대로 낮고 탁하게, 공기도 잠깐 눌린다 */
  hurt(): void {
    this.tone('sawtooth', 190, 60, 0.24, 0.11);
    this.tone('sine', 70, 40, 0.2, 0.22);
    this.hiss(0.16, 0.14, 1100, 0.7, 300);
    const c = this.ctx;
    if (c && this.amb && !this._muted) {
      const g = this.amb.gain.gain;
      g.cancelScheduledValues(c.currentTime);
      g.setValueAtTime(this.ambLevel * 0.3, c.currentTime);
      g.setTargetAtTime(this.ambLevel, c.currentTime + 0.15, 0.3);
    }
  }
  dash(): void {
    const v = this.vary();
    this.hiss(0.13, 0.17, 900 * v, 1.4, 3200 * v);
  }
  fire(): void {
    const v = this.vary();
    this.tone('square', 900 * v, 1300 * v, 0.06, 0.035);
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
    this.hiss(0.05, 0.3, 6000, 1.2, 3000);
    this.tone('sine', 150, 55, 0.18, 0.36);
    this.tone('triangle', f, f * 0.98, 0.3, 0.14);
    this.tone('triangle', f * 1.5, f * 1.49, 0.22, 0.07, 0.01);
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
