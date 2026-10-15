import { expect, test, type Page } from '@playwright/test';
import { aim, cellC, heightAt, openGame, shot, snap } from './helpers';

// 신규 플레이어 가독성(체감 품질 3차): 절단 미리보기가 실제 절단과 같고, 구역 진입 연출이 조작을 막지 않는다

/** 게임 화면 좌표 상자 안의 붉은 픽셀 수(게임 1px 단위). 심연 빗금·테두리·운명 화살과 돌진형 몸이 붉다 */
async function redPixels(page: Page, box: { x0: number; y0: number; x1: number; y1: number }): Promise<number> {
  return page.evaluate((b) => {
    const cv = document.getElementById('game') as HTMLCanvasElement;
    const k = cv.width / 480;
    const d = cv.getContext('2d')!.getImageData(Math.round(b.x0 * k), Math.round(b.y0 * k), Math.round((b.x1 - b.x0) * k), Math.round((b.y1 - b.y0) * k)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] < 100 && d[i + 2] < 130 && d[i] - d[i + 1] > 110) n++;
    return n / (k * k);
  }, box);
}

test('절단 미리보기: 대지 가장자리를 조준하면 대지가 심연 표시로 바뀌고, 베면 보인 그대로 절대 심연이 된다', async ({ page }) => {
  const errors = await openGame(page);
  await page.waitForTimeout(1400); // 측량 주사선이 지나간 뒤
  const s = await snap(page);
  // 첫 측량 대지(중심 40,25 반경 3, 표고 2)의 화면 상자: 평면 y + 20 − 고도×4
  const box = { x0: 37 * 6, y0: 22 * 6 + 12, x1: 44 * 6, y1: 29 * 6 + 12 };
  // 남쪽(평지)을 조준: 벨 등고선이 없어 미리보기도 없다
  await aim(page, s.player.x, s.player.y + 30);
  await page.waitForTimeout(150);
  const idle = await redPixels(page, box);
  // 북쪽 대지 가장자리를 조준(출발점에서 칼날이 닿는다)
  await aim(page, cellC(40), cellC(27));
  await page.waitForTimeout(150);
  const aimed = await redPixels(page, box);
  await shot(page, '30-cut-preview');
  expect(aimed, `붉은 픽셀: 조준 전 ${idle} → 대지 조준 ${aimed}`).toBeGreaterThan(idle + 40);
  expect(await heightAt(page, 40, 25)).toBe(2);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => heightAt(page, 40, 25), { message: '보인 그대로 대지가 절대 심연' }).toBe(-1);
  expect(errors).toEqual([]);
});

test('구역 진입: 처음에는 지도 표제(도면 번호·표고·진입 방향), 다시 하면 짧게 — 어느 쪽도 이동을 막지 않는다', async ({ page }) => {
  const errors = await openGame(page);
  const banner = page.getByTestId('zone-banner');
  await expect(banner).toContainText('구역 1 — 균열 지대');
  await expect(banner).toContainText('측량도 Z01');
  await expect(banner).toContainText('남쪽에서 진입');
  // 측량 주사선이 지나가는 동안에도 걷는다
  const x0 = (await snap(page)).player.x;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyD');
  expect((await snap(page)).player.x, '진입 연출 중 이동').toBeGreaterThan(x0 + 10);
  await shot(page, '31-zone-entry');
  // R = 이 구역 다시: 표제 대신 이름 한 줄과 "다시 측량"
  await page.keyboard.press('KeyR');
  await expect(banner).toContainText('다시 측량');
  await expect(banner).not.toContainText('측량도');
  const x1 = (await snap(page)).player.x;
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyA');
  expect((await snap(page)).player.x, '다시 시작 직후 이동').toBeLessThan(x1 - 8);
  await expect(banner).toBeHidden({ timeout: 3000 });
  expect(errors).toEqual([]);
});

test('구역 2 진입 표제는 서쪽 단애에서 들어온다고 알린다', async ({ page }) => {
  const errors = await openGame(page, undefined, { zone: 2 });
  await expect(page.getByTestId('zone-banner')).toContainText('구역 2 — 접힘 협곡');
  await expect(page.getByTestId('zone-banner')).toContainText('서쪽 단애에서 진입');
  await page.waitForTimeout(500);
  await shot(page, '32-zone2-survey');
  expect(errors).toEqual([]);
});
