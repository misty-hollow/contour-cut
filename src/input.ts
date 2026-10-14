import { CELL, LEVEL_PX, ORIGIN_Y, VIEW_H, VIEW_W, screenY } from './config';
import type { Terrain } from './terrain';
import type { Enemy, Input } from './world';

/** 화면에 그려진 적의 몸통 상자(발끝 기준): 가로 ±5px, 발끝 위 13px ~ 아래 1px */
const BODY = { halfW: 5, top: 13, bottom: 1 };

/**
 * 렌더러는 북쪽 줄부터 그리고, 적은 자기 줄의 지형 바로 뒤에 그린다. 그래서 적보다 남쪽 줄의 지면·절벽면이
 * 커서 픽셀을 덮으면 그 자리에 보이는 것은 지형이다(render.ts drawCell과 같은 범위: 윗면 + 남쪽 절벽면).
 */
export function terrainCoversAfterRow(t: Terrain, vx: number, vy: number, row: number): boolean {
  const cx = Math.floor(vx / CELL);
  const py = Math.floor(vy);
  if (cx < 0 || cx >= t.w) return false;
  for (let r = Math.max(0, row + 1); r < t.h; r++) {
    const i = t.idx(cx, r);
    const top = screenY(r * CELL, t.shown[i]);
    const southShown = r + 1 < t.h ? t.shown[i + t.w] : 0;
    const bottom = Math.max(top + CELL, screenY((r + 1) * CELL, southShown));
    if (py >= top && py < bottom) return true;
  }
  return false;
}

/**
 * 커서(카메라 적용 전 화면 좌표) 아래에 보이는 적. 적은 자기 고도만큼 위에 그려지므로,
 * 공중이나 다른 높이의 적을 보이는 대로 클릭하면 그 적을 조준한 것으로 읽는다. 겹치면 몸통 중심에 가까운 쪽.
 * 지형이 terrain으로 주어지면, 그 픽셀에서 앞쪽 지형에 가려진 적은 후보에서 뺀다.
 */
export function enemyUnderCursor(vx: number, vy: number, enemies: readonly Enemy[], terrain?: Terrain): Enemy | null {
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const e of enemies) {
    if (e.state === 'dead' || e.state === 'spawn') continue;
    const feet = e.y + ORIGIN_Y - e.z * LEVEL_PX;
    if (vx < e.x - BODY.halfW || vx > e.x + BODY.halfW || vy < feet - BODY.top || vy > feet + BODY.bottom) continue;
    if (terrain) {
      const row = Math.max(0, Math.min(terrain.h - 1, Math.floor(e.y / CELL)));
      if (terrainCoversAfterRow(terrain, vx, vy, row)) continue;
    }
    const d = Math.hypot(vx - e.x, vy - (feet - 6));
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/**
 * 커서 → 평면 조준점. 보이는 적 위면 그 적의 평면 위치, 아니면 화면 좌표를 플레이어 고도 평면으로 되돌린 점.
 */
export function resolveAim(
  vx: number,
  vy: number,
  playerZ: number,
  enemies: readonly Enemy[],
  terrain?: Terrain,
): { x: number; y: number; target: Enemy | null } {
  const target = enemyUnderCursor(vx, vy, enemies, terrain);
  if (target) return { x: target.x, y: target.y, target };
  return { x: vx, y: vy - ORIGIN_Y + playerZ * LEVEL_PX, target: null };
}

/** 키보드·마우스 상태. 마우스 좌표는 내부 해상도(480×270) 화면 좌표로 보관한다. */
export class Controls {
  private keys = new Set<string>();
  mouse: { x: number; y: number } | null = null;
  private cutQueued = false;
  private dashQueued = false;
  private dashAimQueued = false;
  onKey: (code: string) => void = () => {};
  /** 화면 좌표 → 카메라 적용 전 화면 좌표(줌 역변환). 렌더러가 넣어 준다 */
  toView: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y });
  /** 마지막 fill 때 커서의 카메라 적용 전 화면 좌표(조준 십자 그리기용) */
  cursorView: { x: number; y: number } | null = null;
  /** 커서가 몸통 위에 있어 조준이 잡힌 적 */
  target: Enemy | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK') this.dashQueued = true;
      if (e.code === 'KeyJ') this.cutQueued = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.onKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointermove', (e) => this.track(e));
    canvas.addEventListener('pointerdown', (e) => {
      this.track(e);
      if (e.button === 0) this.cutQueued = true;
      if (e.button === 2) this.dashAimQueued = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private track(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.mouse = { x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H };
  }

  /** 시뮬레이션 입력으로 변환. 조준점은 플레이어 고도 평면 위로 되돌린다. */
  fill(input: Input, player: { x: number; y: number; z: number }, enemies: readonly Enemy[] = [], terrain?: Terrain): void {
    const k = this.keys;
    input.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    input.moveY = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    this.target = null;
    if (this.mouse) {
      const v = this.toView(this.mouse.x, this.mouse.y);
      this.cursorView = v;
      // 보이는 적을 클릭했으면 그 적의 평면 위치를 향해 벤다(지형에 가려진 적은 제외)
      const a = resolveAim(v.x, v.y, player.z, enemies, terrain);
      this.target = a.target;
      input.aimX = a.x;
      input.aimY = a.y;
    } else {
      input.aimX = player.x + 1;
      input.aimY = player.y;
    }
    if (this.cutQueued) input.cut = true;
    if (this.dashQueued) input.dash = true;
    if (this.dashAimQueued) input.dashToAim = true;
    this.cutQueued = this.dashQueued = this.dashAimQueued = false;
  }

  clear(): void {
    this.keys.clear();
    this.cutQueued = this.dashQueued = this.dashAimQueued = false;
  }
}
