import { describe, expect, it } from 'vitest';
import { CELL, FIXED_DT, GRID_H, GRID_W, tune } from './config';
import { buildFlowField } from './flowfield';
import { inExit, journeyTotals, parseZoneParam, ZONE1_MESA, ZONE1_PLATEAUS, ZONE2_EXIT, ZONE3_HILLS, ZONES, zoneResult, zoneStatus, zoneTick } from './journey';
import { cellCenter } from './maps';
import { isAbyss, stepKind, Terrain } from './terrain';
import { emptyInput, World, type Input } from './world';

const c = cellCenter;

function step(w: World, zi: number, input: Input = emptyInput()): void {
  w.step(FIXED_DT, input);
  zoneTick(ZONES[zi], w);
}
function run(w: World, zi: number, sec: number, input: Input = emptyInput()): void {
  for (let k = 0; k < Math.round(sec / FIXED_DT); k++) step(w, zi, input);
}
function cutToward(w: World, zi: number, ax: number, ay: number): void {
  const inp = emptyInput();
  inp.aimX = ax;
  inp.aimY = ay;
  inp.cut = true;
  step(w, zi, inp);
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

describe('구역 1 — 균열 지대', () => {
  it('적은 모두 걸어서 내려올 수 없는 고지대(2단 이상)에 있어 플레이어에게 길이 없다', () => {
    const w = zoneWorld(0);
    const t = w.terrain;
    const [px, py] = t.cellOf(w.player.x, w.player.y);
    const dist = buildFlowField(t, px, py);
    for (const e of w.enemies) {
      const [ex, ey] = t.cellOf(e.x, e.y);
      expect(dist[t.idx(ex, ey)], `적 ${e.id}`).toBe(-1);
      expect(e.z - w.player.z).toBeGreaterThanOrEqual(2);
    }
  });

  it('고지대마다 한 번씩 4번 베면 전멸해 클리어된다(지형 처치)', () => {
    const w = zoneWorld(0);
    const p = w.player;
    const targets = [
      { stand: [40, 27], aim: [40, 21] }, // 메사(사격형)
      ...ZONE1_PLATEAUS.map((pl) => ({ stand: [pl.cx, pl.cy + 7], aim: [pl.cx, pl.cy] })),
    ];
    expect(ZONE1_MESA.y1).toBeLessThan(27);
    for (const tg of targets) {
      // 서는 자리는 준비(테스트 배치)로 옮긴다. 행동(절단)은 입력으로
      p.x = c(tg.stand[0]);
      p.y = c(tg.stand[1]);
      cutToward(w, 0, c(tg.aim[0]), c(tg.aim[1]));
      run(w, 0, 1.5);
    }
    const st = zoneStatus(ZONES[0], w);
    expect(st.label).toBe('고지대의 적 4/4');
    expect(st.done).toBe(true);
    expect(w.stats.kills.fall + w.stats.kills.abyss).toBe(4);
    expect(w.stats.kills.blade).toBe(0);
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
    expect(zoneStatus(ZONES[2], w)).toEqual({ done: true, label: '공중 추가타 3/3' });
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

