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
  ZONE2_EXIT,
  ZONE3_HILLS,
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

  it('동쪽으로 걸으며 대시하면 출구 표지에 닿아 클리어된다(적을 다 잡지 않아도)', () => {
    const w = zoneWorld(1);
    const inp = emptyInput();
    inp.moveX = 1;
    let k = 0;
    for (; k < 20 * 60 && !zoneStatus(ZONES[1], w).done && w.mode === 'play'; k++) {
      inp.dash = k % 40 === 0;
      step(w, 1, inp);
    }
    expect(w.mode).toBe('play');
    expect(inExit(w)).toBe(true);
    expect(zoneStatus(ZONES[1], w).done).toBe(true);
    expect(w.enemies.some((e) => e.state !== 'dead')).toBe(true);
  });
});

describe('구역 3 — 환원 구역', () => {
  it('언덕마다 가두기 → 7초 환원 → 공중 추가타를 세 번 이으면 클리어된다', () => {
    const w = zoneWorld(2);
    const p = w.player;
    for (const hl of ZONE3_HILLS) {
      const sentry = w.enemies.find((e) => e.state !== 'dead' && Math.hypot(e.x - c(hl.cx), e.y - c(hl.cy)) < 2 * CELL);
      expect(sentry, `언덕 ${hl.cx},${hl.cy}의 감시자`).toBeDefined();
      p.x = c(hl.cx + 10);
      p.y = c(hl.cy);
      cutToward(w, 2, c(hl.cx), c(hl.cy));
      // 심연 가장자리까지 다가간다
      const walk = emptyInput();
      walk.moveX = -1;
      run(w, 2, 1.2, walk);
      let n = 0;
      while (sentry!.state !== 'launched' && n++ < (tune.restoreSec + 2) * 60) step(w, 2);
      expect(sentry!.state).toBe('launched');
      const before = w.stats.airHits;
      cutToward(w, 2, sentry!.x, sentry!.y);
      expect(w.stats.airHits).toBe(before + 1);
      run(w, 2, 0.5);
    }
    expect(zoneStatus(ZONES[2], w)).toMatchObject({ done: true, label: '공중 추가타 3/3' });
  });

  it('살아 있는 적이 없고 목표가 남았으면 언덕 꼭대기에 감시자가 새로 선다(진행 불가 방지). 목표를 채우면 더 서지 않는다', () => {
    const w = zoneWorld(2);
    for (const e of w.enemies) e.state = 'dead';
    w.enemies = [];
    zoneTick(ZONES[2], w);
    expect(w.enemies.length).toBe(1);
    const e = w.enemies[0];
    expect(ZONE3_HILLS.some((hl) => Math.hypot(e.x - c(hl.cx), e.y - c(hl.cy)) < 1)).toBe(true);
    expect(e.state).toBe('spawn');
    w.enemies = [];
    w.stats.airHits = 3;
    zoneTick(ZONES[2], w);
    expect(w.enemies.length).toBe(0);
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

