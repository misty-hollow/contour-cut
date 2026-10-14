import './style.css';
import { Sfx } from './audio';
import { FIXED_DT, LEVEL_PX, ORIGIN_Y, PLAYER, VIEW_H, VIEW_W, tune, type Tune } from './config';
import { Controls } from './input';
import { journeyTotals, newZoneState, parseZoneParam, surveyGrade, zoneResult, ZONES, zoneStatus, zoneTick, type ZoneResult } from './journey';
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
// 타이틀 동안에는 전투 HUD를 숨긴다(타이틀 뒤로 지도만 보이게)
document.body.classList.add('pre');
renderer.titleScan = true;
const input = emptyInput();

// 플레이 방식: 첫 여정(기본) · 무한 웨이브 · 실험 시나리오(?scenario=)
type PlayMode = 'journey' | 'waves' | 'scenario';
type Phase = 'play' | 'zoneClear' | 'complete';
let mode: PlayMode = scenario ? 'scenario' : 'journey';
const firstZone = parseZoneParam(params.get('zone'));
let zoneIndex = firstZone;
let phase: Phase = 'play';
/** 지금 구역의 진행 상태(구역 1 단계). 구역에 들어갈 때마다 새로 */
let zstate = newZoneState();
/** 구역별 결과. 같은 구역을 다시 깨면 덮어써서 최종 집계에 두 번 들어가지 않는다 */
let results: (ZoneResult | undefined)[] = [];

function makeWorld(): World {
  return mode === 'journey' ? new World(null, seed, ZONES[zoneIndex].build()) : new World(scenario, seed);
}

let world = makeWorld();
let started = false;
let paused = false;
let acc = 0;
let last = performance.now();

// ── 화면 크기: 기기 픽셀 기준 정수 배율 ───────────────────────
// 게임 1px = k 기기 픽셀(정수). CSS 크기는 480·k/DPR이라 Windows 배율 125%처럼 DPR이 정수가 아니어도
// 캔버스가 브라우저에서 다시 늘거나 줄지 않아 픽셀 폭이 고르다. 위치도 기기 픽셀 경계에 맞춘다(반 픽셀 어긋나면 흐려진다).
// HUD 단위 --s(게임 1px의 CSS px)도 k/DPR. DPR 1이면 이전(CSS 정수 배율)과 같다.
function layout(): void {
  const dpr = window.devicePixelRatio || 1;
  const devW = window.innerWidth * dpr;
  const devH = window.innerHeight * dpr;
  const k = Math.floor(Math.min(devW / VIEW_W, devH / VIEW_H));
  // 창이 480×270 기기 픽셀보다 작으면 정수 배율이 없다: 맞춰 줄이고 캔버스는 1배
  const css = k >= 1 ? k / dpr : Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  const shownK = Math.max(1, k);
  stage.style.width = `${VIEW_W * css}px`;
  stage.style.height = `${VIEW_H * css}px`;
  stage.style.left = `${Math.max(0, Math.floor((devW - VIEW_W * shownK) / 2)) / dpr}px`;
  stage.style.top = `${Math.max(0, Math.floor((devH - VIEW_H * shownK) / 2)) / dpr}px`;
  stage.style.setProperty('--s', String(css));
  // 캔버스 배율은 8 이하: 그보다 크면 k를 나누는 가장 큰 수로 그리고 브라우저가 정수배로 늘린다
  let ck = shownK;
  if (ck > 8) for (let d = 8; d >= 1; d--) if (shownK % d === 0) { ck = d; break; }
  renderer.resize(ck);
}
let dprQuery: MediaQueryList | null = null;
/** 모니터 이동·확대 비율 변경(DPR 변화)에도 다시 맞춘다 */
function watchDpr(): void {
  dprQuery?.removeEventListener('change', onDpr);
  dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
  dprQuery?.addEventListener('change', onDpr);
}
function onDpr(): void {
  layout();
  watchDpr();
}
window.addEventListener('resize', layout);
layout();
watchDpr();

// ── 오버레이 ──────────────────────────────────────────
const title = $('title');
const help = $('help');
const tunePanel = $('tune');
const pauseEl = $('pause');
const over = $('over');
const zoneClearEl = $('zone-clear');
const journeyClearEl = $('journey-clear');
const banner = $('zone-banner');
if (scenario) {
  $('scenario-note').textContent = `실험 시나리오: ${scenario} (웨이브 없음)`;
  $('start').textContent = '클릭하여 측량 시작';
  $('start-waves').classList.add('hidden');
} else if (firstZone > 0) {
  $('start').textContent = `첫 여정 — 구역 ${firstZone + 1}부터 시작`;
}

function start(asWaves = false): void {
  sfx.unlock();
  started = true;
  title.classList.add('hidden');
  document.body.classList.remove('pre');
  renderer.titleScan = false;
  if (asWaves) {
    mode = 'waves';
    world = makeWorld();
  } else if (mode === 'journey') {
    enterZone(zoneIndex);
  }
  // 측량 신호가 지도를 드러내며 시작(구역 진입·재시작과 같은 연출)
  renderer.resetFx();
  last = performance.now();
}
$('start').addEventListener('click', () => start());
$('start-waves').addEventListener('click', () => start(true));
$('next-zone').addEventListener('click', () => nextZone());

/** 구역 시작(또는 재도전): 지형·적·탄·타이머·연출을 모두 새로 만든다 */
function enterZone(i: number): void {
  zoneIndex = i;
  phase = 'play';
  zstate = newZoneState();
  world = makeWorld();
  resetTransient();
  zoneClearEl.classList.add('hidden');
  journeyClearEl.classList.add('hidden');
  const z = ZONES[i];
  banner.innerHTML = `<b>구역 ${i + 1} — ${z.name}</b><br>${z.goal}`;
  banner.classList.remove('hidden', 'fade');
  bannerT = 3;
}
let bannerT = 0;

function resetTransient(): void {
  over.classList.add('hidden');
  setPaused(false);
  feed.length = 0;
  controls.clear();
  renderer.resetFx();
  acc = 0;
}

function nextZone(): void {
  if (phase !== 'zoneClear') return;
  enterZone(zoneIndex + 1);
}

function onZoneClear(): void {
  const s = world.stats;
  results[zoneIndex] = zoneResult(world);
  const totals = journeyTotals(results);
  const z = ZONES[zoneIndex];
  sfx.clear();
  // 돌파 화면 뒤로 전투 알림이 비치지 않게
  feed.length = 0;
  if (zoneIndex === ZONES.length - 1) {
    phase = 'complete';
    $('journey-stats').innerHTML =
      `걸린 시간 ${Math.round(totals.time)}초 · 측량 절단 ${totals.cuts}회<br>` +
      `지형 처치 ${totals.terrainKills} · 공중 처치 ${totals.airKills} · 칼날 처치 ${totals.bladeKills} · 공중 추가타 ${totals.airHits}<br>` +
      `환원 구역: 에어본 ${s.launches} · 공중 추가타 ${s.airHits} · 공중 처치 ${s.kills.air} · 받은 피해 ${s.hurt}`;
    journeyClearEl.classList.remove('hidden');
  } else {
    phase = 'zoneClear';
    $('zone-clear-title').textContent = `구역 ${zoneIndex + 1} 돌파 — ${z.name}`;
    $('zone-clear-stats').textContent = `${Math.round(world.time)}초 · 측량 절단 ${s.cuts}회 · 지형 처치 ${s.kills.fall + s.kills.abyss} · 공중 추가타 ${s.airHits}`;
    if (z.graded) {
      const g = surveyGrade(results[zoneIndex]!);
      $('zone-clear-grade').innerHTML = `측량 평가 <b class="grade-${g.grade}">${g.grade}</b> — 지형으로 쓰러뜨림 ${g.terrain}/${g.total} · 받은 피해 ${results[zoneIndex]!.hurt}`;
    } else $('zone-clear-grade').textContent = '';
    $('zone-clear-next').textContent = `다음: 구역 ${zoneIndex + 2} — ${ZONES[zoneIndex + 1].name} · ${ZONES[zoneIndex + 1].theme}`;
    zoneClearEl.classList.remove('hidden');
  }
}

function restart(newSeed?: number): void {
  if (newSeed !== undefined) seed = newSeed;
  if (mode === 'journey') {
    // 여정 중 R = 이 구역 다시. 최종 클리어 뒤 R = 여정 처음부터
    if (phase === 'complete') {
      results = [];
      enterZone(0);
    } else enterZone(zoneIndex);
    return;
  }
  world = makeWorld();
  resetTransient();
}

function setPaused(v: boolean): void {
  if (!started || world.mode !== 'play' || phase !== 'play') v = false;
  paused = v;
  pauseEl.classList.toggle('hidden', !paused);
}

controls.onKey = (code) => {
  if (!started) {
    if (code === 'Enter') start();
    return;
  }
  if (code === 'Enter') nextZone();
  else if (code === 'KeyR') restart();
  else if (code === 'KeyN' && mode === 'waves') restart(seed + 1);
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
// 알림 줄의 색 = 원인(UI System 01): 지형 처치 오렌지 · 환원·공중 시안 · 플레이어 위험 레드 · 그 밖 잉크
type FeedTone = 'ink' | 'terrain' | 'air' | 'alert';
const feed: { text: string; t: number; tone: FeedTone }[] = [];
const hintEl = $('hint');
let hintSince = 0;
const feedEl = $('feed');
const zoneEl = $('hud-tl');
const waveEl = $('hud-tr');
const hpEl = $('hud-hp');
hpEl.innerHTML = '<span></span>'.repeat(PLAYER.hp);
const hpSegs = Array.from(hpEl.children) as HTMLElement[];
let pipsKey = '';
function pushFeed(text: string, tone: FeedTone = 'ink'): void {
  feed.unshift({ text, t: 1.6, tone });
  feed.length = Math.min(feed.length, 3);
}

/** 계기 한 줄: 준비(채움 100%·라벨 잉크·램프 점등) · 재충전(채움 비율, 옅게) · 사용 불가(정지·돌파 화면·게임 오버, 사선 해칭) */
function gauge(name: 'cut' | 'dash', frac: number, usable: boolean): void {
  const ready = usable && frac >= 1;
  const track = $(`track-${name}`);
  track.classList.toggle('off', !usable);
  track.classList.toggle('ready', ready);
  $(`cool-${name}`).style.width = `${100 * Math.max(0, Math.min(1, frac))}%`;
  $(`lamp-${name}`).classList.toggle('on', ready);
  $(`lbl-${name}`).classList.toggle('ready', ready);
}

function updateHud(dt: number): void {
  const p = world.player;
  const usable = started && !paused && world.mode === 'play' && phase === 'play';
  // 체력: 칸 블록. 체력 1 이하면 남은 칸·라벨 레드(점멸 없음), 피격 직후 잃은 칸은 잠깐 레드
  const crit = p.hp <= 1;
  hpEl.classList.toggle('crit', crit);
  $('lbl-hp').classList.toggle('crit', crit);
  hpSegs.forEach((seg, i) => {
    seg.classList.toggle('lost', i >= p.hp);
    seg.classList.toggle('fresh', i === p.hp && p.hurtT > 0);
  });
  gauge('cut', 1 - p.cutCool / tune.cutCooldown, usable);
  gauge('dash', 1 - p.dashCool / tune.dashCooldown, usable);
  if (mode === 'journey') {
    const z = ZONES[zoneIndex];
    const st = zoneStatus(z, world, zstate);
    zoneEl.classList.remove('hidden');
    waveEl.classList.add('hidden');
    $('hud-zone-tag').textContent = `Z${String(zoneIndex + 1).padStart(2, '0')}`;
    $('hud-zone-name').textContent = z.name;
    $('hud-zone-no').textContent = `${zoneIndex + 1}/${ZONES.length}`;
    $('hud-goal').textContent = st.goal;
    const count = $('hud-count');
    count.textContent = st.count;
    count.classList.toggle('done', st.countDone);
    // 진행 눈금: 끝난 단계 그린 · 지금 단계 시안 · 남은 단계 테두리만
    const key = `${st.pips.done}/${st.pips.total}`;
    if (key !== pipsKey) {
      pipsKey = key;
      $('hud-pips').innerHTML = Array.from({ length: st.pips.total }, (_, i) => `<span class="${i < st.pips.done ? 'done' : i === st.pips.done ? 'now' : ''}"></span>`).join('');
    }
    // 다음 단계가 자리를 요구하거나(트리거) 출현 지점에서 물러나야 하면 갈 곳에 안내 표지
    world.marker = st.marker ?? null;
    // 힌트는 바뀐 순간 또렷하게, 같은 문구가 8초 넘게 이어지면 옅어진다(피격하면 다시 또렷하게)
    if (hintEl.textContent !== st.hint || p.hurtT > 0) hintSince = world.time;
    hintEl.textContent = st.hint;
    hintEl.classList.toggle('quiet', world.time - hintSince > 8);
    hintEl.classList.toggle('hidden', !st.hint || phase !== 'play');
  } else {
    zoneEl.classList.add('hidden');
    waveEl.classList.remove('hidden');
    waveEl.textContent = world.setup.waves ? `WAVE ${world.stats.wave}` : `실험: ${world.setup.name}`;
    hintEl.classList.add('hidden');
  }
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT < 0.6) banner.classList.add('fade');
    if (bannerT <= 0) banner.classList.add('hidden');
  }
  for (const f of feed) f.t -= dt;
  while (feed.length && feed[feed.length - 1].t <= 0) feed.pop();
  feedEl.innerHTML = feed.map((f) => `<div class="${f.tone}" style="opacity:${Math.min(1, f.t * 2)}">${f.text}</div>`).join('');
}

const CAUSE_TEXT = { fall: '낙하 처치', abyss: '절대 심연 추락', blade: '칼날 처치', air: '공중 처치' } as const;
const CAUSE_TONE: Record<keyof typeof CAUSE_TEXT, FeedTone> = { fall: 'terrain', abyss: 'terrain', blade: 'ink', air: 'air' };

/** 환원 경고: 같은 시각에 돌아올 칸 묶음이 경고 시간에 들어서면 한 번 똑딱 */
const warned = new Set<number>();
let warnedWorld: World | null = null;
function restoreWarnTick(): void {
  // 구역 진입·재시작으로 세계가 바뀌면 시각이 0부터 다시 흐르므로 기록을 비운다
  if (warnedWorld !== world) {
    warned.clear();
    warnedWorld = world;
  }
  const t = world.terrain;
  const now = world.time;
  for (const k of warned) if (k < now * 1000) warned.delete(k);
  for (let i = 0; i < t.restoreAt.length; i++) {
    const at = t.restoreAt[i];
    if (at === Infinity || at - now > tune.restoreWarnSec) continue;
    const key = Math.round(at * 1000);
    if (warned.has(key)) continue;
    warned.add(key);
    sfx.warn();
  }
}

function handleEvents(events: GameEvent[]): void {
  // 한 번의 환원으로 여러 적이 떠도 알림은 하나
  if (events.some((e) => e.type === 'launch')) {
    sfx.launch();
    pushFeed('지형 환원 — 에어본', 'air');
  }
  for (const ev of events) {
    switch (ev.type) {
      case 'slash':
        sfx.slash(ev.crossings.reduce((m, c) => Math.max(m, c.level), -1));
        if (ev.cells.length) sfx.collapse(ev.cells.length);
        break;
      case 'hit':
        sfx.hit();
        break;
      case 'airHit':
        sfx.airHit();
        pushFeed('공중 추가타', 'air');
        break;
      case 'kill':
        if (ev.cause === 'abyss') sfx.fall();
        else sfx.kill();
        // 칼날 처치는 흔한 일이라 알리지 않는다. 지형·공중 처치만 알림 줄에
        if (ev.cause !== 'blade') pushFeed(CAUSE_TEXT[ev.cause], CAUSE_TONE[ev.cause]);
        break;
      case 'shock':
        // 충격파는 고리·흔들림·소리로 충분하다(알림 줄은 비워 둔다)
        sfx.shock();
        break;
      case 'hurt':
        sfx.hurt();
        break;
      case 'fallAbyss':
        if (ev.who === 'player') pushFeed('절대 심연에 빠짐 −1', 'alert');
        break;
      case 'restore':
        sfx.restore(ev.cells.length);
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
  // 결과는 두 줄: 무엇으로 쓰러뜨렸나(큰 글자) · 어떻게 싸웠나(작은 글자)
  $('over-stats').innerHTML =
    `<span class="big">${world.setup.waves ? `WAVE ${s.wave} · ` : ''}지형 처치 ${terrain} · 공중 처치 ${s.kills.air} · 칼날 처치 ${s.kills.blade}</span><br>` +
    `<span class="small">측량 절단 ${s.cuts}회 · 에어본 ${s.launches} · 공중 추가타 ${s.airHits} · 충격파 ${s.shocks}</span>`;
  $('over-note').innerHTML = `<b class="key">R</b> ${mode === 'journey' ? '이 구역 다시 시도' : mode === 'waves' ? '다시 시작 · N 새 지도' : '다시 시작'}`;
  over.classList.remove('hidden');
}

// ── 루프 ───────────────────────────────────────────────
function frame(now: number): void {
  // rAF 시각이 클릭 처리에서 잰 last보다 이를 수 있다(첫 프레임 dt < 0) — 0 아래로 내려가지 않게
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  if (started && !paused && world.mode === 'play' && phase === 'play') {
    controls.fill(input, world.player, world.enemies, world.terrain);
    acc += dt;
    let n = 0;
    while (acc >= FIXED_DT && n < 6) {
      world.step(FIXED_DT, input);
      acc -= FIXED_DT;
      n++;
      if (mode === 'journey' && !world.isOver()) {
        const z = ZONES[zoneIndex];
        const beat = zoneTick(z, world, zstate);
        if (beat !== null && z.beats) {
          pushFeed(`${z.beatWord ?? '측량'} ${beat + 1}/${z.beats.length} — ${z.beats[beat].name}`);
          sfx.beat();
        }
        if (zoneStatus(z, world, zstate).done) {
          onZoneClear();
          break;
        }
      }
    }
    if (n === 6) acc = 0;
    if (world.isOver()) showOver();
  } else if (started) {
    // 정지 중에도 조준은 갱신
    controls.fill(input, world.player, world.enemies, world.terrain);
    input.cut = input.dash = input.dashToAim = false;
  }
  const events = world.events;
  world.events = [];
  renderer.consume(events, world);
  handleEvents(events);
  if (started && world.mode === 'play') restoreWarnTick();
  renderer.draw(world, dt, started && controls.mouse ? { x: input.aimX, y: input.aimY, cursor: controls.cursorView, target: controls.target } : null);
  updateHud(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── 관찰용 디버그 핸들(읽기 전용, CLAUDE.md "프로젝트 고유 제약") ─────────────
declare global {
  interface Window {
    __cc: {
      snapshot: () => ReturnType<World['snapshot']> & {
        started: boolean;
        paused: boolean;
        tune: Tune;
        journey: { mode: PlayMode; zone: number; zoneId: string; phase: Phase; label: string; done: boolean; beat: number; pending: boolean; hint: string };
      };
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
  snapshot: () => {
    const z = ZONES[zoneIndex];
    const st = zoneStatus(z, world, zstate);
    return {
      ...world.snapshot(),
      started,
      paused,
      tune: { ...tune },
      journey: { mode, zone: zoneIndex + 1, zoneId: z.id, phase, label: st.label, done: st.done, beat: zstate.beat + 1, pending: zstate.pending, hint: st.hint },
    };
  },
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
