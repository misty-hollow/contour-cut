import { CELL, ENEMY, GRID_H, GRID_W, LEVEL_PX, ORIGIN_Y, VIEW_H, VIEW_W, tune } from './config';
import { isAbyss } from './terrain';
import type { Enemy, GameEvent, World } from './world';

// 측량 잉크 팔레트: 고도마다 다른 형광색 등고선, 어두운 남색 지면, 심연 테두리는 경고 적색
export const LINE = ['#2f7bff', '#19f5c8', '#6cff4f', '#e8ff3a', '#ffb02e', '#ff4fa3', '#b77bff'];
const TOP = ['#090b17', '#10142a', '#171d3c', '#1f274e', '#283161', '#313b73', '#3b4686'];
const WALL = '#06070e';
const WALL_STRIPE = '#0c0e1c';
const ABYSS_RIM = '#ff2d55';
const RIM = '#dffcff';
const CHASER = '#ff3b3b';
const SHOOTER = '#c04cff';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  g: number;
  size: number;
}

interface Slash {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  t: number;
  max: number;
  color: string;
}

const sy = (y: number, z: number) => Math.round(y + ORIGIN_Y - z * LEVEL_PX);

/** 카메라 상태(관찰용). zoom 1 = 연출 없음 */
export interface CameraState {
  zoom: number;
  fx: number;
  fy: number;
  shakeX: number;
  shakeY: number;
}

/**
 * 그리기는 두 단계다. ① 480×270 픽셀 화면(view)에 지금까지와 똑같이 그린다.
 * ② 표시 캔버스에 정수 배율 k로 옮기면서 카메라(줌·흔들림)를 적용한다. 줌 1·흔들림 0이면 ①을 그대로 확대한 것과 같다.
 */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private readonly view: HTMLCanvasElement;
  private readonly display: HTMLCanvasElement;
  private readonly dctx: CanvasRenderingContext2D;
  private k = 1;
  private particles: Particle[] = [];
  private slashes: Slash[] = [];
  private rings: Ring[] = [];
  private ghosts: { x: number; y: number; z: number; t: number }[] = [];
  private shakeT = 0;
  private shakeDur = 0;
  private shakeAmp = 0;
  private hurtT = 0;
  private bg: HTMLCanvasElement;
  private clock = 0;
  private restoredAt = new Float64Array(GRID_W * GRID_H).fill(-Infinity);
  /** 순간 줌인(주요 타격)과 대시 낙하 줌아웃 */
  private punch = 0;
  private punchT = 0;
  private dashOut = 0;
  readonly cam: CameraState = { zoom: 1, fx: VIEW_W / 2, fy: VIEW_H / 2, shakeX: 0, shakeY: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.display = canvas;
    const dctx = canvas.getContext('2d');
    if (!dctx) throw new Error('2D canvas unavailable');
    this.dctx = dctx;
    this.view = document.createElement('canvas');
    this.view.width = VIEW_W;
    this.view.height = VIEW_H;
    this.ctx = this.view.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.bg = makeBackground();
    this.resize(1);
  }

  /** 표시 캔버스의 정수 배율(화면 배율 × 기기 픽셀 비율) */
  resize(k: number): void {
    this.k = Math.max(1, Math.min(8, Math.round(k)));
    this.display.width = VIEW_W * this.k;
    this.display.height = VIEW_H * this.k;
    this.dctx.imageSmoothingEnabled = false;
  }

  shake(amp: number, t: number): void {
    const a = amp * tune.shake;
    if (a <= 0) return;
    this.shakeAmp = Math.max(this.shakeAmp, a);
    this.shakeT = Math.max(this.shakeT, t);
    this.shakeDur = Math.max(this.shakeDur, t);
  }

  /** 순간 줌인. 짧게(0.12초) 돌아온다 */
  private zoomPunch(amount: number): void {
    this.punch = Math.max(this.punch, amount);
    this.punchT = 0.12;
  }

  /** 내부 화면 좌표(흔들림 제외) → 카메라 적용 전 view 좌표 */
  screenToView(x: number, y: number): { x: number; y: number } {
    const c = this.cam;
    return { x: (x - c.fx * (1 - c.zoom)) / c.zoom, y: (y - c.fy * (1 - c.zoom)) / c.zoom };
  }

  /** view 좌표 → 카메라를 적용한 내부 화면 좌표(흔들림 제외) */
  viewToScreen(x: number, y: number): { x: number; y: number } {
    const c = this.cam;
    return { x: x * c.zoom + c.fx * (1 - c.zoom), y: y * c.zoom + c.fy * (1 - c.zoom) };
  }

  consume(events: GameEvent[], world: World): void {
    const terr = world.terrain;
    for (const ev of events) {
      switch (ev.type) {
        case 'slash': {
          this.slashes.push({ x0: ev.x0, y0: sy(ev.y0, ev.z) - 4, x1: ev.x1, y1: sy(ev.y1, ev.z) - 4, t: 0 });
          for (const c of ev.crossings) this.burst(c.x, sy(c.y, c.level), LINE[Math.min(6, c.level)], 10, 60, 0.35);
          if (ev.cells.length) {
            this.shake(2 + Math.min(3, ev.cells.length / 40), 0.22);
            // 무너진 영역 가장자리에서 먼지
            let n = 0;
            for (const i of ev.cells) {
              const cx = i % terr.w;
              const cy = Math.floor(i / terr.w);
              const edge = [terr.get(cx + 1, cy), terr.get(cx - 1, cy), terr.get(cx, cy + 1), terr.get(cx, cy - 1)].some((h) => h > terr.height[i] + 0.5 && h < 50);
              if (!edge || (n++ & 1)) continue;
              this.burst((cx + 0.5) * CELL, sy((cy + 0.5) * CELL, terr.height[i] + 3), '#8d97c9', 1, 25, 0.5, 40);
            }
          }
          break;
        }
        case 'hit':
          this.burst(ev.x, sy(ev.y, ev.z) - 4, '#ffffff', 8, 70, 0.25);
          this.shake(2, 0.12);
          break;
        case 'land':
          if (ev.levels >= 1.5) this.burst(ev.x, sy(ev.y, ev.z), '#9aa6e0', 10, 45, 0.4, 30);
          break;
        case 'shock':
          this.rings.push({ x: ev.x, y: sy(ev.y, ev.z), r: ev.radius, t: 0, max: 0.28, color: RIM });
          this.shake(3, 0.18);
          this.zoomPunch(0.03);
          break;
        case 'launch':
          // 지형 환원: 발밑에서 위로 솟는 잉크 파편
          this.burst(ev.x, sy(ev.y, ev.z), '#19f5c8', 10, 50, 0.45, -60);
          this.rings.push({ x: ev.x, y: sy(ev.y, ev.z), r: 9, t: 0, max: 0.25, color: '#19f5c8' });
          this.zoomPunch(0.015);
          break;
        case 'airHit':
          this.burst(ev.x, sy(ev.y, ev.z) - 4, '#ffffff', 12, 90, 0.3);
          this.burst(ev.x, sy(ev.y, ev.z) - 4, '#19f5c8', 8, 60, 0.35);
          this.rings.push({ x: ev.x, y: sy(ev.y, ev.z) - 4, r: 8, t: 0, max: 0.16, color: '#ffffff' });
          this.shake(2.5, 0.14);
          this.zoomPunch(0.045);
          break;
        case 'kill': {
          const col = ev.kind === 'chaser' ? CHASER : SHOOTER;
          if (ev.cause !== 'abyss') this.burst(ev.x, sy(ev.y, ev.z) - 4, col, 18, 80, 0.5);
          this.shake(2, 0.15);
          this.zoomPunch(0.035);
          break;
        }
        case 'fallAbyss':
          this.burst(ev.x, sy(ev.y, -1), ABYSS_RIM, 12, 30, 0.6, -20);
          break;
        case 'hurt':
          this.hurtT = 0.3;
          this.shake(4, 0.25);
          this.burst(ev.x, sy(ev.y, world.player.z) - 4, '#ff6b6b', 10, 60, 0.35);
          break;
        case 'boltBlocked':
          this.burst(ev.x, sy(ev.y, ev.z), SHOOTER, 6, 40, 0.25);
          break;
        case 'restore':
          for (const i of ev.cells) {
            this.restoredAt[i] = this.clock;
            if ((i * 7) % 5 === 0) this.burst(((i % terr.w) + 0.5) * CELL, sy((Math.floor(i / terr.w) + 0.5) * CELL, terr.base[i]), '#bff7ff', 1, 20, 0.45, -30);
          }
          break;
        case 'spawn':
          this.rings.push({ x: ev.x, y: sy(ev.y, world.terrain.heightAt(ev.x, ev.y)), r: 10, t: 0, max: 0.9, color: SHOOTER });
          break;
        case 'dash':
        case 'fire':
        case 'wave':
          break;
      }
    }
  }

  private burst(x: number, y: number, color: string, n: number, speed: number, life: number, g = 120): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life, max: life, color, g, size: Math.random() < 0.25 ? 2 : 1 });
    }
  }

  draw(world: World, dt: number, aim: { x: number; y: number } | null): void {
    const ctx = this.ctx;
    this.clock += dt;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0);

    const p = world.player;
    if (p.dashT > 0) this.ghosts.push({ x: p.x, y: p.y, z: p.z, t: 0 });

    // 줄 단위로 엔티티를 끼워 넣어 앞쪽(남쪽) 높은 지형이 가리게 한다
    const rows: (() => void)[][] = Array.from({ length: GRID_H }, () => []);
    const rowOf = (y: number) => Math.max(0, Math.min(GRID_H - 1, Math.floor(y / CELL)));
    for (const e of world.enemies) rows[rowOf(e.y)].push(() => this.drawEnemy(world, e));
    rows[rowOf(p.y)].push(() => this.drawPlayer(world));

    for (let cy = 0; cy < GRID_H; cy++) {
      for (let cx = 0; cx < GRID_W; cx++) this.drawCell(world, cx, cy);
      for (const f of rows[cy]) f();
    }

    this.drawBolts(world);
    if (aim && world.mode === 'play') this.drawAim(world, aim);
    this.drawFx(dt);
    this.present(world, dt);
  }

  /** ② 카메라를 적용해 표시 캔버스로 옮긴다 */
  private present(world: World, dt: number): void {
    const d = this.dctx;
    const k = this.k;
    const p = world.player;
    const c = this.cam;

    // 고지대에서 저지대로 대시해 활강하는 동안 미세한 줌아웃
    const ground = world.terrain.heightAt(p.x, p.y);
    const gliding = p.dashT > 0 && p.airborne && p.peakZ - Math.max(0, ground) >= 1.5;
    const target = gliding ? 0.06 : 0;
    this.dashOut += (target - this.dashOut) * Math.min(1, dt * (gliding ? 10 : 4));
    if (Math.abs(this.dashOut) < 0.0005) this.dashOut = 0;
    this.punchT = Math.max(0, this.punchT - dt);
    if (this.punchT === 0) this.punch = 0;
    const punchNow = this.punch * (this.punchT / 0.12);
    c.zoom = 1 + (punchNow - this.dashOut) * tune.zoomFx;
    // 줌 중심 = 플레이어(화면 밖으로 치우치지 않게 제한)
    c.fx = Math.max(0, Math.min(VIEW_W, p.x));
    c.fy = Math.max(0, Math.min(VIEW_H, sy(p.y, p.z) - 6));

    // 흔들림: 시간에 따라 잦아든다(표시 해상도에서 1/k픽셀 단위)
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.shakeT === 0) {
      this.shakeAmp = 0;
      this.shakeDur = 0;
    }
    const amp = this.shakeDur > 0 ? this.shakeAmp * (this.shakeT / this.shakeDur) : 0;
    c.shakeX = amp > 0 ? (Math.random() * 2 - 1) * amp : 0;
    c.shakeY = amp > 0 ? (Math.random() * 2 - 1) * amp : 0;

    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalAlpha = 1;
    d.fillStyle = '#02030a';
    d.fillRect(0, 0, this.display.width, this.display.height);
    d.imageSmoothingEnabled = false;
    const sx = k * c.zoom;
    d.setTransform(sx, 0, 0, sx, Math.round(k * (c.fx * (1 - c.zoom) + c.shakeX)), Math.round(k * (c.fy * (1 - c.zoom) + c.shakeY)));
    d.drawImage(this.view, 0, 0);
    d.setTransform(1, 0, 0, 1, 0, 0);

    // 피격 테두리는 카메라와 무관하게 화면 가장자리에
    if (this.hurtT > 0) {
      this.hurtT -= dt;
      d.globalAlpha = Math.max(0, this.hurtT / 0.3) * 0.5;
      d.fillStyle = '#ff1f3d';
      const w = this.display.width;
      const h = this.display.height;
      const b = 4 * k;
      d.fillRect(0, 0, w, b);
      d.fillRect(0, h - b, w, b);
      d.fillRect(0, 0, b, h);
      d.fillRect(w - b, 0, b, h);
      d.globalAlpha = 1;
    }
  }

  private drawCell(world: World, cx: number, cy: number): void {
    const ctx = this.ctx;
    const t = world.terrain;
    const i = t.idx(cx, cy);
    const h = t.height[i];
    const s = t.shown[i];
    const x = cx * CELL;
    const top = sy(cy * CELL, s);
    const now = world.time;

    // 남쪽 절벽면 + 지층선
    const sShown = cy + 1 < GRID_H ? t.shown[i + GRID_W] : 0;
    const southTop = sy((cy + 1) * CELL, sShown);
    const wallTop = top + CELL;
    if (southTop > wallTop) {
      ctx.fillStyle = WALL;
      ctx.fillRect(x, wallTop, CELL, southTop - wallTop);
      ctx.fillStyle = WALL_STRIPE;
      for (let k = (cx & 1) * 3; k < CELL; k += 3) ctx.fillRect(x + k, wallTop, 1, southTop - wallTop);
      ctx.globalAlpha = 0.7;
      for (let lv = Math.floor(s) - 1; lv > sShown - 0.01 && lv >= 0; lv--) {
        ctx.fillStyle = LINE[lv + 1 > 6 ? 6 : lv + 1];
        ctx.fillRect(x, sy((cy + 1) * CELL, lv), CELL, 1);
      }
      ctx.globalAlpha = 1;
    }

    if (isAbyss(h)) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, top, CELL, CELL);
      // 접힌 종이 틈 사이로 보이는 먼 별빛
      const hash = (cx * 73856093) ^ (cy * 19349663);
      if ((hash & 15) === 0 && Math.sin(this.clock * 3 + hash) > 0.3) {
        ctx.fillStyle = '#5b2a8f';
        ctx.fillRect(x + (hash & 3) + 1, top + ((hash >> 4) & 3) + 1, 1, 1);
      }
      return;
    }

    const lvl = Math.min(6, h);
    const flash = now - t.cutAt[i] < 0.07;
    const restoring = this.clock - this.restoredAt[i] < 0.1;
    ctx.fillStyle = flash ? '#ffffff' : restoring ? '#bff7ff' : TOP[lvl];
    ctx.fillRect(x, top, CELL, CELL);

    // 베인 지형: 균열 무늬, 복구 직전 깜빡임
    if (t.isCut(i)) {
      const left = t.restoreAt[i] - now;
      const warn = left < tune.restoreWarnSec && Math.floor(this.clock * 10) % 2 === 0;
      ctx.fillStyle = warn ? '#bff7ff' : '#6b3a8f';
      const o = (cx + cy) % 3;
      ctx.fillRect(x + o, top + 1, 1, 1);
      ctx.fillRect(x + o + 1, top + 2, 1, 1);
      ctx.fillRect(x + ((o + 3) % CELL), top + 4, 1, 1);
      ctx.fillRect(x + ((o + 4) % CELL), top + 5, 1, 1);
    }

    // 등고선: 나보다 낮은 이웃과의 경계에 내 고도의 색으로
    const edge = (nh: number) => nh < h || nh === -1;
    const hw = cx > 0 ? t.height[i - 1] : 99;
    const he = cx < GRID_W - 1 ? t.height[i + 1] : 99;
    const hn = cy > 0 ? t.height[i - GRID_W] : 99;
    const hs = cy < GRID_H - 1 ? t.height[i + GRID_W] : 99;
    const col = (nh: number) => (isAbyss(nh) ? ABYSS_RIM : flash ? '#ffffff' : LINE[lvl]);
    if (edge(hn)) this.edgeLine(x, top, CELL, 1, col(hn), 0, 1);
    if (edge(hs)) this.edgeLine(x, top + CELL - 1, CELL, 1, col(hs), 0, -1);
    if (edge(hw)) this.edgeLine(x, top, 1, CELL, col(hw), 1, 0);
    if (edge(he)) this.edgeLine(x + CELL - 1, top, 1, CELL, col(he), -1, 0);
  }

  private edgeLine(x: number, y: number, w: number, h: number, color: string, ix: number, iy: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.28;
    ctx.fillRect(x + ix, y + iy, w, h);
    ctx.globalAlpha = 1;
  }

  private drawPlayer(world: World): void {
    const ctx = this.ctx;
    const p = world.player;
    const t = world.terrain;
    const x = Math.round(p.x);
    const y = sy(p.y, p.z);
    for (const g of this.ghosts) {
      ctx.globalAlpha = Math.max(0, 0.45 - g.t * 3);
      drawSurveyor(ctx, Math.round(g.x), sy(g.y, g.z), p.facingX < 0, '#19f5c8', '#0b3a44');
    }
    ctx.globalAlpha = 1;
    if (p.airborne) {
      const gh = t.heightAt(p.x, p.y);
      if (!isAbyss(gh)) {
        ctx.fillStyle = '#000000';
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x - 2, sy(p.y, gh) - 1, 5, 2);
        ctx.globalAlpha = 1;
      }
    }
    const blink = p.inv > 0 && p.dashT === 0 && Math.floor(this.clock * 20) % 2 === 0;
    if (p.z < -0.5) ctx.globalAlpha = Math.max(0, 1 + p.z / 5);
    if (!blink) drawSurveyor(ctx, x, y, p.facingX < 0, p.hurtT > 0 ? '#ff6b6b' : RIM, '#000000');
    ctx.globalAlpha = 1;
    // 낙차 가속 표시: 발밑의 짧은 잔광
    if (p.boostT > 0 && p.boost > 0) {
      ctx.fillStyle = '#19f5c8';
      ctx.globalAlpha = 0.6 * (p.boostT / tune.fallBoostTime);
      ctx.fillRect(x - 3 - Math.round(p.facingX * 3), y, 7, 1);
      ctx.globalAlpha = 1;
    }
  }

  private drawEnemy(world: World, e: Enemy): void {
    const ctx = this.ctx;
    const t = world.terrain;
    const x = Math.round(e.x);
    const y = sy(e.y, e.z);
    if (e.state === 'dead') {
      if (e.deathCause !== 'abyss') return;
      ctx.globalAlpha = Math.max(0, 1 - e.deadT / 0.8);
    }
    if (e.airborne && e.state !== 'dead') {
      const gh = t.heightAt(e.x, e.y);
      if (!isAbyss(gh)) {
        ctx.fillStyle = '#000000';
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x - 2, sy(e.y, gh) - 1, 5, 2);
        ctx.globalAlpha = 1;
      }
    }
    if (e.state === 'spawn') {
      const k = 1 - Math.max(0, e.t) / 0.9;
      ctx.fillStyle = SHOOTER;
      ctx.fillRect(x, y - Math.round(10 * k), 1, Math.round(10 * k));
      ctx.globalAlpha = 1;
      return;
    }
    const white = e.flash > 0 || (e.state === 'windup' && Math.floor(this.clock * 16) % 2 === 0);
    const mirror = e.dirX < 0;
    if (e.kind === 'chaser') {
      if (e.state === 'lunge') {
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * 0.4;
        drawHound(ctx, x - Math.round(e.dirX * 4), y - Math.round(e.dirY * 4), mirror, CHASER);
        ctx.globalAlpha = a;
      }
      drawHound(ctx, x, y, mirror, white ? '#ffffff' : CHASER);
    } else {
      if (e.state === 'windup') {
        // 조준선: 점선
        ctx.fillStyle = SHOOTER;
        const dx = e.aimX - e.x;
        const dy = e.aimY - e.y;
        const d = Math.hypot(dx, dy) || 1;
        for (let s = 6; s < d; s += 4) ctx.fillRect(Math.round(e.x + (dx / d) * s), Math.round(sy(e.y + (dy / d) * s, e.z + 0.5) - 4), 1, 1);
      }
      drawMarker(ctx, x, y, white ? '#ffffff' : SHOOTER, e.state === 'windup');
    }
    if (e.exposedT > 0 && e.state !== 'dead') {
      // 무방비 표식: 머리 위 깜빡이는 마름모(지금 베면 공중 추가타)
      ctx.fillStyle = Math.floor(this.clock * 14) % 2 === 0 ? '#ffffff' : '#19f5c8';
      ctx.fillRect(x, y - 17, 1, 1);
      ctx.fillRect(x - 1, y - 16, 3, 1);
      ctx.fillRect(x, y - 15, 1, 1);
    }
    if (e.state === 'stun') {
      ctx.fillStyle = '#e8ff3a';
      const a = this.clock * 10;
      ctx.fillRect(x + Math.round(Math.cos(a) * 3), y - 11, 1, 1);
      ctx.fillRect(x + Math.round(Math.cos(a + Math.PI) * 3), y - 11, 1, 1);
    }
    const max = ENEMY[e.kind].hp;
    if (e.hp < max && e.state !== 'dead') {
      for (let k = 0; k < max; k++) {
        ctx.fillStyle = k < e.hp ? '#ffffff' : '#444a66';
        ctx.fillRect(x - max + k * 2, y - 13, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawBolts(world: World): void {
    const ctx = this.ctx;
    for (const b of world.bolts) {
      const x = Math.round(b.x);
      const y = sy(b.y, b.alt) - 3;
      ctx.fillStyle = '#ff7bf0';
      ctx.fillRect(x - Math.round((b.vx / 110) * 3), y - Math.round((b.vy / 110) * 3), 1, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  /** 조준: 칼날이 닿을 선과, 그 선이 벨 등고선 위치를 미리 보여 준다 */
  private drawAim(world: World, aim: { x: number; y: number }): void {
    const ctx = this.ctx;
    const p = world.player;
    let dx = aim.x - p.x;
    let dy = aim.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) return;
    dx /= d;
    dy /= d;
    const ready = p.cutCool === 0;
    ctx.fillStyle = ready ? '#bff7ff' : '#3c4766';
    for (let s = 4; s <= tune.bladeLen; s += 3) ctx.fillRect(Math.round(p.x + dx * s), sy(p.y + dy * s, p.z) - 4, 1, 1);
    if (ready) {
      const cr = world.terrain.findCrossings(p.x, p.y, p.x + dx * tune.bladeLen, p.y + dy * tune.bladeLen);
      const on = Math.floor(this.clock * 8) % 2 === 0;
      for (const c of cr) {
        ctx.fillStyle = on ? '#ffffff' : LINE[Math.min(6, c.level)];
        const cx = Math.round(c.x);
        const cyy = sy(c.y, c.level);
        ctx.fillRect(cx - 2, cyy, 5, 1);
        ctx.fillRect(cx, cyy - 2, 1, 5);
      }
    }
    // 조준점: 측량 십자
    const ax = Math.round(aim.x);
    const ay = sy(aim.y, p.z);
    ctx.fillStyle = '#19f5c8';
    ctx.fillRect(ax - 4, ay, 3, 1);
    ctx.fillRect(ax + 2, ay, 3, 1);
    ctx.fillRect(ax, ay - 4, 1, 3);
    ctx.fillRect(ax, ay + 2, 1, 3);
  }

  private drawFx(dt: number): void {
    const ctx = this.ctx;
    for (const g of this.ghosts) g.t += dt;
    this.ghosts = this.ghosts.filter((g) => g.t < 0.15);

    for (const s of this.slashes) {
      s.t += dt;
      const k = 1 - s.t / 0.16;
      if (k <= 0) continue;
      ctx.globalAlpha = k;
      pixLine(ctx, s.x0, s.y0 - 1, s.x1, s.y1 - 1, '#19f5c8');
      pixLine(ctx, s.x0, s.y0 + 1, s.x1, s.y1 + 1, '#19f5c8');
      pixLine(ctx, s.x0, s.y0, s.x1, s.y1, '#ffffff');
      // 자 눈금: 측량사의 칼날
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
      const ux = (s.x1 - s.x0) / len;
      const uy = (s.y1 - s.y0) / len;
      ctx.fillStyle = '#ffffff';
      for (let d = 6; d < len; d += 6) {
        ctx.fillRect(Math.round(s.x0 + ux * d - uy * 2), Math.round(s.y0 + uy * d + ux * 2), 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    this.slashes = this.slashes.filter((s) => s.t < 0.16);

    for (const r of this.rings) {
      r.t += dt;
      const k = r.t / r.max;
      if (k >= 1) continue;
      ctx.globalAlpha = 1 - k;
      pixCircle(ctx, r.x, r.y, Math.max(2, r.r * k), r.color);
      ctx.globalAlpha = 1;
    }
    this.rings = this.rings.filter((r) => r.t < r.max);

    for (const pt of this.particles) {
      pt.life -= dt;
      pt.vy += pt.g * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.life <= 0) continue;
      ctx.globalAlpha = Math.min(1, (pt.life / pt.max) * 1.5);
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((pt) => pt.life > 0);
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }
}

/** 검은 측량사: 넓은 챙 모자, 검은 외투, 형광 윤곽. 발끝 (x,y) 기준 */
function drawSurveyor(ctx: CanvasRenderingContext2D, x: number, y: number, mirror: boolean, rim: string, body: string): void {
  const parts: [number, number, number, number][] = [
    [-2, -2, 1, 2],
    [1, -2, 1, 2],
    [-2, -7, 4, 5],
    [-3, -5, 1, 3], // 외투 자락
    [-1, -9, 3, 2],
    [-4, -10, 8, 1], // 모자 챙
    [-2, -12, 4, 2],
  ];
  const rect = (rx: number, ry: number, w: number, h: number) => {
    const xx = mirror ? x - rx - w : x + rx;
    ctx.fillRect(xx, y + ry, w, h);
  };
  ctx.fillStyle = rim;
  for (const [rx, ry, w, h] of parts) rect(rx - 1, ry - 1, w + 2, h + 2);
  ctx.fillStyle = body;
  for (const [rx, ry, w, h] of parts) rect(rx, ry, w, h);
  ctx.fillStyle = '#19f5c8';
  rect(1, -9, 1, 1); // 눈
  // 등에 멘 측량 막대
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * 0.7;
  rect(-5, -13, 1, 11);
  ctx.globalAlpha = a;
}

/** 주름 사냥개(돌진형) */
function drawHound(ctx: CanvasRenderingContext2D, x: number, y: number, mirror: boolean, color: string): void {
  const rect = (rx: number, ry: number, w: number, h: number) => ctx.fillRect(mirror ? x - rx - w : x + rx, y + ry, w, h);
  ctx.fillStyle = '#12020a';
  rect(-4, -6, 9, 6);
  rect(1, -8, 5, 4);
  ctx.fillStyle = color;
  rect(-3, -5, 7, 3);
  rect(2, -7, 3, 3);
  rect(-3, -2, 1, 2);
  rect(2, -2, 1, 2);
  ctx.fillStyle = '#12020a';
  rect(-1, -5, 1, 2);
  rect(1, -5, 1, 2);
  ctx.fillStyle = '#ffffff';
  rect(4, -6, 1, 1);
}

/** 삼각점(사격형): 측량 기준점 모양의 포대 */
function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, aiming: boolean): void {
  ctx.fillStyle = '#0c0216';
  ctx.fillRect(x - 5, y - 10, 11, 7);
  ctx.fillRect(x - 1, y - 3, 3, 3);
  ctx.fillStyle = color;
  for (let r = 0; r < 5; r++) ctx.fillRect(x - r, y - 9 + r, r * 2 + 1, 1);
  ctx.fillStyle = '#3d1160';
  ctx.fillRect(x, y - 3, 1, 3);
  ctx.fillStyle = aiming ? '#ff2d55' : '#ffffff';
  ctx.fillRect(x, y - 6, 1, 1);
}

function pixLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  ctx.fillStyle = color;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let k = 0; k <= n; k++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1);
}

function pixCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  const n = Math.max(12, Math.ceil(r * 6));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    // 위에서 내려다본 원: 세로를 눌러 바닥에 깔린 느낌
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.6), 1, 1);
  }
}

/** 배경: 거대한 종이 지도의 모눈과 접힌 자국 */
function makeBackground(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = VIEW_W;
  c.height = VIEW_H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#04050a';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.fillStyle = '#0a0d1a';
  for (let x = 0; x < VIEW_W; x += 12) g.fillRect(x, 0, 1, VIEW_H);
  for (let y = 0; y < VIEW_H; y += 12) g.fillRect(0, y, VIEW_W, 1);
  return c;
}

