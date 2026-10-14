import { describe, expect, it } from 'vitest';
import { ABYSS, CELL, GRID_H, GRID_W, OUT_OF_BOUNDS } from './config';
import { buildFlowField, nextCell } from './flowfield';
import { generateArena, labHeights } from './maps';
import { stepKind, Terrain } from './terrain';

const c = (n: number) => (n + 0.5) * CELL;
const lab = () => new Terrain(GRID_W, GRID_H, labHeights());

describe('등고선 찾기', () => {
  it('평지만 지나면 등고선이 없다', () => {
    const t = lab();
    expect(t.findCrossings(c(30), c(5), c(38), c(5))).toEqual([]);
  });

  it('메사 서쪽 절벽을 동쪽으로 베면 높은 쪽이 메사 칸이다', () => {
    const t = lab();
    const cr = t.findCrossings(c(40), c(15), c(47), c(15));
    expect(cr).toHaveLength(1);
    expect(cr[0].level).toBe(4);
    expect(cr[0].high).toBe(t.idx(44, 15));
    expect(cr[0].low).toBe(t.idx(43, 15));
  });

  it('반대 방향(고지대에서 내려오며)으로 베어도 같은 등고선을 찾는다', () => {
    const t = lab();
    const cr = t.findCrossings(c(47), c(15), c(40), c(15));
    expect(cr).toHaveLength(1);
    expect(cr[0].high).toBe(t.idx(44, 15));
  });
});

describe('절단 → 붕괴', () => {
  it('벤 등고선 안쪽 고지대가 반경 안에서 drop 단계 내려앉고, 반경 밖은 그대로', () => {
    const t = lab();
    const res = t.cut(c(40), c(15), c(47), c(15), 0, 3, 6, 7);
    expect(res.cells.length).toBeGreaterThan(0);
    expect(t.get(44, 15)).toBe(1);
    expect(t.get(49, 15)).toBe(1); // 거리 5
    expect(t.get(51, 15)).toBe(4); // 거리 7 > 반경 6
    expect(t.get(43, 15)).toBe(1); // 낮은 쪽은 그대로
    expect(t.version).toBe(1);
  });

  it('0 미만이 되는 칸은 심연이 된다', () => {
    const t = lab();
    // 계단 언덕 남쪽: 고도 1 → 2 경계를 북쪽으로 벤다
    t.cut(c(18), c(36), c(18), c(29), 0, 3, 6, 7);
    expect(t.get(18, 31)).toBe(ABYSS); // 고도 2 → 심연
    expect(t.get(18, 28)).toBe(0); // 고도 3 → 0
    expect(t.get(18, 33)).toBe(1); // 낮은 쪽(고도 1)은 그대로
  });

  it('여러 등고선을 한 번에 베어도 각 칸은 한 번만 내려간다', () => {
    const t = lab();
    t.cut(c(18), c(36), c(18), c(24), 0, 3, 8, 7);
    expect(t.get(18, 26)).toBe(1); // 꼭대기 4 → 1 (두 번 내려가면 심연)
  });

  it('복구 시각이 지나면 원래 높이로 돌아온다', () => {
    const t = lab();
    t.cut(c(40), c(15), c(47), c(15), 10, 3, 6, 7);
    expect(t.restoreDue(16.9)).toEqual([]);
    expect(t.get(44, 15)).toBe(1);
    const back = t.restoreDue(17);
    expect(back.length).toBeGreaterThan(0);
    expect(t.get(44, 15)).toBe(4);
    expect(t.isCut(t.idx(44, 15))).toBe(false);
  });

  it('그리기 높이는 즉시가 아니라 시간에 걸쳐 따라간다', () => {
    const t = lab();
    t.cut(c(40), c(15), c(47), c(15), 0, 3, 6, 7);
    const i = t.idx(46, 15);
    expect(t.shown[i]).toBe(4);
    t.animate(1 / 60);
    expect(t.shown[i]).toBeLessThan(4);
    expect(t.shown[i]).toBeGreaterThan(1);
    for (let k = 0; k < 30; k++) t.animate(1 / 60);
    expect(t.shown[i]).toBe(1);
  });
});

describe('이동 규칙', () => {
  it('1단 오르기 가능, 2단 이상은 벽, 내려가기는 낙하, 심연·지도 밖 구분', () => {
    expect(stepKind(1, 2)).toBe('walk');
    expect(stepKind(1, 3)).toBe('blocked');
    expect(stepKind(4, 1)).toBe('drop');
    expect(stepKind(1, ABYSS)).toBe('abyss');
    expect(stepKind(1, OUT_OF_BOUNDS)).toBe('blocked');
  });
});

describe('적 길찾기', () => {
  it('3단 절벽 메사 위는 평지에서 도달할 수 없다', () => {
    const t = lab();
    const dist = buildFlowField(t, 40, 15);
    expect(dist[t.idx(48, 15)]).toBe(-1);
    expect(dist[t.idx(30, 15)]).toBeGreaterThan(0);
  });

  it('계단 언덕은 한 단씩 올라 꼭대기까지 간다', () => {
    const t = lab();
    const dist = buildFlowField(t, 18, 26);
    expect(dist[t.idx(18, 36)]).toBeGreaterThan(0);
    const n = nextCell(t, dist, 18, 36);
    expect(n).toBe(t.idx(18, 35));
  });

  it('계단 언덕의 안쪽 고리를 베면 구덩이가 되고, 빠진 적은 나갈 길이 없다', () => {
    const t = lab();
    // 고리 2(고도 2) 위에서 북쪽으로 고리 3 경계를 벤다: 고도 3·4 → 0·1, 바깥 고리 2와 2단 차이
    t.cut(c(18), c(30), c(18), c(27), 0, 3, 6, 7);
    expect(t.get(18, 28)).toBe(0);
    expect(t.get(18, 26)).toBe(1);
    expect(t.get(18, 30)).toBe(2);
    const dist = buildFlowField(t, 40, 15);
    expect(dist[t.idx(18, 26)]).toBe(-1);
    expect(dist[t.idx(18, 30)]).toBeGreaterThan(0);
  });

  it('메사(평지 위 3단)를 베면 평지와 같은 높이가 되어 그쪽으로는 열린다', () => {
    const t = lab();
    t.cut(c(40), c(15), c(47), c(15), 0, 3, 6, 7);
    const dist = buildFlowField(t, 40, 15);
    expect(dist[t.idx(46, 15)]).toBeGreaterThan(0);
  });
});

describe('지도 생성', () => {
  it('같은 시드는 같은 지도, 다른 시드는 다른 지도', () => {
    const a = generateArena(7);
    const b = generateArena(7);
    const d = generateArena(8);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(d));
  });

  it('고도는 0~6, 시작 지점은 평지(1)', () => {
    const a = generateArena(7);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(6);
    expect(a[Math.floor(GRID_H / 2) * GRID_W + Math.floor(GRID_W / 2)]).toBe(1);
  });
});
