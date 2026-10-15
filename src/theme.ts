import { CELL, GRID_H, GRID_W, VIEW_W, VIEW_H } from './config';

/**
 * 구역별 환경 재질(그리기 전용). 지형 규칙·판정과 무관하고 화면만 바꾼다.
 * 지면 색 계단·절벽면·그림자 길이와, 땅에 붙어 함께 오르내리는 표면 무늬(평면 좌표 캔버스)를 구역마다 만든다.
 * 무늬는 원래 지형(base)으로 정해져서, 무너진 땅도 제 무늬를 지닌 채 내려앉는다(돌아올 땅이 읽힌다).
 */

/** 구역 분위기 */
export type Mood = 'rift' | 'canyon' | 'restore' | 'plain';

// 측량 잉크 팔레트: 고도마다 다른 형광색 등고선(모든 구역 공통 — 전투 정보는 구역이 바뀌어도 같은 색)
export const LINE = ['#2f7bff', '#19f5c8', '#6cff4f', '#e8ff3a', '#ffb02e', '#ff4fa3', '#b77bff'];

/** 평면(지도) 크기(px) */
export const PLANE_W = GRID_W * CELL;
export const PLANE_H = GRID_H * CELL;

export interface Theme {
  mood: Mood;
  /** 고도별 윗면 색 */
  top: string[];
  /** 고도별 절벽면 색과 세로 빗금 색 */
  wall: string[];
  wallStripe: string[];
  /** 고도별 측량 눈금(+) 색 */
  tick: string[];
  /** 절벽면 지층 띠(고도마다 번갈아). null이면 단색 면 */
  strata: string[] | null;
  /** 절벽면 세로 광맥(환원 구역의 시안 줄). null이면 없음 */
  vein: string | null;
  /** 서쪽에서 오는 빛의 그림자: 1단 차이당 길이(px), 몇 칸 서쪽 지형까지 보나, 진하기, 최대 폭 */
  shadow: { slope: number; reach: number; alpha: number; cap: number };
  /** 이 높이 이하(원래 지형)는 바닥 무늬, 위는 높은 땅 무늬 */
  floorLevel: number;
  /**
   * 표면 무늬(평면 좌표, 반투명): 원래 바닥인 칸에는 바닥 무늬, 높은 땅에는 높은 땅 무늬를 칸 경계로 오려 붙여 한 장으로 합성했다.
   * 바닥 무늬의 시간 변화(균열 불씨가 숨쉬고, 환원 고리 파동이 바깥으로 퍼진다)는 장을 바꿔 보인다(surfaceFps 장/초).
   * 같은 높이로 이어진 칸을 한 번에 옮겨 그리므로 프레임마다 겹쳐 그리지 않는다
   */
  surface: HTMLCanvasElement[];
  surfaceFps: number;
  /** 바닥·심연 위를 흐르는 안개(접힘 협곡). 폭은 평면의 2배(이어 붙는 무늬) */
  fog: HTMLCanvasElement | null;
  /** 배경: 지평선 실루엣·원점 타워·지도 윗변 자 */
  horizon: HTMLCanvasElement;
}

/** 원점 타워가 지평선에 서 있는 x(내부 화면 px) */
export const TOWER_X = 240;

/** 두 #rrggbb 색을 t(0~1)만큼 섞는다 */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** 그리기 전용 결정적 난수(같은 지형이면 같은 무늬 — 다시 시작해도 땅이 그대로 보인다) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** 고도 계단(남색 명도) — 무한 웨이브·실험 시나리오. 이전 화면 그대로 */
const RAMP_PLAIN = ['#0a0d1b', '#0c1124', '#151d3c', '#1f2a55', '#2a376c', '#344583', '#3f529a'];
/** 균열 지대: 식은 현무암과 재. 바닥은 따뜻한 잿빛, 위로 갈수록 보랏빛 석판 */
const RAMP_RIFT = ['#100b12', '#16101a', '#211826', '#2d2133', '#3a2b41', '#47354f', '#54405d'];
/** 접힘 협곡: 깊은 바닥은 차가운 어둠, 높은 단은 노을 받은 사암. 단 사이 명도 차를 크게 — 규모감 */
const RAMP_CANYON = ['#070a14', '#121626', '#1f2134', '#2f2c40', '#433a4b', '#554857', '#665663'];
/** 환원 구역: 이끼 낀 광물. 청록 기운의 어둠 */
const RAMP_RESTORE = ['#07100f', '#0b1a1a', '#112524', '#183131', '#203d3d', '#294a49', '#315655'];

export function buildTheme(mood: Mood, base: Int8Array): Theme {
  const ramp = mood === 'rift' ? RAMP_RIFT : mood === 'canyon' ? RAMP_CANYON : mood === 'restore' ? RAMP_RESTORE : RAMP_PLAIN;
  // 단채: 고도 명도 계단 + 그 고도 등고선 색을 조금
  const top = ramp.map((c, l) => mix(c, LINE[l], 0.05 + 0.015 * l));
  const wall = top.map((c) => mix(c, '#000000', mood === 'canyon' ? 0.5 : 0.62));
  const wallStripe = top.map((c) => mix(c, '#000000', 0.8));
  const tick = top.map((c) => mix(c, '#ffffff', 0.13));
  const floorLevel = commonLevel(base);
  const [floor, fg] = canvas(PLANE_W, PLANE_H);
  const [high, hg] = canvas(PLANE_W, PLANE_H);
  const glow: HTMLCanvasElement[] = [];
  let fog: HTMLCanvasElement | null = null;
  let strata: string[] | null = null;
  let vein: string | null = null;
  let shadow = { slope: 1.3, reach: 1, alpha: 0.38, cap: 4 };
  const r = rng(base.reduce((a, v, i) => (a * 31 + v * (i + 7)) | 0, 17));
  const isHigh = (px: number, py: number) => base[Math.floor(py / CELL) * GRID_W + Math.floor(px / CELL)] > floorLevel;

  if (mood === 'rift') {
    shadow = { slope: 1.8, reach: 1, alpha: 0.42, cap: CELL };
    edgeShade(fg, 0.42);
    riftCracks(fg, glow, r, isHigh);
    pebbles(fg, r, 320, 0.07, 0.3);
    slabs(hg, r);
    pebbles(hg, r, 120, 0.06, 0.22);
  } else if (mood === 'canyon') {
    shadow = { slope: 3.4, reach: 3, alpha: 0.45, cap: CELL };
    strata = ['#2b1f27', '#36262c', '#2a2230', '#3b2b2b', '#2f2531', '#3d2f30', '#33282f'];
    // 깊은 바닥: 전체를 한 겹 더 어둡게, 바람 결
    fg.fillStyle = 'rgba(0,0,8,0.22)';
    fg.fillRect(0, 0, PLANE_W, PLANE_H);
    ripples(fg, r);
    sandstone(hg, r);
    fog = canyonFog(r);
  } else if (mood === 'restore') {
    shadow = { slope: 2, reach: 2, alpha: 0.4, cap: CELL };
    vein = '#19f5c8';
    memoryRings(fg, glow, base, floorLevel);
    pebbles(fg, r, 160, 0.05, 0.18, '#7ff5e0');
    benchmarks(hg, base, floorLevel, r);
  } else {
    // 무한 웨이브·실험: 이전 화면 그대로(무늬 없음)
  }
  // 바닥 + 빛 무늬를 장마다 합성: 균열은 두 불씨 장이 엇갈려 숨쉬는 12장(한 주기 약 3.7초), 환원은 고리 하나씩 밝아지는 8장
  const floorFrames: HTMLCanvasElement[] = [];
  let floorFps = 0;
  if (glow.length === 2) {
    floorFps = 12 / 3.7;
    for (let f = 0; f < 12; f++) {
      const a = 0.55 + 0.45 * Math.sin((f / 12) * Math.PI * 2);
      floorFrames.push(compose(floor, [[glow[0], a], [glow[1], 1 - a * 0.7]]));
    }
  } else if (glow.length > 2) {
    floorFps = 3.2;
    for (let f = 0; f < glow.length; f++) floorFrames.push(compose(floor, [[glow[f], 1], [glow[(f + glow.length - 1) % glow.length], 0.45]]));
  } else floorFrames.push(floor);
  // 높은 땅 칸 모양의 틀로 두 무늬를 오려 한 장에
  const [mask, mg] = canvas(PLANE_W, PLANE_H);
  mg.fillStyle = '#ffffff';
  for (let i = 0; i < base.length; i++) if (base[i] > floorLevel) mg.fillRect((i % GRID_W) * CELL, Math.floor(i / GRID_W) * CELL, CELL, CELL);
  hg.globalCompositeOperation = 'destination-in';
  hg.drawImage(mask, 0, 0);
  const surface = floorFrames.map((f) => {
    const [c, g] = canvas(PLANE_W, PLANE_H);
    g.drawImage(f, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(high, 0, 0);
    return c;
  });
  return { mood, top, wall, wallStripe, tick, strata, vein, shadow, floorLevel, surface, surfaceFps: floorFps, fog, horizon: makeHorizon(mood) };
}

function compose(under: HTMLCanvasElement, layers: [HTMLCanvasElement, number][]): HTMLCanvasElement {
  const [c, g] = canvas(PLANE_W, PLANE_H);
  g.drawImage(under, 0, 0);
  for (const [l, a] of layers) {
    g.globalAlpha = a;
    g.drawImage(l, 0, 0);
  }
  g.globalAlpha = 1;
  return c;
}

/** 가장 넓게 깔린 원래 높이(심연 제외) = 그 구역의 바닥 */
function commonLevel(base: Int8Array): number {
  const n = new Array(8).fill(0);
  for (const v of base) if (v >= 0) n[Math.min(7, v)]++;
  return n.indexOf(Math.max(...n));
}

/** 지도 가장자리가 어두워진다: 무너져 가는 세계의 끝 */
function edgeShade(g: CanvasRenderingContext2D, a: number): void {
  const grad = g.createRadialGradient(PLANE_W / 2, PLANE_H * 0.62, PLANE_H * 0.32, PLANE_W / 2, PLANE_H * 0.62, PLANE_W * 0.62);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, PLANE_W, PLANE_H);
}

function pebbles(g: CanvasRenderingContext2D, r: () => number, n: number, light: number, dark: number, color = '#ffffff'): void {
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * PLANE_W);
    const y = Math.floor(r() * PLANE_H);
    g.globalAlpha = light;
    g.fillStyle = color;
    g.fillRect(x, y, 1, 1);
    g.globalAlpha = dark;
    g.fillStyle = '#000000';
    g.fillRect(x, y + 1, r() < 0.3 ? 2 : 1, 1);
  }
  g.globalAlpha = 1;
}

/**
 * 균열 지대 바닥의 갈라진 틈: 검은 틈 + 그 속의 불씨(빛 무늬 두 장 — 서로 다른 불씨가 번갈아 숨쉰다).
 * 등고선(축에 맞춘 형광 실선)과 헷갈리지 않게 비스듬히 꺾이는 어두운 선이고, 불씨는 옅다.
 */
function riftCracks(g: CanvasRenderingContext2D, glow: HTMLCanvasElement[], r: () => number, isHigh: (x: number, y: number) => boolean): void {
  const [ga, gA] = canvas(PLANE_W, PLANE_H);
  const [gb, gB] = canvas(PLANE_W, PLANE_H);
  const crack = (x: number, y: number, a: number, len: number, depth: number) => {
    for (let s = 0; s < len; s++) {
      a += (r() - 0.5) * 0.55;
      x += Math.cos(a);
      y += Math.sin(a) * 0.8;
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 1 || py < 1 || px >= PLANE_W - 1 || py >= PLANE_H - 1) return;
      if (isHigh(px, py)) return;
      const w = s < len * 0.7 && depth === 0 ? 1 : 0;
      g.fillStyle = '#000000';
      g.globalAlpha = 0.62;
      g.fillRect(px, py, 1, 1);
      g.globalAlpha = 0.22;
      g.fillRect(px + 1, py, w, 1);
      // 불씨: 틈의 일부 마디에만, 두 장에 나눠서
      const ember = Math.sin(s * 0.45 + x * 0.05) > 0.15 - depth * 0.3;
      if (ember) {
        const tgt = (Math.floor(s / 7) & 1) === 0 ? gA : gB;
        tgt.fillStyle = '#ff6a2a';
        tgt.globalAlpha = depth === 0 ? 0.62 : 0.4;
        tgt.fillRect(px, py, 1, 1);
        tgt.fillStyle = '#7a1e0c';
        tgt.globalAlpha = 0.3;
        tgt.fillRect(px, py - 1, 1, 1);
        tgt.fillRect(px, py + 1, 1, 1);
      }
      if (depth < 2 && r() < 0.025) crack(x, y, a + (r() < 0.5 ? 0.9 : -0.9), len * 0.45, depth + 1);
    }
  };
  for (let i = 0; i < 15; i++) crack(r() * PLANE_W, r() * PLANE_H, r() * Math.PI * 2, 30 + r() * 55, 0);
  g.globalAlpha = 1;
  glow.push(ga, gb);
}

/** 균열 지대의 높은 땅: 쪼개진 석판의 곧은 금과 깨진 모서리 */
function slabs(g: CanvasRenderingContext2D, r: () => number): void {
  for (let i = 0; i < 90; i++) {
    let x = Math.floor(r() * PLANE_W);
    let y = Math.floor(r() * PLANE_H);
    const horiz = r() < 0.5;
    const len = 3 + Math.floor(r() * 6);
    g.fillStyle = '#000000';
    g.globalAlpha = 0.32;
    for (let s = 0; s < len; s++) {
      g.fillRect(x, y, 1, 1);
      if (horiz) x++;
      else y++;
      if (r() < 0.2) {
        if (horiz) y++;
        else x++;
      }
    }
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.07;
    g.fillRect(x, y - 1, 1, 1);
  }
  g.globalAlpha = 1;
}

/** 협곡 바닥의 바람 결: 동쪽으로 비스듬히 누운 짧은 줄 */
function ripples(g: CanvasRenderingContext2D, r: () => number): void {
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(r() * PLANE_W);
    const y = Math.floor(r() * PLANE_H);
    const len = 3 + Math.floor(r() * 4);
    for (let s = 0; s < len; s++) {
      const px = x + s;
      const py = y + Math.floor(s / 3);
      g.fillStyle = '#c9b8d8';
      g.globalAlpha = 0.06;
      g.fillRect(px, py, 1, 1);
      g.fillStyle = '#000000';
      g.globalAlpha = 0.14;
      g.fillRect(px, py + 1, 1, 1);
    }
  }
  g.globalAlpha = 1;
}

/** 협곡의 높은 단: 사암 알갱이와 수평 층리 */
function sandstone(g: CanvasRenderingContext2D, r: () => number): void {
  for (let y = 2; y < PLANE_H; y += 5 + Math.floor(r() * 4)) {
    g.fillStyle = '#000000';
    g.globalAlpha = 0.12;
    let x = 0;
    while (x < PLANE_W) {
      const run = 4 + Math.floor(r() * 18);
      if (r() < 0.7) g.fillRect(x, y + (r() < 0.2 ? 1 : 0), run, 1);
      x += run + 1 + Math.floor(r() * 5);
    }
  }
  pebbles(g, r, 260, 0.07, 0.12, '#ffd9a8');
}

/** 4×4 순서 점묘 문턱값 */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** 협곡 안개: 동쪽으로 흐르는 길쭉한 옅은 띠. 폭 2배에 같은 무늬를 이어 붙여 끊김 없이 흐른다 */
function canyonFog(r: () => number): HTMLCanvasElement {
  const [c, g] = canvas(PLANE_W * 2, PLANE_H);
  for (let i = 0; i < 14; i++) {
    const x = r() * PLANE_W;
    const y = r() * PLANE_H;
    const rx = 60 + r() * 90;
    const ry = 12 + r() * 16;
    for (const ox of [-PLANE_W, 0, PLANE_W, PLANE_W * 2]) {
      g.save();
      g.translate(x + ox, y);
      g.scale(rx / ry, 1);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      grad.addColorStop(0, 'rgba(150,165,220,0.11)');
      grad.addColorStop(1, 'rgba(150,165,220,0)');
      g.fillStyle = grad;
      g.fillRect(-ry, -ry, ry * 2, ry * 2);
      g.restore();
    }
  }
  // 픽셀 감성: 부드러운 안개를 4단계로 양자화(점묘)한다
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < d.data.length; i += 4) {
    const px = (i >> 2) % c.width;
    const py = Math.floor((i >> 2) / c.width);
    const a = d.data[i] / 255;
    const bayer = BAYER4[(px & 3) + ((py & 3) << 2)] / 16;
    // 4×4 점묘: 옅은 곳은 듬성듬성, 짙은 곳은 촘촘히(한 점의 진하기는 일정)
    d.data[i] = a * 8 > bayer + 0.08 ? 20 : 0;
  }
  // 읽어 들인 캔버스는 브라우저가 소프트웨어 그리기로 돌려 매 프레임 옮겨 그릴 때 느려진다 — 새 캔버스에 담아 돌려준다
  const [out, og] = canvas(c.width, c.height);
  og.putImageData(d, 0, 0);
  return out;
}

/**
 * 환원 구역 바닥: 언덕·환원대를 둘러싼 동심 고리(땅이 제 모양을 기억하는 흔적). 등고선의 메아리라 옅고 가늘다.
 * 빛 무늬 8장은 고리 하나씩 차례로 밝혀, 높은 땅에서 바깥으로 퍼지는 느린 파동이 된다.
 */
function memoryRings(g: CanvasRenderingContext2D, glow: HTMLCanvasElement[], base: Int8Array, floorLevel: number): void {
  const W = PLANE_W;
  const H = PLANE_H;
  // 높은 땅에서의 거리(px, 3-4 거리 변환)
  const dist = new Float32Array(W * H).fill(1e9);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (base[Math.floor(y / CELL) * GRID_W + Math.floor(x / CELL)] > floorLevel) dist[y * W + x] = 0;
  const pass = (fwd: boolean) => {
    const ys = fwd ? 0 : H - 1;
    const ye = fwd ? H : -1;
    const st = fwd ? 1 : -1;
    for (let y = ys; y !== ye; y += st)
      for (let x = fwd ? 0 : W - 1; x !== (fwd ? W : -1); x += st) {
        const i = y * W + x;
        let v = dist[i];
        const nx = x - st;
        const ny = y - st;
        if (nx >= 0 && nx < W) v = Math.min(v, dist[i - st] + 1);
        if (ny >= 0 && ny < H) {
          v = Math.min(v, dist[i - st * W] + 1);
          if (nx >= 0 && nx < W) v = Math.min(v, dist[i - st * W - st] + 1.41);
          const px = x + st;
          if (px >= 0 && px < W) v = Math.min(v, dist[i - st * W + st] + 1.41);
        }
        dist[i] = v;
      }
  };
  pass(true);
  pass(false);
  const GAP = 5;
  const MAXD = 38;
  const FR = 8;
  const frames = Array.from({ length: FR }, () => canvas(W, H));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = dist[y * W + x];
      if (d < 2 || d > MAXD) continue;
      const k = Math.round(d / GAP);
      if (Math.abs(d - k * GAP) >= 0.5) continue;
      // 고리는 점선(측량 보조선): 둘레를 따라 두 칸 걸러 한 칸
      if (((x * 3 + y * 5) >> 1) % 3 === 0) continue;
      const fall = 1 - d / (MAXD + 4);
      g.fillStyle = '#7ff5e0';
      g.globalAlpha = 0.07 * fall;
      g.fillRect(x, y, 1, 1);
      const [, fg] = frames[k % FR];
      fg.fillStyle = '#bff7ff';
      fg.globalAlpha = 0.26 * fall;
      fg.fillRect(x, y, 1, 1);
    }
  g.globalAlpha = 1;
  for (const [c] of frames) glow.push(c);
}

/** 환원 구역의 높은 땅: 꼭대기마다 측량 기준점(원 + 십자)이 새겨져 있다 */
function benchmarks(g: CanvasRenderingContext2D, base: Int8Array, floorLevel: number, r: () => number): void {
  pebbles(g, r, 140, 0.06, 0.16, '#bff7ff');
  const top = Math.max(...base);
  if (top <= floorLevel) return;
  // 가장 높은 땅 덩어리마다 가운데에 하나
  const seen = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i++) {
    if (seen[i] || base[i] !== top) continue;
    const q = [i];
    seen[i] = 1;
    let sx = 0;
    let sy = 0;
    let n = 0;
    while (q.length) {
      const j = q.pop()!;
      const x = j % GRID_W;
      const y = (j - x) / GRID_W;
      sx += x;
      sy += y;
      n++;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
        const k = ny * GRID_W + nx;
        if (!seen[k] && base[k] === top) {
          seen[k] = 1;
          q.push(k);
        }
      }
    }
    const cx = Math.round(((sx / n) + 0.5) * CELL);
    const cy = Math.round(((sy / n) + 0.5) * CELL);
    g.fillStyle = '#bff7ff';
    g.globalAlpha = 0.2;
    for (let a = 0; a < 20; a++) g.fillRect(Math.round(cx + Math.cos((a / 20) * Math.PI * 2) * 4), Math.round(cy + Math.sin((a / 20) * Math.PI * 2) * 3), 1, 1);
    g.globalAlpha = 0.3;
    g.fillRect(cx - 2, cy, 5, 1);
    g.fillRect(cx, cy - 2, 1, 5);
  }
  g.globalAlpha = 1;
}

/** 배경: 먼 지평선 실루엣 두 겹(구역마다 다른 땅), 세계 중심의 원점 타워, 지도 윗변 자 */
function makeHorizon(mood: Mood): HTMLCanvasElement {
  const [c, g] = canvas(VIEW_W, VIEW_H);
  g.fillStyle = '#04050a';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  const r = rng(mood.length * 977);
  const farCol = mood === 'rift' ? '#140b14' : mood === 'canyon' ? '#130f1c' : mood === 'restore' ? '#08131a' : '#0a0d1d';
  const nearCol = mood === 'rift' ? '#1c0f19' : mood === 'canyon' ? '#1b1522' : mood === 'restore' ? '#0c1b20' : '#0e1226';
  // 지평선 빛: 균열은 붉은 열기, 협곡은 노을, 환원은 시안 기운
  const glowCol = mood === 'rift' ? '#3a0f1a' : mood === 'canyon' ? '#2a1a22' : mood === 'restore' ? '#0d3333' : null;
  if (glowCol) {
    g.fillStyle = glowCol;
    g.fillRect(0, 12, VIEW_W, 1);
    g.globalAlpha = 0.5;
    g.fillRect(0, 11, VIEW_W, 1);
    g.globalAlpha = 1;
  }
  const far: number[] = [];
  const near: number[] = [];
  for (let x = 0; x < VIEW_W; x++) {
    if (mood === 'canyon') {
      // 계단처럼 꺾인 거대한 단애: 평평한 꼭대기가 층층이
      far.push(Math.max(1, 13 - Math.round(4 + 4 * Math.sin(x * 0.019) + 2 * Math.sin(x * 0.061 + 1))));
      near.push(13 - Math.max(0, Math.round((3 + 3 * Math.sin(x * 0.043 + 2.1)) / 1.5) * 1.5 + (Math.sin(x * 0.11) > 0.6 ? 2 : 0)));
    } else if (mood === 'rift') {
      // 부서진 능선: 날카롭게 솟고 군데군데 끊긴다
      const saw = Math.abs(((x * 0.09) % 2) - 1);
      far.push(7 + Math.round(2.5 * Math.sin(x * 0.031) + 2 * saw));
      near.push(Math.sin(x * 0.07 + 0.5) > 0.82 ? 13 : 10 + Math.round(1.5 * Math.sin(x * 0.053 + 2.1) + Math.sin(x * 0.23)));
    } else if (mood === 'restore') {
      // 둥글게 다시 솟는 언덕
      far.push(8 + Math.round(2 * Math.sin(x * 0.024) + Math.sin(x * 0.071 + 1.3)));
      near.push(10 + Math.round(1.5 * Math.cos(x * 0.041 + 2.1)));
    } else {
      far.push(7 + Math.round(2.5 * Math.sin(x * 0.031) + 1.5 * Math.sin(x * 0.097 + 1.3)));
      near.push(10 + Math.round(1.5 * Math.sin(x * 0.053 + 2.1) + Math.sin(x * 0.17)));
    }
  }
  for (let x = 0; x < VIEW_W; x++) {
    g.fillStyle = farCol;
    g.fillRect(x, far[x], 1, 13 - far[x]);
    g.fillStyle = nearCol;
    g.fillRect(x, near[x], 1, 13 - near[x]);
  }
  if (mood === 'rift') {
    // 떠 있는 바위 조각: 대접힘에 뜯겨 나간 땅
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * VIEW_W);
      if (Math.abs(x - TOWER_X) < 12) continue;
      const y = 2 + Math.floor(r() * 5);
      const w = 2 + Math.floor(r() * 4);
      g.fillStyle = farCol;
      g.fillRect(x, y, w, 2);
      g.fillRect(x + 1, y + 2, Math.max(1, w - 2), 1);
    }
  } else if (mood === 'restore') {
    // 고리를 두른 기둥(되살아나는 땅의 표지)
    for (const x of [62, 141, 333, 409]) {
      g.fillStyle = nearCol;
      g.fillRect(x, 5, 1, 8);
      g.fillStyle = '#123536';
      g.fillRect(x - 2, 7, 5, 1);
    }
  }
  g.fillStyle = '#1a2142';
  g.fillRect(TOWER_X, 2, 1, 11);
  g.fillRect(TOWER_X - 1, 6, 3, 7);
  g.fillRect(TOWER_X - 2, 10, 5, 3);
  g.fillStyle = '#2a3463';
  g.fillRect(TOWER_X - 3, 4, 7, 1);
  // 지도 윗변 자: 5칸(30px)마다 큰 눈금, 1칸마다 작은 눈금 — 지면의 측량 눈금(+)과 열이 맞는다
  g.fillStyle = '#121833';
  g.fillRect(0, 13, VIEW_W, 1);
  for (let x = 0; x < VIEW_W; x += 6) g.fillRect(x, 14, 1, x % 30 === 0 ? 3 : 1);
  g.fillStyle = '#1d2750';
  for (let x = 0; x < VIEW_W; x += 30) g.fillRect(x, 10, 1, 3);
  return c;
}
