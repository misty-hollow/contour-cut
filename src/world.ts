import { CELL, ENEMY, GRAVITY, GRID_H, GRID_W, PLAYER, tune } from './config';
import { buildFlowField, nextCell } from './flowfield';
import { buildSetup, cellCenter, type EnemyKind, type Setup } from './maps';
import { makeRng, randInt, type Rng } from './rng';
import { isAbyss, stepKind, Terrain } from './terrain';

export interface Input {
  moveX: number;
  moveY: number;
  /** 조준점(평면 좌표 px) */
  aimX: number;
  aimY: number;
  cut: boolean;
  dash: boolean;
  /** 대시 방향을 조준점으로(우클릭) */
  dashToAim: boolean;
}

export const emptyInput = (): Input => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, cut: false, dash: false, dashToAim: false });

export type KillCause = 'fall' | 'abyss' | 'blade';

export type GameEvent =
  | { type: 'slash'; x0: number; y0: number; x1: number; y1: number; z: number; crossings: { x: number; y: number; level: number }[]; cells: number[] }
  | { type: 'hit'; x: number; y: number; z: number }
  | { type: 'land'; x: number; y: number; z: number; levels: number; who: 'player' | 'enemy' }
  | { type: 'shock'; x: number; y: number; z: number; radius: number }
  | { type: 'kill'; x: number; y: number; z: number; cause: KillCause; kind: EnemyKind }
  | { type: 'fallAbyss'; x: number; y: number; who: 'player' | 'enemy' }
  | { type: 'hurt'; x: number; y: number }
  | { type: 'boltBlocked'; x: number; y: number; z: number }
  | { type: 'fire'; x: number; y: number; z: number }
  | { type: 'restore'; cells: number[] }
  | { type: 'dash'; x: number; y: number }
  | { type: 'spawn'; x: number; y: number }
  | { type: 'wave'; wave: number };

interface Body {
  x: number;
  y: number;
  /** 고도(단계, 실수). 지면보다 높으면 공중 */
  z: number;
  vz: number;
  /** 공중에 뜬 시점의 고도(착지 낙차 계산) */
  peakZ: number;
  airborne: boolean;
}

export interface Player extends Body {
  hp: number;
  inv: number;
  facingX: number;
  facingY: number;
  dashT: number;
  dashCool: number;
  dashDx: number;
  dashDy: number;
  cutCool: number;
  boost: number;
  boostT: number;
  safeX: number;
  safeY: number;
  hurtT: number;
  dashed: boolean;
}

export type EnemyState = 'spawn' | 'walk' | 'windup' | 'lunge' | 'recover' | 'stun' | 'dead';

export interface Enemy extends Body {
  id: number;
  kind: EnemyKind;
  hp: number;
  state: EnemyState;
  t: number;
  cool: number;
  dormant: number;
  dirX: number;
  dirY: number;
  aimX: number;
  aimY: number;
  knockX: number;
  knockY: number;
  knockT: number;
  flash: number;
  deadT: number;
  deathCause?: KillCause;
}

export interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alt: number;
  life: number;
}

export interface Stats {
  kills: Record<KillCause, number>;
  cuts: number;
  cellsCollapsed: number;
  shocks: number;
  boltsBlocked: number;
  hurt: number;
  wave: number;
}

export type Mode = 'play' | 'over';

const EDGE = 5;

const enemyGround = (t: Terrain, e: { x: number; y: number }) => t.heightAt(e.x, e.y);

export class World {
  readonly setup: Setup;
  readonly terrain: Terrain;
  readonly player: Player;
  enemies: Enemy[] = [];
  bolts: Bolt[] = [];
  events: GameEvent[] = [];
  stats: Stats = { kills: { fall: 0, abyss: 0, blade: 0 }, cuts: 0, cellsCollapsed: 0, shocks: 0, boltsBlocked: 0, hurt: 0, wave: 0 };
  mode: Mode = 'play';
  time = 0;
  hitstop = 0;
  readonly rng: Rng;
  private nextId = 1;
  private flow: Int16Array;
  private flowKey = '';
  private waveTimer = 1.2;

  constructor(scenario: string | null, seed: number) {
    this.setup = buildSetup(scenario, seed);
    this.rng = makeRng(seed * 7919 + 13);
    this.terrain = new Terrain(GRID_W, GRID_H, this.setup.heights);
    const px = cellCenter(this.setup.player.cx);
    const py = cellCenter(this.setup.player.cy);
    const pz = this.terrain.heightAt(px, py);
    this.player = {
      x: px, y: py, z: pz, vz: 0, peakZ: pz, airborne: false,
      hp: PLAYER.hp, inv: 0, facingX: 1, facingY: 0,
      dashT: 0, dashCool: 0, dashDx: 1, dashDy: 0, cutCool: 0,
      boost: 0, boostT: 0, safeX: px, safeY: py, hurtT: 0, dashed: false,
    };
    for (const s of this.setup.enemies) this.spawnEnemy(s.kind, cellCenter(s.cx), cellCenter(s.cy), s.dormant ?? 0, false);
    this.flow = new Int16Array(GRID_W * GRID_H).fill(-1);
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number, dormant: number, portal: boolean): Enemy {
    const z = this.terrain.heightAt(x, y);
    const e: Enemy = {
      id: this.nextId++, kind, x, y, z, vz: 0, peakZ: z, airborne: false,
      hp: ENEMY[kind].hp, state: portal ? 'spawn' : 'walk', t: portal ? 0.9 : 0,
      cool: kind === 'shooter' ? ENEMY.shooter.firstShot : 0.5,
      dormant, dirX: 0, dirY: 0, aimX: 0, aimY: 0, knockX: 0, knockY: 0, knockT: 0, flash: 0, deadT: 0,
    };
    this.enemies.push(e);
    if (portal) this.events.push({ type: 'spawn', x, y });
    return e;
  }

  /** 고정 간격 한 단계. 입력의 cut/dash는 처리되면 false로 바뀐다(타격 멈춤 중에는 보존). */
  step(dt: number, input: Input): void {
    if (this.mode !== 'play') return;
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return;
    }
    this.time += dt;
    const restored = this.terrain.restoreDue(this.time);
    if (restored.length) this.events.push({ type: 'restore', cells: restored });
    this.updatePlayer(dt, input);
    this.updateFlow();
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.separateEnemies();
    this.updateBolts(dt);
    this.enemies = this.enemies.filter((e) => e.state !== 'dead' || e.deadT < 0.8);
    for (const e of this.enemies) if (e.state === 'dead') e.deadT += dt;
    if (this.setup.waves) this.updateWaves(dt);
    this.terrain.animate(dt);
  }

  // ── 플레이어 ────────────────────────────────────────────

  private updatePlayer(dt: number, input: Input): void {
    const p = this.player;
    p.inv = Math.max(0, p.inv - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.cutCool = Math.max(0, p.cutCool - dt);
    p.dashCool = Math.max(0, p.dashCool - dt);
    p.boostT = Math.max(0, p.boostT - dt);
    if (p.boostT === 0) p.boost = 0;

    let mx = input.moveX;
    let my = input.moveY;
    const ml = Math.hypot(mx, my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    if (ml > 0.01) {
      p.facingX = mx;
      p.facingY = my;
    }

    // 대시
    if ((input.dash || input.dashToAim) && p.dashCool === 0 && p.dashT === 0) {
      let dx = mx;
      let dy = my;
      if (input.dashToAim || ml < 0.01) {
        dx = input.aimX - p.x;
        dy = input.aimY - p.y;
      }
      const dl = Math.hypot(dx, dy);
      if (dl < 0.01) {
        dx = p.facingX;
        dy = p.facingY;
      } else {
        dx /= dl;
        dy /= dl;
      }
      p.dashDx = dx;
      p.dashDy = dy;
      p.dashT = tune.dashTime;
      p.dashCool = tune.dashCooldown;
      p.inv = Math.max(p.inv, tune.dashTime + 0.1);
      p.dashed = true;
      this.events.push({ type: 'dash', x: p.x, y: p.y });
    }
    input.dash = false;
    input.dashToAim = false;

    // 절단
    if (input.cut && p.cutCool === 0) {
      p.cutCool = tune.cutCooldown;
      this.slash(input.aimX, input.aimY);
    }
    input.cut = false;

    // 이동
    let vx: number;
    let vy: number;
    if (p.dashT > 0) {
      vx = p.dashDx * tune.dashSpeed;
      vy = p.dashDy * tune.dashSpeed;
      p.dashT = Math.max(0, p.dashT - dt);
      // 공중에 있는 동안 대시가 끝나지 않는다(활강): 착지할 때까지 속도를 유지
      if (p.dashT === 0 && p.airborne) p.dashT = dt;
    } else {
      const speed = tune.playerSpeed * (1 + p.boost * (p.boostT / tune.fallBoostTime));
      vx = mx * speed;
      vy = my * speed;
    }
    // 걸어서는 심연에 들어가지 않는다(작은 턱에서 잠깐 뜬 동안 포함). 대시만 심연 위를 건넌다
    this.moveBody(p, vx * dt, vy * dt, p.dashT > 0 ? 'air' : 'walk');

    // 수직
    const ground = this.terrain.heightAt(p.x, p.y);
    const g = p.dashT > 0 ? GRAVITY * tune.dashGravityScale : GRAVITY;
    const landed = this.verticalStep(p, ground, dt, g);
    if (landed !== null) this.onPlayerLand(landed);
    if (!p.airborne && !isAbyss(ground)) {
      const [cx, cy] = this.terrain.cellOf(p.x, p.y);
      if (!this.terrain.isCut(this.terrain.idx(cx, cy))) {
        p.safeX = p.x;
        p.safeY = p.y;
      }
    }
    if (p.z < -5) this.playerFellIntoAbyss();
  }

  private onPlayerLand(levels: number): void {
    const p = this.player;
    if (levels >= 0.5) {
      p.boost = Math.min(tune.fallBoostMax, p.boost + tune.fallBoostPerLevel * Math.round(levels));
      p.boostT = tune.fallBoostTime;
    }
    this.events.push({ type: 'land', x: p.x, y: p.y, z: p.z, levels, who: 'player' });
    if (levels >= 1.5) {
      // 2단 이상 낙하 착지 = 충격파. 대시로 뛰어내렸으면 대시 쿨다운 반환
      this.stats.shocks++;
      this.events.push({ type: 'shock', x: p.x, y: p.y, z: p.z, radius: tune.shockRadius });
      for (const e of this.enemies) {
        if (e.state === 'dead') continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > tune.shockRadius) continue;
        this.stun(e, tune.shockStun);
        const k = d < 0.01 ? 1 : 1 / d;
        e.knockX = dx * k * tune.shockKnock;
        e.knockY = dy * k * tune.shockKnock;
        e.knockT = ENEMY.knockTime;
      }
      if (p.dashed) p.dashCool = 0;
    }
    p.dashed = false;
  }

  private playerFellIntoAbyss(): void {
    const p = this.player;
    this.events.push({ type: 'fallAbyss', x: p.x, y: p.y, who: 'player' });
    p.x = p.safeX;
    p.y = p.safeY;
    // 안전 지점이 그 사이 무너졌으면 가장 가까운 단단한 칸으로
    if (isAbyss(this.terrain.heightAt(p.x, p.y))) this.relocateToSolid(p);
    p.z = this.terrain.heightAt(p.x, p.y);
    p.vz = 0;
    p.airborne = false;
    p.dashT = 0;
    this.damagePlayer(p.x, p.y, PLAYER.respawnInv, true);
  }

  private relocateToSolid(b: Body): void {
    const t = this.terrain;
    const [cx, cy] = t.cellOf(b.x, b.y);
    for (let r = 1; r < Math.max(GRID_W, GRID_H); r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const h = t.get(cx + dx, cy + dy);
          if (h >= 0 && h < 50 && !t.isCut(t.idx(cx + dx, cy + dy))) {
            b.x = cellCenter(cx + dx);
            b.y = cellCenter(cy + dy);
            return;
          }
        }
  }

  private damagePlayer(x: number, y: number, inv: number, ignoreInv = false): void {
    const p = this.player;
    if (!ignoreInv && p.inv > 0) return;
    p.hp -= 1;
    p.inv = inv;
    p.hurtT = 0.25;
    this.stats.hurt++;
    this.events.push({ type: 'hurt', x, y });
    if (p.hp <= 0) {
      p.hp = 0;
      this.mode = 'over';
    }
  }

  private slash(aimX: number, aimY: number): void {
    const p = this.player;
    let dx = aimX - p.x;
    let dy = aimY - p.y;
    const dl = Math.hypot(dx, dy);
    if (dl < 0.01) {
      dx = p.facingX;
      dy = p.facingY;
    } else {
      dx /= dl;
      dy /= dl;
    }
    p.facingX = dx;
    p.facingY = dy;
    // 칼날은 발밑에서 시작한다(절벽에 붙어 서도 바로 앞 등고선을 벤다)
    const x0 = p.x;
    const y0 = p.y;
    const x1 = p.x + dx * tune.bladeLen;
    const y1 = p.y + dy * tune.bladeLen;
    // 지형 절단이 먼저: 발밑이 무너진 적은 밀려나지 않고 그대로 떨어진다
    const res = this.terrain.cut(x0, y0, x1, y1, this.time, tune.cutDrop, tune.cutRadius, tune.restoreSec);
    const collapsed = new Set(res.cells);
    this.stats.cuts++;
    this.stats.cellsCollapsed += res.cells.length;
    let hitSomething = res.cells.length > 0;
    this.events.push({
      type: 'slash', x0, y0, x1, y1, z: p.z,
      crossings: res.crossings.map((c) => ({ x: c.x, y: c.y, level: c.level })),
      cells: res.cells,
    });

    // 칼날 직접 타격(약함): 1 피해 + 밀치기. 밀려 떨어지면 낙하 판정
    for (const e of this.enemies) {
      if (e.state === 'dead') continue;
      if (distToSegment(e.x, e.y, x0, y0, x1, y1) > tune.bladeHitWidth) continue;
      e.hp -= 1;
      e.flash = 0.12;
      const [ecx, ecy] = this.terrain.cellOf(e.x, e.y);
      if (!collapsed.has(this.terrain.idx(ecx, ecy))) {
        e.knockX = dx * ENEMY.bladeKnock;
        e.knockY = dy * ENEMY.bladeKnock;
        e.knockT = ENEMY.knockTime;
      }
      this.events.push({ type: 'hit', x: e.x, y: e.y, z: e.z });
      hitSomething = true;
      if (e.hp <= 0) this.kill(e, 'blade');
      else this.stun(e, ENEMY.bladeStun);
    }
    if (hitSomething) this.hitstop = tune.hitstop;
  }

  // ── 적 ─────────────────────────────────────────────────

  private updateFlow(): void {
    const [cx, cy] = this.terrain.cellOf(this.player.x, this.player.y);
    const key = `${cx},${cy},${this.terrain.version}`;
    if (key === this.flowKey) return;
    this.flowKey = key;
    this.flow = buildFlowField(this.terrain, cx, cy);
  }

  private stun(e: Enemy, sec: number): void {
    if (e.state === 'dead') return;
    const remaining = e.state === 'stun' ? e.t : 0;
    e.state = 'stun';
    e.t = Math.max(remaining, sec);
  }

  private kill(e: Enemy, cause: KillCause): void {
    if (e.state === 'dead') return;
    e.state = 'dead';
    e.deadT = 0;
    e.deathCause = cause;
    this.stats.kills[cause]++;
    this.events.push({ type: 'kill', x: e.x, y: e.y, z: e.z, cause, kind: e.kind });
  }

  private updateEnemy(e: Enemy, dt: number): void {
    e.flash = Math.max(0, e.flash - dt);
    const t = this.terrain;
    const p = this.player;

    if (e.state === 'dead') {
      // 심연으로 떨어지는 중이면 계속 떨어진다
      if (e.deathCause === 'abyss') {
        e.vz -= GRAVITY * dt;
        e.z += e.vz * dt;
      }
      return;
    }

    // 밀려남·돌진은 걷기 규칙이 아닌 공중 규칙(절벽 아래로 떨어질 수 있음)
    if (e.knockT > 0) {
      e.knockT = Math.max(0, e.knockT - dt);
      this.moveBody(e, e.knockX * dt, e.knockY * dt, 'air');
    }

    const ground = enemyGround(t, e);
    const landed = this.verticalStep(e, ground, dt, GRAVITY);
    if (landed !== null) {
      this.events.push({ type: 'land', x: e.x, y: e.y, z: e.z, levels: landed, who: 'enemy' });
      if (landed >= 1.5) {
        e.hp -= Math.round(landed) - 1;
        e.flash = 0.12;
        if (e.hp <= 0) {
          this.kill(e, 'fall');
          return;
        }
        this.stun(e, ENEMY.fallStun);
      }
    }
    if (e.z < -1.5 && isAbyss(ground)) {
      this.events.push({ type: 'fallAbyss', x: e.x, y: e.y, who: 'enemy' });
      this.kill(e, 'abyss');
      return;
    }
    if (e.airborne) return;

    if (e.dormant > 0) {
      e.dormant -= dt;
      return;
    }

    e.t -= dt;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy);

    switch (e.state) {
      case 'spawn':
        if (e.t <= 0) e.state = 'walk';
        return;
      case 'stun':
        if (e.t <= 0) {
          e.state = e.kind === 'chaser' ? 'recover' : 'walk';
          e.t = 0.3;
        }
        return;
      case 'recover':
        if (e.t <= 0) e.state = 'walk';
        return;
      case 'windup':
        if (e.t <= 0) {
          if (e.kind === 'chaser') {
            e.state = 'lunge';
            e.t = ENEMY.chaser.lungeTime;
          } else {
            this.fireBolt(e);
            e.state = 'walk';
            e.cool = ENEMY.shooter.cooldown;
          }
        }
        return;
      case 'lunge': {
        // 돌진은 고정 방향. 절벽 끝에서 피하면 그대로 떨어진다
        this.moveBody(e, e.dirX * ENEMY.chaser.lungeSpeed * dt, e.dirY * ENEMY.chaser.lungeSpeed * dt, 'air');
        if (Math.hypot(p.x - e.x, p.y - e.y) < 7 && Math.abs(p.z - e.z) < 1.5) this.damagePlayer(e.x, e.y, PLAYER.hurtInv);
        if (e.t <= 0) {
          e.state = 'recover';
          e.t = ENEMY.chaser.recover;
        }
        return;
      }
      case 'walk':
        break;
    }

    if (this.mode !== 'play') return;
    e.cool -= dt;
    if (e.kind === 'chaser') {
      if (dist < ENEMY.chaser.lungeRange && Math.abs(p.z - e.z) < 1.5 && e.cool <= 0) {
        e.state = 'windup';
        e.t = ENEMY.chaser.windup;
        e.dirX = dx / (dist || 1);
        e.dirY = dy / (dist || 1);
        e.cool = 0.6;
        return;
      }
      this.walkToward(e, ENEMY.chaser.speed, dt);
    } else {
      if (dist < ENEMY.shooter.range && e.cool <= 0) {
        e.state = 'windup';
        e.t = ENEMY.shooter.windup;
        e.aimX = p.x;
        e.aimY = p.y;
        return;
      }
      if (dist > ENEMY.shooter.range * 0.8) this.walkToward(e, ENEMY.shooter.speed, dt);
    }
  }

  private walkToward(e: Enemy, speed: number, dt: number): void {
    const t = this.terrain;
    const p = this.player;
    const [cx, cy] = t.cellOf(e.x, e.y);
    const here = t.inBounds(cx, cy) ? this.flow[t.idx(cx, cy)] : -1;
    let tx: number;
    let ty: number;
    if (here > 0 && here <= 2) {
      tx = p.x;
      ty = p.y;
    } else {
      const n = nextCell(t, this.flow, cx, cy);
      if (n >= 0) {
        tx = cellCenter(n % t.w);
        ty = cellCenter(Math.floor(n / t.w));
      } else {
        // 길이 없다(갇힘·절벽 너머): 플레이어 쪽으로 밀어붙이지만 걷기 규칙에 막힌다
        tx = p.x;
        ty = p.y;
      }
    }
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return;
    e.dirX = dx / d;
    e.dirY = dy / d;
    this.moveBody(e, e.dirX * speed * dt, e.dirY * speed * dt, 'enemyWalk');
  }

  private fireBolt(e: Enemy): void {
    const dx = e.aimX - e.x;
    const dy = e.aimY - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const s = ENEMY.shooter.boltSpeed;
    // 탄의 높이 = 쏜 적의 고도 + 0.5. 그보다 높은 지형에 닿으면 막힌다
    this.bolts.push({ x: e.x, y: e.y, vx: (dx / d) * s, vy: (dy / d) * s, alt: e.z + 0.5, life: ENEMY.shooter.boltLife });
    this.events.push({ type: 'fire', x: e.x, y: e.y, z: e.z });
  }

  private separateEnemies(): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.state === 'dead' || b.state === 'dead' || a.airborne || b.airborne) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= 6 || d < 0.001) continue;
        const push = (6 - d) / 2;
        this.moveBody(a, (-dx / d) * push, (-dy / d) * push, 'enemyWalk');
        this.moveBody(b, (dx / d) * push, (dy / d) * push, 'enemyWalk');
      }
  }

  private updateBolts(dt: number): void {
    const t = this.terrain;
    const p = this.player;
    const keep: Bolt[] = [];
    for (const b of this.bolts) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const h = t.heightAt(b.x, b.y);
      if (b.life <= 0) continue;
      if (h > 50 || h > b.alt) {
        this.stats.boltsBlocked++;
        this.events.push({ type: 'boltBlocked', x: b.x, y: b.y, z: Math.min(b.alt, 6) });
        continue;
      }
      if (Math.hypot(p.x - b.x, p.y - b.y) < 5 && p.z <= b.alt + 0.5 && p.inv === 0) {
        this.damagePlayer(b.x, b.y, PLAYER.hurtInv);
        continue;
      }
      keep.push(b);
    }
    this.bolts = keep;
  }

  private updateWaves(dt: number): void {
    const alive = this.enemies.some((e) => e.state !== 'dead');
    if (alive) return;
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    this.stats.wave++;
    const n = this.stats.wave;
    this.events.push({ type: 'wave', wave: n });
    const chasers = 2 + n;
    const shooters = Math.floor((n + 1) / 2);
    for (let k = 0; k < chasers + shooters; k++) {
      const pos = this.findSpawn();
      this.spawnEnemy(k < chasers ? 'chaser' : 'shooter', pos.x, pos.y, 0, true);
    }
    this.waveTimer = 2.5;
  }

  private findSpawn(): { x: number; y: number } {
    const t = this.terrain;
    const p = this.player;
    for (let tries = 0; tries < 200; tries++) {
      const cx = randInt(this.rng, 1, GRID_W - 2);
      const cy = randInt(this.rng, 1, GRID_H - 2);
      const x = cellCenter(cx);
      const y = cellCenter(cy);
      const h = t.get(cx, cy);
      if (isAbyss(h) || t.isCut(t.idx(cx, cy))) continue;
      if (Math.hypot(x - p.x, y - p.y) < 110) continue;
      return { x, y };
    }
    return { x: CELL * 2, y: CELL * 2 };
  }

  // ── 공통 물리 ──────────────────────────────────────────

  /**
   * 축별 이동과 지형 판정.
   * walk: 플레이어 걷기 — 2단 이상 오르막·심연 막힘, 내리막 허용.
   * enemyWalk: 적 걷기 — 오르막·내리막 모두 1단까지, 심연 막힘.
   * air: 대시·밀려남·돌진 — 2단 이상 오르막만 막힘. 심연·낭떠러지 위로 나갈 수 있다.
   */
  private moveBody(b: Body, dx: number, dy: number, mode: 'walk' | 'enemyWalk' | 'air'): void {
    const t = this.terrain;
    const tryMove = (nx: number, ny: number): boolean => {
      // 지도 가장자리 여백: 그림이 화면 밖으로 잘리지 않게
      if (nx < EDGE || nx > GRID_W * CELL - EDGE || ny < EDGE || ny > GRID_H * CELL - EDGE) return false;
      const from = b.airborne ? b.z : t.heightAt(b.x, b.y);
      const to = t.heightAt(nx, ny);
      const kind = stepKind(from, to);
      if (kind === 'blocked') return false;
      // 떠 있는 몸은 자기보다 높은 지형 속으로 들어가지 못한다(떨어지는 중에 절벽 위로 되돌아가지 않음)
      if (b.airborne && to < 50 && to - b.z > 0.5) return false;
      if (mode === 'walk' && kind === 'abyss') return false;
      if (mode === 'enemyWalk' && (kind === 'abyss' || (kind === 'drop' && from - to > 1.5))) return false;
      b.x = nx;
      b.y = ny;
      return true;
    };
    if (dx !== 0) tryMove(b.x + dx, b.y);
    if (dy !== 0) tryMove(b.x, b.y + dy);
  }

  /** 수직 이동. 착지하면 낙차(단계)를 반환, 아니면 null. */
  private verticalStep(b: Body, ground: number, dt: number, g: number): number | null {
    const floor = isAbyss(ground) ? -Infinity : ground;
    if (!b.airborne) {
      if (b.z > floor + 0.01) {
        b.airborne = true;
        b.peakZ = b.z;
        b.vz = 0;
      } else {
        // 지형이 솟아오르면 함께 올라간다(복구)
        b.z = floor;
        return null;
      }
    }
    b.vz -= g * dt;
    b.z += b.vz * dt;
    if (b.z <= floor) {
      b.z = floor;
      b.vz = 0;
      b.airborne = false;
      return b.peakZ - floor;
    }
    return null;
  }

  isOver(): boolean {
    return this.mode === 'over';
  }

  snapshot() {
    const p = this.player;
    return {
      mode: this.mode,
      time: this.time,
      scenario: this.setup.name,
      player: { x: p.x, y: p.y, z: p.z, hp: p.hp, airborne: p.airborne, dashing: p.dashT > 0, inv: p.inv, boost: p.boost },
      enemies: this.enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, hp: e.hp, state: e.state, airborne: e.airborne, cause: e.deathCause ?? null })),
      bolts: this.bolts.length,
      stats: structuredClone(this.stats),
    };
  }
}

export function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const l2 = vx * vx + vy * vy;
  let t = l2 === 0 ? 0 : ((px - x0) * vx + (py - y0) * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + vx * t), py - (y0 + vy * t));
}
