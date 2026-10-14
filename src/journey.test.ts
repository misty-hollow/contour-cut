import { describe, expect, it } from 'vitest';
import { CELL, FIXED_DT, GRID_H, GRID_W, tune } from './config';
import { buildFlowField } from './flowfield';
import {
  BEAT_GAP,
  inExit,
  journeyTotals,
  newZoneState,
  parseZoneParam,
  surveyGrade,
  ZONE1_BEATS,
  ZONE1_MESA,
  ZONE1_P1,
  ZONE1_P2,
  ZONE1_RING,
  ZONE2_BRIDGE,
  ZONE2_CHASM,
  ZONE2_EXIT,
  ZONE2_LEDGE,
  ZONE2_PILLARS,
  ZONE2_RIDGES,
  ZONE2_SCARP,
  ZONE3_BEATS,
  ZONE3_HILLS,
  ZONE3_TABLES,
  ZONES,
  zoneResult,
  zoneStatus,
  zoneTick,
  type ZoneState,
} from './journey';
import { cellCenter } from './maps';
import { isAbyss, stepKind, Terrain } from './terrain';
import { emptyInput, World, type Input } from './world';

const c = cellCenter;

function step(w: World, zi: number, input: Input = emptyInput(), st?: ZoneState): void {
  w.step(FIXED_DT, input);
  zoneTick(ZONES[zi], w, st);
}
function run(w: World, zi: number, sec: number, input: Input = emptyInput(), st?: ZoneState): void {
  for (let k = 0; k < Math.round(sec / FIXED_DT); k++) step(w, zi, input, st);
}
function cutToward(w: World, zi: number, ax: number, ay: number, st?: ZoneState): void {
  const inp = emptyInput();
  inp.aimX = ax;
  inp.aimY = ay;
  inp.cut = true;
  step(w, zi, inp, st);
}
const zoneWorld = (i: number) => new World(null, 7, ZONES[i].build());

/** 플레이어 이동 규칙(1단 오르기, 내리기 자유, 심연 불가)으로 닿는 칸 */
function reachable(t: Terrain, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(t.w * t.h);
  const q = [t.idx(sx, sy)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % t.w;
    const y = (i - x) / t.w;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (!t.inBounds(nx, ny)) continue;
      const j = t.idx(nx, ny);
      if (seen[j]) continue;
      const k = stepKind(t.height[i], t.height[j]);
      if (k === 'walk' || k === 'drop') {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  return seen;
}

describe('첫 여정 구역 설정', () => {
  it('세 구역 모두: 지도 크기가 맞고 플레이어·적·출구가 단단한 땅 위에서 시작한다', () => {
    for (const z of ZONES) {
      const s = z.build();
      expect(s.heights.length).toBe(GRID_W * GRID_H);
      const t = new Terrain(GRID_W, GRID_H, s.heights);
      expect(isAbyss(t.get(s.player.cx, s.player.cy)), z.id).toBe(false);
      for (const e of s.enemies) expect(isAbyss(t.get(e.cx, e.cy)), `${z.id} 적`).toBe(false);
      if (s.exit) expect(isAbyss(t.get(s.exit.cx, s.exit.cy))).toBe(false);
      expect(s.waves).toBe(false);
    }
  });

  it('같은 구역은 언제 만들어도 같은 배치(결정적)', () => {
    for (const z of ZONES) expect(Array.from(z.build().heights)).toEqual(Array.from(z.build().heights));
  });
});

describe('구역 1 — 균열 지대(세 번의 측량)', () => {
  it('측량 1: 출발점 바로 앞 대지의 적은 걸어서 내려오지 못하고(2단), 출발 자리에서 베어 닿는다', () => {
    const w = zoneWorld(0);
    const t = w.terrain;
    const [px, py] = t.cellOf(w.player.x, w.player.y);
    const dist = buildFlowField(t, px, py);
    expect(w.enemies.length).toBe(1);
    const e = w.enemies[0];
    const [ex, ey] = t.cellOf(e.x, e.y);
    expect(dist[t.idx(ex, ey)]).toBe(-1);
    expect(e.z - w.player.z).toBe(2);
    // 대지 가장자리(등고선)가 칼날 길이 안에 있다
    const edge = (ZONE1_P1.cy + 3 + 1) * 6;
    expect(w.player.y - edge).toBeLessThan(42);
  });

  it('균열 고리: 고리 안(표고 0)에서 고리(표고 1)를 밟지 않고는 지도 밖으로 나갈 수 없다(다가오는 적은 반드시 고리를 넘는다)', () => {
    const w = zoneWorld(0);
    const t = w.terrain;
    const seen = new Uint8Array(t.w * t.h);
    const q = [t.idx(ZONE1_RING.cx, ZONE1_RING.cy)];
    seen[q[0]] = 1;
    let escaped = false;
    while (q.length) {
      const i = q.pop()!;
      const x = i % t.w;
      const y = (i - x) / t.w;
      if (x === 0 || y === 0 || x === t.w - 1 || y === t.h - 1) escaped = true;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (!t.inBounds(nx, ny)) continue;
        const j = t.idx(nx, ny);
        if (seen[j] || t.height[j] !== 0) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    expect(escaped).toBe(false);
  });

  it('세 단계를 지형으로 정리하면 클리어된다: 대지 → 메사·대지 → 고리를 넘는 적', () => {
    const w = zoneWorld(0);
    const st = newZoneState();
    const p = w.player;
    // 측량 1: 출발 자리에서 바로 벤다
    cutToward(w, 0, c(ZONE1_P1.cx), c(ZONE1_P1.cy), st);
    run(w, 0, 1.2, emptyInput(), st);
    expect(w.stats.kills.abyss).toBe(1);
    expect(zoneStatus(ZONES[0], w, st).label).toBe('측량 2/3 포대 · 준비');
    run(w, 0, BEAT_GAP + 0.2, emptyInput(), st);
    expect(st.beat).toBe(1);
    expect(zoneStatus(ZONES[0], w, st).label).toBe('측량 2/3 포대 · 적 0/2');
    run(w, 0, 1.2, emptyInput(), st); // 소환 연출(0.9초)
    // 측량 2: 메사(사격형) 남쪽, 서쪽 대지(돌진형) 남쪽에서 벤다. 서는 자리는 테스트 준비로 옮긴다
    p.x = c(56);
    p.y = c(ZONE1_MESA.y1 + 4);
    cutToward(w, 0, c(56), c(19), st);
    run(w, 0, 1.2, emptyInput(), st);
    p.x = c(ZONE1_P2.cx);
    p.y = c(ZONE1_P2.cy + 7);
    cutToward(w, 0, c(ZONE1_P2.cx), c(ZONE1_P2.cy), st);
    run(w, 0, 1.2, emptyInput(), st);
    // 측량 3은 고리 안에 들어가야 시작한다
    run(w, 0, BEAT_GAP + 1, emptyInput(), st);
    expect(st.beat).toBe(1);
    expect(st.pending).toBe(true);
    const wait = zoneStatus(ZONES[0], w, st);
    expect(wait.label).toBe('측량 3/3 균열 고리 · 준비');
    expect(wait.hint).toContain('고리 안으로');
    // 고리 한가운데에 서서, 고리 위에 올라선 적의 발밑을 벤다
    p.x = c(ZONE1_RING.cx);
    p.y = c(ZONE1_RING.cy);
    run(w, 0, 0.1, emptyInput(), st);
    expect(st.beat).toBe(2);
    let k = 0;
    while (!zoneStatus(ZONES[0], w, st).done && w.mode === 'play' && k++ < 60 * 60) {
      const onRing = w.enemies.find((e) => {
        if (e.state === 'dead' || e.state === 'spawn' || e.airborne) return false;
        const d = Math.hypot(e.x - c(ZONE1_RING.cx), e.y - c(ZONE1_RING.cy)) / 6;
        return d >= ZONE1_RING.inner - 0.5 && d <= ZONE1_RING.outer + 0.5 && w.terrain.heightAt(e.x, e.y) === 1;
      });
      if (onRing && w.player.cutCool === 0) cutToward(w, 0, onRing.x, onRing.y, st);
      else step(w, 0, emptyInput(), st);
    }
    expect(w.mode).toBe('play');
    const done = zoneStatus(ZONES[0], w, st);
    expect(done.done).toBe(true);
    expect(done.label).toBe('측량 3/3 균열 고리 · 적 3/3');
    const r = zoneResult(w);
    expect(r.terrainKills + r.airKills).toBeGreaterThanOrEqual(5);
  });

  it('다음 단계의 적이 설 자리가 무너져 있으면 환원될 때까지 기다렸다가 나타난다', () => {
    const w = zoneWorld(0);
    const st = newZoneState();
    const p = w.player;
    // 메사(측량 2의 사격형 자리)를 먼저 베어 둔다
    p.x = c(56);
    p.y = c(ZONE1_MESA.y1 + 4);
    cutToward(w, 0, c(56), c(19), st);
    // 측량 1의 적을 처치
    p.x = c(40);
    p.y = c(34);
    run(w, 0, 0.5, emptyInput(), st);
    cutToward(w, 0, c(ZONE1_P1.cx), c(ZONE1_P1.cy), st);
    run(w, 0, 1.2 + BEAT_GAP + 0.5, emptyInput(), st);
    expect(st.pending).toBe(true);
    expect(st.beat).toBe(0);
    run(w, 0, 6, emptyInput(), st);
    expect(st.beat).toBe(1);
    const shooter = w.enemies.find((e) => e.kind === 'shooter')!;
    expect(shooter.z).toBe(4);
  });

  it('다음 단계의 적이 설 자리 바로 옆(4칸 안)에 플레이어가 있으면 기다리고, 벗어나면 나타난다', () => {
    const w = zoneWorld(0);
    const st = newZoneState();
    const p = w.player;
    cutToward(w, 0, c(ZONE1_P1.cx), c(ZONE1_P1.cy), st);
    run(w, 0, 1.2, emptyInput(), st);
    // 측량 2의 서쪽 대지 돌진형 자리 바로 옆에 선다(준비)
    p.x = c(ZONE1_P2.cx + 2);
    p.y = c(ZONE1_P2.cy + 2);
    run(w, 0, BEAT_GAP + 2, emptyInput(), st);
    expect(st.pending).toBe(true);
    expect(st.beat).toBe(0);
    expect(w.enemies.filter((e) => e.state !== 'dead').length).toBe(0);
    // 벗어나면 바로 다음 단계
    p.x = c(40);
    p.y = c(34);
    run(w, 0, 0.1, emptyInput(), st);
    expect(st.beat).toBe(1);
    expect(st.pending).toBe(false);
    expect(w.enemies.filter((e) => e.state !== 'dead').length).toBe(2);
  });

  it('측량 평가: 전부 지형+무피해 S, 지형 80% 이상+피해 2 이하 A, 그 밖 B', () => {
    const base = { cuts: 0, airHits: 0, time: 0, airKills: 0 };
    expect(surveyGrade({ ...base, terrainKills: 6, bladeKills: 0, hurt: 0 }).grade).toBe('S');
    expect(surveyGrade({ ...base, terrainKills: 5, bladeKills: 1, hurt: 2 }).grade).toBe('A');
    expect(surveyGrade({ ...base, terrainKills: 6, bladeKills: 0, hurt: 3 }).grade).toBe('B');
    expect(surveyGrade({ ...base, terrainKills: 3, bladeKills: 3, hurt: 0 }).grade).toBe('B');
    expect(ZONE1_BEATS.reduce((n, b) => n + b.enemies.length, 0)).toBe(6);
  });
});

describe('구역 2 — 접힘 협곡', () => {
  /** 구역 2에서 적을 모두 치우고(또는 고른 것만 남기고) 플레이어를 칸 (cx, cy)에 세운다(테스트 준비) */
  function canyon(cx: number, cy: number, keep: (e: { kind: string; x: number; y: number }) => boolean = () => false): World {
    const w = zoneWorld(1);
    w.enemies = w.enemies.filter(keep);
    w.player.x = c(cx);
    w.player.y = c(cy);
    w.player.z = w.terrain.heightAt(w.player.x, w.player.y);
    return w;
  }
  /** 동쪽으로 대시해 착지할 때까지 */
  function dashEast(w: World): void {
    const inp = emptyInput();
    inp.moveX = 1;
    inp.dash = true;
    for (let k = 0; k < 120; k++) {
      step(w, 1, inp);
      if (k > 3 && !w.player.airborne && w.player.dashT === 0) break;
    }
    run(w, 1, 1);
  }

  it('출발점에서 출구까지 걷거나 뛰어내려 갈 수 있고, 닿을 수 있는 어느 칸에서도 출구로 갈 수 있다(막다른 구덩이 없음)', () => {
    const s = ZONES[1].build();
    const t = new Terrain(GRID_W, GRID_H, s.heights);
    const fromStart = reachable(t, s.player.cx, s.player.cy);
    expect(fromStart[t.idx(ZONE2_EXIT.cx, ZONE2_EXIT.cy)]).toBe(1);
    for (let i = 0; i < fromStart.length; i++) {
      if (!fromStart[i]) continue;
      const r = reachable(t, i % t.w, Math.floor(i / t.w));
      expect(r[t.idx(ZONE2_EXIT.cx, ZONE2_EXIT.cy)], `칸 ${i % t.w},${Math.floor(i / t.w)}`).toBe(1);
    }
  });

  it('구간 표시: 플레이어가 동쪽으로 갈수록 단애 → 사격 회랑 → 심연 균열, 구간마다 힌트가 다르다', () => {
    const labels = [6, 30, 52, 70].map((cx) => zoneStatus(ZONES[1], canyon(cx, 20)));
    expect(labels.map((l) => l.label)).toEqual([
      '출구까지 돌파 · 구간 1/3 단애',
      '출구까지 돌파 · 구간 2/3 사격 회랑',
      '출구까지 돌파 · 구간 3/3 심연 균열',
      '출구까지 돌파 · 구간 3/3 심연 균열',
    ]);
    expect(new Set(labels.slice(0, 3).map((l) => l.hint)).size).toBe(3);
    expect(labels.every((l) => !l.done)).toBe(true);
  });

  it('단애: 걸어 내려가면 4단 낙하 충격파, 대시하면 협곡 바닥을 넘어 회랑까지 활강한다', () => {
    const walk = canyon(ZONE2_SCARP.x1, 20);
    const inp = emptyInput();
    inp.moveX = 1;
    run(walk, 1, 0.4, inp);
    expect(walk.stats.shocks).toBe(1);
    expect(walk.player.z).toBe(0);
    const glide = canyon(ZONE2_SCARP.x1 - 1, 20);
    dashEast(glide);
    expect(glide.player.x / CELL).toBeGreaterThan(27);
    expect(glide.stats.shocks).toBe(1);
    expect(glide.player.hp).toBe(5);
  });

  it('심연 균열: 평지에서 대시하면 못 건너고 빠지지만(체력 −1), 도약대에서 대시하면 건너편 광장에 착지 충격파', () => {
    const flat = canyon(ZONE2_CHASM.x0 - 1, 30);
    run(flat, 1, 0.1); // 균열 앞 평지(표고 1)에 선다(안전 지점 기록)
    dashEast(flat);
    expect(flat.player.hp).toBe(4);
    expect(flat.player.x / CELL).toBeLessThan(ZONE2_CHASM.x0);
    const high = canyon(ZONE2_LEDGE.x1 - 1, 20);
    expect(high.player.z).toBe(4);
    dashEast(high);
    expect(high.player.x / CELL).toBeGreaterThan(ZONE2_CHASM.x1 + 1);
    expect(high.player.z).toBe(1);
    expect(high.player.hp).toBe(5);
    expect(high.stats.shocks).toBe(1);
  });

  it('남쪽 다리는 한 방향 길: 걸어서 건너면 광장으로 2단 내려서며 충격파, 광장의 적은 다리로 올라오지 못한다', () => {
    const w = canyon(ZONE2_CHASM.x0 - 4, ZONE2_BRIDGE.y0);
    const inp = emptyInput();
    inp.moveX = 1;
    run(w, 1, 3, inp);
    expect(w.player.x / CELL).toBeGreaterThan(ZONE2_CHASM.x1 + 1);
    expect(w.player.z).toBe(1);
    expect(w.stats.shocks).toBe(1);
    // 광장에서 다리·회랑으로 가는 적의 길은 없다(적은 고도차 1까지만 걷는다)
    const flow = buildFlowField(w.terrain, ZONE2_CHASM.x0 - 4, ZONE2_BRIDGE.y0);
    for (const e of ZONES[1].build().enemies.filter((en) => en.cx > ZONE2_CHASM.x1)) expect(flow[w.terrain.idx(e.cx, e.cy)], `광장 적 ${e.cx},${e.cy}`).toBe(-1);
  });

  it('사격 회랑: 기둥 뒤에서는 능선 사격형의 탄이 막히고, 가리는 것 없이 서 있으면 맞는다', () => {
    const north = (e: { kind: string; y: number }) => e.kind === 'shooter' && e.y < c(ZONE2_RIDGES.north[1] + 1);
    const pillar = ZONE2_PILLARS[0];
    const covered = canyon(pillar.x1, pillar.y1 + 2, north);
    run(covered, 1, 6);
    expect(covered.player.hp).toBe(5);
    expect(covered.stats.boltsBlocked).toBeGreaterThan(0);
    const open = canyon(pillar.x1 + 4, pillar.y1 + 2, north);
    run(open, 1, 6);
    expect(open.player.hp).toBeLessThan(5);
  });

  it('사격 회랑: 회랑에서 능선 가장자리를 베면 사격형이 3단 떨어져 쓰러진다', () => {
    const shooter = ZONES[1].build().enemies.find((e) => e.kind === 'shooter' && e.cy <= ZONE2_RIDGES.north[1])!;
    const w = canyon(shooter.cx, shooter.cy + 4, (e) => e.kind === 'shooter' && e.x === c(shooter.cx) && e.y === c(shooter.cy));
    cutToward(w, 1, c(shooter.cx), c(shooter.cy));
    run(w, 1, 1.5);
    expect(w.stats.kills.fall).toBe(1);
  });

  it('도약대 경로: 단애에서 활강 → 회랑 → 계단으로 도약대 → 균열 위 활강 → 출구 표지(적을 다 잡지 않아도 클리어)', () => {
    const w = zoneWorld(1);
    const p = w.player;
    const go = (cx: number, cy: number) => {
      const inp = emptyInput();
      for (let k = 0; k < 15 * 60; k++) {
        const dx = c(cx) - p.x;
        const dy = c(cy) - p.y;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        inp.moveX = Math.abs(dx) > 2 ? Math.sign(dx) : 0;
        inp.moveY = Math.abs(dy) > 2 ? Math.sign(dy) : 0;
        step(w, 1, inp);
      }
      throw new Error(`${cx},${cy}까지 가지 못함(현재 ${(p.x / CELL).toFixed(1)},${(p.y / CELL).toFixed(1)})`);
    };
    go(ZONE2_SCARP.x1 - 1, 20);
    dashEast(w);
    go(ZONE2_LEDGE.x0 - 5, 20);
    go(ZONE2_LEDGE.x1 - 1, 20);
    expect(p.z).toBe(4);
    dashEast(w);
    go(ZONE2_EXIT.cx, ZONE2_EXIT.cy);
    run(w, 1, 0.1);
    expect(w.mode).toBe('play');
    expect(inExit(w)).toBe(true);
    expect(zoneStatus(ZONES[1], w).done).toBe(true);
    expect(w.enemies.some((e) => e.state !== 'dead')).toBe(true);
  });
});

describe('구역 3 — 환원 구역', () => {
  const restore = ZONES[2];

  it('세 단계(가두기 → 환원대 → 대환원), 적은 3 → 5 → 6으로 늘고 마지막에 사격형 둘', () => {
    expect(restore.kind).toBe('beats');
    expect(ZONE3_BEATS.map((b) => b.name)).toEqual(['가두기', '환원대', '대환원']);
    expect(ZONE3_BEATS.map((b) => b.enemies.length)).toEqual([3, 5, 6]);
    expect(ZONE3_BEATS[2].enemies.filter((e) => e.kind === 'shooter').length).toBe(2);
    expect(zoneStatus(restore, zoneWorld(2)).label).toBe('환원 1/3 가두기 · 적 0/3');
  });

  it('평평한 바닥(표고 1)에는 등고선이 없어 베어도 무너지지 않는다 — 지형으로 다루려면 언덕과 환원대를 쓴다', () => {
    const w = zoneWorld(2);
    cutToward(w, 2, w.player.x + 40, w.player.y);
    run(w, 2, 0.5);
    cutToward(w, 2, w.player.x, w.player.y + 40);
    expect(w.stats.cuts).toBe(2);
    expect(w.stats.cellsCollapsed).toBe(0);
  });

  it('가두기: 언덕 바깥 등고선을 베면 감시자 둘이 구덩이에 갇히고, 7초 뒤 환원으로 튕겨 오른 것을 구덩이 가장자리에서 공중 추가타', () => {
    const w = zoneWorld(2);
    w.enemies = w.enemies.filter((e) => e.dormant > 0);
    const p = w.player;
    const hill = ZONE3_HILLS[0];
    p.x = c(hill.cx);
    p.y = c(hill.cy + 9);
    cutToward(w, 2, c(hill.cx), c(hill.cy));
    const walk = emptyInput();
    walk.moveY = -1;
    run(w, 2, 1.5, walk); // 심연 가장자리에서 걸음이 멈춘다
    expect(p.hp).toBe(5);
    const [a, b] = w.enemies;
    expect([a.hp, b.hp]).toEqual([1, 1]);
    let n = 0;
    while (a.state !== 'launched' && n++ < (tune.restoreSec + 1) * 60) {
      step(w, 2);
      // 갇힌 동안 구덩이(꼭대기 반경 4칸) 밖으로 나오지 못한다
      for (const e of w.enemies) expect(Math.hypot(e.x - c(hill.cx), e.y - c(hill.cy))).toBeLessThan(4 * CELL);
    }
    expect(a.state).toBe('launched');
    expect(b.state).toBe('launched');
    cutToward(w, 2, a.x, a.y);
    expect(w.stats.airHits).toBeGreaterThanOrEqual(1);
    run(w, 2, 0.4);
    if (b.state !== 'dead') cutToward(w, 2, b.x, b.y);
    run(w, 2, 1);
    expect(w.stats.kills.air).toBe(2);
  });

  it('환원대: 베면 바닥과 같은 높이가 되어 적이 올라서고, 7초 뒤 솟는 땅이 그 위의 적을 띄운다', () => {
    const tbl = ZONE3_TABLES[0];
    const w = zoneWorld(2);
    w.enemies = [];
    const p = w.player;
    const mid = { cx: Math.floor((tbl.x0 + tbl.x1) / 2), cy: Math.floor((tbl.y0 + tbl.y1) / 2) };
    p.x = c(mid.cx);
    p.y = c(tbl.y1 + 3);
    cutToward(w, 2, c(mid.cx), c(mid.cy));
    for (let y = tbl.y0; y <= tbl.y1; y++) for (let x = tbl.x0; x <= tbl.x1; x++) expect(w.terrain.get(x, y), `${x},${y}`).toBe(1);
    // 환원대 한가운데로 올라선다. 북쪽에서 돌진형이 다가온다
    p.x = c(mid.cx);
    p.y = c(mid.cy);
    const e = w.spawnEnemy('chaser', c(mid.cx), c(tbl.y0 - 6), 0, false);
    let k = 0;
    while (e.state !== 'launched' && k++ < (tune.restoreSec + 1) * 60) step(w, 2);
    expect(e.state).toBe('launched');
    expect(p.z).toBe(4); // 플레이어는 땅과 함께 올라선다(튕기지 않음)
    cutToward(w, 2, e.x, e.y);
    expect(w.stats.airHits).toBe(1);
  });

  it('다음 단계의 적이 설 언덕이 무너져 있으면 환원될 때까지 기다렸다가 나타난다', () => {
    const w = zoneWorld(2);
    const st = newZoneState();
    const p = w.player;
    for (const e of w.enemies) e.state = 'dead';
    run(w, 2, BEAT_GAP + 0.2, emptyInput(), st);
    expect(st.beat).toBe(1);
    // 대환원 사격형 자리(서쪽 언덕)를 베어 둔 채로 환원대 단계를 끝낸다
    const hill = ZONE3_HILLS[1];
    p.x = c(hill.cx + 9);
    p.y = c(hill.cy);
    cutToward(w, 2, c(hill.cx), c(hill.cy), st);
    p.x = c(40);
    p.y = c(34);
    for (const e of w.enemies) e.state = 'dead';
    run(w, 2, BEAT_GAP + 0.5, emptyInput(), st);
    expect(st.pending).toBe(true);
    expect(zoneStatus(restore, w, st).label).toBe('환원 3/3 대환원 · 준비');
    run(w, 2, tune.restoreSec, emptyInput(), st);
    expect(st.beat).toBe(2);
    expect(w.enemies.filter((e) => e.kind === 'shooter' && e.state !== 'dead').length).toBe(2);
  });

  it('콤보는 강제가 아니다: 공중 추가타 없이도 세 단계의 적을 모두 쓰러뜨리면 클리어', () => {
    const w = zoneWorld(2);
    const st = newZoneState();
    for (let beat = 0; beat < 3; beat++) {
      expect(st.beat).toBe(beat);
      expect(zoneStatus(restore, w, st).done).toBe(false);
      for (const e of w.enemies) e.state = 'dead';
      run(w, 2, BEAT_GAP + 0.2, emptyInput(), st);
    }
    expect(w.stats.airHits).toBe(0);
    expect(zoneStatus(restore, w, st)).toMatchObject({ done: true, label: '환원 3/3 대환원 · 적 6/6' });
  });
});

describe('구역 번호 주소(?zone=N)', () => {
  it('1~3 정수만 받고, 소수·0·범위 밖·문자·빈 값은 구역 1(리뷰 재현: 1.5·2.5)', () => {
    expect(parseZoneParam('1')).toBe(0);
    expect(parseZoneParam('2')).toBe(1);
    expect(parseZoneParam('3')).toBe(2);
    for (const bad of ['1.5', '2.5', '0', '4', '-1', 'abc', '', '  ', 'NaN', 'Infinity']) expect(parseZoneParam(bad), bad).toBe(0);
    expect(parseZoneParam(null)).toBe(0);
    // 어떤 값이든 구역 배치를 만들 수 있어야 한다(초기화 예외 없음)
    for (const raw of ['1.5', '2.5', 'abc', null]) expect(() => ZONES[parseZoneParam(raw)].build()).not.toThrow();
  });
});

describe('최종 집계', () => {
  it('같은 구역을 다시 깨면 그 구역 결과를 덮어써 두 번 더해지지 않는다', () => {
    const w = zoneWorld(0);
    w.stats.cuts = 4;
    w.stats.kills.abyss = 3;
    const results = [zoneResult(w)];
    const again = zoneWorld(0);
    again.stats.cuts = 6;
    again.stats.kills.abyss = 4;
    results[0] = zoneResult(again);
    const t = journeyTotals(results);
    expect(t.cuts).toBe(6);
    expect(t.terrainKills).toBe(4);
  });
});

