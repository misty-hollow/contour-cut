import { CELL, GRID_H, GRID_W, MAX_LEVEL } from './config';
import { makeRng, randInt } from './rng';

export type EnemyKind = 'chaser' | 'shooter';

export interface EnemySpec {
  kind: EnemyKind;
  cx: number;
  cy: number;
  /** 이 시간(초) 동안 움직이지 않는다. 시나리오 준비용 */
  dormant?: number;
}

export interface Setup {
  name: string;
  heights: Int8Array;
  player: { cx: number; cy: number };
  enemies: EnemySpec[];
  waves: boolean;
  /** 돌파형 구역의 출구 표지(칸 좌표·반경). 첫 여정 구역 2 */
  exit?: { cx: number; cy: number; r: number };
}

export const DEFAULT_SEED = 7;

/** 시나리오 이름 목록. `?scenario=<이름>`. 검증 하네스와 사용자 실험 겸용 */
export const SCENARIOS = ['lab', 'cut', 'fall', 'abyss', 'trap', 'dash', 'cover', 'exposed', 'highshot', 'combo', 'swarm', 'hidden'] as const;

export function cellCenter(c: number): number {
  return (c + 0.5) * CELL;
}

/** 기본 전장: 계단식 언덕, 절벽 메사, 낮은 골짜기가 있는 지도. 시드 결정적. */
export function generateArena(seed: number): Int8Array {
  const rng = makeRng(seed);
  const h = new Float32Array(GRID_W * GRID_H).fill(1);
  const at = (x: number, y: number) => y * GRID_W + x;

  // 골짜기(고도 0): 지도를 가로지르는 사행 띠
  const phase = rng() * Math.PI * 2;
  const amp = 4 + rng() * 5;
  const yMid = 10 + rng() * 22;
  const freq = 0.06 + rng() * 0.05;
  for (let x = 0; x < GRID_W; x++) {
    const yc = yMid + amp * Math.sin(x * freq + phase);
    for (let y = 0; y < GRID_H; y++) if (Math.abs(y - yc) < 1.6) h[at(x, y)] = 0;
  }

  // 계단식 언덕: 고도 1단계씩 오를 수 있는 동심원 테라스
  const hills = 5 + randInt(rng, 0, 2);
  for (let k = 0; k < hills; k++) {
    const cx = randInt(rng, 6, GRID_W - 7);
    const cy = randInt(rng, 6, GRID_H - 7);
    const r = 6 + rng() * 4;
    const peak = randInt(rng, 3, MAX_LEVEL);
    for (let y = 0; y < GRID_H; y++)
      for (let x = 0; x < GRID_W; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r) h[at(x, y)] = Math.max(h[at(x, y)], Math.ceil(peak * (1 - d / r)));
      }
  }

  // 메사: 절벽으로 둘러싸인 평평한 고지대, 남쪽에 계단 하나
  for (let k = 0; k < 2; k++) {
    const mx = randInt(rng, 10, GRID_W - 11);
    const my = randInt(rng, 6, GRID_H - 14);
    const rx = 4 + rng() * 3;
    const ry = 3 + rng() * 2;
    const lv = randInt(rng, 3, 4);
    for (let y = 0; y < GRID_H; y++)
      for (let x = 0; x < GRID_W; x++)
        if (((x - mx) / rx) ** 2 + ((y - my) / ry) ** 2 <= 1) h[at(x, y)] = Math.max(h[at(x, y)], lv);
    const sy = Math.floor(my + ry);
    for (let s = 1; s < lv; s++)
      for (const x of [mx - 1, mx]) {
        const y = sy + s;
        if (y < GRID_H) h[at(x, y)] = Math.max(h[at(x, y)], lv - s);
      }
  }

  // 시작 지점 주변은 평지
  const px = Math.floor(GRID_W / 2);
  const py = Math.floor(GRID_H / 2);
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) if (Math.hypot(x - px, y - py) <= 4) h[at(x, y)] = 1;

  return Int8Array.from(h, (v) => Math.max(0, Math.min(MAX_LEVEL, v)));
}

/** 실험실 지형: 좌표가 고정된 메사·계단 언덕·낭떠러지. 시나리오가 공유한다. */
export function labHeights(): Int8Array {
  const h = new Int8Array(GRID_W * GRID_H).fill(1);
  const set = (x: number, y: number, v: number) => {
    h[y * GRID_W + x] = v;
  };
  // 메사 M: x 44..55, y 10..21, 고도 4(사방 3단 절벽)
  for (let y = 10; y <= 21; y++) for (let x = 44; x <= 55; x++) set(x, y, 4);
  // 계단 언덕 T: 중심 (18,26), 반경 8, 꼭대기 4
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      const d = Math.hypot(x - 18, y - 26);
      if (d < 8) set(x, y, Math.max(1, Math.ceil(4 * (1 - d / 8))));
    }
  // 낭떠러지 L: x 62..76, y 26..36, 고도 4. 동쪽 계단(3→2)으로 다시 오른다
  for (let y = 26; y <= 36; y++) for (let x = 62; x <= 76; x++) set(x, y, 4);
  for (let y = 30; y <= 32; y++) {
    set(77, y, 3);
    set(78, y, 2);
  }
  return h;
}

export function buildSetup(name: string | null, seed: number): Setup {
  switch (name) {
    case 'lab':
      return {
        name,
        heights: labHeights(),
        player: { cx: 36, cy: 30 },
        enemies: [
          { kind: 'chaser', cx: 48, cy: 14 },
          { kind: 'chaser', cx: 51, cy: 18 },
          { kind: 'chaser', cx: 18, cy: 30 },
          { kind: 'shooter', cx: 30, cy: 8 },
        ],
        waves: false,
      };
    case 'cut':
      return { name, heights: labHeights(), player: { cx: 40, cy: 15 }, enemies: [], waves: false };
    case 'fall':
      return { name, heights: labHeights(), player: { cx: 40, cy: 15 }, enemies: [{ kind: 'chaser', cx: 49, cy: 15, dormant: 60 }], waves: false };
    case 'abyss':
      return { name, heights: labHeights(), player: { cx: 18, cy: 36 }, enemies: [{ kind: 'chaser', cx: 18, cy: 30, dormant: 60 }], waves: false };
    case 'trap':
      // 언덕 꼭대기의 적: 동쪽에서 바깥 고리를 베면 꼭대기가 구덩이가 되어 갇힌다
      return { name, heights: labHeights(), player: { cx: 30, cy: 26 }, enemies: [{ kind: 'chaser', cx: 18, cy: 26, dormant: 1.5 }], waves: false };
    case 'dash':
      return { name, heights: labHeights(), player: { cx: 63, cy: 31 }, enemies: [{ kind: 'chaser', cx: 45, cy: 31, dormant: 60 }], waves: false };
    case 'cover':
      return { name, heights: labHeights(), player: { cx: 46, cy: 15 }, enemies: [{ kind: 'shooter', cx: 36, cy: 15 }], waves: false };
    case 'exposed':
      return { name, heights: labHeights(), player: { cx: 41, cy: 15 }, enemies: [{ kind: 'shooter', cx: 36, cy: 15 }], waves: false };
    case 'combo':
      // 핵심 루프 연습: 꼭대기 적(움직이지 않음)을 구덩이에 가두고 → 7초 환원 → 에어본 → 공중 추가타
      return {
        name,
        heights: labHeights(),
        player: { cx: 30, cy: 26 },
        enemies: [
          { kind: 'chaser', cx: 18, cy: 26, dormant: 60 },
          { kind: 'chaser', cx: 17, cy: 24, dormant: 60 },
        ],
        waves: false,
      };
    case 'highshot':
      // 메사 위(고도 4) 사격형이 아래 평지(고도 1)의 플레이어를 쏜다
      return { name, heights: labHeights(), player: { cx: 40, cy: 15 }, enemies: [{ kind: 'shooter', cx: 46, cy: 15 }], waves: false };
    case 'hidden':
      // 2.5D 가림 확인: 메사(표고 4) 바로 북쪽 낮은 땅에 멈춰 선 적 둘 — 남쪽 메사에 몸이 가려 윤곽으로 보인다
      return {
        name,
        heights: labHeights(),
        player: { cx: 50, cy: 25 },
        enemies: [
          { kind: 'chaser', cx: 48, cy: 9, dormant: 60 },
          { kind: 'shooter', cx: 52, cy: 9, dormant: 60 },
        ],
        waves: false,
      };
    case 'swarm': {
      const enemies: EnemySpec[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        enemies.push({ kind: 'chaser', cx: 36 + Math.round(Math.cos(a) * 4), cy: 30 + Math.round(Math.sin(a) * 4) });
      }
      return { name, heights: labHeights(), player: { cx: 36, cy: 30 }, enemies, waves: false };
    }
    default:
      return {
        name: 'arena',
        heights: generateArena(seed),
        player: { cx: Math.floor(GRID_W / 2), cy: Math.floor(GRID_H / 2) },
        enemies: [],
        waves: true,
      };
  }
}
