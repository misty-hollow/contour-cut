import { CELL, GRID_H, GRID_W } from './config';
import { cellCenter, type Setup } from './maps';
import { randInt } from './rng';
import { isAbyss } from './terrain';
import type { World } from './world';

/**
 * 첫 여정: 세 구역을 차례로 돌파한다(DECISIONS P-010).
 * 범용 스테이지 엔진이 아니라 구역 세 개의 데이터와 클리어 판정뿐이다. 구역마다 새 World를 만든다.
 */

export type ZoneGoal = 'rout' | 'reach' | 'airHits';

export interface Zone {
  id: string;
  name: string;
  /** 구역 시작 배너와 HUD에 쓰는 목표 문장 */
  goal: string;
  kind: ZoneGoal;
  /** airHits 목표 수 */
  target?: number;
  build: () => Setup;
}

export interface ZoneStatus {
  done: boolean;
  /** HUD 진행 표시(예: "고지대의 적 2/4") */
  label: string;
}

// ── 지형 그리기 도우미 ────────────────────────────────────

function fill(v: number): Int8Array {
  return new Int8Array(GRID_W * GRID_H).fill(v);
}
function rect(h: Int8Array, x0: number, y0: number, x1: number, y1: number, v: number): void {
  for (let y = Math.max(0, y0); y <= Math.min(GRID_H - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(GRID_W - 1, x1); x++) h[y * GRID_W + x] = v;
}
function disc(h: Int8Array, cx: number, cy: number, r: number, v: number): void {
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (Math.hypot(x - cx, y - cy) <= r) h[y * GRID_W + x] = v;
}
/** 계단식 언덕(실험실 언덕 T와 같은 식): 한 단씩 걸어 오를 수 있는 동심 고리 */
function terraceHill(h: Int8Array, cx: number, cy: number, r: number, peak: number, base: number): void {
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) h[y * GRID_W + x] = Math.max(h[y * GRID_W + x], Math.max(base, Math.ceil(peak * (1 - d / r))));
    }
}

// ── 구역 1 — 균열 지대: 지형 절단과 낙하 ──────────────────────
// 낮은 골짜기(표고 0)에 선 카인. 적은 걸어서 내려올 수 없는 고지대(2단 절벽) 위에 있다.
// 칼날로는 닿기 어렵지만, 고지대를 베면 표고 2의 대지는 절대 심연으로, 표고 4의 메사는 3단 침하로 적을 떨어뜨린다.
export const ZONE1_PLATEAUS = [
  { cx: 18, cy: 12 },
  { cx: 40, cy: 9 },
  { cx: 62, cy: 12 },
];
export const ZONE1_MESA = { x0: 37, y0: 19, x1: 43, y1: 23 };

function buildZone1(): Setup {
  const h = fill(0);
  for (const p of ZONE1_PLATEAUS) disc(h, p.cx, p.cy, 3, 2);
  rect(h, ZONE1_MESA.x0, ZONE1_MESA.y0, ZONE1_MESA.x1, ZONE1_MESA.y1, 4);
  // 균열 주름: 걸어 오를 수 있는 낮은 둔덕(표고 1)
  disc(h, 8, 30, 3, 1);
  disc(h, 72, 30, 3, 1);
  rect(h, 26, 36, 54, 37, 1);
  return {
    name: 'zone1',
    heights: h,
    player: { cx: 40, cy: 33 },
    enemies: [
      ...ZONE1_PLATEAUS.map((p) => ({ kind: 'chaser' as const, cx: p.cx, cy: p.cy })),
      { kind: 'shooter', cx: 40, cy: 21 },
    ],
    waves: false,
  };
}

// ── 구역 2 — 접힘 협곡: 고도차 이동과 돌파 ────────────────────
// 서쪽 높은 단애(표고 4)에서 출발해 2 → 0으로 내려가는 협곡을 지나 동쪽 출구 표지까지.
// 협곡 바닥에는 돌진형, 출구 앞 접힘 고개 양쪽 능선(표고 3)에는 사격형. 적을 다 잡을 필요는 없다.
export const ZONE2_EXIT = { cx: 74, cy: 20, r: 3 };

function buildZone2(): Setup {
  const h = fill(5); // 협곡 벽
  rect(h, 1, 9, 11, 31, 4); // 출발 단애
  rect(h, 12, 9, 24, 31, 2); // 첫 내리막 단
  rect(h, 25, 9, 54, 31, 0); // 협곡 바닥
  rect(h, 55, 9, 68, 31, 3); // 접힘 고개 능선
  rect(h, 55, 16, 68, 24, 0); // 고개 길
  rect(h, 69, 9, 78, 31, 0); // 출구 광장
  // 엄폐 기둥(표고 2)
  rect(h, 35, 13, 36, 14, 2);
  rect(h, 44, 25, 45, 26, 2);
  rect(h, 30, 26, 31, 27, 2);
  rect(h, 48, 14, 49, 15, 2);
  return {
    name: 'zone2',
    heights: h,
    player: { cx: 6, cy: 20 },
    enemies: [
      { kind: 'chaser', cx: 32, cy: 20 },
      { kind: 'chaser', cx: 40, cy: 17 },
      { kind: 'chaser', cx: 48, cy: 23 },
      { kind: 'shooter', cx: 60, cy: 13 },
      { kind: 'shooter', cx: 64, cy: 27 },
    ],
    waves: false,
    exit: ZONE2_EXIT,
  };
}

// ── 구역 3 — 환원 구역: 시간차 전투와 콤보 ────────────────────
// 계단식 언덕 셋, 꼭대기마다 멈춰 선 감시자. 감시자는 시간이 지나면 차례로 깨어나 내려온다(14·28·42초).
// 언덕 바깥 고리를 베어 꼭대기를 구덩이로 → 7초 뒤 지형 환원으로 튕겨 오른 적에게 공중 추가타.
export const ZONE3_HILLS = [
  { cx: 16, cy: 20 },
  { cx: 40, cy: 12 },
  { cx: 64, cy: 22 },
];
export const ZONE3_AIR_HITS = 3;
const ZONE3_WAKE = [14, 28, 42];

function buildZone3(): Setup {
  const h = fill(1);
  for (const p of ZONE3_HILLS) terraceHill(h, p.cx, p.cy, 8, 4, 1);
  return {
    name: 'zone3',
    heights: h,
    player: { cx: 40, cy: 30 },
    enemies: ZONE3_HILLS.map((p, i) => ({ kind: 'chaser' as const, cx: p.cx, cy: p.cy, dormant: ZONE3_WAKE[i] })),
    waves: false,
  };
}

export const ZONES: Zone[] = [
  { id: 'rift', name: '균열 지대', goal: '고지대의 적을 모두 떨어뜨려라', kind: 'rout', build: buildZone1 },
  { id: 'canyon', name: '접힘 협곡', goal: '동쪽 출구 표지까지 돌파하라', kind: 'reach', build: buildZone2 },
  { id: 'restore', name: '환원 구역', goal: `지형 환원으로 띄운 적에게 공중 추가타 ${ZONE3_AIR_HITS}회`, kind: 'airHits', target: ZONE3_AIR_HITS, build: buildZone3 },
];

/** `?zone=N` 해석: 1~구역 수의 정수만 받아 0부터 세는 번호로. 그 밖(소수·0·범위 밖·문자·없음)은 구역 1 */
export function parseZoneParam(raw: string | null, count: number = ZONES.length): number {
  if (raw === null || raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : 0;
}

/** 구역 하나의 결과(최종 집계용). 같은 구역을 다시 깨면 덮어쓴다 */
export interface ZoneResult {
  cuts: number;
  terrainKills: number;
  airKills: number;
  bladeKills: number;
  airHits: number;
  time: number;
}

export function zoneResult(world: World): ZoneResult {
  const s = world.stats;
  return {
    cuts: s.cuts,
    terrainKills: s.kills.fall + s.kills.abyss,
    airKills: s.kills.air,
    bladeKills: s.kills.blade,
    airHits: s.airHits,
    time: world.time,
  };
}

/** 구역별 결과의 합계 */
export function journeyTotals(results: readonly (ZoneResult | undefined)[]): ZoneResult {
  const t: ZoneResult = { cuts: 0, terrainKills: 0, airKills: 0, bladeKills: 0, airHits: 0, time: 0 };
  for (const r of results) if (r) for (const k of Object.keys(t) as (keyof ZoneResult)[]) t[k] += r[k];
  return t;
}

/** 플레이어가 출구 표지 안에 서 있는가(평면 거리) */
export function inExit(world: World): boolean {
  const e = world.setup.exit;
  if (!e) return false;
  return Math.hypot(world.player.x - cellCenter(e.cx), world.player.y - cellCenter(e.cy)) <= e.r * CELL;
}

export function zoneStatus(zone: Zone, world: World): ZoneStatus {
  switch (zone.kind) {
    case 'rout': {
      const total = world.setup.enemies.length;
      const alive = world.enemies.filter((e) => e.state !== 'dead').length;
      const down = total - alive;
      return { done: alive === 0, label: `고지대의 적 ${down}/${total}` };
    }
    case 'reach':
      return { done: inExit(world), label: '동쪽 출구 표지까지 돌파' };
    case 'airHits': {
      const n = Math.min(world.stats.airHits, zone.target ?? 0);
      return { done: world.stats.airHits >= (zone.target ?? 0), label: `공중 추가타 ${n}/${zone.target}` };
    }
  }
}

/**
 * 구역별 진행 보조(구역 3만): 살아 있는 적이 없는데 목표가 남았으면 언덕 꼭대기에 감시자를 새로 세운다.
 * 진행 불가 상태(콤보를 넣을 상대가 없음)를 막는다. 시뮬레이션 RNG를 써서 결정적이다.
 */
export function zoneTick(zone: Zone, world: World): void {
  if (zone.kind !== 'airHits' || world.stats.airHits >= (zone.target ?? 0)) return;
  if (world.enemies.some((e) => e.state !== 'dead')) return;
  const t = world.terrain;
  const p = world.player;
  const hills = ZONE3_HILLS.filter((hl) => {
    const i = t.idx(hl.cx, hl.cy);
    return !t.isCut(i) && !isAbyss(t.height[i]) && Math.hypot(p.x - cellCenter(hl.cx), p.y - cellCenter(hl.cy)) > 8 * CELL;
  });
  if (!hills.length) return;
  const hl = hills[randInt(world.rng, 0, hills.length - 1)];
  world.spawnEnemy('chaser', cellCenter(hl.cx), cellCenter(hl.cy), 4, true);
}
