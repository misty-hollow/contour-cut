import { LEVEL_PX, ORIGIN_Y, VIEW_H, VIEW_W } from './config';
import type { Input } from './world';

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
  fill(input: Input, player: { x: number; y: number; z: number }): void {
    const k = this.keys;
    input.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    input.moveY = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (this.mouse) {
      const v = this.toView(this.mouse.x, this.mouse.y);
      input.aimX = v.x;
      input.aimY = v.y - ORIGIN_Y + player.z * LEVEL_PX;
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
