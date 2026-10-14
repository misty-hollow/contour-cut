import { ABYSS, CELL, MAX_LEVEL, OUT_OF_BOUNDS } from './config';

export interface Crossing {
  /** 낮은 쪽 칸 */
  low: number;
  /** 높은 쪽 칸(붕괴의 시작점) */
  high: number;
  level: number;
  x: number;
  y: number;
}

export interface CutResult {
  crossings: Crossing[];
  /** 내려앉은 칸 인덱스 */
  cells: number[];
}

export const isAbyss = (h: number): boolean => h < 0;

/**
 * 정수 고도 격자. base = 원래 지형, height = 현재 지형, shown = 그리기용 보간 높이.
 * 등고선은 서로 다른 고도의 칸 사이 경계다.
 */
export class Terrain {
  readonly w: number;
  readonly h: number;
  readonly base: Int8Array;
  readonly height: Int8Array;
  readonly shown: Float32Array;
  /** 복구 예정 시각(초). 붕괴하지 않은 칸은 Infinity */
  readonly restoreAt: Float64Array;
  /** 마지막으로 붕괴한 시각. 섬광 연출용 */
  readonly cutAt: Float64Array;
  version = 0;

  constructor(w: number, h: number, heights: ArrayLike<number>) {
    if (heights.length !== w * h) throw new Error(`heights length ${heights.length} != ${w * h}`);
    this.w = w;
    this.h = h;
    this.base = Int8Array.from(heights, (v) => clampLevel(v));
    this.height = Int8Array.from(this.base);
    this.shown = Float32Array.from(this.base, shownTarget);
    this.restoreAt = new Float64Array(w * h).fill(Infinity);
    this.cutAt = new Float64Array(w * h).fill(-Infinity);
  }

  idx(cx: number, cy: number): number {
    return cy * this.w + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h;
  }

  get(cx: number, cy: number): number {
    return this.inBounds(cx, cy) ? this.height[this.idx(cx, cy)] : OUT_OF_BOUNDS;
  }

  cellOf(x: number, y: number): [number, number] {
    return [Math.floor(x / CELL), Math.floor(y / CELL)];
  }

  heightAt(x: number, y: number): number {
    const [cx, cy] = this.cellOf(x, y);
    return this.get(cx, cy);
  }

  isCut(i: number): boolean {
    return this.restoreAt[i] !== Infinity;
  }

  /** 선분이 지나는 등고선(고도가 바뀌는 칸 경계)을 찾는다. */
  findCrossings(x0: number, y0: number, x1: number, y1: number): Crossing[] {
    const out: Crossing[] = [];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len));
    let [pcx, pcy] = this.cellOf(x0, y0);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const [cx, cy] = this.cellOf(x, y);
      if (cx === pcx && cy === pcy) continue;
      if (!this.inBounds(cx, cy) || !this.inBounds(pcx, pcy)) break;
      const ha = this.get(pcx, pcy);
      const hb = this.get(cx, cy);
      if (ha !== hb) {
        const aHigh = ha > hb;
        const high = aHigh ? this.idx(pcx, pcy) : this.idx(cx, cy);
        const low = aHigh ? this.idx(cx, cy) : this.idx(pcx, pcy);
        const level = Math.max(ha, hb);
        if (!isAbyss(level)) out.push({ low, high, level, x, y });
      }
      pcx = cx;
      pcy = cy;
    }
    return out;
  }

  /**
   * 등고선 절단. 베인 등고선마다 높은 쪽(그 등고선이 둘러싼 고지대)을 반경 안에서
   * 찾아 drop 단계 내려앉힌다. 한 번의 절단에서 각 칸은 최대 한 번만 내려간다.
   * 0 미만이 되면 심연. restoreSec 뒤 원래 높이로 돌아온다.
   */
  cut(x0: number, y0: number, x1: number, y1: number, now: number, drop: number, radius: number, restoreSec: number): CutResult {
    const crossings = this.findCrossings(x0, y0, x1, y1);
    const mark = new Uint8Array(this.w * this.h);
    const cells: number[] = [];
    const r2 = radius * radius;
    for (const c of crossings) {
      const ox = c.high % this.w;
      const oy = (c.high - ox) / this.w;
      const queue = [c.high];
      const seen = new Uint8Array(this.w * this.h);
      seen[c.high] = 1;
      while (queue.length) {
        const i = queue.pop()!;
        if (!mark[i]) {
          mark[i] = 1;
          cells.push(i);
        }
        const ix = i % this.w;
        const iy = (i - ix) / this.w;
        for (const [nx, ny] of [
          [ix + 1, iy],
          [ix - 1, iy],
          [ix, iy + 1],
          [ix, iy - 1],
        ]) {
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (seen[j]) continue;
          seen[j] = 1;
          if (this.height[j] < c.level) continue;
          if ((nx - ox) ** 2 + (ny - oy) ** 2 > r2) continue;
          queue.push(j);
        }
      }
    }
    for (const i of cells) {
      const nh = this.height[i] - drop;
      this.height[i] = nh < 0 ? ABYSS : nh;
      this.restoreAt[i] = now + restoreSec;
      this.cutAt[i] = now;
    }
    if (cells.length) this.version++;
    return { crossings, cells };
  }

  /** 복구 시각이 지난 칸을 원래 높이로 돌린다. 돌아온 칸 인덱스를 반환. */
  restoreDue(now: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.restoreAt.length; i++) {
      if (this.restoreAt[i] <= now) {
        this.height[i] = this.base[i];
        this.restoreAt[i] = Infinity;
        out.push(i);
      }
    }
    if (out.length) this.version++;
    return out;
  }

  /** 그리기용 높이를 현재 높이로 보간한다. 내려앉을 때는 빠르게, 복구는 조금 느리게. */
  animate(dt: number): void {
    for (let i = 0; i < this.shown.length; i++) {
      const target = shownTarget(this.height[i]);
      const cur = this.shown[i];
      if (cur === target) continue;
      const speed = target < cur ? 22 : 12; // 단계/s
      const d = target - cur;
      const stepAbs = speed * dt;
      this.shown[i] = Math.abs(d) <= stepAbs ? target : cur + Math.sign(d) * stepAbs;
    }
  }
}

function clampLevel(v: number): number {
  if (v < 0) return ABYSS;
  return Math.min(MAX_LEVEL, Math.round(v));
}

/** 심연은 화면에서 고도 -2 깊이로 그린다. */
export function shownTarget(h: number): number {
  return isAbyss(h) ? -2 : h;
}

export type StepKind = 'walk' | 'drop' | 'blocked' | 'abyss';

/**
 * 걸어서 이웃 칸으로 갈 때의 규칙. from = 현재 서 있는 고도(공중이면 현재 z).
 * 1단계 오르기까지 가능, 2단계 이상은 벽. 내려가기는 제한 없음(낙하). 심연은 별도.
 */
export function stepKind(from: number, to: number): StepKind {
  if (to === OUT_OF_BOUNDS) return 'blocked';
  if (isAbyss(to)) return 'abyss';
  const diff = to - from;
  if (diff > 1.5) return 'blocked';
  if (diff < -0.5) return 'drop';
  return 'walk';
}
