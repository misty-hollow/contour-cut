import { CELL, ENEMY, GRID_H, GRID_W, VIEW_H, VIEW_W, screenY, tune } from './config';
import { terrainCoversAfterRow } from './input';
import { drawHound, drawKain, drawKainDown, drawMarker, houndKey, kainKey, markerKey, type HoundPose, type KainPose, type MarkerPose } from './sprites';
import { isAbyss } from './terrain';
import type { Enemy, GameEvent, World } from './world';

/** 조준: 평면 조준점 + 실제 커서 화면 위치 + 잡힌 적 */
export interface Aim {
  x: number;
  y: number;
  cursor: { x: number; y: number } | null;
  target: Enemy | null;
}

// 측량 잉크 팔레트: 고도마다 다른 형광색 등고선, 어두운 남색 지면, 심연 테두리는 경고 적색
export const LINE = ['#2f7bff', '#19f5c8', '#6cff4f', '#e8ff3a', '#ffb02e', '#ff4fa3', '#b77bff'];
/**
 * 지면 색 = 고도 단계 명도(남색 계단) + 그 고도 등고선 색을 조금 섞은 단채(hypsometric tint).
 * 높을수록 밝고, 같은 높이의 땅은 같은 기운의 색이라 등고선이 끊긴 곳에서도 높이가 읽힌다.
 */
const RAMP = ['#0a0d1b', '#0c1124', '#151d3c', '#1f2a55', '#2a376c', '#344583', '#3f529a'];
const TOP = RAMP.map((c, l) => mix(c, LINE[l], 0.05 + 0.015 * l));
/** 절벽면: 윗면 색을 어둡게. 세로 빗금(지도의 우모선)은 더 어둡게 */
const WALL = TOP.map((c) => mix(c, '#000000', 0.62));
const WALL_STRIPE = TOP.map((c) => mix(c, '#000000', 0.8));
/** 측량 눈금(5칸마다 + 표시). 고도만큼 위로 그려져 높낮이가 눈금 어긋남으로도 보인다 */
const TICK = TOP.map((c) => mix(c, '#ffffff', 0.13));
const ABYSS_RIM = '#ff2d55';
const RIM = '#dffcff';
const CHASER = '#ff3b3b';
const SHOOTER = '#c04cff';
/** 지형에 가려진 플레이어 윤곽 색(측량 신호 시안) */
const PLAYER_OUTLINE = '#19f5c8';
/** 윤곽 마스크를 구할 때 스프라이트를 그리는 작은 캔버스(발끝 기준점) */
const MASK = { size: 32, ox: 16, oy: 24 };

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

/** 방사형 섬광선(공중 추가타·처치) */
interface Streak {
  x: number;
  y: number;
  t: number;
  max: number;
  r0: number;
  r1: number;
  n: number;
  rot: number;
  color: string;
}

/** 처치 자리에 남는 측량 표시(×), 땅에 붙어 잠시 남는다 */
interface Mark {
  x: number;
  y: number;
  t: number;
  color: string;
}

/** 구역 시작·재시작 때 플레이어에서 퍼지는 측량 신호가 지도를 드러내는 시간(초). 입력·시뮬레이션은 막지 않는다 */
const INTRO_SEC = 0.45;
/** 측량도 휘두르기 표시 시간(초). 판정은 절단 순간 그대로 */
const SWING_SEC = 0.16;
/** 공중 추가타 멈춘 한 장의 길이(초, 표시 시간). 시뮬레이션 타격 멈춤(hitstopStrong)과 별개 */
const IMPACT_SEC = 0.1;

interface FoePose {
  hound: HoundPose;
  marker: MarkerPose;
}

/** 구역 분위기: 떠다니는 입자의 종류(전투 정보 위에 겹쳐도 옅은 1px) */
export type Mood = 'rift' | 'canyon' | 'restore' | 'plain';

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
}

const sy = screenY;

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
  private streaks: Streak[] = [];
  private marks: Mark[] = [];
  private beams: { x: number; y: number; t: number }[] = [];
  /** 늦게 터지는 먼지(침하가 다 내려앉는 순간) */
  private later: { t: number; run: () => void }[] = [];
  private introT = INTRO_SEC;
  private frameDt = 0;
  /** 카인 애니메이션 상태(표시 전용) */
  private kain = { px: NaN, py: NaN, phase: 0, mirror: false, turnT: 0, landT: 0, wasAir: false, slashT: 9, slashAng: 0, overT: 0 };
  private lastKain: KainPose | null = null;
  /** 공중 추가타 순간의 "멈춘 한 장": 장면을 어둡게 하고 맞은 적과 섬광만 남긴다(초) */
  private impactT = 0;
  private impactAt: { x: number; y: number } | null = null;
  /** 공중 추가타와 같은 칼질로 다시 베인 칸: 섬광을 죽여 타격이 먼저 읽히게 한다(시뮬레이션 시각까지) */
  private flashMute = new Float64Array(GRID_W * GRID_H).fill(-Infinity);
  /** 적별 걸음 위상(표시 전용) */
  private foes = new Map<number, { px: number; py: number; phase: number }>();
  /** 타이틀 화면: 지도를 위에서 아래로 훑는 측량 주사선 */
  titleScan = false;
  private mood: Mood = 'plain';
  private motes: Mote[] = [];
  private vignette: HTMLCanvasElement;
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
  /** 스프라이트 종류별 1px 테두리 픽셀(발끝 기준 상대 좌표) */
  private outlines = new Map<string, [number, number][]>();

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
    this.vignette = makeVignette();
    this.setMood('plain');
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
    // 같은 칼질에 공중 추가타가 있으면, 그 칼질의 지형 섬광·교차 불꽃·먼지는 줄인다(타격 → 지형 순서로 읽히게)
    const airSlash = events.some((e) => e.type === 'airHit');
    for (const ev of events) {
      switch (ev.type) {
        case 'slash': {
          this.kain.slashT = 0;
          this.kain.slashAng = Math.atan2(ev.y1 - ev.y0, ev.x1 - ev.x0);
          this.slashes.push({ x0: ev.x0, y0: sy(ev.y0, ev.z) - 4, x1: ev.x1, y1: sy(ev.y1, ev.z) - 4, t: 0 });
          if (airSlash) {
            for (const i of ev.cells) this.flashMute[i] = world.time + 0.12;
            break;
          }
          for (const c of ev.crossings) this.burst(c.x, sy(c.y, c.level), LINE[Math.min(6, c.level)], 10, 60, 0.35);
          if (ev.cells.length) {
            this.shake(2 + Math.min(3, ev.cells.length / 40), 0.22);
            // 무너진 영역 가장자리에서 먼지: 땅이 다 내려앉는 순간(약 0.12초 뒤) 새 절벽 밑동에서 피어오르고, 짧게 쿵
            const cells = ev.cells.slice();
            this.later.push({
              t: 0.12,
              run: () => {
                let n = 0;
                for (const i of cells) {
                  const cx = i % terr.w;
                  const cy = Math.floor(i / terr.w);
                  const edge = [terr.get(cx + 1, cy), terr.get(cx - 1, cy), terr.get(cx, cy + 1), terr.get(cx, cy - 1)].some((h) => h > terr.height[i] + 0.5 && h < 50);
                  if (!edge || (n++ & 1)) continue;
                  this.burst((cx + 0.5) * CELL, sy((cy + 0.5) * CELL, Math.max(0, terr.height[i]) + 0.5), '#8d97c9', 2, 22, 0.55, -18);
                }
                this.shake(1.5, 0.1);
              },
            });
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
          // 지형 환원: 발밑에서 위로 솟는 잉크 파편과 빛기둥
          this.burst(ev.x, sy(ev.y, ev.z), '#19f5c8', 10, 50, 0.45, -60);
          this.rings.push({ x: ev.x, y: sy(ev.y, ev.z), r: 9, t: 0, max: 0.25, color: '#19f5c8' });
          this.beams.push({ x: Math.round(ev.x), y: sy(ev.y, ev.z), t: 0 });
          this.zoomPunch(0.015);
          break;
        case 'airHit':
          this.burst(ev.x, sy(ev.y, ev.z) - 4, '#ffffff', 12, 90, 0.3);
          this.burst(ev.x, sy(ev.y, ev.z) - 4, '#19f5c8', 8, 60, 0.35);
          this.rings.push({ x: ev.x, y: sy(ev.y, ev.z) - 4, r: 13, t: 0, max: 0.2, color: '#ffffff' });
          this.streaks.push({ x: ev.x, y: sy(ev.y, ev.z) - 5, t: 0, max: 0.16, r0: 5, r1: 17, n: 8, rot: Math.random(), color: '#ffffff' });
          this.impactT = IMPACT_SEC;
          this.impactAt = { x: ev.x, y: ev.y };
          this.shake(2.5, 0.14);
          this.zoomPunch(0.045);
          break;
        case 'kill': {
          const col = ev.kind === 'chaser' ? CHASER : SHOOTER;
          if (ev.cause !== 'abyss') {
            this.burst(ev.x, sy(ev.y, ev.z) - 4, col, 18, 80, 0.5);
            this.streaks.push({ x: ev.x, y: sy(ev.y, ev.z) - 5, t: 0, max: 0.14, r0: 4, r1: 12, n: 6, rot: Math.random(), color: col });
            this.marks.push({ x: Math.round(ev.x), y: sy(ev.y, ev.z), t: 0, color: col });
          }
          this.shake(2, 0.15);
          this.zoomPunch(0.035);
          break;
        }
        case 'fallAbyss':
          this.burst(ev.x, sy(ev.y, -1), ABYSS_RIM, 12, 30, 0.6, -20);
          break;
        case 'hurt': {
          this.hurtT = 0.3;
          this.shake(4, 0.25);
          const pl = world.player;
          this.burst(ev.x, sy(ev.y, pl.z) - 4, '#ff6b6b', 10, 60, 0.35);
          // 맞은 자리를 분명히: 플레이어를 감싸고 퍼지는 적색 고리
          this.rings.push({ x: pl.x, y: sy(pl.y, pl.z) - 5, r: 14, t: 0, max: 0.25, color: '#ff2d55' });
          break;
        }
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
        case 'dash': {
          // 대시 시작: 발밑에서 뒤로 튀는 먼지
          const pl = world.player;
          for (let q = 0; q < 5; q++)
            this.particles.push({ x: ev.x, y: sy(ev.y, pl.z), vx: -pl.dashDx * (30 + Math.random() * 40) + (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 15, life: 0.3, max: 0.3, color: '#9aa6e0', g: 80, size: 1 });
          break;
        }
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

  draw(world: World, dt: number, aim: Aim | null): void {
    const ctx = this.ctx;
    this.clock += dt;
    this.frameDt = dt;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0);
    this.drawBeaconLight();

    const p = world.player;
    if (p.dashT > 0) this.ghosts.push({ x: p.x, y: p.y, z: p.z, t: 0 });

    // 줄 단위로 엔티티를 끼워 넣어 앞쪽(남쪽) 높은 지형이 가리게 한다
    const rows: (() => void)[][] = Array.from({ length: GRID_H }, () => []);
    const rowOf = (y: number) => Math.max(0, Math.min(GRID_H - 1, Math.floor(y / CELL)));
    for (const e of world.enemies) rows[rowOf(e.y)].push(() => this.drawEnemy(world, e));
    rows[rowOf(p.y)].push(() => this.drawPlayer(world));

    for (let cy = 0; cy < GRID_H; cy++) {
      for (let cx = 0; cx < GRID_W; cx++) this.drawCell(world, cx, cy);
      this.drawGhostRow(world, cy);
      for (const f of rows[cy]) f();
    }
    this.drawOccluded(world, rowOf);

    if (world.setup.exit) this.drawBeacon(world, world.setup.exit, '#e8ff3a');
    if (world.marker) this.drawBeacon(world, world.marker, '#19f5c8');
    this.drawBolts(world);
    if (aim && world.mode === 'play') this.drawAim(world, aim);
    this.drawMotes(dt);
    ctx.drawImage(this.vignette, 0, 0);
    this.drawImpact(world, dt);
    this.drawFx(dt);
    if (this.titleScan) this.drawScan();
    this.drawIntro(world, dt);
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

    // 남쪽 절벽면: 윗면 색을 어둡게 한 면 + 세로 빗금(우모선) + 고도마다 지층선
    const sShown = cy + 1 < GRID_H ? t.shown[i + GRID_W] : 0;
    const southTop = sy((cy + 1) * CELL, sShown);
    const wallTop = top + CELL;
    if (southTop > wallTop) {
      const wl = Math.max(0, Math.min(6, Math.floor(s)));
      ctx.fillStyle = WALL[wl];
      ctx.fillRect(x, wallTop, CELL, southTop - wallTop);
      ctx.fillStyle = WALL_STRIPE[wl];
      for (let k = (cx & 1) * 3; k < CELL; k += 3) ctx.fillRect(x + k, wallTop, 1, southTop - wallTop);
      ctx.globalAlpha = 0.55;
      for (let lv = Math.floor(s) - 1; lv > sShown - 0.01 && lv >= 0; lv--) {
        ctx.fillStyle = LINE[lv + 1 > 6 ? 6 : lv + 1];
        ctx.fillRect(x, sy((cy + 1) * CELL, lv), CELL, 1);
      }
      ctx.globalAlpha = 1;
    }

    if (isAbyss(h)) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, top, CELL, CELL);
      // 깊이: 가장자리 바로 밑은 붉은 열기, 안쪽으로는 천천히 가라앉는 지층선(아래로 멀어지는 공간)
      const rimN = cy > 0 && !isAbyss(t.height[i - GRID_W]);
      if (rimN) {
        ctx.fillStyle = '#3a0716';
        ctx.fillRect(x, top, CELL, 1);
        ctx.fillStyle = '#1c0410';
        ctx.fillRect(x, top + 1, CELL, 2);
      }
      const drift = Math.floor(this.clock * 5 + cy * 2) % 6;
      ctx.fillStyle = '#100820';
      ctx.fillRect(x, top + drift, CELL, 1);
      // 접힌 종이 틈 사이로 보이는 먼 별빛
      const hash = (cx * 73856093) ^ (cy * 19349663);
      if ((hash & 15) === 0 && Math.sin(this.clock * 3 + hash) > 0.3) {
        ctx.fillStyle = '#5b2a8f';
        ctx.fillRect(x + (hash & 3) + 1, top + ((hash >> 4) & 3) + 1, 1, 1);
      }
      return;
    }

    const lvl = Math.min(6, h);
    ctx.fillStyle = TOP[lvl];
    ctx.fillRect(x, top, CELL, CELL);

    // 그늘: 서쪽(빛이 오는 쪽)이 더 높으면 그 높이만큼 띠, 북쪽 절벽 밑동에는 얇은 접지 그늘
    const sw = cx > 0 ? t.shown[i - 1] : s;
    const sn = cy > 0 ? t.shown[i - GRID_W] : s;
    if (sw > s + 0.5 || sn > s + 0.5) {
      ctx.fillStyle = '#000000';
      ctx.globalAlpha = 0.38;
      if (sw > s + 0.5) ctx.fillRect(x, top, Math.min(4, Math.round((sw - s) * 1.3)), CELL);
      if (sn > s + 0.5) ctx.fillRect(x, top, CELL, sn - s > 1.5 ? 2 : 1);
      ctx.globalAlpha = 1;
    }

    // 측량 눈금: 5칸마다 작은 +
    if (cx % 5 === 0 && cy % 5 === 0) {
      ctx.fillStyle = TICK[lvl];
      ctx.fillRect(x - 1, top, 3, 1);
      ctx.fillRect(x, top - 1, 1, 3);
    }

    // 등고선: 나보다 낮은 이웃과의 경계에 내 고도의 색으로. 막 무너진 칸은 흰 섬광, 막 환원된 칸은 시안 섬광(선에만)
    const flash = now - t.cutAt[i] < 0.08 && now > this.flashMute[i];
    const restoring = this.clock - this.restoredAt[i] < 0.1;
    const edge = (nh: number) => nh < h || nh === -1;
    const hw = cx > 0 ? t.height[i - 1] : 99;
    const he = cx < GRID_W - 1 ? t.height[i + 1] : 99;
    const hn = cy > 0 ? t.height[i - GRID_W] : 99;
    const hs = cy < GRID_H - 1 ? t.height[i + GRID_W] : 99;
    const col = (nh: number) => (isAbyss(nh) ? ABYSS_RIM : flash ? '#ffffff' : restoring ? '#bff7ff' : LINE[lvl]);
    if (edge(hn)) this.edgeLine(x, top, CELL, 1, col(hn), 0, 1);
    if (edge(hs)) this.edgeLine(x, top + CELL - 1, CELL, 1, col(hs), 0, -1);
    if (edge(hw)) this.edgeLine(x, top, 1, CELL, col(hw), 1, 0);
    if (edge(he)) this.edgeLine(x + CELL - 1, top, 1, CELL, col(he), -1, 0);
  }

  /**
   * 기억된 등고선: 무너진 칸은 원래 등고선을 원래 높이에 점선으로 남긴다. 환원이 다가올수록 점선 → 파선 → 실선으로 차오르고,
   * 경고 시간(마지막 restoreWarnSec)에는 흰색으로 깜빡인다. "어디가, 언제, 어디까지 솟는지"를 한 선으로 보여 준다.
   */
  private drawGhostRow(world: World, cy: number): void {
    const t = world.terrain;
    const ctx = this.ctx;
    const now = world.time;
    const blink = Math.floor(this.clock * 10) % 2 === 0;
    for (let cx = 0; cx < GRID_W; cx++) {
      const i = t.idx(cx, cy);
      if (!t.isCut(i)) continue;
      const L = t.base[i];
      if (L < 0) continue;
      const total = Math.max(0.01, t.restoreAt[i] - t.cutAt[i]);
      const left = t.restoreAt[i] - now;
      const prog = Math.max(0, Math.min(1, 1 - left / total));
      const warn = left < tune.restoreWarnSec;
      const density = warn ? 1 : prog < 0.45 ? 1 / 3 : prog < 0.8 ? 2 / 3 : 1;
      ctx.fillStyle = warn ? (blink ? '#bff7ff' : '#19f5c8') : LINE[Math.min(6, L)];
      ctx.globalAlpha = warn ? 0.95 : 0.3 + 0.4 * prog;
      const x = cx * CELL;
      const top = sy(cy * CELL, L);
      const lower = (j: number) => t.base[j] < L;
      const seg = (x0: number, y0: number, dx: number, dy: number) => {
        for (let k = 0; k < CELL; k++) if (((x0 + y0 + k) % 3) / 3 < density - 0.001) ctx.fillRect(x0 + dx * k, y0 + dy * k, 1, 1);
      };
      if (cy > 0 && lower(i - GRID_W)) seg(x, top, 1, 0);
      if (cy < GRID_H - 1 && lower(i + GRID_W)) seg(x, top + CELL - 1, 1, 0);
      if (cx > 0 && lower(i - 1)) seg(x, top, 0, 1);
      if (cx < GRID_W - 1 && lower(i + 1)) seg(x + CELL - 1, top, 0, 1);
    }
    ctx.globalAlpha = 1;
  }

  private edgeLine(x: number, y: number, w: number, h: number, color: string, ix: number, iy: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.28;
    ctx.fillRect(x + ix, y + iy, w, h);
    ctx.globalAlpha = 1;
  }

  /** 카인의 지금 자세: 실제로 움직인 거리로 걸음을 세고, 방향 전환·착지·피격·대시를 자세로 바꾼다 */
  private kainPose(world: World): KainPose {
    const p = world.player;
    const k = this.kain;
    const dt = this.frameDt;
    if (Number.isNaN(k.px)) {
      k.px = p.x;
      k.py = p.y;
    }
    const dist = Math.hypot(p.x - k.px, p.y - k.py);
    k.px = p.x;
    k.py = p.y;
    const speed = dt > 0 ? dist / dt : 0;
    const moving = speed > 8 && !p.airborne && p.dashT === 0;
    k.phase = moving ? k.phase + dist / 4.5 : 0;
    const mirror = p.facingX < -0.01 ? true : p.facingX > 0.01 ? false : k.mirror;
    if (mirror !== k.mirror) {
      k.turnT = 0.05;
      k.mirror = mirror;
    }
    k.turnT = Math.max(0, k.turnT - dt);
    if (k.wasAir && !p.airborne) k.landT = 0.1;
    k.wasAir = p.airborne;
    k.landT = Math.max(0, k.landT - dt);
    k.slashT += dt;
    const dashing = p.dashT > 0;
    return {
      mirror,
      back: p.facingY < -0.7 && Math.abs(p.facingX) < 0.4,
      frame: moving ? Math.floor(k.phase) & 3 : 0,
      breath: !moving && !dashing && !p.airborne && Math.floor(this.clock * 1.4) % 2 === 0 ? -1 : 0,
      lean: k.turnT > 0 ? 0 : p.hurtT > 0 ? -1 : dashing || speed > 95 ? 1 : 0,
      coat: dashing || p.airborne ? 2 : moving ? 1 : 0,
      air: p.airborne,
      squash: k.landT > 0.035 ? -1 : 0,
      staff: k.slashT > SWING_SEC,
    };
  }

  private drawPlayer(world: World): void {
    const ctx = this.ctx;
    const p = world.player;
    const t = world.terrain;
    const x = Math.round(p.x);
    const y = sy(p.y, p.z);
    const k = this.kain;
    if (world.mode === 'over') {
      // 쓰러짐: 비틀 → 무릎 → 엎드림, 모자가 굴러 떨어지고 발밑에서 붉은 등고선 고리가 번진다
      k.overT += this.frameDt;
      this.groundShadow(t, p.x, p.y, p.z);
      drawKainDown(ctx, x, y, k.mirror, k.overT, '#ff6b6b');
      if (k.overT > 0.36 && k.overT < 1.3) {
        const q = (k.overT - 0.36) / 0.94;
        ctx.globalAlpha = 1 - q;
        pixCircle(ctx, x, y - 1, 4 + q * 26, '#ff2d55');
        ctx.globalAlpha = (1 - q) * 0.5;
        pixCircle(ctx, x, y - 1, 2 + q * 16, '#ff2d55');
        ctx.globalAlpha = 1;
      }
      return;
    }
    k.overT = 0;
    const pose = this.kainPose(world);
    this.lastKain = pose;
    for (const g of this.ghosts) {
      ctx.globalAlpha = Math.max(0, 0.45 - g.t * 3);
      drawKain(ctx, Math.round(g.x), sy(g.y, g.z), { ...pose, frame: 0, breath: 0 }, '#19f5c8', '#0b3a44');
    }
    ctx.globalAlpha = 1;
    this.groundShadow(t, p.x, p.y, p.z);
    const blink = p.inv > 0 && p.dashT === 0 && p.hurtT === 0 && Math.floor(this.clock * 20) % 2 === 0;
    if (p.z < -0.5) ctx.globalAlpha = Math.max(0, 1 + p.z / 5);
    // 피격 직후 잠깐 흰색, 그다음 적색
    const rim = p.hurtT > 0.2 ? '#ffffff' : p.hurtT > 0 ? '#ff6b6b' : RIM;
    if (!blink) drawKain(ctx, x, y, pose, rim, '#000000');
    ctx.globalAlpha = 1;
    this.drawSwing(x, y, pose);
    // 낙차 가속 표시: 발밑의 짧은 잔광
    if (p.boostT > 0 && p.boost > 0) {
      ctx.fillStyle = '#19f5c8';
      ctx.globalAlpha = 0.6 * (p.boostT / tune.fallBoostTime);
      ctx.fillRect(x - 3 - Math.round(p.facingX * 3), y, 7, 1);
      ctx.globalAlpha = 1;
    }
  }

  /** 측량도 휘두르기: 어깨에서 조준 방향으로 칼날이 쓸고 지나가며 시안 잔상 호를 남긴다(SWING_SEC 동안) */
  private drawSwing(x: number, y: number, pose: KainPose): void {
    const k = this.kain;
    if (k.slashT >= SWING_SEC) return;
    const ctx = this.ctx;
    const q = k.slashT / SWING_SEC;
    const e = 1 - (1 - Math.min(1, q * 1.7)) ** 3;
    const side = pose.mirror ? -1 : 1;
    const sx = x + side;
    const syy = y - 6;
    const ang = (u: number) => k.slashAng + side * (-1.15 + 1.6 * u);
    for (let i = 4; i >= 1; i--) {
      const a = ang(Math.max(0, e - i * 0.09));
      ctx.globalAlpha = (1 - q) * (0.7 - i * 0.12);
      ctx.fillStyle = '#19f5c8';
      for (let r = 5; r <= 15; r++) ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(syy + Math.sin(a) * r), 1, 1);
    }
    const a = ang(e);
    ctx.globalAlpha = 1 - q * 0.6;
    ctx.fillStyle = '#000000';
    for (let r = 1; r <= 3; r++) ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(syy + Math.sin(a) * r), 1, 1);
    ctx.fillStyle = '#e8fdff';
    for (let r = 4; r <= 15; r++) ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(syy + Math.sin(a) * r), 1, 1);
    ctx.globalAlpha = 1;
  }

  /** 적 자세: 걸음은 실제로 움직인 거리로, 준비·돌진·기절·조준·반동은 상태로 */
  private foePose(e: Enemy): FoePose {
    let f = this.foes.get(e.id);
    if (!f) {
      f = { px: e.x, py: e.y, phase: 0 };
      this.foes.set(e.id, f);
    }
    const dist = Math.hypot(e.x - f.px, e.y - f.py);
    f.px = e.x;
    f.py = e.y;
    if (e.state === 'walk' && dist > 0.05) f.phase += dist / 3.2;
    else if (e.state !== 'walk') f.phase = 0;
    const crouch = e.state === 'windup';
    const sh = ENEMY.shooter;
    const recoil = e.kind === 'shooter' && e.state === 'walk' && e.cool > sh.cooldown - 0.12;
    const ax = Math.sign(e.aimX - e.x);
    const ay = Math.sign(e.aimY - e.y);
    return {
      hound: {
        mirror: e.dirX < 0,
        frame: Math.floor(f.phase) & 3,
        crouch,
        stretch: e.state === 'lunge',
        dazed: e.state === 'stun',
        jitter: crouch && Math.floor(this.clock * 30) % 2 === 0 ? 1 : 0,
      },
      marker: {
        hover: e.state === 'stun' ? 0 : Math.round(Math.sin(this.clock * 3 + e.id * 1.7) * 0.75),
        charge: e.kind === 'shooter' && crouch ? 1 - Math.max(0, e.t) / sh.windup : 0,
        recoilX: recoil ? -ax : 0,
        recoilY: recoil ? -ay : 0,
        tilt: e.state === 'stun' ? 1 : 0,
      },
    };
  }

  /** 적 스프라이트(환원으로 튕겨 오른 동안은 90°씩 굴러 넘어진다) */
  private paintFoe(e: Enemy, x: number, y: number, pose: FoePose, color: string, haloPts: [number, number][] | null): void {
    const ctx = this.ctx;
    const tumble = e.state === 'launched' ? Math.floor(this.clock / 0.07) % 4 : 0;
    if (tumble) {
      ctx.save();
      ctx.translate(x, y - 4);
      ctx.rotate((tumble * Math.PI) / 2);
      ctx.translate(-x, -(y - 4));
    }
    if (haloPts) {
      const a0 = ctx.globalAlpha;
      ctx.fillStyle = '#03040a';
      ctx.globalAlpha = a0 * 0.9;
      for (const [dx, dy] of haloPts) ctx.fillRect(x + dx, y + dy, 1, 1);
      ctx.globalAlpha = a0;
    }
    if (e.kind === 'chaser') drawHound(ctx, x, y, pose.hound, color);
    else drawMarker(ctx, x, y, pose.marker, color);
    if (tumble) ctx.restore();
  }

  private foeMask(e: Enemy, pose: FoePose, kind: 'halo' | 'outline'): [number, number][] {
    const fn = kind === 'halo' ? this.halo.bind(this) : this.outline.bind(this);
    return e.kind === 'chaser'
      ? fn(houndKey(pose.hound), (g, hx, hy) => drawHound(g, hx, hy, pose.hound, '#fff'))
      : fn(markerKey(pose.marker), (g, hx, hy) => drawMarker(g, hx, hy, { ...pose.marker, charge: 0 }, '#fff'));
  }

  private drawEnemy(world: World, e: Enemy): void {
    const ctx = this.ctx;
    const t = world.terrain;
    const x = Math.round(e.x);
    const y = sy(e.y, e.z);
    if (e.state === 'dead') {
      if (e.deathCause !== 'abyss') return;
      // 절대 심연으로 떨어지는 적: 붉게 바래며 사라진다
      const k = Math.min(1, e.deadT / 0.8);
      ctx.globalAlpha = Math.max(0, 1 - k);
      this.paintFoe(e, x, y, this.foePose(e), k > 0.3 ? '#5b1020' : e.kind === 'chaser' ? CHASER : SHOOTER, null);
      ctx.globalAlpha = 1;
      return;
    }
    this.groundShadow(t, e.x, e.y, e.z);
    if (e.state === 'spawn') {
      const k = 1 - Math.max(0, e.t) / 0.9;
      ctx.fillStyle = SHOOTER;
      ctx.fillRect(x, y - Math.round(10 * k), 1, Math.round(10 * k));
      ctx.globalAlpha = 1;
      return;
    }
    const pose = this.foePose(e);
    const white = e.flash > 0 || (e.state === 'windup' && e.kind === 'chaser' && Math.floor(this.clock * 16) % 2 === 0);
    if (e.kind === 'chaser' && e.state === 'windup') {
      // 돌진 예고: 돌진할 길이 끝까지 차오르는 붉은 점선(다 차면 곧 돌진)
      const k = Math.min(1, (1 - Math.max(0, e.t) / ENEMY.chaser.windup) * 1.25);
      const len = ENEMY.chaser.lungeSpeed * ENEMY.chaser.lungeTime * k;
      ctx.fillStyle = k >= 1 ? '#ffffff' : CHASER;
      for (let d = 5; d < len; d += 3) ctx.fillRect(Math.round(e.x + e.dirX * d), sy(e.y + e.dirY * d, e.z) - 3, 1, 1);
    }
    if (e.kind === 'chaser' && e.state === 'lunge') {
      // 돌진 잔상 두 겹
      for (const [o, al] of [[8, 0.2], [4, 0.4]] as const) {
        ctx.globalAlpha = al;
        drawHound(ctx, x - Math.round(e.dirX * o), y - Math.round(e.dirY * o), pose.hound, CHASER);
      }
      ctx.globalAlpha = 1;
    }
    if (e.kind === 'shooter' && e.state === 'windup') {
      // 조준선: 점선. 발사 직전 0.2초는 경고 적색
      ctx.fillStyle = e.t < 0.2 ? '#ff2d55' : SHOOTER;
      const dx = e.aimX - e.x;
      const dy = e.aimY - e.y;
      const d = Math.hypot(dx, dy) || 1;
      for (let s = 6; s < d; s += 4) ctx.fillRect(Math.round(e.x + (dx / d) * s), Math.round(sy(e.y + (dy / d) * s, e.z + 0.5) - 4), 1, 1);
    }
    this.paintFoe(e, x, y, pose, white ? '#ffffff' : e.kind === 'chaser' ? CHASER : SHOOTER, this.foeMask(e, pose, 'halo'));
    if (e.exposedT > 0) {
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
    if (e.hp < max) {
      for (let k = 0; k < max; k++) {
        ctx.fillStyle = k < e.hp ? '#ffffff' : '#444a66';
        ctx.fillRect(x - max + k * 2, y - 13, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 발밑 그림자: 서 있으면 납작한 타원, 높이 뜰수록 작고 옅게. 몸이 어느 땅 위에 있는지 보인다 */
  private groundShadow(t: World['terrain'], px: number, py: number, z: number): void {
    const gh = t.heightAt(px, py);
    if (isAbyss(gh)) return;
    const ctx = this.ctx;
    const up = Math.max(0, z - gh);
    const x = Math.round(px);
    const y = sy(py, gh);
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = up > 0.2 ? Math.max(0.25, 0.6 - up * 0.05) : 0.5;
    const w = up > 3 ? 3 : up > 0.2 ? 5 : 7;
    ctx.fillRect(x - (w >> 1), y - 1, w, 1);
    ctx.fillRect(x - (w >> 1) + 1, y, w - 2, 1);
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

  /**
   * 2.5D 가림 보완: 남쪽(앞쪽) 높은 지형에 가려진 적·플레이어는, 지형이 덮은 픽셀에만 1px 윤곽을 그린다.
   * 가림 판정은 조준(input.ts terrainCoversAfterRow)과 같은 함수다. 표시만 바꾸고 판정·조준은 그대로.
   */
  private drawOccluded(world: World, rowOf: (y: number) => number): void {
    const ctx = this.ctx;
    const t = world.terrain;
    const trace = (x: number, y: number, row: number, pts: [number, number][], color: string) => {
      ctx.fillStyle = color;
      for (const [dx, dy] of pts) if (terrainCoversAfterRow(t, x + dx, y + dy, row)) ctx.fillRect(x + dx, y + dy, 1, 1);
    };
    for (const e of world.enemies) {
      if (e.state === 'dead' || e.state === 'spawn' || e.state === 'launched') continue;
      trace(Math.round(e.x), sy(e.y, e.z), rowOf(e.y), this.foeMask(e, this.foePose(e), 'outline'), e.kind === 'chaser' ? CHASER : SHOOTER);
    }
    const p = world.player;
    const pose = this.lastKain;
    if (!pose || world.mode === 'over') return;
    trace(Math.round(p.x), sy(p.y, p.z), rowOf(p.y), this.outline(kainKey(pose), (g, x, y) => drawKain(g, x, y, pose, '#fff', '#fff')), PLAYER_OUTLINE);
  }

  /** 스프라이트 바깥에 맞닿은 빈 픽셀(1px 바깥 테두리)을 구해 둔다 */
  private halo(key: string, paint: (g: CanvasRenderingContext2D, x: number, y: number) => void): [number, number][] {
    const hk = `halo:${key}`;
    const cached = this.outlines.get(hk);
    if (cached) return cached;
    const { size, ox, oy } = MASK;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    paint(g, ox, oy);
    const a = g.getImageData(0, 0, size, size).data;
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && a[(y * size + x) * 4 + 3] > 0;
    const pts: [number, number][] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!solid(x, y) && (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))) pts.push([x - ox, y - oy]);
    this.outlines.set(hk, pts);
    return pts;
  }

  /** 스프라이트를 작은 캔버스에 한 번 그려, 채워진 픽셀 중 바깥과 맞닿은 것(1px 테두리)을 구해 둔다 */
  private outline(key: string, paint: (g: CanvasRenderingContext2D, x: number, y: number) => void): [number, number][] {
    const cached = this.outlines.get(key);
    if (cached) return cached;
    const { size, ox, oy } = MASK;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    paint(g, ox, oy);
    const a = g.getImageData(0, 0, size, size).data;
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && a[(y * size + x) * 4 + 3] > 0;
    const pts: [number, number][] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (solid(x, y) && (!solid(x + 1, y) || !solid(x - 1, y) || !solid(x, y + 1) || !solid(x, y - 1))) pts.push([x - ox, y - oy]);
    this.outlines.set(key, pts);
    return pts;
  }

  /** 표지(출구·안내): 바닥에 퍼지는 측량 고리 + 위로 솟는 빛기둥과 삼각점 */
  private drawBeacon(world: World, e: { cx: number; cy: number; r: number }, color: string): void {
    const ctx = this.ctx;
    const x = Math.round((e.cx + 0.5) * CELL);
    const gz = Math.max(0, world.terrain.get(e.cx, e.cy));
    const y = sy((e.cy + 0.5) * CELL, gz);
    const k = (this.clock * 0.8) % 1;
    ctx.globalAlpha = 0.9;
    pixCircle(ctx, x, y, e.r * CELL, color);
    ctx.globalAlpha = 1 - k;
    pixCircle(ctx, x, y, 3 + k * e.r * CELL, color);
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.clock * 5);
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 40, 1, 40);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    for (let r = 0; r < 4; r++) ctx.fillRect(x - r, y - 8 + r, r * 2 + 1, 1);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y - 6, 1, 1);
  }

  /** 구역마다 다른 공기: 균열 지대는 심연에서 오르는 불티, 접힘 협곡은 동쪽으로 부는 먼지, 환원 구역은 떠오르는 시안 입자 */
  setMood(m: Mood): void {
    this.mood = m;
    this.motes = [];
    const n = m === 'plain' ? 18 : 34;
    for (let i = 0; i < n; i++) {
      const r = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
      const speed = 0.5 + r(3);
      const [vx, vy] = m === 'canyon' ? [26 * speed, 2 * (r(4) - 0.5)] : m === 'rift' ? [3 * (r(4) - 0.5), -7 * speed] : m === 'restore' ? [2 * (r(4) - 0.5), -5 * speed] : [2, -1.5 * speed];
      this.motes.push({ x: r(1) * VIEW_W, y: r(2) * VIEW_H, vx, vy, ph: r(5) * 6 });
    }
  }

  private drawMotes(dt: number): void {
    const ctx = this.ctx;
    const col = this.mood === 'rift' ? '#ff7a45' : this.mood === 'canyon' ? '#9aa6e0' : this.mood === 'restore' ? '#19f5c8' : '#7f8bb8';
    ctx.fillStyle = col;
    for (const m of this.motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt + Math.sin(this.clock * 1.3 + m.ph) * 0.05;
      if (m.x > VIEW_W + 4) m.x -= VIEW_W + 8;
      if (m.x < -4) m.x += VIEW_W + 8;
      if (m.y < 14) m.y += VIEW_H - 14;
      if (m.y > VIEW_H) m.y -= VIEW_H - 14;
      const tw = 0.5 + 0.5 * Math.sin(this.clock * 2.1 + m.ph);
      ctx.globalAlpha = 0.12 + 0.28 * tw;
      if (this.mood === 'canyon') ctx.fillRect(Math.round(m.x) - 2, Math.round(m.y), 3, 1);
      else ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  /** 지평선 위 원점 타워(Benchmark Zero)의 점멸등. 탑 실루엣은 배경에 */
  private drawBeaconLight(): void {
    const on = Math.sin(this.clock * 2.2) > 0.2;
    const ctx = this.ctx;
    ctx.fillStyle = '#ff2d55';
    ctx.globalAlpha = on ? 0.9 : 0.25;
    ctx.fillRect(TOWER_X, 1, 1, 1);
    ctx.globalAlpha = on ? 0.25 : 0.08;
    ctx.fillRect(TOWER_X - 1, 0, 3, 3);
    ctx.globalAlpha = 1;
  }

  /** 공중 추가타의 멈춘 한 장: 장면을 어둡게 누르고 맞은 적을 흰 실루엣으로 다시 그린다. 섬광(drawFx)은 그 위에 */
  private drawImpact(world: World, dt: number): void {
    if (this.impactT <= 0 || !this.impactAt) return;
    this.impactT = Math.max(0, this.impactT - dt);
    const ctx = this.ctx;
    const k = this.impactT / IMPACT_SEC;
    ctx.fillStyle = '#02030a';
    ctx.globalAlpha = 0.55 * Math.min(1, k * 1.6);
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
    const at = this.impactAt;
    let best: Enemy | null = null;
    let bd = 12;
    for (const e of world.enemies) {
      const d = Math.hypot(e.x - at.x, e.y - at.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) this.paintFoe(best, Math.round(best.x), sy(best.y, best.z), this.foePose(best), '#ffffff', this.foeMask(best, this.foePose(best), 'halo'));
  }

  /** 타이틀: 4초마다 위에서 아래로 지나가는 시안 주사선과 옅은 잔상 */
  private drawScan(): void {
    const ctx = this.ctx;
    const y = Math.round(((this.clock / 4) % 1) * (VIEW_H + 30)) - 10;
    ctx.fillStyle = '#19f5c8';
    for (let k = 0; k < 10; k++) {
      ctx.globalAlpha = 0.16 * (1 - k / 10);
      ctx.fillRect(0, y - k, VIEW_W, 1);
    }
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, y, VIEW_W, 1);
    ctx.globalAlpha = 1;
  }

  /** 구역 시작·재시작: 플레이어에서 퍼지는 측량 신호 고리 안쪽만 지도가 보인다(INTRO_SEC 동안) */
  private drawIntro(world: World, dt: number): void {
    if (this.introT >= INTRO_SEC) return;
    // 연출 줄이기(흔들림·줌 모두 끔)면 퍼지는 고리 없이 바로 보인다
    if (tune.shake === 0 && tune.zoomFx === 0) {
      this.introT = INTRO_SEC;
      return;
    }
    this.introT += dt;
    const k = Math.min(1, this.introT / INTRO_SEC);
    const e = 1 - (1 - k) ** 3;
    const p = world.player;
    const cx = p.x;
    const cy = sy(p.y, p.z) - 6;
    const r = Math.max(1, 8 + e * 560);
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#04050a';
    ctx.fill('evenodd');
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#19f5c8';
    ctx.globalAlpha = 1 - k * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.35 * (1 - k);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, r - 10), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** 구역이 바뀔 때 이전 구역의 연출을 지운다 */
  resetFx(): void {
    this.particles = [];
    this.slashes = [];
    this.rings = [];
    this.ghosts = [];
    this.streaks = [];
    this.marks = [];
    this.beams = [];
    this.later = [];
    this.introT = 0;
    this.foes.clear();
    this.impactT = 0;
    this.flashMute.fill(-Infinity);
    this.kain.px = NaN;
    this.kain.slashT = 9;
    this.kain.overT = 0;
    this.shakeT = this.shakeAmp = this.shakeDur = 0;
    this.punch = this.punchT = this.dashOut = 0;
    this.hurtT = 0;
    this.restoredAt.fill(-Infinity);
  }

  /** 조준: 칼날이 닿을 선과, 그 선이 벨 등고선 위치를 미리 보여 준다 */
  private drawAim(world: World, aim: Aim): void {
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
    // 조준이 잡힌 적: 몸통을 감싸는 괄호
    if (aim.target) {
      const e = aim.target;
      const ex = Math.round(e.x);
      const feet = sy(e.y, e.z);
      ctx.fillStyle = '#ffffff';
      for (const [bx, by, w, h] of [
        [ex - 7, feet - 15, 3, 1], [ex - 7, feet - 15, 1, 3], [ex + 5, feet - 15, 3, 1], [ex + 7, feet - 15, 1, 3],
        [ex - 7, feet + 2, 3, 1], [ex - 7, feet, 1, 3], [ex + 5, feet + 2, 3, 1], [ex + 7, feet, 1, 3],
      ]) ctx.fillRect(bx, by, w, h);
    }
    // 조준점: 측량 십자(실제 커서 자리)
    const ax = Math.round(aim.cursor ? aim.cursor.x : aim.x);
    const ay = aim.cursor ? Math.round(aim.cursor.y) : sy(aim.y, p.z);
    ctx.fillStyle = '#19f5c8';
    ctx.fillRect(ax - 4, ay, 3, 1);
    ctx.fillRect(ax + 2, ay, 3, 1);
    ctx.fillRect(ax, ay - 4, 1, 3);
    ctx.fillRect(ax, ay + 2, 1, 3);
  }

  private drawFx(dt: number): void {
    const ctx = this.ctx;
    for (const l of this.later) {
      l.t -= dt;
      if (l.t <= 0) l.run();
    }
    this.later = this.later.filter((l) => l.t > 0);
    for (const m of this.marks) {
      m.t += dt;
      ctx.globalAlpha = Math.max(0, 0.8 * (1 - m.t / 1.4));
      ctx.fillStyle = m.color;
      for (let k = -2; k <= 2; k++) {
        ctx.fillRect(m.x + k, m.y - 1 + k, 1, 1);
        ctx.fillRect(m.x + k, m.y - 1 - k, 1, 1);
      }
    }
    this.marks = this.marks.filter((m) => m.t < 1.4);
    for (const b of this.beams) {
      b.t += dt;
      const k = 1 - b.t / 0.22;
      if (k <= 0) continue;
      ctx.globalAlpha = k;
      ctx.fillStyle = '#bff7ff';
      ctx.fillRect(b.x, b.y - 22, 1, 22);
      ctx.globalAlpha = k * 0.4;
      ctx.fillStyle = '#19f5c8';
      ctx.fillRect(b.x - 1, b.y - 16, 3, 16);
    }
    this.beams = this.beams.filter((b) => b.t < 0.22);
    for (const st of this.streaks) {
      st.t += dt;
      const k = st.t / st.max;
      if (k >= 1) continue;
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.fillStyle = st.color;
      // 바깥으로 밀려 나가는 짧은 선들
      const r0 = st.r0 + (st.r1 - st.r0) * k * 0.6;
      const r1 = st.r0 + (st.r1 - st.r0) * Math.min(1, k * 1.6 + 0.3);
      for (let q = 0; q < st.n; q++) {
        const a = ((q + st.rot) / st.n) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a) * 0.75;
        for (let r = r0; r <= r1; r += 1) ctx.fillRect(Math.round(st.x + ca * r), Math.round(st.y + sa * r), 1, 1);
      }
    }
    this.streaks = this.streaks.filter((st) => st.t < st.max);
    ctx.globalAlpha = 1;
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

/** 원점 타워가 지평선에 서 있는 x(내부 화면 px) */
const TOWER_X = 240;

/** 가장자리를 눌러 시선을 가운데로 모으는 비네트(한 번 만들어 둔다) */
function makeVignette(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = VIEW_W;
  c.height = VIEW_H;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.55, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.64);
  grad.addColorStop(0, 'rgba(2,3,10,0)');
  grad.addColorStop(1, 'rgba(2,3,10,0.3)');
  g.fillStyle = grad;
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  return c;
}

/** 두 #rrggbb 색을 t(0~1)만큼 섞는다 */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
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
  // 먼 지평선: 접힌 단애의 실루엣 두 겹과 세계 중심의 원점 타워(Benchmark Zero)
  for (let x = 0; x < VIEW_W; x++) {
    const far = 7 + Math.round(2.5 * Math.sin(x * 0.031) + 1.5 * Math.sin(x * 0.097 + 1.3));
    const near = 10 + Math.round(1.5 * Math.sin(x * 0.053 + 2.1) + Math.sin(x * 0.17));
    g.fillStyle = '#0a0d1d';
    g.fillRect(x, far, 1, 13 - far);
    g.fillStyle = '#0e1226';
    g.fillRect(x, near, 1, 13 - near);
  }
  g.fillStyle = '#1a2142';
  g.fillRect(TOWER_X, 2, 1, 11);
  g.fillRect(TOWER_X - 1, 6, 3, 7);
  g.fillRect(TOWER_X - 2, 10, 5, 3);
  g.fillStyle = '#2a3463';
  g.fillRect(TOWER_X - 3, 4, 7, 1);
  // 지도 윗변 자: 5칸(30px)마다 큰 눈금, 1칸마다 작은 눈금 — 지면의 측량 눈금(+)과 열이 맞는다
  g.fillStyle = '#121833';
  g.fillRect(0, 13, VIEW_W, 1);
  for (let x = 0; x < VIEW_W; x += 6) g.fillRect(x, 14, 1, x % 30 === 0 ? 3 : 1);
  g.fillStyle = '#1d2750';
  for (let x = 0; x < VIEW_W; x += 30) g.fillRect(x, 10, 1, 3);
  return c;
}

