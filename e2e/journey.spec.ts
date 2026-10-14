import { expect, test, type Page } from '@playwright/test';
import { aim, canvasStats, cellC, cutAt, hudGeometry, openGame, shot, snap, walkPath, walkTo } from './helpers';

// 첫 여정: 시작 → 구역 1 → 구역 2 → 구역 3 → 최종 클리어. 모든 행동은 실제 키보드·마우스 입력이다.
// 이동은 상태를 관찰하며 키를 누르고 떼는 폐회로(walkTo), 디버그 핸들은 관찰·좌표 변환에만 쓴다.

const journey = (page: Page) => snap(page).then((s) => s.journey);

/** 진행 표시(예: "고지대의 적 2/4")의 앞 숫자 */
const progress = async (page: Page) => Number(/(\d+)\//.exec((await journey(page)).label)?.[1] ?? 0);

async function clearZone1(page: Page): Promise<void> {
  // 메사(사격형) → 서·중·동 대지(돌진형). 서는 자리에서 고지대 한가운데를 조준해 벤다
  const targets: { path: [number, number][]; aim: [number, number] }[] = [
    { path: [[40, 27]], aim: [40, 21] },
    { path: [[18, 27], [18, 19]], aim: [18, 12] },
    { path: [[18, 16], [40, 16]], aim: [40, 9] },
    { path: [[62, 16], [62, 19]], aim: [62, 12] },
  ];
  for (const tg of targets) {
    await walkPath(page, tg.path);
    const before = await progress(page);
    await cutAt(page, cellC(tg.aim[0]), cellC(tg.aim[1]));
    await expect.poll(() => progress(page), { timeout: 4000, message: `고지대 ${tg.aim} 처치` }).toBeGreaterThan(before);
  }
}

async function clearZone2(page: Page): Promise<number> {
  // 동쪽으로 걸으며 대시(활강). 쓰러지면 R로 이 구역을 다시(최대 3번)
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.keyboard.down('KeyD');
    const t0 = Date.now();
    while (Date.now() - t0 < 25_000) {
      const s = await snap(page);
      if (s.journey.phase !== 'play' || s.mode !== 'play') break;
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
    }
    await page.keyboard.up('KeyD');
    const s = await snap(page);
    if (s.journey.phase === 'zoneClear') return attempt;
    expect(s.mode, '돌파 실패는 게임 오버뿐이어야 한다').toBe('over');
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await snap(page)).mode).toBe('play');
  }
  throw new Error('구역 2를 3번 안에 돌파하지 못함');
}

async function clearZone3(page: Page): Promise<void> {
  const hills: { path: [number, number][]; c: [number, number] }[] = [
    { path: [[26, 30], [26, 20]], c: [16, 20] },
    { path: [[50, 20], [50, 12]], c: [40, 12] },
    { path: [[74, 12], [74, 22]], c: [64, 22] },
  ];
  for (const h of hills) {
    await walkPath(page, h.path);
    const before = (await snap(page)).stats.airHits;
    // ① 바깥 고리를 베어 꼭대기를 구덩이로
    await cutAt(page, cellC(h.c[0]), cellC(h.c[1]));
    // ② 심연 가장자리까지 다가간다(걸음이 멈춘다)
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyA');
    await aim(page, (await snap(page)).player.x - 15, (await snap(page)).player.y + 20); // 조준은 빈 땅에
    // ③ 환원으로 이 언덕의 적이 떠오르면 보이는 몸통 위치를 얻는다
    const target = await page.evaluate(
      ([hx, hy]) =>
        new Promise<{ x: number; y: number } | null>((resolve) => {
          const r = (document.getElementById('game') as HTMLCanvasElement).getBoundingClientRect();
          const t0 = performance.now();
          const tick = () => {
            const s = window.__cc.snapshot();
            const e = s.enemies.find((en) => en.state === 'launched' && en.z > 5 && Math.hypot(en.x - hx, en.y - hy) < 30);
            if (e) {
              const f = window.__cc.project(e.x, e.y, e.z);
              return resolve({ x: f.x, y: f.y - (6 * r.height) / 270 });
            }
            if (performance.now() - t0 > 12_000) return resolve(null);
            requestAnimationFrame(tick);
          };
          tick();
        }),
      [cellC(h.c[0]), cellC(h.c[1])] as const,
    );
    expect(target, `언덕 ${h.c}의 적이 환원으로 떠오른다`).not.toBeNull();
    // ④ 보이는 자리로 다시 조준해 공중 추가타
    await page.mouse.move(target!.x, target!.y);
    await page.waitForTimeout(30);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await snap(page)).stats.airHits + ((await journey(page)).phase === 'complete' ? 99 : 0), { message: '공중 추가타' }).toBeGreaterThan(before);
  }
}

test('첫 여정 완주: 타이틀 → 구역 1 균열 지대 → 구역 2 접힘 협곡 → 구역 3 환원 구역 → 최종 클리어 → R로 처음부터', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openGame(page);
  let j = await journey(page);
  expect(j).toMatchObject({ mode: 'journey', zone: 1, zoneId: 'rift', phase: 'play' });
  await expect(page.getByTestId('zone-banner')).toContainText('구역 1 — 균열 지대');
  await expect(page.getByTestId('hud-goal')).toContainText('고지대의 적 0/4');
  await expect(page.getByTestId('hud-wave')).toContainText('구역 1/3');
  expect(await hudGeometry(page)).toEqual([]);
  await shot(page, '13-journey-zone1');

  // 구역 1
  await clearZone1(page);
  await expect(page.getByTestId('zone-clear')).toBeVisible();
  await expect(page.getByTestId('zone-clear')).toContainText('구역 1 돌파');
  const s1 = await snap(page);
  expect(s1.stats.kills.fall + s1.stats.kills.abyss, '구역 1은 지형으로 처치').toBe(4);
  await shot(page, '14-journey-zone1-clear');
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
  expect(s.enemies.length).toBe(5);
  await expect(page.getByTestId('hud-goal')).toContainText('출구 표지');
  await page.waitForTimeout(400);
  await shot(page, '15-journey-zone2');
  const attempts = await clearZone2(page);
  await expect(page.getByTestId('zone-clear')).toContainText('구역 2 돌파');
  await page.keyboard.press('Enter');

  // 구역 3
  j = await journey(page);
  expect(j).toMatchObject({ zone: 3, zoneId: 'restore', phase: 'play', label: '공중 추가타 0/3' });
  s = await snap(page);
  expect(s.player.hp).toBe(5);
  expect(s.bolts.length).toBe(0);
  await clearZone3(page);

  // 최종 클리어
  await expect(page.getByTestId('journey-clear')).toBeVisible();
  await expect(page.getByTestId('journey-clear')).toContainText('첫 여정 완료');
  expect((await journey(page)).phase).toBe('complete');
  const cs = await canvasStats(page);
  expect(cs.colors).toBeGreaterThan(8);
  await shot(page, '16-journey-complete');

  // R = 여정 처음부터
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('journey-clear')).toBeHidden();
  j = await journey(page);
  expect(j).toMatchObject({ zone: 1, zoneId: 'rift', phase: 'play', label: '고지대의 적 0/4' });
  expect((await snap(page)).player.hp).toBe(5);
  test.info().annotations.push({ type: '구역 2 시도 횟수', description: String(attempts) });
  expect(errors).toEqual([]);
});

test('첫 여정 게임 오버: 쓰러지면 "R 이 구역 다시 시도" → 같은 구역 처음 상태로', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await openGame(page);
  // 메사 사격형 아래에 서서 맞는다
  await walkTo(page, cellC(40), cellC(27));
  await expect.poll(async () => (await snap(page)).mode, { timeout: 30_000, message: '게임 오버' }).toBe('over');
  await expect(page.getByTestId('over')).toContainText('R 이 구역 다시 시도');
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('over')).toBeHidden();
  const s = await snap(page);
  expect(s.mode).toBe('play');
  expect(s.journey).toMatchObject({ zone: 1, phase: 'play', label: '고지대의 적 0/4' });
  expect(s.player.hp).toBe(5);
  expect(s.enemies.filter((e) => e.state !== 'dead').length).toBe(4);
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
