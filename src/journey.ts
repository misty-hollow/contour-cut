import { CELL, FIXED_DT, GRID_H, GRID_W } from './config';
import { cellCenter, type EnemySpec, type Setup } from './maps';
import { randInt } from './rng';
import { isAbyss } from './terrain';
import type { World } from './world';

/**
 * 첫 여정: 세 구역을 차례로 돌파한다(DECISIONS P-010).
 * 범용 스테이지 엔진이 아니라 구역 세 개의 데이터와 클리어 판정뿐이다. 구역마다 새 World를 만든다.
 */

export type ZoneGoal = 'beats' | 'reach' | 'airHits';

/** 구역 1의 단계("측량"). 앞 단계의 적이 모두 쓰러지면 다음 단계의 적이 나타난다 */
export interface Beat {
  name: string;
  /** 이 단계 동안 화면 아래에 보이는 전술 힌트 */
  hint: string;
  /** 앞 단계가 끝난 뒤 이 단계를 기다리는 동안의 안내(트리거가 있으면 어디로 가야 하는지) */
  prompt?: string;
  /** 플레이어가 이 원(칸 좌표·반경) 안에 들어와야 시작한다 */
  trigger?: { cx: number; cy: number; r: number };
  enemies: EnemySpec[];
}

export interface Zone {
  id: string;
  name: string;
  /** 구역 시작 배너와 HUD에 쓰는 목표 문장 */
  goal: string;
  kind: ZoneGoal;
  /** airHits 목표 수 */
  target?: number;
  /** beats형 구역의 단계들. 첫 단계의 적은 구역 시작부터 있다 */
  beats?: Beat[];
  /** 돌파 화면에 측량 평가를 보여 줄지 */
  graded?: boolean;
  build: () => Setup;
}

export interface ZoneStatus {
  done: boolean;
  /** HUD 진행 표시(예: "측량 2/3 포대 · 적 1/2") */
  label: string;
  /** 지금 단계의 전술 힌트(없으면 빈 문자열) */
  hint: string;
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
    enemies: [{ kind: 'chaser', cx: ZONE1_P1.cx, cy: ZONE1_P1.cy }],
  },
  {
    name: '포대',
    hint: '메사를 베면 사격형이 3단 떨어진다 · 서쪽 대지는 절대 심연이 된다 · 탄을 피해 움직여라',
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
  { id: 'rift', name: '균열 지대', goal: '세 번의 측량 — 적을 칼보다 지형으로 떨어뜨려라', kind: 'beats', beats: ZONE1_BEATS, graded: true, build: buildZone1 },
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

export function zoneStatus(zone: Zone, world: World, st: ZoneState = newZoneState()): ZoneStatus {
  switch (zone.kind) {
    case 'beats': {
      const beats = zone.beats ?? [];
      const b = beats[st.beat];
      const alive = world.enemies.filter((e) => e.state !== 'dead').length;
      const n = b.enemies.length;
      const last = st.beat === beats.length - 1;
      if (st.pending) {
        // 다음 단계 준비 중: 다음 단계 이름과 어디로 가야 하는지
        const next = beats[st.beat + 1];
        return { done: false, label: `측량 ${st.beat + 2}/${beats.length} ${next.name} · 준비`, hint: next.prompt ?? next.hint };
      }
      return {
        done: last && alive === 0,
        label: `측량 ${st.beat + 1}/${beats.length} ${b.name} · 적 ${n - alive}/${n}`,
        hint: b.hint,
      };
    }
    case 'reach':
      return { done: inExit(world), label: '동쪽 출구 표지까지 돌파', hint: '' };
    case 'airHits': {
      const n = Math.min(world.stats.airHits, zone.target ?? 0);
      return { done: world.stats.airHits >= (zone.target ?? 0), label: `공중 추가타 ${n}/${zone.target}`, hint: '' };
    }
  }
}

/** 단계의 적을 세울 수 있는가: 서는 칸이 모두 단단하고(침하·심연 아님) 플레이어 바로 옆이 아니다 */
function beatReady(world: World, b: Beat): boolean {
  const t = world.terrain;
  const p = world.player;
  if (b.trigger && Math.hypot(p.x - cellCenter(b.trigger.cx), p.y - cellCenter(b.trigger.cy)) > b.trigger.r * CELL) return false;
  return b.enemies.every((e) => {
    const i = t.idx(e.cx, e.cy);
    return !t.isCut(i) && !isAbyss(t.height[i]) && Math.hypot(p.x - cellCenter(e.cx), p.y - cellCenter(e.cy)) > 4 * CELL;
  });
}

/**
 * 한 단계(FIXED_DT)마다 부른다. 구역 1: 앞 단계가 끝나면 숨 고르기 뒤 다음 단계의 적을 세운다(서는 칸이 무너져 있으면
 * 환원될 때까지 기다린다). 구역 3: 살아 있는 적이 없고 목표가 남았으면 언덕 꼭대기에 감시자를 새로 세운다.
 * 모두 진행 불가 상태를 막기 위한 것이고, 시뮬레이션 RNG만 써서 결정적이다. 새 단계가 시작되면 그 단계 번호를 반환.
 */
export function zoneTick(zone: Zone, world: World, st: ZoneState = newZoneState()): number | null {
  if (zone.kind === 'beats') {
    const beats = zone.beats ?? [];
    const alive = world.enemies.some((e) => e.state !== 'dead');
    if (!st.pending && !alive && st.beat < beats.length - 1) {
      st.pending = true;
      st.wait = BEAT_GAP;
    }
    if (st.pending) {
      st.wait -= FIXED_DT;
      const next = beats[st.beat + 1];
      if (st.wait <= 0 && beatReady(world, next)) {
        st.beat++;
        st.pending = false;
        for (const e of next.enemies) world.spawnEnemy(e.kind, cellCenter(e.cx), cellCenter(e.cy), e.dormant ?? 0, true);
        return st.beat;
      }
    }
    return null;
  }
  zoneTick3(zone, world);
  return null;
}

/**
 * 구역별 진행 보조(구역 3만): 살아 있는 적이 없는데 목표가 남았으면 언덕 꼭대기에 감시자를 새로 세운다.
 * 진행 불가 상태(콤보를 넣을 상대가 없음)를 막는다. 시뮬레이션 RNG를 써서 결정적이다.
 */
function zoneTick3(zone: Zone, world: World): void {
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
