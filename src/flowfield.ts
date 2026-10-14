import { isAbyss, type Terrain } from './terrain';

/**
 * 적의 길찾기용 거리장. 목표 칸에서 BFS로 퍼진다.
 * 적은 고도차 1 이하로만 걷는다(오르기·내려가기 모두). 그래서 절단으로 생긴 2단 이상
 * 절벽은 우회하거나 넘지 못한다. 도달 불가 칸은 -1.
 */
export function buildFlowField(t: Terrain, tx: number, ty: number): Int16Array {
  const dist = new Int16Array(t.w * t.h).fill(-1);
  if (!t.inBounds(tx, ty)) return dist;
  const start = t.idx(tx, ty);
  if (isAbyss(t.height[start])) return dist;
  const queue = new Int32Array(t.w * t.h);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  dist[start] = 0;
  while (head < tail) {
    const i = queue[head++];
    const x = i % t.w;
    const y = (i - x) / t.w;
    const hi = t.height[i];
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x;
      const ny = k === 2 ? y + 1 : k === 3 ? y - 1 : y;
      if (!t.inBounds(nx, ny)) continue;
      const j = t.idx(nx, ny);
      if (dist[j] !== -1) continue;
      const hj = t.height[j];
      if (isAbyss(hj) || Math.abs(hj - hi) > 1) continue;
      dist[j] = dist[i] + 1;
      queue[tail++] = j;
    }
  }
  return dist;
}

/** 현재 칸에서 목표에 가까워지는 이웃 칸. 없으면 -1. */
export function nextCell(t: Terrain, dist: Int16Array, cx: number, cy: number): number {
  if (!t.inBounds(cx, cy)) return -1;
  const here = dist[t.idx(cx, cy)];
  if (here <= 0) return -1;
  let best = -1;
  let bestD = here;
  for (const [nx, ny] of [
    [cx + 1, cy],
    [cx - 1, cy],
    [cx, cy + 1],
    [cx, cy - 1],
  ]) {
    if (!t.inBounds(nx, ny)) continue;
    const j = t.idx(nx, ny);
    const d = dist[j];
    if (d >= 0 && d < bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}
