import { ABYSS, CELL, FIXED_DT, GRID_H, GRID_W } from './config';
import { cellCenter, type EnemySpec, type Setup } from './maps';
import { isAbyss } from './terrain';
import type { World } from './world';

/**
 * 첫 여정: 세 구역을 차례로 돌파한다(DECISIONS P-010).
 * 범용 스테이지 엔진이 아니라 구역 세 개의 데이터와 클리어 판정뿐이다. 구역마다 새 World를 만든다.
 */

export type ZoneGoal = 'beats' | 'reach';

/** beats형 구역(1·3)의 단계. 앞 단계의 적이 모두 쓰러지면 다음 단계의 적이 나타난다 */
export interface Beat {
  name: string;
  /** 이 단계 동안 화면 아래에 보이는 전술 힌트 */
  hint: string;
  /** 앞 단계가 끝난 뒤 이 단계를 기다리는 동안의 안내(트리거가 있으면 어디로 가야 하는지) */
  prompt?: string;
  /** 플레이어가 이 원(칸 좌표·반경) 안에 들어와야 시작한다 */
  trigger?: { cx: number; cy: number; r: number };
  /** 이 단계에서 처음 벨 때까지 깜빡여 눈길을 끄는 등고선(칸 좌표 원). 그리기 안내만, 판정과 무관 */
  focus?: { cx: number; cy: number; r: number };
  enemies: EnemySpec[];
}

/** reach형 구역(2)의 구간. 플레이어가 선 칸의 x로 지금 구간을 고른다(진행 판정에는 쓰지 않음, 안내만) */
export interface Leg {
  /** 이 구간이 시작하는 칸 x */
  x0: number;
  name: string;
  hint: string;
}

export interface Zone {
  id: string;
  name: string;
  /** 구역 시작 배너와 HUD에 쓰는 목표 문장 */
  goal: string;
  kind: ZoneGoal;
  /** 돌파 화면의 "다음:" 줄에 붙는 이 구역의 전술 한 줄 */
  theme: string;
  /** beats형 구역의 단계들. 첫 단계의 적은 구역 시작부터 있다 */
  beats?: Beat[];
  /** 단계를 부르는 말(구역 1 "측량", 구역 3 "환원") */
  beatWord?: string;
  /** reach형 구역의 구간들(서쪽부터) */
  legs?: Leg[];
  /** 돌파 화면에 측량 평가를 보여 줄지 */
  graded?: boolean;
  /** 진입 방향(구역 표제 문구)과 첫 진입 때 측량 주사선이 나아가는 쪽 */
  entry: { from: string; scan: 'north' | 'east' };
  build: () => Setup;
}

export interface ZoneStatus {
  done: boolean;
  /** HUD 진행 표시(예: "측량 2/3 포대 · 적 1/2") */
  label: string;
  /** 지금 단계의 전술 힌트(없으면 빈 문자열) */
  hint: string;
  /** 화면 안내 표지(가야 할 곳). 없으면 표시하지 않는다 */
  marker?: { cx: number; cy: number; r: number };
  /** HUD 구역 블록 2행 왼쪽: 지금 단계·구간(예: "측량 2/3 포대", "구간 1/3 단애") */
  goal: string;
  /** HUD 구역 블록 2행 오른쪽 수치(예: "적 0/2", "준비", "출구 돌파") */
  count: string;
  /** 수치가 달성됐는가(단계의 적을 모두 쓰러뜨림·출구 도달) */
  countDone: boolean;
  /** 진행 눈금: 끝난 단계·구간 수 / 전체 */
  pips: { done: number; total: number };
}

/** 구역 하나를 도는 동안의 진행 상태(구역에 들어갈 때마다 새로) */
export interface ZoneState {
  beat: number;
  /** 다음 단계가 나타나기까지 남은 시간 */
  wait: number;
  /** 다음 단계를 기다리는 중 */
  pending: boolean;
}

export const newZoneState = (): ZoneState => ({ beat: 0, wait: 0, pending: false });

/** 단계 사이 숨 고르기(초) */
export const BEAT_GAP = 1.5;

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
// 낮은 골짜기(표고 0)에 선 카인. 세 번의 측량으로 지형이 칼보다 강하다는 것을 익힌다.
// 1 첫 측량: 출발점 바로 앞 대지(표고 2) 위의 적. 걸어서 내려오지 못하고 칼도 닿지 않는다 → 대지를 베면 절대 심연
// 2 포대: 동쪽 메사(표고 4) 사격형 + 서쪽 대지 돌진형. 메사는 3단 침하(낙하 피해), 대지는 절대 심연
// 3 균열 고리: 걸어서 다가오는 돌진형 셋. 북쪽 낮은 둔덕 고리(표고 1) 안에 서서, 고리를 넘는 적의 발밑을 벤다
export const ZONE1_P1 = { cx: 40, cy: 25 };
export const ZONE1_P2 = { cx: 22, cy: 18 };
export const ZONE1_MESA = { x0: 53, y0: 17, x1: 59, y1: 22 };
export const ZONE1_RING = { cx: 40, cy: 11, inner: 4, outer: 5.5 };

function buildZone1(): Setup {
  const h = fill(0);
  disc(h, ZONE1_P1.cx, ZONE1_P1.cy, 3, 2);
  disc(h, ZONE1_P2.cx, ZONE1_P2.cy, 3, 2);
  rect(h, ZONE1_MESA.x0, ZONE1_MESA.y0, ZONE1_MESA.x1, ZONE1_MESA.y1, 4);
  // 균열 고리: 걸어 넘을 수 있는 낮은 둔덕(표고 1). 베면 절대 심연이 되어 넘어오던 적이 떨어지고, 7초 동안 벽이 된다
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      const d = Math.hypot(x - ZONE1_RING.cx, y - ZONE1_RING.cy);
      if (d >= ZONE1_RING.inner && d <= ZONE1_RING.outer) h[y * GRID_W + x] = 1;
    }
  // 균열 주름(장식 겸 2차 무기): 낮은 둔덕
  disc(h, 9, 30, 3, 1);
  disc(h, 71, 30, 3, 1);
  return {
    name: 'zone1',
    heights: h,
    player: { cx: 40, cy: 34 },
    enemies: ZONE1_BEATS[0].enemies,
    waves: false,
  };
}

export const ZONE1_BEATS: Beat[] = [
  {
    name: '첫 측량',
    hint: '대지 위의 적에게 칼은 닿지 않는다 — 대지 가장자리(등고선)를 조준해 클릭',
    focus: { cx: ZONE1_P1.cx, cy: ZONE1_P1.cy, r: 3.6 },
    enemies: [{ kind: 'chaser', cx: ZONE1_P1.cx, cy: ZONE1_P1.cy }],
  },
  {
    name: '포대',
    hint: '메사를 베면 사격형이 3단 떨어진다 · 서쪽 대지는 절대 심연이 된다 · 탄을 피해 움직여라',
    focus: { cx: 56, cy: 19.5, r: 4.6 },
    enemies: [
      { kind: 'shooter', cx: 56, cy: 19 },
      { kind: 'chaser', cx: ZONE1_P2.cx, cy: ZONE1_P2.cy },
    ],
  },
  {
    name: '균열 고리',
    hint: '고리를 넘는 적의 발밑을 베어라 · 이미 심연이 된 곳 너머로 베면 내 발밑도 무너진다',
    prompt: '북쪽 둔덕 고리 안으로 들어가라 — 적이 사방에서 다가온다',
    trigger: { cx: ZONE1_RING.cx, cy: ZONE1_RING.cy, r: ZONE1_RING.inner - 0.5 },
    enemies: [
      { kind: 'chaser', cx: 6, cy: 4 },
      { kind: 'chaser', cx: 40, cy: 1 },
      { kind: 'chaser', cx: 74, cy: 4 },
    ],
  },
];

// ── 구역 2 — 접힘 협곡: 고도차 이동과 돌파 ────────────────────
// 종이처럼 접힌 협곡을 서쪽에서 동쪽으로 세 구간 지나 출구 표지까지. 적을 다 잡을 필요는 없다.
// 1 단애: 높은 출발 단애(표고 4) 아래 협곡 바닥(0)의 돌진형 셋. 뛰어내리면 충격파, 대시하면 멀리 활강.
//   바닥의 균열 웅덩이(영구 심연) 가장자리를 베면 주변 바닥이 심연이 된다
// 2 사격 회랑: 남북 능선(표고 4) 위 사격형 둘이 회랑(1)을 내려 쏜다. 기둥(3) 뒤가 엄폐, 능선을 베면 사격형이 떨어진다
// 3 심연 균열: 폭 9칸 균열(영구 심연)은 평지 대시로는 못 건넌다. 도약대(4)에서 대시해 활강하거나 남쪽 다리(3)를 걷는다.
//   다리 끝은 광장(1)으로 2단 낙차라 걸어 내려가면 충격파가 나고, 광장의 돌진형은 다리로 올라오지 못한다(광장을 지킨다).
//   북쪽 보루(4)의 사격형이 광장과 도약대를 겨눈다
export const ZONE2_EXIT = { cx: 75, cy: 27, r: 3 };
export const ZONE2_SCARP = { x1: 12 };
export const ZONE2_POOLS = [
  { x0: 18, y0: 14, x1: 19, y1: 16 },
  { x0: 18, y0: 24, x1: 19, y1: 26 },
];
export const ZONE2_PILLARS = [
  { x0: 33, y0: 16, x1: 34, y1: 17 },
  { x0: 39, y0: 23, x1: 40, y1: 24 },
  { x0: 45, y0: 15, x1: 46, y1: 16 },
];
export const ZONE2_RIDGES = { x0: 29, x1: 48, north: [3, 9], south: [31, 37] } as const;
export const ZONE2_LEDGE = { x0: 50, y0: 12, x1: 55, y1: 27 };
export const ZONE2_CHASM = { x0: 56, x1: 64 };
export const ZONE2_BRIDGE = { y0: 33, y1: 34 };
export const ZONE2_BASTION = { x0: 68, y0: 7, x1: 73, y1: 11 };
export const ZONE2_LEGS: Leg[] = [
  { x0: 0, name: '단애', hint: '단애에서 대시하면 멀리 활강 · 뛰어내리면 착지 충격파 · 심연 곁을 베면 발밑도 무너진다' },
  { x0: 27, name: '사격 회랑', hint: '탄은 더 높은 지형에 막힌다 — 기둥 뒤로 · 능선 가장자리를 베면 사격형이 떨어진다' },
  { x0: 49, name: '심연 균열', hint: '균열은 도약대에서 대시해 활강하거나 남쪽 다리로 · 심연 쪽으로 베면 내 발밑도 무너진다' },
];

function buildZone2(): Setup {
  const h = fill(0); // 협곡 바닥
  rect(h, 0, 0, ZONE2_SCARP.x1, GRID_H - 1, 4); // 출발 단애
  for (const p of ZONE2_POOLS) rect(h, p.x0, p.y0, p.x1, p.y1, ABYSS); // 균열 웅덩이
  rect(h, 27, 0, ZONE2_CHASM.x0 - 1, GRID_H - 1, 1); // 사격 회랑 바닥(협곡 바닥에서 한 단 위)
  const r = ZONE2_RIDGES;
  rect(h, r.x0, r.north[0], r.x1, r.north[1], 4);
  rect(h, r.x0, r.south[0], r.x1, r.south[1], 4);
  for (const p of ZONE2_PILLARS) rect(h, p.x0, p.y0, p.x1, p.y1, 3); // 엄폐 기둥
  const L = ZONE2_LEDGE;
  rect(h, L.x0, L.y0, L.x1, L.y1, 4); // 도약대
  // 도약대 서쪽 계단(1 → 2 → 3 → 4)
  rect(h, L.x0 - 3, 18, L.x0 - 3, 21, 2);
  rect(h, L.x0 - 2, 18, L.x0 - 2, 21, 3);
  rect(h, L.x0 - 1, 18, L.x0 - 1, 21, 4);
  rect(h, ZONE2_CHASM.x0, 0, ZONE2_CHASM.x1, GRID_H - 1, ABYSS); // 심연 균열
  // 남쪽 다리(표고 3): 회랑 쪽 계단(2 → 3)으로 오르고, 광장 쪽 끝은 2단 낙차(한 방향 길)
  rect(h, ZONE2_CHASM.x0 - 2, ZONE2_BRIDGE.y0, ZONE2_CHASM.x0 - 2, ZONE2_BRIDGE.y1, 2);
  rect(h, ZONE2_CHASM.x0 - 1, ZONE2_BRIDGE.y0, ZONE2_CHASM.x1, ZONE2_BRIDGE.y1, 3);
  rect(h, ZONE2_CHASM.x1 + 1, 0, GRID_W - 1, GRID_H - 1, 1); // 출구 광장
  const B = ZONE2_BASTION;
  rect(h, B.x0, B.y0, B.x1, B.y1, 4); // 북쪽 보루
  return {
    name: 'zone2',
    heights: h,
    player: { cx: 6, cy: 20 },
    enemies: [
      // 단애 아래 협곡 바닥
      { kind: 'chaser', cx: 18, cy: 17 },
      { kind: 'chaser', cx: 22, cy: 21 },
      { kind: 'chaser', cx: 22, cy: 25 },
      // 사격 회랑
      { kind: 'shooter', cx: 36, cy: 9 },
      { kind: 'shooter', cx: 43, cy: 31 },
      { kind: 'chaser', cx: 41, cy: 19 },
      // 균열 건너편
      { kind: 'chaser', cx: 70, cy: 22 },
      { kind: 'chaser', cx: 71, cy: 31 },
      { kind: 'shooter', cx: 70, cy: 11 },
    ],
    waves: false,
    exit: ZONE2_EXIT,
  };
}

// ── 구역 3 — 환원 구역: 시간차 지형 조작과 콤보 ──────────────────
// 땅이 제 모양을 기억하는 곳. 평탄한 바닥(표고 1)에 계단식 언덕 셋과 환원대(표고 4의 낮은 탁자) 셋.
// 평평한 바닥에는 등고선이 없어 베어도 무너지지 않으므로, 적을 지형째 다루려면 언덕과 환원대를 쓴다(언덕을 벤 뒤에는 심연 가장자리가 등고선이 된다).
// 1 가두기: 북쪽 언덕 꼭대기의 감시자 둘(잠시 멈춤) + 동쪽에서 걸어오는 돌진형 하나. 구덩이에 가두고, 7초 동안 다른 적을 상대하다 환원 순간에 벤다
// 2 환원대: 서·동쪽 끝과 북쪽(언덕 너머)에서 돌진형 넷 + 동쪽 언덕 사격형. 환원대를 베면 바닥과 같은 높이가 되어 적이 올라선다 → 7초 뒤 솟는 땅이 한꺼번에 띄운다
// 3 대환원: 서쪽·북쪽 언덕 사격형 둘 + 네 모서리에서 돌진형 넷. 마지막 고조
// 콤보는 유리할 뿐 강제가 아니다. 칼날·충격파·심연(무너진 언덕 가장자리)으로도 쓰러뜨릴 수 있다.
export const ZONE3_HILLS = [
  { cx: 40, cy: 9, r: 6 },
  { cx: 12, cy: 12, r: 6 },
  { cx: 68, cy: 12, r: 6 },
];
export const ZONE3_TABLES = [
  { x0: 37, y0: 22, x1: 43, y1: 26 },
  { x0: 12, y0: 25, x1: 18, y1: 29 },
  { x0: 62, y0: 25, x1: 68, y1: 29 },
];
const [H1, HW, HE] = ZONE3_HILLS;

export const ZONE3_BEATS: Beat[] = [
  {
    name: '가두기',
    hint: '언덕을 베어 구덩이에 가두고 7초 뒤 떠오를 때 벤다 · 심연 너머로 베면 발밑도 무너진다',
    focus: { cx: H1.cx, cy: H1.cy, r: 6.6 },
    enemies: [
      { kind: 'chaser', cx: H1.cx, cy: H1.cy, dormant: 9 },
      { kind: 'chaser', cx: H1.cx + 1, cy: H1.cy - 1, dormant: 9 },
      { kind: 'chaser', cx: 76, cy: 34 },
    ],
  },
  {
    name: '환원대',
    hint: '환원대를 베면 바닥 높이가 된다 · 적을 끌어들이면 7초 뒤 솟는 땅이 한꺼번에 띄운다',
    focus: { cx: 40, cy: 24, r: 4.6 },
    enemies: [
      { kind: 'chaser', cx: 3, cy: 20 },
      { kind: 'chaser', cx: 77, cy: 20 },
      { kind: 'chaser', cx: 26, cy: 3 },
      { kind: 'chaser', cx: 54, cy: 3 },
      { kind: 'shooter', cx: HE.cx, cy: HE.cy },
    ],
  },
  {
    name: '대환원',
    hint: '사격형은 언덕째 떨어뜨려라 · 쫓아오는 적은 환원대와 구덩이로 — 환원 순간을 노려라',
    enemies: [
      { kind: 'shooter', cx: HW.cx, cy: HW.cy },
      { kind: 'shooter', cx: H1.cx, cy: H1.cy },
      { kind: 'chaser', cx: 3, cy: 36 },
      { kind: 'chaser', cx: 77, cy: 36 },
      { kind: 'chaser', cx: 26, cy: 36 },
      { kind: 'chaser', cx: 54, cy: 36 },
    ],
  },
];

function buildZone3(): Setup {
  const h = fill(1);
  for (const p of ZONE3_HILLS) terraceHill(h, p.cx, p.cy, p.r, 4, 1);
  for (const t of ZONE3_TABLES) rect(h, t.x0, t.y0, t.x1, t.y1, 4);
  return {
    name: 'zone3',
    heights: h,
    player: { cx: 40, cy: 34 },
    enemies: ZONE3_BEATS[0].enemies,
    waves: false,
  };
}

export const ZONES: Zone[] = [
  { id: 'rift', name: '균열 지대', goal: '세 번의 측량 — 적을 칼보다 지형으로 떨어뜨려라', theme: '절단과 낙하', kind: 'beats', beats: ZONE1_BEATS, beatWord: '측량', graded: true, entry: { from: '남쪽', scan: 'north' }, build: buildZone1 },
  { id: 'canyon', name: '접힘 협곡', goal: '동쪽 출구 표지까지 돌파하라 — 적을 다 잡을 필요는 없다', theme: '고도차를 타고 돌파', kind: 'reach', legs: ZONE2_LEGS, entry: { from: '서쪽 단애', scan: 'east' }, build: buildZone2 },
  { id: 'restore', name: '환원 구역', goal: '세 번의 환원 — 무너뜨린 땅이 돌아오는 순간을 무기로', theme: '시간차 지형 조작과 콤보', kind: 'beats', beats: ZONE3_BEATS, beatWord: '환원', entry: { from: '남쪽', scan: 'north' }, build: buildZone3 },
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
  hurt: number;
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
    hurt: s.hurt,
    time: world.time,
  };
}

/**
 * 측량 평가(구역 1 돌파 화면). 지형으로 쓰러뜨린 비율(낙하·심연·공중 처치)과 받은 피해로 매긴다.
 * S: 전부 지형 + 무피해, A: 지형 80% 이상 + 피해 2 이하, B: 그 밖
 */
export function surveyGrade(r: ZoneResult): { grade: 'S' | 'A' | 'B'; terrain: number; total: number } {
  const terrain = r.terrainKills + r.airKills;
  const total = terrain + r.bladeKills;
  const share = total === 0 ? 0 : terrain / total;
  const grade = share === 1 && r.hurt === 0 ? 'S' : share >= 0.8 && r.hurt <= 2 ? 'A' : 'B';
  return { grade, terrain, total };
}

/** 구역별 결과의 합계 */
export function journeyTotals(results: readonly (ZoneResult | undefined)[]): ZoneResult {
  const t: ZoneResult = { cuts: 0, terrainKills: 0, airKills: 0, bladeKills: 0, airHits: 0, hurt: 0, time: 0 };
  for (const r of results) if (r) for (const k of Object.keys(t) as (keyof ZoneResult)[]) t[k] += r[k];
  return t;
}

/** 플레이어가 출구 표지 안에 서 있는가(평면 거리) */
export function inExit(world: World): boolean {
  const e = world.setup.exit;
  if (!e) return false;
  return Math.hypot(world.player.x - cellCenter(e.cx), world.player.y - cellCenter(e.cy)) <= e.r * CELL;
}

/** reach형 구역에서 플레이어가 지금 있는 구간 번호(0부터). 구간이 없으면 0 */
export function legIndex(zone: Zone, world: World): number {
  const legs = zone.legs ?? [];
  const cx = Math.floor(world.player.x / CELL);
  let k = 0;
  for (let i = 0; i < legs.length; i++) if (cx >= legs[i].x0) k = i;
  return k;
}

export function zoneStatus(zone: Zone, world: World, st: ZoneState = newZoneState()): ZoneStatus {
  switch (zone.kind) {
    case 'beats': {
      const beats = zone.beats ?? [];
      const b = beats[st.beat];
      const alive = world.enemies.filter((e) => e.state !== 'dead').length;
      const n = b.enemies.length;
      const last = st.beat === beats.length - 1;
      const word = zone.beatWord ?? '측량';
      if (st.pending) {
        // 다음 단계 준비 중: 다음 단계 이름과 어디로 가야 하는지
        const next = beats[st.beat + 1];
        const goal = `${word} ${st.beat + 2}/${beats.length} ${next.name}`;
        const label = `${goal} · 준비`;
        const block = { goal, count: '준비', countDone: false, pips: { done: st.beat + 1, total: beats.length } };
        // 숨 고르기가 끝났는데 플레이어가 출현 지점 4칸 안이라서 기다리는 중이면(지형 환원 대기가 겹쳐도) 물러날 곳(출발점)을 알린다
        if (st.wait <= 0 && beatBlock(world, next) === 'near') {
          const sp = world.setup.player;
          return { done: false, label, hint: '적이 나타날 자리 바로 옆이다 — 청록 표지 쪽으로 물러나면 다음 단계가 시작된다', marker: { cx: sp.cx, cy: sp.cy, r: 2 }, ...block };
        }
        return { done: false, label, hint: next.prompt ?? next.hint, marker: next.trigger, ...block };
      }
      const goal = `${word} ${st.beat + 1}/${beats.length} ${b.name}`;
      const count = `적 ${n - alive}/${n}`;
      const done = last && alive === 0;
      return {
        done,
        label: `${goal} · ${count}`,
        hint: b.hint,
        goal,
        count,
        countDone: alive === 0,
        pips: { done: st.beat + (done ? 1 : 0), total: beats.length },
      };
    }
    case 'reach': {
      const legs = zone.legs ?? [];
      const k = legIndex(zone, world);
      const leg = legs[k];
      const done = inExit(world);
      return {
        done,
        label: leg ? `출구까지 돌파 · 구간 ${k + 1}/${legs.length} ${leg.name}` : '출구까지 돌파',
        hint: leg?.hint ?? '',
        goal: leg ? `구간 ${k + 1}/${legs.length} ${leg.name}` : '출구까지 돌파',
        count: '출구 돌파',
        countDone: done,
        pips: { done: done ? legs.length : k, total: legs.length },
      };
    }
  }
}

/**
 * 단계의 적을 세울 수 없는 까닭: trigger = 플레이어가 아직 트리거 원 밖, near = 플레이어가 어느 출현 지점 4칸 안,
 * terrain = 서는 칸이 무너져 있음(환원되면 풀린다). 세울 수 있으면 null
 */
function beatBlock(world: World, b: Beat): 'trigger' | 'near' | 'terrain' | null {
  const t = world.terrain;
  const p = world.player;
  if (b.trigger && Math.hypot(p.x - cellCenter(b.trigger.cx), p.y - cellCenter(b.trigger.cy)) > b.trigger.r * CELL) return 'trigger';
  if (b.enemies.some((e) => Math.hypot(p.x - cellCenter(e.cx), p.y - cellCenter(e.cy)) <= 4 * CELL)) return 'near';
  if (b.enemies.some((e) => t.isCut(t.idx(e.cx, e.cy)) || isAbyss(t.height[t.idx(e.cx, e.cy)]))) return 'terrain';
  return null;
}

/**
 * 한 단계(FIXED_DT)마다 부른다(beats형 구역만 할 일이 있다). 앞 단계가 끝나면 숨 고르기 뒤 다음 단계의 적을 세운다.
 * 서는 칸이 무너져 있거나 플레이어 바로 옆이면 환원·이동을 기다린다(진행 불가 방지). 새 단계가 시작되면 그 단계 번호를 반환.
 */
export function zoneTick(zone: Zone, world: World, st: ZoneState = newZoneState()): number | null {
  if (zone.kind !== 'beats') return null;
  const beats = zone.beats ?? [];
  const alive = world.enemies.some((e) => e.state !== 'dead');
  if (!st.pending && !alive && st.beat < beats.length - 1) {
    st.pending = true;
    st.wait = BEAT_GAP;
  }
  if (st.pending) {
    st.wait -= FIXED_DT;
    const next = beats[st.beat + 1];
    if (st.wait <= 0 && beatBlock(world, next) === null) {
      st.beat++;
      st.pending = false;
      for (const e of next.enemies) world.spawnEnemy(e.kind, cellCenter(e.cx), cellCenter(e.cy), e.dormant ?? 0, true);
      return st.beat;
    }
  }
  return null;
}
