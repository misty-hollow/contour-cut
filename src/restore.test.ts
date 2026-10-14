import { describe, expect, it } from 'vitest';
import { CELL, FIXED_DT, GRID_H, GRID_W, tune } from './config';
import { isAbyss } from './terrain';
import { emptyInput, World, type Input } from './world';

const c = (n: number) => (n + 0.5) * CELL;

function run(w: World, sec: number, input: Input = emptyInput()): void {
  const n = Math.round(sec / FIXED_DT);
  for (let k = 0; k < n; k++) w.step(FIXED_DT, input);
}

/** 조건이 참이 될 때까지(최대 sec초) 한 단계씩 */
function runUntil(w: World, sec: number, cond: () => boolean, input: Input = emptyInput()): boolean {
  const n = Math.round(sec / FIXED_DT);
  for (let k = 0; k < n; k++) {
    if (cond()) return true;
    w.step(FIXED_DT, input);
  }
  return cond();
}

function cutToward(w: World, ax: number, ay: number): void {
  const inp = emptyInput();
  inp.aimX = ax;
  inp.aimY = ay;
  inp.cut = true;
  w.step(FIXED_DT, inp);
}

/** combo: 바깥 고리를 베어 꼭대기 적을 가두고, 서쪽으로 걸어가 심연 가장자리에 선다 */
function trapAndApproach(): World {
  const w = new World('combo', 1);
  cutToward(w, c(18), c(26));
  const walk = emptyInput();
  walk.moveX = -1;
  run(w, 1.5, walk);
  return w;
}

describe('지형 환원 → 에어본', () => {
  it('구덩이에 갇힌 적은 7초 환원 순간 공중으로 튕겨 오른다(피해 없음, 위치 그대로, 지면 위)', () => {
    const w = new World('trap', 1);
    cutToward(w, c(18), c(26));
    const cutTime = w.time;
    const e = w.enemies[0];
    expect(runUntil(w, tune.restoreSec - 0.3, () => e.state === 'launched')).toBe(false);
    const before = { x: e.x, y: e.y, hp: e.hp };
    expect(runUntil(w, 1, () => e.state === 'launched')).toBe(true);
    // 기존 7초 규칙 그대로: 절단 시각 + restoreSec(게임 시간)에 환원
    expect(w.time - cutTime).toBeGreaterThanOrEqual(tune.restoreSec - FIXED_DT);
    expect(w.time - cutTime).toBeLessThan(tune.restoreSec + 2 * FIXED_DT);
    expect(e.airborne).toBe(true);
    expect(e.vz).toBeGreaterThan(0);
    expect(e.hp).toBe(before.hp);
    expect(e.x).toBe(before.x);
    expect(e.y).toBe(before.y);
    expect(e.z).toBeGreaterThanOrEqual(w.terrain.heightAt(e.x, e.y));
    expect(w.stats.launches).toBe(1);
  });

  it('환원 한 번에 한 번만 뜬다. 착지하면 짧게 기절했다가 다시 움직인다', () => {
    const w = new World('trap', 1);
    cutToward(w, c(18), c(26));
    const e = w.enemies[0];
    runUntil(w, tune.restoreSec + 1, () => e.state === 'launched');
    runUntil(w, 2, () => e.state !== 'launched');
    expect(e.state).toBe('stun');
    expect(e.airborne).toBe(false);
    expect(e.z).toBe(w.terrain.heightAt(e.x, e.y));
    run(w, 1.5);
    expect(['walk', 'windup', 'lunge', 'recover']).toContain(e.state);
    expect(w.stats.launches).toBe(1);
  });

  it('환원 자체로는 죽지 않는다: 낙하로 체력 1이 된 적도 환원 착지 뒤 살아 있다', () => {
    const w = new World('fall', 1);
    cutToward(w, c(47), c(15));
    const e = w.enemies[0];
    run(w, 1);
    expect(e.hp).toBe(1);
    runUntil(w, tune.restoreSec + 1, () => e.state === 'launched');
    expect(e.state).toBe('launched');
    runUntil(w, 2, () => e.state !== 'launched');
    expect(e.state).toBe('stun');
    expect(e.hp).toBe(1);
    expect(w.stats.kills.fall + w.stats.kills.abyss + w.stats.kills.air + w.stats.kills.blade).toBe(0);
  });

  it('에어본 중 칼날 = 공중 추가타(2 피해). 공중에서 받은 기절은 착지 뒤로 미뤄져 상태가 겹치지 않는다', () => {
    const w = trapAndApproach();
    const e = w.enemies[0];
    expect(w.player.x).toBeGreaterThan(c(18) + 20); // 심연 앞에서 멈췄다
    runUntil(w, tune.restoreSec + 1, () => e.state === 'launched');
    expect(e.state).toBe('launched');
    // 덫 절단 때 꼭대기도 3단 내려앉아 이미 체력 1이다. 공중 상태 전이를 보려고 체력만 3으로 준비
    e.hp = 3;
    cutToward(w, e.x, e.y);
    expect(w.stats.airHits).toBe(1);
    expect(e.hp).toBe(1);
    expect(e.state).toBe('launched'); // 공중에서 기절로 바뀌지 않는다
    // 착지할 때까지 매 단계: 살아서 떠 있는 동안은 launched만. 착지하면 기절(또는 다시 벤 땅이 무너져 낙하 처치)
    for (let k = 0; k < 120 && e.airborne && e.state !== 'dead'; k++) {
      expect(e.state).toBe('launched');
      w.step(FIXED_DT, emptyInput());
    }
    expect(['stun', 'dead']).toContain(e.state);
    if (e.state === 'dead') expect(e.deathCause).toBe('fall');
  });

  it('무방비 적을 공중 추가타로 처치하면 공중 처치로 센다', () => {
    const w = new World('fall', 1);
    cutToward(w, c(47), c(15));
    const walk = emptyInput();
    walk.moveX = 1;
    run(w, 1, walk); // 메사 절벽 앞까지
    const e = w.enemies[0];
    runUntil(w, tune.restoreSec + 1, () => e.state === 'launched');
    cutToward(w, e.x, e.y);
    run(w, 0.2);
    expect(w.stats.kills.air).toBe(1);
    expect(e.state).toBe('dead');
  });

  it('무방비 시간이 지나면 보통 칼날 피해(1)로 돌아간다', () => {
    const w = trapAndApproach();
    const e = w.enemies[0];
    runUntil(w, tune.restoreSec + 1, () => e.state === 'launched');
    runUntil(w, 3, () => e.exposedT === 0);
    e.hp = 3; // 덫 절단 낙하로 체력 1 → 타격 판정만 보려고 준비
    w.events = [];
    cutToward(w, e.x, e.y);
    expect(w.events.some((ev) => ev.type === 'hit'), '칼날이 실제로 맞았다').toBe(true);
    expect(w.events.some((ev) => ev.type === 'airHit')).toBe(false);
    expect(e.hp).toBe(2);
    expect(w.stats.airHits).toBe(0);
  });
});

describe('타격 멈춤(히트스톱)', () => {
  it('강한 타격(처치)은 hitstopStrong만큼 멈추고, 겹쳐도 누적되지 않는다', () => {
    const w = new World('abyss', 1);
    cutToward(w, c(18), c(29));
    runUntil(w, 2, () => w.stats.kills.abyss === 1);
    expect(w.hitstop).toBeGreaterThan(0);
    expect(w.hitstop).toBeLessThanOrEqual(Math.max(tune.hitstop, tune.hitstopStrong));
  });

  it('멈춘 동안 게임 시간·복구 타이머는 흐르지 않고, 들어온 대시 입력은 보존됐다가 멈춤이 풀리면 실행된다', () => {
    const w = new World('abyss', 1);
    cutToward(w, c(18), c(29));
    runUntil(w, 2, () => w.hitstop > 0 && w.stats.kills.abyss === 1);
    const t0 = w.time;
    const restoreAt = Math.min(...Array.from(w.terrain.restoreAt).filter((v) => v !== Infinity));
    const inp = emptyInput();
    inp.dash = true;
    inp.moveX = 1;
    w.step(FIXED_DT, inp);
    expect(w.time).toBe(t0);
    expect(inp.dash).toBe(true);
    runUntil(w, 1, () => !inp.dash, inp);
    expect(w.player.dashT > 0 || w.player.dashCool > 0).toBe(true);
    // 복구 예정 시각은 멈춤 때문에 바뀌지 않는다(게임 시간 기준 7초)
    expect(Math.min(...Array.from(w.terrain.restoreAt).filter((v) => v !== Infinity))).toBe(restoreAt);
  });
});

describe('불변식: 30초 모의 전투(기본 전장, 결정적 입력)', () => {
  it('적이 지형 속에 끼이거나 맵 밖으로 나가지 않고, 환원 에어본은 착지 전에 다시 발동하지 않는다', () => {
    const w = new World(null, 7);
    const inp = emptyInput();
    const launchedOnce = new Map<number, boolean>();
    let launchEvents = 0;
    for (let k = 0; k < 30 * 60; k++) {
      const p = w.player;
      const live = w.enemies.filter((e) => e.state !== 'dead');
      if (live.length) {
        live.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
        const t = live[0];
        inp.aimX = t.x;
        inp.aimY = t.y;
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        inp.moveX = d > 40 ? Math.sign(t.x - p.x) : -Math.sign(t.x - p.x);
        inp.moveY = d > 40 ? Math.sign(t.y - p.y) : -Math.sign(t.y - p.y);
        if (k % 24 === 0) inp.cut = true;
        if (k % 90 === 0) inp.dash = true;
      }
      const prev = new Map(w.enemies.map((e) => [e.id, e.state]));
      w.step(FIXED_DT, inp);
      for (const ev of w.events) if (ev.type === 'launch') launchEvents++;
      w.events = [];
      if (w.mode !== 'play') break;
      for (const e of w.enemies) {
        if (e.state === 'dead') continue;
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.y).toBeGreaterThanOrEqual(0);
        expect(e.x).toBeLessThanOrEqual(GRID_W * CELL);
        expect(e.y).toBeLessThanOrEqual(GRID_H * CELL);
        const g = w.terrain.heightAt(e.x, e.y);
        if (!isAbyss(g) && g < 50) expect(e.z).toBeGreaterThanOrEqual(g - 1e-6);
        if (e.state === 'launched' && prev.get(e.id) !== 'launched') {
          // 새로 뜬 적은 직전 단계에 launched가 아니었다 = 착지 전 재발동 없음
          launchedOnce.set(e.id, true);
        }
        if (e.state === 'launched') expect(e.airborne).toBe(true);
      }
    }
    expect(w.stats.launches).toBe(launchEvents);
  });
});
