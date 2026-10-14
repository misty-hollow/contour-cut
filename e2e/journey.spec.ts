import { expect, test, type Page } from '@playwright/test';
import { canvasStats, cellC, cutAt, heightAt, hudGeometry, openGame, shot, snap, walkPath, walkTo } from './helpers';

// 첫 여정: 시작 → 구역 1 → 구역 2 → 구역 3 → 최종 클리어. 모든 행동은 실제 키보드·마우스 입력이다.
// 이동은 상태를 관찰하며 키를 누르고 떼는 폐회로(walkTo), 디버그 핸들은 관찰·좌표 변환에만 쓴다.

const journey = (page: Page) => snap(page).then((s) => s.journey);


/** 살아 있는(소환 연출이 끝난) 적 */
const liveEnemies = async (page: Page) => (await snap(page)).enemies.filter((e) => e.state !== 'dead' && e.state !== 'spawn');

async function zone1Once(page: Page): Promise<boolean> {
  // 측량 1 — 첫 측량: 출발 자리에서 앞 대지를 벤다
  await expect(page.getByTestId('hint')).toContainText('칼은 닿지 않는다');
  await cutAt(page, cellC(40), cellC(25));
  await expect.poll(async () => (await journey(page)).label, { message: '측량 2 준비' }).toContain('측량 2/3');
  await shot(page, '13-zone1-beat2-ready');
  // 측량 2 — 포대: 적이 나타나기를 기다렸다가 메사 남쪽 → 서쪽 대지 남쪽
  await expect.poll(async () => (await liveEnemies(page)).length, { timeout: 6000, message: '포대 적 등장' }).toBe(2);
  await walkPath(page, [[56, 34], [56, 26]]);
  await cutAt(page, cellC(56), cellC(19));
  await expect.poll(async () => (await snap(page)).enemies.filter((e) => e.kind === 'shooter' && e.state !== 'dead').length, { timeout: 4000, message: '메사 사격형 낙하' }).toBe(0);
  await walkPath(page, [[56, 34], [22, 34], [22, 25]]);
  await cutAt(page, cellC(22), cellC(18));
  await expect.poll(async () => (await journey(page)).label, { timeout: 5000, message: '측량 3 준비' }).toContain('측량 3/3');
  // 측량 3 — 균열 고리: 안내 표지가 있는 고리 안으로 들어가면 적이 나타난다
  await expect(page.getByTestId('hint')).toContainText('고리 안으로');
  await walkPath(page, [[30, 25], [30, 11], [40, 11]]);
  await expect.poll(async () => (await journey(page)).beat, { timeout: 4000, message: '고리 안에서 측량 3 시작' }).toBe(3);
  await shot(page, '14-zone1-ring');
  // 고리 위에 올라선 적(또는 칼날 길이 안의 적)의 발밑을 벤다
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    const s = await snap(page);
    if (s.journey.phase !== 'play') return s.journey.phase === 'zoneClear';
    if (s.mode !== 'play') return false;
    const p = s.player;
    const ready = s.enemies.filter((e) => e.state !== 'dead' && e.state !== 'spawn' && !e.airborne);
    const d = (e: { x: number; y: number }) => Math.hypot(e.x - p.x, e.y - p.y);
    const target = ready.sort((a, b) => d(a) - d(b)).find((e) => {
      const r = Math.hypot(e.x - cellC(40), e.y - cellC(11)) / 6;
      return (r >= 3.5 && r <= 6 && d(e) < 44) || d(e) < 30;
    });
    if (target) {
      await cutAt(page, target.x, target.y);
      await page.waitForTimeout(400);
    } else await page.waitForTimeout(60);
  }
  return false;
}

async function clearZone1(page: Page): Promise<number> {
  // 쓰러지면 R로 구역 1을 처음부터(최대 3번)
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await zone1Once(page)) return attempt;
    expect((await snap(page)).mode, '구역 1 실패는 게임 오버뿐이어야 한다').toBe('over');
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await snap(page)).mode).toBe('play');
    await walkTo(page, cellC(40), cellC(34));
  }
  throw new Error('구역 1을 3번 안에 정리하지 못함');
}

/** 누르고 있는 이동 키(겹치지 않게 바꿔 쥔다) */
class Keys {
  private held: string[] = [];
  constructor(private readonly page: Page) {}
  async hold(keys: string[]): Promise<void> {
    for (const k of this.held) if (!keys.includes(k)) await this.page.keyboard.up(k);
    for (const k of keys) if (!this.held.includes(k)) await this.page.keyboard.down(k);
    this.held = keys;
  }
  /** 목표 지점(평면 px) 쪽 키를 쥔다. 가까우면 놓는다 */
  async toward(p: { x: number; y: number }, x: number, y: number): Promise<void> {
    const keys: string[] = [];
    if (x - p.x > 3) keys.push('KeyD');
    else if (x - p.x < -3) keys.push('KeyA');
    if (y - p.y > 3) keys.push('KeyS');
    else if (y - p.y < -3) keys.push('KeyW');
    await this.hold(keys);
  }
}

/** 화면에 그려진 적의 몸통(발끝 6px 위)을 실제 마우스로 클릭한다 — 공중에 뜬 적 조준 */
async function clickVisible(page: Page, e: { x: number; y: number; z: number }): Promise<void> {
  const pt = await page.evaluate(([x, y, z]) => {
    const r = (document.getElementById('game') as HTMLCanvasElement).getBoundingClientRect();
    const f = window.__cc.project(x, y, z);
    return { x: f.x, y: f.y - (6 * r.height) / 270 };
  }, [e.x, e.y, e.z] as const);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(20);
  await page.mouse.down();
  await page.mouse.up();
}

/** 출구 표지 쪽으로 걸어 구역 돌파 화면이 뜰 때까지(표지 반경에 들어서면 시뮬레이션이 멈춘다) */
async function walkIntoExit(page: Page): Promise<void> {
  const keys = new Keys(page);
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < 9000) {
      const s = await snap(page);
      if (s.journey.phase !== 'play') return;
      await keys.toward(s.player, cellC(75), cellC(27));
      await page.waitForTimeout(25);
    }
  } finally {
    await keys.hold([]);
  }
  throw new Error('출구 표지에 닿지 못함');
}

/** 대시가 끝나고 착지할 때까지 */
async function landed(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const p = (await snap(page)).player;
        return !p.airborne && !p.dashing;
      },
      { timeout: 4000, message: '착지' },
    )
    .toBe(true);
}

/** 동쪽으로 대시(D를 누른 채 Space) */
async function dashEast(page: Page): Promise<void> {
  await page.keyboard.down('KeyD');
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  await page.keyboard.up('KeyD');
  await landed(page);
}

/** 구역 2 — 도약대 경로: 단애에서 활강 → 회랑 → 계단으로 도약대 → 균열 위 활강 → 출구 */
async function zone2Glide(page: Page): Promise<boolean> {
  await walkTo(page, cellC(11), cellC(20));
  await dashEast(page);
  const s1 = await snap(page);
  if (s1.mode !== 'play') return false;
  expect(s1.player.x / 6, '단애에서 대시하면 협곡 바닥을 넘어 활강').toBeGreaterThan(24);
  expect(s1.stats.shocks, '착지 충격파').toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('hud-goal')).toContainText('구간 2/3 사격 회랑');
  await walkPath(page, [[44, 20], [54, 20]]);
  expect((await snap(page)).player.z, '도약대 위').toBe(4);
  await expect(page.getByTestId('hud-goal')).toContainText('구간 3/3 심연 균열');
  await shot(page, '17-zone2-ledge');
  await dashEast(page);
  const s2 = await snap(page);
  if (s2.mode !== 'play') return false;
  expect(s2.player.x / 6, '균열을 활강으로 건넜다').toBeGreaterThan(65);
  await walkIntoExit(page);
  expect((await journey(page)).phase, '출구 도달').toBe('zoneClear');
  return true;
}

async function clearZone2(page: Page): Promise<number> {
  // 쓰러지거나 경로가 막히면 R로 이 구역을 다시(최대 3번)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (await zone2Glide(page)) return attempt;
    } catch (err) {
      if (attempt === 3) throw err;
    }
    if ((await snap(page)).journey.phase === 'zoneClear') return attempt;
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await snap(page)).time).toBeLessThan(1);
  }
  throw new Error('구역 2를 3번 안에 돌파하지 못함');
}

/** 칸 (cx, cy)가 원래 표고보다 내려앉았는가(절단이 실제로 지형을 무너뜨렸는지 관찰) */
async function sunk(page: Page, cx: number, cy: number): Promise<boolean> {
  // 절단 직후 몇 프레임 안에 내려앉는지 본다(벤 칸의 남쪽 가장자리 근처)
  for (let k = 0; k < 6; k++) {
    await page.waitForTimeout(50);
    if ((await heightAt(page, cx, cy)) < 4) return true;
  }
  return false;
}

/** 구역 3 언덕·환원대 좌표(칸) — src/journey.ts ZONE3_HILLS·ZONE3_TABLES와 같다. from = 언덕을 벨 때 서는 자리 */
const Z3 = {
  hills: [
    { cx: 40, cy: 9, from: [40, 17] },
    { cx: 12, cy: 12, from: [21, 12] },
    { cx: 68, cy: 12, from: [59, 12] },
  ],
  table: { cx: 40, cy: 24 },
};

interface Zone3Run {
  result: 'clear' | 'over' | 'timeout';
  /** 마지막으로 본 상태 한 줄(정체 진단용 — 실패 메시지에 싣는다) */
  last: string;
  /** 단계가 바뀔 때마다 본 HUD 기하 문제 */
  hud: string[];
  /** 환원대를 벤 뒤 그 환원으로 띄운 적 수 */
  tableLaunches: number;
  /** 가두기 단계의 공중 추가타 */
  pitAirHits: number;
}

/**
 * 구역 3 자동 조작(실제 입력). 우선순위: ① 칼날 거리 안의 무방비(공중) 적에게 공중 추가타 ② 가까운 돌진형을 칼날로
 * ③ 단계별 지형 계획 — 가두기: 북쪽 언덕을 베어 감시자를 가두고 구덩이 가장자리에서 환원을 기다린다 /
 * 환원대: 돌진형이 다가오면 가운데 환원대를 베고 그 위에서 버틴다 / 사격형이 있으면 그 언덕을 베어 떨어뜨린다.
 */
async function zone3Bot(page: Page, timeoutMs: number, review: boolean): Promise<Zone3Run> {
  const tune = (await snap(page)).tune;
  const keys = new Keys(page);
  let lastCut = -1;
  let hillCut = false;
  let tableCut = -1;
  let launchesAtTableCut = 0;
  let lastTrace = -1;
  const run: Zone3Run = { result: 'timeout', last: '', hud: [], tableLaunches: 0, pitAirHits: 0 };
  let seenBeat = '';
  let beat2At = -1;
  let beat3At = -1;
  const shots = new Set<string>();
  const shotOnce = async (name: string) => {
    if (!review || shots.has(name)) return;
    shots.add(name);
    await shot(page, name);
  };
  const cutOk = (t: number) => t - lastCut > 0.42;
  let lastDash = -1;
  // 막힘 감지: 갈 곳이 있는데 0.8초(게임 시간) 동안 거의 못 움직였으면 0.7초 동안 옆으로 비켜 돌아간다(환원대·언덕을 돌아가기)
  let anchor = { x: 0, y: 0, t: -1 };
  let detourUntil = -1;
  let detourKey = 'KeyA';
  const near = (p: { x: number; y: number }, cx: number, cy: number) => Math.abs(p.x - cellC(cx)) < 5 && Math.abs(p.y - cellC(cy)) < 5;
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < timeoutMs) {
      const s = await snap(page);
      if (s.journey.phase === 'complete') return { ...run, result: 'clear' };
      if (s.mode === 'over') return { ...run, result: 'over' };
      const p = s.player;
      const live = s.enemies.filter((e) => e.state !== 'dead' && e.state !== 'spawn');
      const dist = (e: { x: number; y: number }) => Math.hypot(e.x - p.x, e.y - p.y);
      const byDist = (a: { x: number; y: number }, b: { x: number; y: number }) => dist(a) - dist(b);
      const beat = s.journey.beat;
      run.last = `${s.time.toFixed(1)} b${beat}${s.journey.pending ? 'p' : ''} P(${(p.x / 6).toFixed(1)},${(p.y / 6).toFixed(1)},z${p.z.toFixed(1)}) hp${p.hp} L${s.stats.launches} A${s.stats.airHits} hint「${s.journey.hint}」 | ${s.enemies.filter((e) => e.state !== 'dead').map((e) => `${e.kind[0]}${(e.x / 6).toFixed(0)},${(e.y / 6).toFixed(0)}z${e.z.toFixed(0)}h${e.hp}${e.state.slice(0, 3)}${e.exposed ? '!' : ''}`).join(' ')}`;
      if (process.env.BOT_TRACE && s.time - lastTrace > 0.5) {
        lastTrace = s.time;
        console.log(run.last);
      }
      if (beat === 1) run.pitAirHits = s.stats.airHits;
      // 직접 검토용 스크린샷: 환원대 단계 6초 뒤(적이 가운데로 모여드는 때), 대환원 시작 2초 뒤
      if (beat === 2 && beat2At < 0) beat2At = s.time;
      if (beat === 2 && s.time - beat2At > 6) await shotOnce('20-zone3-table');
      if (beat === 3 && beat3At < 0) beat3At = s.time;
      if (beat === 3 && s.time - beat3At > 2) await shotOnce('21-zone3-climax');
      // 단계·준비가 바뀔 때마다 그 힌트로 HUD 기하를 본다
      const beatKey = `${beat}${s.journey.pending}`;
      if (beatKey !== seenBeat) {
        seenBeat = beatKey;
        run.hud.push(...(await hudGeometry(page)).map((h) => `${beatKey}: ${h}`));
      }
      if (beat === 2 && tableCut > 0 && s.time - tableCut < 9) run.tableLaunches = s.stats.launches - launchesAtTableCut;
      // ① 공중 추가타
      const air = live.filter((e) => e.exposed && dist(e) < 40).sort(byDist)[0];
      if (air && cutOk(s.time)) {
        await keys.hold([]);
        await clickVisible(page, air);
        lastCut = s.time;
        continue;
      }
      // ⓪ 회피: 같은 높이의 돌진형이 가까이서 돌진을 준비하는데 칼날로 끊을 수 없으면(재사용 대기·끌어들이는 중) 반대쪽으로 대시(무적)
      const luringNow = beat === 2 && tableCut > 0 && s.time - tableCut < tune.restoreSec + 0.3;
      const winding = live.find((e) => e.kind === 'chaser' && e.state === 'windup' && Math.abs(e.z - p.z) < 1.5 && dist(e) < 30);
      if (winding && s.time - lastDash > 0.6 && (luringNow || !cutOk(s.time))) {
        await keys.toward(p, 2 * p.x - winding.x, 2 * p.y - winding.y);
        await page.keyboard.press('Space');
        lastDash = s.time;
        continue;
      }
      // ② 칼날 거리 안의 적(높이와 무관 — 높은 곳에 올라선 적은 칼날이 그 땅째 벤다). 단, 가두기 구덩이 안의 감시자는
      //    환원까지 두고(심연 너머로 베면 내 발밑이 무너진다), 베어 낸 환원대 위에서 적을 끌어들이는 동안은 밀쳐 내지 않는다(체력이 넉넉할 때)
      const h1 = Z3.hills[0];
      const inPit = (e: { x: number; y: number }) => beat === 1 && hillCut && Math.hypot(e.x - cellC(h1.cx), e.y - cellC(h1.cy)) < 30;
      const luring = luringNow && p.hp > 3;
      const chaser = live
        .filter((e) => !e.airborne && dist(e) < (Math.abs(e.z - p.z) < 1.5 ? 34 : 40) && !inPit(e) && !(luring && e.kind === 'chaser'))
        .sort(byDist)[0];
      if (chaser && cutOk(s.time)) {
        await keys.hold([]);
        await cutAt(page, chaser.x, chaser.y);
        lastCut = s.time;
        continue;
      }
      // ③ 단계별 지형 계획
      let goal: [number, number] = [40, 32];
      const sentries = live.some((e) => Math.hypot(e.x - cellC(h1.cx), e.y - cellC(h1.cy)) < 30);
      const shooter = live.filter((e) => e.kind === 'shooter' && e.z >= 3).sort(byDist)[0];
      const shooterHill = shooter && Z3.hills.find((h) => Math.hypot(shooter.x - cellC(h.cx), shooter.y - cellC(h.cy)) < 20);
      if (beat === 1 && !hillCut && sentries) {
        // 가운데 환원대를 서쪽으로 돌아 북쪽 언덕 남쪽으로
        if (p.y > cellC(21)) goal = Math.abs(p.x - cellC(33)) < 6 ? [33, 18] : [33, 30];
        else goal = [h1.from[0], h1.from[1]];
        if (near(p, h1.from[0], h1.from[1]) && cutOk(s.time)) {
          await keys.hold([]);
          await cutAt(page, cellC(h1.cx), cellC(h1.cy));
          lastCut = s.time;
          hillCut = await sunk(page, h1.cx, h1.cy);
          continue;
        }
      } else if (beat === 1 && sentries) {
        goal = [40, 13]; // 구덩이 가장자리(심연 앞에서 걸음이 멈춘다)
      } else if (beat === 2 && tableCut < 0 && live.some((e) => e.kind === 'chaser')) {
        goal = [Z3.table.cx, Z3.table.cy + 5];
        const closest = Math.min(...live.filter((e) => e.kind === 'chaser').map((e) => Math.hypot(e.x - cellC(Z3.table.cx), e.y - cellC(Z3.table.cy))));
        // 앞서 싸우다 칼날이 환원대를 벤 적이 있으면(재절단) 환원될 때까지 기다렸다가 온전한 환원대를 벤다
        const intact = (await heightAt(page, Z3.table.cx, Z3.table.cy + 2)) === 4;
        if (intact && near(p, goal[0], goal[1]) && closest < 70 && cutOk(s.time)) {
          await keys.hold([]);
          await cutAt(page, cellC(Z3.table.cx), cellC(Z3.table.cy));
          lastCut = s.time;
          // 실제로 내려앉았는지 지형을 보고 확인한다(아니면 다음 틱에 다시 벤다)
          if (await sunk(page, Z3.table.cx, Z3.table.cy)) {
            tableCut = s.time;
            launchesAtTableCut = s.stats.launches;
          }
          continue;
        }
      } else if (beat === 2 && tableCut > 0 && s.time - tableCut < tune.restoreSec + 0.3 && live.some((e) => e.kind === 'chaser')) {
        goal = [Z3.table.cx, Z3.table.cy]; // 베어 낸 환원대 한가운데에서 버틴다
      } else if (shooterHill) {
        // 사격형이 서 있는 언덕을 베어 떨어뜨린다
        goal = [shooterHill.from[0], shooterHill.from[1]];
        if (near(p, goal[0], goal[1]) && cutOk(s.time)) {
          await keys.hold([]);
          await cutAt(page, cellC(shooterHill.cx), cellC(shooterHill.cy));
          lastCut = s.time;
          continue;
        }
      } else {
        // 남은 적(내려온 사격형 포함)에게 다가간다
        const target = live.slice().sort(byDist)[0];
        if (target) goal = [target.x / 6 - 0.5, target.y / 6 - 0.5];
      }
      const far = Math.hypot(cellC(goal[0]) - p.x, cellC(goal[1]) - p.y) > 10;
      if (!far || Math.hypot(p.x - anchor.x, p.y - anchor.y) > 3) anchor = { x: p.x, y: p.y, t: s.time };
      else if (s.time - anchor.t > 0.8 && s.time > detourUntil) {
        detourUntil = s.time + 0.7;
        detourKey = detourKey === 'KeyA' ? 'KeyD' : 'KeyA';
        anchor = { x: p.x, y: p.y, t: s.time + 0.7 };
      }
      if (s.time < detourUntil) await keys.hold([detourKey]);
      else await keys.toward(p, cellC(goal[0]), cellC(goal[1]));
      await page.waitForTimeout(30);
    }
    return run;
  } finally {
    await keys.hold([]);
  }
}

async function clearZone3(page: Page, review = false): Promise<Zone3Run & { attempts: number }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await zone3Bot(page, 150_000, review);
    if (r.result === 'clear') return { ...r, attempts: attempt };
    expect(r.result, `구역 3 실패는 게임 오버뿐이어야 한다 — 마지막 상태 ${r.last}`).toBe('over');
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await snap(page)).mode).toBe('play');
  }
  throw new Error('구역 3을 3번 안에 정리하지 못함');
}

test('첫 여정 완주: 타이틀 → 구역 1 균열 지대 → 구역 2 접힘 협곡 → 구역 3 환원 구역 → 최종 클리어 → R로 처음부터', async ({ page }) => {
  test.setTimeout(480_000);
  const errors = await openGame(page);
  let j = await journey(page);
  expect(j).toMatchObject({ mode: 'journey', zone: 1, zoneId: 'rift', phase: 'play', beat: 1 });
  await expect(page.getByTestId('zone-banner')).toContainText('구역 1 — 균열 지대');
  await expect(page.getByTestId('hud-goal')).toContainText('측량 1/3 첫 측량 · 적 0/1');
  await expect(page.getByTestId('hud-wave')).toContainText('구역 1/3');
  await expect(page.getByTestId('hint')).toBeVisible();
  expect(await hudGeometry(page)).toEqual([]);
  await shot(page, '12-journey-zone1');

  // 구역 1: 세 번의 측량
  const z1attempts = await clearZone1(page);
  await expect(page.getByTestId('zone-clear')).toBeVisible();
  await expect(page.getByTestId('zone-clear')).toContainText('구역 1 돌파');
  await expect(page.getByTestId('zone-clear-grade')).toContainText(/측량 평가 [SAB]/);
  await expect(page.getByTestId('zone-clear')).toContainText('다음: 구역 2 — 접힘 협곡 · 고도차를 타고 돌파');
  await expect(page.getByTestId('hint')).toBeHidden();
  const s1 = await snap(page);
  expect(s1.stats.kills.fall + s1.stats.kills.abyss + s1.stats.kills.air, '구역 1은 대부분 지형으로 처치').toBeGreaterThanOrEqual(5);
  await shot(page, '15-journey-zone1-clear');
  // 클리어 화면 동안 시뮬레이션은 멈춘다
  const t1 = s1.time;
  await page.waitForTimeout(300);
  expect((await snap(page)).time).toBe(t1);
  await page.keyboard.press('Enter');

  // 구역 2: 새 지형·적·체력
  j = await journey(page);
  expect(j).toMatchObject({ zone: 2, zoneId: 'canyon', phase: 'play' });
  let s = await snap(page);
  expect(s.player.hp).toBe(5);
  expect(s.time).toBeLessThan(0.5);
  expect(s.stats.cuts).toBe(0);
  expect(s.enemies.length).toBe(9);
  await expect(page.getByTestId('hud-goal')).toContainText('출구까지 돌파 · 구간 1/3 단애');
  await expect(page.getByTestId('hint')).toContainText('활강');
  expect(await hudGeometry(page)).toEqual([]);
  await page.waitForTimeout(2600); // 구역 배너가 사라진 뒤의 전장
  await shot(page, '16-zone2-start');
  const attempts = await clearZone2(page);
  await expect(page.getByTestId('zone-clear')).toContainText('구역 2 돌파');
  await expect(page.getByTestId('zone-clear')).toContainText('다음: 구역 3 — 환원 구역 · 시간차 지형 조작과 콤보');
  const s2 = await snap(page);
  expect(s2.enemies.filter((e) => e.state !== 'dead').length, '구역 2는 적을 다 잡지 않아도 돌파').toBeGreaterThan(0);
  await page.keyboard.press('Enter');

  // 구역 3: 세 번의 환원
  j = await journey(page);
  expect(j).toMatchObject({ zone: 3, zoneId: 'restore', phase: 'play', beat: 1, label: '환원 1/3 가두기 · 적 0/3' });
  s = await snap(page);
  expect(s.player.hp).toBe(5);
  expect(s.bolts.length).toBe(0);
  await expect(page.getByTestId('hint')).toContainText('구덩이');
  expect(await hudGeometry(page)).toEqual([]);
  await page.waitForTimeout(2600);
  await shot(page, '18-zone3-start');
  const z3 = await clearZone3(page, true);
  expect(z3.hud, '단계마다 HUD 기하').toEqual([]);

  // 최종 클리어
  await expect(page.getByTestId('journey-clear')).toBeVisible();
  await expect(page.getByTestId('journey-clear')).toContainText('첫 여정 완료');
  expect((await journey(page)).phase).toBe('complete');
  const cs = await canvasStats(page);
  expect(cs.colors).toBeGreaterThan(8);
  await expect(page.getByTestId('journey-clear')).toContainText('환원 구역: 에어본');
  await shot(page, '19-journey-complete');

  // R = 여정 처음부터
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('journey-clear')).toBeHidden();
  j = await journey(page);
  expect(j).toMatchObject({ zone: 1, zoneId: 'rift', phase: 'play', beat: 1, label: '측량 1/3 첫 측량 · 적 0/1' });
  expect((await snap(page)).player.hp).toBe(5);
  test.info().annotations.push({ type: '구역 1·2·3 시도 횟수', description: `${z1attempts}·${attempts}·${z3.attempts}` });
  test.info().annotations.push({ type: '구역 3 콤보', description: `가두기 공중 추가타 ${z3.pitAirHits} · 환원대 에어본 ${z3.tableLaunches}` });
  expect(errors).toEqual([]);
});

test('리뷰 재현: 다음 단계 출현 지점 바로 옆에서 기다리면 "물러나라" 안내 → 청록 표지(출발점)로 가면 다음 단계 시작(구역 1 측량 2)', async ({ page }) => {
  const errors = await openGame(page);
  // 측량 1을 대지 서쪽에서 정리하고, 곧장 측량 2 서쪽 대지 출현 지점 바로 아래(4칸)로 간다
  await walkTo(page, cellC(31), cellC(25));
  await cutAt(page, cellC(40), cellC(25));
  await walkTo(page, cellC(22), cellC(23));
  // 대지(표고 2) 남쪽 절벽에 막힐 때까지 W — 출현 지점(22,18)에서 4칸 안
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  expect(Math.hypot((await snap(page)).player.y - cellC(18), (await snap(page)).player.x - cellC(22))).toBeLessThanOrEqual(24);
  await expect.poll(async () => (await journey(page)).label, { timeout: 6000, message: '측량 2 준비' }).toBe('측량 2/3 포대 · 준비');
  await expect(page.getByTestId('hint')).toContainText('물러나면 다음 단계가 시작된다', { timeout: 4000 });
  expect(await hudGeometry(page)).toEqual([]);
  // 서 있는 동안에는 시작하지 않는다
  await page.waitForTimeout(1500);
  expect((await journey(page)).beat).toBe(1);
  await shot(page, '22-step-back');
  // 안내대로 출발점 쪽으로 물러나면 시작
  await walkTo(page, cellC(40), cellC(34));
  await expect.poll(async () => (await journey(page)).beat, { timeout: 3000, message: '측량 2 시작' }).toBe(2);
  await expect(page.getByTestId('hint')).not.toContainText('물러나');
  expect(errors).toEqual([]);
});

test('구역 2 다리 경로: 단애를 걸어 내려가 충격파 → 회랑 → 남쪽 다리를 걸어 건너 광장으로 내려서며 충격파 → 출구', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 800, height: 600 }); // 배율 1(가장 좁은 힌트 줄)
  const errors = await openGame(page, undefined, { zone: 2 });
  await page.waitForTimeout(2600);
  expect(await hudGeometry(page), '구간 1 힌트').toEqual([]);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // 단애 끝에서 걸어 내려간다(대시 없이)
      await walkTo(page, cellC(14), cellC(20));
      await landed(page);
      const s1 = await snap(page);
      expect(s1.player.z).toBe(0);
      expect(s1.stats.shocks, '4단 낙하 착지 충격파').toBe(1);
      await walkTo(page, cellC(30), cellC(20));
      await expect(page.getByTestId('hud-goal')).toContainText('구간 2/3 사격 회랑');
      expect(await hudGeometry(page), '구간 2 힌트').toEqual([]);
      await walkPath(page, [[44, 29], [52, 29], [52, 33]]);
      await expect(page.getByTestId('hud-goal')).toContainText('구간 3/3 심연 균열');
      await expect(page.getByTestId('hint')).toContainText('다리');
      expect(await hudGeometry(page), '구간 3 힌트').toEqual([]);
      await walkTo(page, cellC(67), cellC(33.5));
      await landed(page);
      const s2 = await snap(page);
      expect(s2.player.z, '다리(표고 3)에서 광장(1)으로 내려섰다').toBe(1);
      expect(s2.stats.shocks, '다리 끝 2단 낙하 충격파').toBe(s1.stats.shocks + 1);
      await walkIntoExit(page);
      expect((await journey(page)).phase).toBe('zoneClear');
      break;
    } catch (err) {
      if (attempt === 3 || (await snap(page)).mode !== 'over') throw err;
      await page.keyboard.press('KeyR');
      await expect.poll(async () => (await snap(page)).time).toBeLessThan(1);
    }
  }
  expect(errors).toEqual([]);
});

test('구역 3 단독: 가두기 → 환원대 → 대환원을 실제 입력으로 정리하고, 환원 에어본·공중 추가타가 실제로 일어난다', async ({ page }) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 800, height: 600 }); // 배율 1(가장 좁은 힌트 줄)
  const errors = await openGame(page, undefined, { zone: 3 });
  const z3 = await clearZone3(page);
  expect(z3.hud, '단계마다 HUD 기하(힌트 한 줄·겹침 없음)').toEqual([]);
  await expect(page.getByTestId('journey-clear')).toBeVisible();
  const s = await snap(page);
  expect(s.stats.launches, '지형 환원 에어본').toBeGreaterThan(0);
  expect(s.stats.airHits, '공중 추가타').toBeGreaterThan(0);
  expect(z3.pitAirHits, '가두기: 구덩이에 가둔 감시자를 환원 순간 공중 추가타').toBeGreaterThan(0);
  test.info().annotations.push({ type: '구역 3', description: `시도 ${z3.attempts} · 가두기 공중 추가타 ${z3.pitAirHits} · 환원대 에어본 ${z3.tableLaunches} · 전체 에어본 ${s.stats.launches} · 공중 추가타 ${s.stats.airHits} · 공중 처치 ${s.stats.kills.air} · 칼날 처치 ${s.stats.kills.blade} · 지형 처치 ${s.stats.kills.fall + s.stats.kills.abyss} · 피해 ${s.stats.hurt} · ${Math.round(s.time)}초` });
  expect(errors).toEqual([]);
});

test('첫 여정 게임 오버: 쓰러지면 "R 이 구역 다시 시도" → 같은 구역 처음 상태로', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await openGame(page);
  // 측량 1을 끝내고, 측량 2의 메사 사격형 아래에 서서 맞는다
  await cutAt(page, cellC(40), cellC(25));
  await expect.poll(async () => (await liveEnemies(page)).length, { timeout: 8000, message: '포대 적 등장' }).toBe(2);
  await walkPath(page, [[56, 34], [56, 26]]);
  await expect.poll(async () => (await snap(page)).mode, { timeout: 40_000, message: '게임 오버' }).toBe('over');
  await expect(page.getByTestId('over')).toContainText('R 이 구역 다시 시도');
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('over')).toBeHidden();
  const s = await snap(page);
  expect(s.mode).toBe('play');
  expect(s.journey).toMatchObject({ zone: 1, phase: 'play', beat: 1, pending: false, label: '측량 1/3 첫 측량 · 적 0/1' });
  expect(s.player.hp).toBe(5);
  expect(s.enemies.filter((e) => e.state !== 'dead').length).toBe(1);
  expect(errors).toEqual([]);
});

test('첫 여정 도중 R: 진행 중인 구역을 처음 상태로 다시(구역 2부터 시작해 확인)', async ({ page }) => {
  const errors = await openGame(page, undefined, { zone: 2 });
  expect((await journey(page)).zone).toBe(2);
  const x0 = (await snap(page)).player.x;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyD');
  expect((await snap(page)).player.x).toBeGreaterThan(x0 + 20);
  await page.keyboard.press('KeyR');
  const s = await snap(page);
  expect(s.journey).toMatchObject({ zone: 2, phase: 'play' });
  expect(s.player.x).toBe(x0);
  expect(s.time).toBeLessThan(0.3);
  expect(errors).toEqual([]);
});

for (const raw of ['1.5', 'abc']) {
  test(`잘못된 구역 주소(?zone=${raw})에서도 타이틀이 뜨고 첫 여정(구역 1)·무한 웨이브 둘 다 시작된다`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`/?zone=${raw}`);
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('start')).toHaveText('첫 여정 시작');
    await page.getByTestId('start').click();
    await expect(page.getByTestId('title')).toBeHidden();
    expect((await journey(page))).toMatchObject({ mode: 'journey', zone: 1, phase: 'play' });
    await page.goto(`/?zone=${raw}`);
    await page.getByTestId('start-waves').click();
    await expect.poll(async () => (await snap(page)).stats.wave, { message: '웨이브 시작' }).toBeGreaterThanOrEqual(1);
    expect((await journey(page)).mode).toBe('waves');
    expect(errors).toEqual([]);
  });
}

