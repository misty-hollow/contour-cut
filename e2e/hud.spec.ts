import { expect, test, type Page } from '@playwright/test';
import { cellC, cutAt, hudGeometry, openGame, shot, snap } from './helpers';

// 1단계 HUD 다이어트(UI System 01) 계기 상태 · 2.5D 가림 윤곽 · 기기 픽셀 정수 배율. 행동은 실제 키보드·마우스.

const cls = (page: Page, id: string) => page.locator(`#${id}`).getAttribute('class');

test('계기: 절단 직후 재충전(램프 꺼짐) → 준비(오렌지 램프), 일시정지 중에는 사용 불가(해칭), 무한 웨이브는 우상단 한 줄', async ({ page }) => {
  const errors = await openGame(page, 'cut');
  await expect(page.locator('#track-cut')).toHaveClass(/ready/);
  await expect(page.locator('#lamp-cut')).toHaveClass(/on/);
  await expect(page.locator('#lamp-dash')).toHaveClass(/on/);
  // 실험 시나리오: 구역 블록 대신 우상단 한 줄
  await expect(page.getByTestId('hud-zone')).toBeHidden();
  await expect(page.getByTestId('hud-wave')).toHaveText('실험: cut');
  // 빈 땅을 벤다 → 재충전 중(0.38초)에는 램프가 꺼지고 라벨이 보조색
  await cutAt(page, (await snap(page)).player.x + 30, (await snap(page)).player.y);
  await expect.poll(async () => (await cls(page, 'lamp-cut'))?.includes('on'), { timeout: 2000 }).toBe(false);
  await expect(page.locator('#lbl-cut')).not.toHaveClass(/ready/);
  await expect.poll(async () => (await cls(page, 'lamp-cut'))?.includes('on'), { timeout: 2000, message: '재충전 뒤 준비' }).toBe(true);
  // 일시정지: 두 계기 모두 사용 불가
  await page.keyboard.press('KeyP');
  await expect(page.locator('#track-cut')).toHaveClass(/off/);
  await expect(page.locator('#track-dash')).toHaveClass(/off/);
  await expect(page.locator('#lamp-cut')).not.toHaveClass(/on/);
  await page.keyboard.press('KeyP');
  await expect(page.locator('#track-cut')).not.toHaveClass(/off/);
  expect(await hudGeometry(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('계기: 체력 1이 되면 남은 칸·라벨이 레드, 쓰러지면 계기 사용 불가', async ({ page }) => {
  const errors = await openGame(page, 'swarm');
  await expect.poll(async () => (await snap(page)).player.hp, { timeout: 25_000, message: '체력 1' }).toBe(1);
  await expect(page.locator('#hud-hp')).toHaveClass(/crit/);
  await expect(page.locator('#lbl-hp')).toHaveClass(/crit/);
  await expect(page.locator('#hud-hp span.lost')).toHaveCount(4);
  await expect.poll(async () => (await snap(page)).mode, { timeout: 25_000 }).toBe('over');
  await expect(page.locator('#track-cut')).toHaveClass(/off/);
  await expect(page.locator('#hud-hp span.lost')).toHaveCount(5);
  expect(errors).toEqual([]);
});

/** 캔버스(표시 해상도)에서 게임 좌표 상자 안에 주어진 색과 가까운 픽셀 수 */
async function colorPixels(page: Page, box: { x0: number; y0: number; x1: number; y1: number }, rgb: [number, number, number]): Promise<number> {
  return page.evaluate(
    ([b, c]) => {
      const cv = document.getElementById('game') as HTMLCanvasElement;
      const k = cv.width / 480;
      const d = cv.getContext('2d')!.getImageData(Math.round(b.x0 * k), Math.round(b.y0 * k), Math.round((b.x1 - b.x0) * k), Math.round((b.y1 - b.y0) * k)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - c[0]) < 24 && Math.abs(d[i + 1] - c[1]) < 24 && Math.abs(d[i + 2] - c[2]) < 24) n++;
      return n / (k * k);
    },
    [box, rgb] as const,
  );
}

test('2.5D 가림: 메사 바로 북쪽에 선 적은 메사에 덮인 몸 부분이 적 색 1px 윤곽으로 보인다(판정·조준은 그대로)', async ({ page }) => {
  const errors = await openGame(page, 'hidden');
  await page.waitForTimeout(300);
  const s = await snap(page);
  const [chaser, shooter] = s.enemies;
  // 발끝(게임 화면 y) = 평면 y + 20 − 고도×4. 몸통은 발끝 위 13px까지
  const feet = (e: { y: number; z: number }) => Math.round(e.y + 20 - e.z * 4);
  // 메사 윗면(표고 4, 10번째 줄)이 시작하는 화면 y — 그 아래로는 메사가 덮는다
  const mesaTop = 10 * 6 + 20 - 4 * 4;
  expect(feet(chaser)).toBeGreaterThan(mesaTop);
  const red = await colorPixels(page, { x0: chaser.x - 6, y0: mesaTop, x1: chaser.x + 7, y1: feet(chaser) + 1 }, [0xff, 0x3b, 0x3b]);
  const purple = await colorPixels(page, { x0: shooter.x - 6, y0: mesaTop, x1: shooter.x + 7, y1: feet(shooter) + 1 }, [0xc0, 0x4c, 0xff]);
  expect(red, '돌진형 윤곽(메사가 덮은 부분)').toBeGreaterThan(4);
  expect(purple, '사격형 윤곽(메사가 덮은 부분)').toBeGreaterThan(4);
  // 메사 위 빈 곳에는 적 색이 없다(윤곽은 가려진 몸에만)
  expect(await colorPixels(page, { x0: 270, y0: mesaTop, x1: 282, y1: feet(chaser) + 1 }, [0xff, 0x3b, 0x3b])).toBe(0);
  await shot(page, '23-hidden-outline');
  expect(errors).toEqual([]);
});

for (const [dpr, w, h] of [
  [1.25, 1536, 740],
  [1.5, 1280, 600],
  [2, 1280, 720],
] as const) {
  test.describe(`기기 픽셀 비율 ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr, viewport: { width: w, height: h } });
    test(`DPR ${dpr}: 게임 1px = 정수 기기 픽셀(캔버스가 다시 늘거나 줄지 않음), 기기 픽셀 경계에 놓이고 HUD·조준이 맞는다`, async ({ page }) => {
      const errors = await openGame(page);
      const m = await page.evaluate(() => {
        const cv = document.getElementById('game') as HTMLCanvasElement;
        const r = cv.getBoundingClientRect();
        const d = window.devicePixelRatio;
        return { cw: cv.width, ch: cv.height, dw: r.width * d, dh: r.height * d, left: r.left * d, top: r.top * d, d };
      });
      expect(m.d).toBe(dpr);
      expect(m.cw % 480, '캔버스 폭은 480의 정수배').toBe(0);
      expect(Math.abs(m.dw - m.cw), '표시 기기 픽셀 폭 = 캔버스 폭').toBeLessThan(0.5);
      expect(Math.abs(m.dh - m.ch)).toBeLessThan(0.5);
      expect(Math.abs(m.left - Math.round(m.left)), '왼쪽 끝이 기기 픽셀 경계').toBeLessThan(0.01);
      expect(Math.abs(m.top - Math.round(m.top))).toBeLessThan(0.01);
      expect(await hudGeometry(page)).toEqual([]);
      // 이 배율에서도 보이는 곳을 벤다: 측량 1 대지를 출발 자리에서 베면 절대 심연
      await cutAt(page, cellC(40), cellC(25));
      await expect.poll(async () => (await snap(page)).stats.kills.abyss, { message: '측량 1 처치' }).toBe(1);
      if (dpr === 1.25) await shot(page, '24-dpr125');
      expect(errors).toEqual([]);
    });
  });
}
