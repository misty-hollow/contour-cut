import './style.css';
import { Sfx } from './audio';
import { FIXED_DT, LEVEL_PX, ORIGIN_Y, PLAYER, VIEW_H, VIEW_W, tune, type Tune } from './config';
import { Controls } from './input';
import { DEFAULT_SEED, SCENARIOS } from './maps';
import { Renderer } from './render';
import { emptyInput, World, type GameEvent } from './world';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const scenarioParam = params.get('scenario');
const scenario = scenarioParam && (SCENARIOS as readonly string[]).includes(scenarioParam) ? scenarioParam : null;
let seed = Number(params.get('seed') ?? DEFAULT_SEED) || DEFAULT_SEED;

const canvas = $<HTMLCanvasElement>('game');
const stage = $('stage');
const renderer = new Renderer(canvas);
const controls = new Controls(canvas);
controls.toView = (x, y) => renderer.screenToView(x, y);

// 접근성: 운영체제에서 '동작 줄이기'를 켠 사용자는 화면 흔들림·줌 연출을 끈 채로 시작한다
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  tune.shake = 0;
  tune.zoomFx = 0;
}
const sfx = new Sfx();
const input = emptyInput();

let world = new World(scenario, seed);
let started = false;
let paused = false;
let acc = 0;
let last = performance.now();

// ── 화면 크기: 정수 배율 우선 ─────────────────────────────
function layout(): void {
  const s = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  const scale = s >= 1 ? Math.floor(s) : s;
  stage.style.width = `${VIEW_W * scale}px`;
  stage.style.height = `${VIEW_H * scale}px`;
  stage.style.setProperty('--s', String(scale));
  renderer.resize(Math.ceil(scale * (window.devicePixelRatio || 1)));
}
window.addEventListener('resize', layout);
layout();

// ── 오버레이 ──────────────────────────────────────────
const title = $('title');
const help = $('help');
const tunePanel = $('tune');
const pauseEl = $('pause');
const over = $('over');
if (scenario) $('scenario-note').textContent = `실험 시나리오: ${scenario} (웨이브 없음)`;

function start(): void {
  sfx.unlock();
  started = true;
  title.classList.add('hidden');
  last = performance.now();
}
$('start').addEventListener('click', start);

function restart(newSeed?: number): void {
  if (newSeed !== undefined) seed = newSeed;
  world = new World(scenario, seed);
  over.classList.add('hidden');
  feed.length = 0;
  controls.clear();
  acc = 0;
}

function setPaused(v: boolean): void {
  if (!started || world.mode !== 'play') v = false;
  paused = v;
  pauseEl.classList.toggle('hidden', !paused);
}

controls.onKey = (code) => {
  if (!started) {
    if (code === 'Enter') start();
    return;
  }
  if (code === 'KeyR') restart();
  else if (code === 'KeyN' && !scenario) restart(seed + 1);
  else if (code === 'KeyP' || code === 'Escape') setPaused(!paused);
  else if (code === 'KeyH') help.classList.toggle('hidden');
  else if (code === 'KeyT') tunePanel.classList.toggle('hidden');
  else if (code === 'KeyM') sfx.muted = !sfx.muted;
};
window.addEventListener('blur', () => setPaused(true));

// ── 튜닝 패널: 사용자가 손맛을 직접 비교할 수 있게 ────────────
const TUNE_ROWS: [keyof Tune, string, number, number, number][] = [
  ['cutDrop', '침하 낙차(단)', 1, 5, 1],
  ['cutRadius', '침하 반경(칸)', 2, 12, 1],
  ['restoreSec', '환원 시간(초)', 2, 20, 1],
  ['restoreLaunch', '환원 튕김 세기', 0, 25, 1],
  ['airHitDamage', '공중 추가타 피해', 1, 3, 1],
  ['bladeLen', '칼날 길이(px)', 18, 80, 2],
  ['cutCooldown', '절단 쿨다운(초)', 0.1, 1, 0.02],
  ['playerSpeed', '이동 속도', 40, 130, 5],
  ['dashSpeed', '대시 속도', 120, 400, 10],
  ['fallBoostPerLevel', '낙차 가속/단', 0, 1, 0.05],
  ['shockRadius', '충격파 반경(px)', 8, 60, 2],
  ['hitstop', '타격 멈춤(초)', 0, 0.15, 0.01],
  ['hitstopStrong', '강한 타격 멈춤(초)', 0, 0.06, 0.005],
  ['shake', '화면 흔들림 배율', 0, 2, 0.1],
  ['zoomFx', '카메라 줌 배율', 0, 2, 0.1],
];
const defaults = { ...tune };
function buildTunePanel(): void {
  tunePanel.innerHTML = '<h3>튜닝 (실행 중 즉시 반영, 새로고침하면 기본값)</h3>';
  // 접근성: 화면 흔들림·카메라 줌을 한 번에 끄기
  const calm = document.createElement('label');
  calm.className = 'calm';
  const calmBox = document.createElement('input');
  calmBox.type = 'checkbox';
  calmBox.dataset.testid = 'reduce-motion';
  calmBox.checked = tune.shake === 0 && tune.zoomFx === 0;
  calmBox.addEventListener('change', () => {
    tune.shake = calmBox.checked ? 0 : defaults.shake || 1;
    tune.zoomFx = calmBox.checked ? 0 : defaults.zoomFx || 1;
    buildTunePanel();
  });
  calm.append(calmBox, document.createTextNode(' 연출 줄이기 (화면 흔들림·줌 끄기)'));
  tunePanel.append(calm);
  for (const [key, label, min, max, step] of TUNE_ROWS) {
    const row = document.createElement('label');
    const out = document.createElement('span');
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(tune[key]);
    out.textContent = String(tune[key]);
    inp.addEventListener('input', () => {
      tune[key] = Number(inp.value);
      out.textContent = inp.value;
      syncHelp();
    });
    row.append(label, inp, out);
    tunePanel.append(row);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '기본값';
  reset.addEventListener('click', () => {
    Object.assign(tune, defaults);
    buildTunePanel();
    syncHelp();
  });
  tunePanel.append(reset);
}
buildTunePanel();

function syncHelp(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-tune]')) {
    const k = el.dataset.tune as keyof Tune;
    el.textContent = String(tune[k]);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-tune-abyss]')) el.textContent = String(Math.max(0, tune.cutDrop - 1));
}
syncHelp();

// ── HUD ────────────────────────────────────────────────
const feed: { text: string; t: number }[] = [];
const feedEl = $('feed');
function pushFeed(text: string): void {
  feed.unshift({ text, t: 1.6 });
  feed.length = Math.min(feed.length, 3);
}

function updateHud(dt: number): void {
  const p = world.player;
  $('hud-hp').innerHTML = Array.from({ length: PLAYER.hp }, (_, i) => `<span class="${i < p.hp ? '' : 'lost'}">◆</span>`).join('');
  $('hud-wave').textContent = world.setup.waves ? `WAVE ${world.stats.wave}` : `실험: ${world.setup.name}`;
  const k = world.stats.kills;
  $('k-terrain').textContent = String(k.fall + k.abyss);
  $('k-air').textContent = String(k.air);
  $('k-blade').textContent = String(k.blade);
  $('k-launch').textContent = String(world.stats.launches);
  $('k-fall').textContent = String(k.fall);
  $('k-abyss').textContent = String(k.abyss);
  $('k-shock').textContent = String(world.stats.shocks);
  $('cool-cut').style.width = `${100 * (1 - p.cutCool / tune.cutCooldown)}%`;
  $('cool-dash').style.width = `${100 * (1 - p.dashCool / tune.dashCooldown)}%`;
  for (const f of feed) f.t -= dt;
  while (feed.length && feed[feed.length - 1].t <= 0) feed.pop();
  feedEl.innerHTML = feed.map((f) => `<div style="opacity:${Math.min(1, f.t * 2)}">${f.text}</div>`).join('');
}

const CAUSE_TEXT = { fall: '낙하 처치', abyss: '절대 심연 추락', blade: '칼날 처치', air: '공중 처치' } as const;

function handleEvents(events: GameEvent[]): void {
  // 한 번의 환원으로 여러 적이 떠도 알림은 하나
  if (events.some((e) => e.type === 'launch')) {
    sfx.launch();
    pushFeed('지형 환원 — 에어본');
  }
  for (const ev of events) {
    switch (ev.type) {
      case 'slash':
        sfx.slash();
        if (ev.cells.length) sfx.collapse(ev.cells.length);
        break;
      case 'hit':
        sfx.hit();
        break;
      case 'airHit':
        sfx.airHit();
        pushFeed('공중 추가타');
        break;
      case 'kill':
        if (ev.cause === 'abyss') sfx.fall();
        else sfx.kill();
        pushFeed(CAUSE_TEXT[ev.cause]);
        break;
      case 'shock':
        sfx.shock();
        pushFeed('충격파');
        break;
      case 'hurt':
        sfx.hurt();
        break;
      case 'fallAbyss':
        if (ev.who === 'player') pushFeed('절대 심연에 빠짐 −1');
        break;
      case 'dash':
        sfx.dash();
        break;
      case 'fire':
        sfx.fire();
        break;
      case 'boltBlocked':
        sfx.blocked();
        break;
      case 'wave':
        pushFeed(`WAVE ${ev.wave}`);
        break;
      default:
        break;
    }
  }
}

function showOver(): void {
  const s = world.stats;
  const terrain = s.kills.fall + s.kills.abyss;
  $('over-stats').innerHTML =
    `${world.setup.waves ? `WAVE ${s.wave} · ` : ''}지형 처치 ${terrain} (낙하 ${s.kills.fall} · 절대 심연 ${s.kills.abyss}) · 공중 처치 ${s.kills.air} · 칼날 처치 ${s.kills.blade}<br>` +
    `측량 절단 ${s.cuts}회 · 침하시킨 칸 ${s.cellsCollapsed} · 지형 환원 에어본 ${s.launches} · 공중 추가타 ${s.airHits} · 충격파 ${s.shocks} · 막아 낸 탄 ${s.boltsBlocked}`;
  over.classList.remove('hidden');
}

// ── 루프 ───────────────────────────────────────────────
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (started && !paused && world.mode === 'play') {
    controls.fill(input, world.player, world.enemies);
    acc += dt;
    let n = 0;
    while (acc >= FIXED_DT && n < 6) {
      world.step(FIXED_DT, input);
      acc -= FIXED_DT;
      n++;
    }
    if (n === 6) acc = 0;
    if (world.isOver()) showOver();
  } else if (started) {
    // 정지 중에도 조준은 갱신
    controls.fill(input, world.player, world.enemies);
    input.cut = input.dash = input.dashToAim = false;
  }
  const events = world.events;
  world.events = [];
  renderer.consume(events, world);
  handleEvents(events);
  renderer.draw(world, dt, started && controls.mouse ? { x: input.aimX, y: input.aimY, cursor: controls.cursorView, target: controls.target } : null);
  updateHud(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── 관찰용 디버그 핸들(읽기 전용, CLAUDE.md B절) ─────────────
declare global {
  interface Window {
    __cc: {
      snapshot: () => ReturnType<World['snapshot']> & { started: boolean; paused: boolean; tune: Tune };
      /** 카메라 상태(줌·흔들림) 관찰 */
      camera: () => { zoom: number; shakeX: number; shakeY: number };
      /** 조준이 잡힌 적 id(없으면 null) */
      aimTarget: () => number | null;
      /** 평면 좌표(px)·고도 → 브라우저 화면 좌표. 고도를 생략하면 그 지점의 지형 높이 */
      project: (x: number, y: number, z?: number) => { x: number; y: number };
      heightAt: (cx: number, cy: number) => number;
      shownAt: (cx: number, cy: number) => number;
    };
  }
}
window.__cc = {
  snapshot: () => ({ ...world.snapshot(), started, paused, tune: { ...tune } }),
  camera: () => ({ zoom: renderer.cam.zoom, shakeX: renderer.cam.shakeX, shakeY: renderer.cam.shakeY }),
  aimTarget: () => controls.target?.id ?? null,
  project: (x, y, z) => {
    const r = canvas.getBoundingClientRect();
    const lv = z ?? Math.max(0, world.terrain.heightAt(x, y));
    // 카메라 줌까지 적용한 화면 위치(흔들림 제외 — 입력 쪽도 흔들림을 빼고 읽는다)
    const s = renderer.viewToScreen(x, y + ORIGIN_Y - lv * LEVEL_PX);
    return { x: r.left + (s.x / VIEW_W) * r.width, y: r.top + (s.y / VIEW_H) * r.height };
  },
  heightAt: (cx, cy) => world.terrain.get(cx, cy),
  shownAt: (cx, cy) => world.terrain.shown[world.terrain.idx(cx, cy)],
};
