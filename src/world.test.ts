import { describe, expect, it } from 'vitest';
import { CELL, FIXED_DT, tune } from './config';
import { boltHitsBody, emptyInput, World, type Input } from './world';

const c = (n: number) => (n + 0.5) * CELL;

function run(w: World, sec: number, input: Input = emptyInput()): void {
  const n = Math.round(sec / FIXED_DT);
  for (let k = 0; k < n; k++) w.step(FIXED_DT, input);
}

function cutToward(w: World, ax: number, ay: number): void {
  const inp = emptyInput();
  inp.aimX = ax;
  inp.aimY = ay;
  inp.cut = true;
  w.step(FIXED_DT, inp);
}

describe('적 낙하', () => {
  it('메사 위 적: 메사를 베면 3단 떨어져 2 피해 + 기절, 낙하 처치는 아님(체력 3)', () => {
    const w = new World('fall', 1);
    cutToward(w, c(47), c(15));
    expect(w.terrain.get(49, 15)).toBe(1);
    run(w, 1);
    const e = w.enemies[0];
    expect(e.hp).toBe(1);
    expect(e.state).toBe('stun');
    expect(e.z).toBe(1);
  });

  it('메사 위 적: 칼날로 한 번 때린 뒤 메사를 베면 낙하 처치', () => {
    const w = new World('fall', 1);
    // 칼날이 닿을 만큼 다가간다(동쪽으로 걷기, 절벽 앞에서 막힘)
    const walk = emptyInput();
    walk.moveX = 1;
    run(w, 0.4, walk);
    expect(w.player.x).toBeLessThan(c(44));
    // 적은 휴면 중이라 메사 가장자리에 그대로
    w.enemies[0].x = c(44);
    cutToward(w, c(46), c(15));
    run(w, 1);
    expect(w.stats.kills.blade + w.stats.kills.fall).toBe(1);
  });

  it('계단 언덕 적: 고리 2를 심연으로 만들면 심연 추락 처치', () => {
    const w = new World('abyss', 1);
    cutToward(w, c(18), c(29));
    run(w, 1.5);
    expect(w.stats.kills.abyss).toBe(1);
    expect(w.enemies.every((e) => e.state === 'dead') || w.enemies.length === 0).toBe(true);
  });

  it('무너진 지형은 복구 시간이 지나면 원래대로 돌아온다', () => {
    const w = new World('cut', 1);
    cutToward(w, c(47), c(15));
    expect(w.terrain.get(46, 15)).toBe(1);
    run(w, tune.restoreSec + 0.1);
    expect(w.terrain.get(46, 15)).toBe(4);
  });
});

describe('이동 방해', () => {
  it('언덕 꼭대기의 적은 바깥 고리가 베이면 구덩이에 갇힌다', () => {
    const w = new World('trap', 1);
    cutToward(w, c(18), c(26));
    run(w, 4);
    const e = w.enemies[0];
    expect(e.state).not.toBe('dead');
    expect(Math.hypot(e.x - c(18), e.y - c(26))).toBeLessThan(4 * CELL);
  });
});

describe('지형 이동', () => {
  it('낭떠러지에서 대시로 뛰어내리면 멀리 날아가 충격파로 아래 적을 기절시킨다', () => {
    const w = new World('dash', 1);
    const x0 = w.player.x;
    const inp = emptyInput();
    inp.moveX = -1;
    inp.dash = true;
    run(w, 1.2, inp);
    const travelled = x0 - w.player.x;
    // 같은 시간 평지 대시 거리(속도×시간)보다 확실히 길다
    expect(travelled).toBeGreaterThan(tune.dashSpeed * tune.dashTime * 1.4);
    expect(w.player.z).toBe(1);
    expect(w.stats.shocks).toBe(1);
  });

  it('지도 가장자리 밖으로 나가지 않는다(그림이 잘리지 않는 여백)', () => {
    const w = new World('cut', 1);
    const inp = emptyInput();
    inp.moveX = -1;
    inp.moveY = -1;
    run(w, 6, inp);
    expect(w.player.x).toBeGreaterThanOrEqual(5);
    expect(w.player.y).toBeGreaterThanOrEqual(5);
  });

  it('걸어서는 2단 이상 절벽을 오르지 못한다', () => {
    const w = new World('cut', 1);
    const inp = emptyInput();
    inp.moveX = 1;
    run(w, 2, inp);
    expect(w.player.x).toBeLessThan(44 * CELL);
    expect(w.player.z).toBe(1);
  });

  it('내려서면 낙차 가속이 붙는다', () => {
    const w = new World('dash', 1);
    const inp = emptyInput();
    inp.moveX = -1;
    run(w, 0.6, inp);
    expect(w.player.z).toBe(1);
    expect(w.player.boost).toBeGreaterThan(0);
  });

  it('사격형의 탄은 더 높은 지형에 막힌다: 메사 위에서는 맞지 않는다', () => {
    const w = new World('cover', 1);
    run(w, 4);
    expect(w.player.hp).toBe(5);
    expect(w.stats.boltsBlocked).toBeGreaterThan(0);
  });

  it('탄 피격은 몸의 수직 구간과 겹칠 때만: 머리 위·발밑을 지나는 탄은 맞지 않는다', () => {
    expect(boltHitsBody(1.5, 1)).toBe(true);
    expect(boltHitsBody(4.5, 1)).toBe(false); // 머리 위
    expect(boltHitsBody(1.5, 4)).toBe(false); // 발밑
  });

  it('높은 곳의 사격형은 고지대를 벗어난 뒤 내려가는 탄으로 아래 표적을 맞힌다', () => {
    const w = new World('highshot', 1);
    expect(w.enemies[0].z).toBe(4);
    expect(w.player.z).toBe(1);
    run(w, 3);
    expect(w.player.hp).toBeLessThan(5);
  });

  it('높게 날아가는 탄이 낮은 플레이어 머리 위를 지나가면 맞지 않는다', () => {
    const w = new World('cut', 1);
    const p = w.player;
    // 고도 4.5로 수평 비행하는 탄(표적 고도도 4.5)이 플레이어 위치를 가로지른다
    w.bolts.push({ x: p.x + 20, y: p.y, vx: -110, vy: 0, alt: 4.5, launchAlt: 4.5, targetAlt: 4.5, aimX: p.x - 60, aimY: p.y, life: 3 });
    run(w, 0.6);
    expect(p.hp).toBe(5);
  });

  it('같은 높이에 서 있으면 탄에 맞는다', () => {
    const w = new World('exposed', 1);
    run(w, 4);
    expect(w.player.hp).toBeLessThan(5);
  });
});

describe('게임 진행', () => {
  it('체력이 0이 되면 게임 오버', () => {
    const w = new World('swarm', 1);
    run(w, 20);
    expect(w.mode).toBe('over');
    expect(w.player.hp).toBe(0);
  });

  it('기본 전장은 웨이브로 적을 보낸다', () => {
    const w = new World(null, 7);
    run(w, 2);
    expect(w.stats.wave).toBe(1);
    expect(w.enemies.length).toBeGreaterThan(0);
  });

  it('같은 시드·같은 입력이면 같은 결과(결정성)', () => {
    const a = new World(null, 7);
    const b = new World(null, 7);
    const inp = emptyInput();
    inp.moveX = 1;
    run(a, 3, inp);
    run(b, 3, { ...inp });
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
