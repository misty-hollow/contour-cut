import { expect, test } from '@playwright/test';
import { aim, canvasStats, cellC, cutAt, heightAt, hudGeometry, openGame, shot, snap } from './helpers';

// 실행 검증 ①: 대표 플레이 경로. 모든 행동은 실제 키보드·마우스 입력이다.

test('기본 전장: 타이틀 → 클릭 시작 → WASD 이동 → 웨이브 → 화면·HUD 정상', async ({ page }) => {
  const errors = await openGame(page);
  const s0 = await snap(page);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  const s1 = await snap(page);
  expect(s1.player.x - s0.player.x, 'D키로 동쪽 이동').toBeGreaterThan(15);
  await expect.poll(async () => (await snap(page)).stats.wave, { message: '첫 웨이브' }).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await snap(page)).enemies.length).toBeGreaterThan(0);
  await aim(page, s1.player.x + 30, s1.player.y - 10);
  await page.waitForTimeout(300);
  const cs = await canvasStats(page);
  expect(cs.colors, '캔버스 색 수').toBeGreaterThan(12);
  expect(cs.variance, '캔버스 밝기 분산').toBeGreaterThan(20);
  expect(await hudGeometry(page)).toEqual([]);
  await expect(page.getByTestId('hud-wave')).toContainText('WAVE 1');
  await shot(page, '01-arena');
  expect(errors).toEqual([]);
});

test('HUD는 여러 창 크기에서 화면 안에 있고 겹치지 않는다', async ({ page }) => {
  await openGame(page);
  for (const [w, h] of [
    [1920, 1080],
    [1024, 768],
    [800, 600],
    [1366, 768],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(100);
    expect(await hudGeometry(page), `${w}x${h}`).toEqual([]);
  }
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('help')).toBeVisible();
  await shot(page, '02-help-1366');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('help')).toBeHidden();
});

test('등고선 절단: 메사 절벽을 베면 고지대가 내려앉고(시간 축), 복구 시간이 지나면 돌아온다', async ({ page }) => {
  const errors = await openGame(page, 'cut');
  expect(await heightAt(page, 46, 15)).toBe(4);
  await aim(page, cellC(47), cellC(15));
  await page.waitForTimeout(200);
  await shot(page, '03-cut-aim');
  // 붕괴 전·중·후의 그리기 높이를 프레임마다 기록한다
  const samples = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        const t0 = performance.now();
        const tick = () => {
          out.push(window.__cc.shownAt(46, 15));
          if (performance.now() - t0 < 600) requestAnimationFrame(tick);
          else resolve(out);
        };
        tick();
      }),
  );
  await page.mouse.down();
  await page.mouse.up();
  const shown = await samples;
  expect(await heightAt(page, 46, 15), '내려앉은 고도').toBe(1);
  expect(await heightAt(page, 52, 15), '반경 밖은 그대로').toBe(4);
  expect(shown[0]).toBe(4);
  expect(shown[shown.length - 1]).toBe(1);
  expect(shown.some((v) => v > 1 && v < 4), '중간 높이가 그려진다(순간이동이 아님)').toBe(true);
  for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeLessThanOrEqual(shown[i - 1]);
  const s = await snap(page);
  expect(s.stats.cuts).toBe(1);
  expect(s.stats.cellsCollapsed).toBeGreaterThan(20);
  await page.waitForTimeout(150);
  await shot(page, '04-cut-after');
  await expect.poll(() => heightAt(page, 46, 15), { timeout: (s.tune.restoreSec + 3) * 1000, message: '복구' }).toBe(4);
  expect(errors).toEqual([]);
});

test('적 낙하: 메사 위의 적은 땅째 떨어져 피해·기절, 계단 언덕의 적은 심연으로 추락해 처치', async ({ page }) => {
  const errors = await openGame(page, 'fall');
  await cutAt(page, cellC(47), cellC(15));
  await expect.poll(async () => (await snap(page)).enemies[0]?.state, { message: '기절' }).toBe('stun');
  const e = (await snap(page)).enemies[0];
  expect(e.hp, '3단 낙하 = 2 피해').toBe(1);
  expect(e.z).toBe(1);
  await shot(page, '05-fall-stun');

  await page.goto('/?scenario=abyss');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('title')).toBeHidden();
  await cutAt(page, cellC(18), cellC(29));
  await expect.poll(async () => (await snap(page)).stats.kills.abyss, { message: '심연 처치' }).toBe(1);
  await expect(page.locator('#k-abyss')).toHaveText('1');
  await expect(page.locator('#k-terrain')).toHaveText('1');
  await expect(page.getByTestId('feed')).toContainText('심연 추락');
  await shot(page, '06-abyss-kill');
  expect(errors).toEqual([]);
});

test('이동 방해: 언덕 바깥 고리를 베면 꼭대기의 적이 구덩이에 갇혀 다가오지 못한다', async ({ page }) => {
  const errors = await openGame(page, 'trap');
  await cutAt(page, cellC(18), cellC(26));
  await expect.poll(() => heightAt(page, 18, 26), { message: '꼭대기 붕괴' }).toBe(1);
  const hx = cellC(18);
  const hy = cellC(26);
  let maxD = 0;
  for (let k = 0; k < 12; k++) {
    await page.waitForTimeout(250);
    const e = (await snap(page)).enemies[0];
    maxD = Math.max(maxD, Math.hypot(e.x - hx, e.y - hy));
  }
  const s = await snap(page);
  expect(s.enemies[0].state, '휴면이 끝나 움직이는 중').not.toBe('dead');
  expect(maxD, '구덩이(꼭대기 반경 4칸) 밖으로 나가지 못한다').toBeLessThan(4 * 6);
  expect(s.player.hp).toBe(5);
  await shot(page, '10-trap');
  expect(errors).toEqual([]);
});

test('지형 이동: 낭떠러지에서 대시로 뛰어내리면 멀리 활강하고 착지 충격파로 적을 기절시킨다', async ({ page }) => {
  const errors = await openGame(page, 'dash');
  const s0 = await snap(page);
  expect(s0.player.z).toBe(4);
  await page.keyboard.down('KeyA');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snap(page)).stats.shocks, { message: '충격파' }).toBe(1);
  await page.keyboard.up('KeyA');
  const s1 = await snap(page);
  expect(s1.player.z).toBe(1);
  expect(s0.player.x - s1.player.x, '평지 대시(약 37px)보다 길게').toBeGreaterThan(70);
  expect(s1.enemies[0].state).toBe('stun');
  await shot(page, '07-dash-shock');
  expect(errors).toEqual([]);
});

test('회피: 사격형의 탄은 높은 지형에 막히고, 같은 높이에서는 맞는다', async ({ page }) => {
  const errors = await openGame(page, 'cover');
  await page.waitForTimeout(3500);
  const s = await snap(page);
  expect(s.player.hp, '메사 위에서는 맞지 않는다').toBe(5);
  expect(s.stats.boltsBlocked).toBeGreaterThan(0);
  await shot(page, '08-cover');

  await page.goto('/?scenario=exposed');
  await page.getByTestId('start').click();
  await expect.poll(async () => (await snap(page)).player.hp, { timeout: 6000, message: '같은 높이에서는 피격' }).toBeLessThan(5);
  await expect(page.locator('#hud-hp .lost')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('게임 오버 → R로 다시 시작', async ({ page }) => {
  const errors = await openGame(page, 'swarm');
  await expect.poll(async () => (await snap(page)).mode, { timeout: 25_000, message: '게임 오버' }).toBe('over');
  await expect(page.getByTestId('over')).toBeVisible();
  await expect(page.locator('#over-stats')).toContainText('절단');
  await shot(page, '09-over');
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('over')).toBeHidden();
  const s = await snap(page);
  expect(s.mode).toBe('play');
  expect(s.player.hp).toBe(5);
  expect(errors).toEqual([]);
});
