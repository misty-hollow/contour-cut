import { expect, type Page } from '@playwright/test';

// 디버그 핸들은 관찰(snapshot·heightAt)과 좌표 변환(project)에만 쓴다. 행동은 실제 마우스·키보드로(CLAUDE.md "프로젝트 고유 제약").

export const cellC = (n: number) => (n + 0.5) * 6;

/** 페이지를 열고 실제 클릭으로 시작한다(기본 = 첫 여정, waves = 무한 웨이브 버튼). 콘솔·페이지 오류를 모아 반환한다. */
export async function openGame(page: Page, scenario?: string, opts: { waves?: boolean; zone?: number } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(scenario ? `/?scenario=${scenario}` : opts.zone ? `/?zone=${opts.zone}` : '/');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.getByTestId(opts.waves ? 'start-waves' : 'start').click();
  await expect(page.getByTestId('title')).toBeHidden();
  await expect.poll(() => snap(page).then((s) => s.time), { message: '시뮬레이션이 진행된다' }).toBeGreaterThan(0.1);
  return errors;
}

export const snap = (page: Page) => page.evaluate(() => window.__cc.snapshot());
export const heightAt = (page: Page, cx: number, cy: number) => page.evaluate(([x, y]) => window.__cc.heightAt(x, y), [cx, cy]);
export const shownAt = (page: Page, cx: number, cy: number) => page.evaluate(([x, y]) => window.__cc.shownAt(x, y), [cx, cy]);

/** 평면 좌표의 화면 위치로 마우스를 옮긴다(조준). 게임은 마우스를 플레이어 고도 평면으로 읽으므로 기본 고도는 플레이어의 것 */
export async function aim(page: Page, x: number, y: number, z?: number): Promise<void> {
  const lv = z ?? (await snap(page)).player.z;
  const p = await page.evaluate(([px, py, pz]) => window.__cc.project(px, py, pz), [x, y, lv] as const);
  await page.mouse.move(p.x, p.y, { steps: 5 });
}

/** 조준 후 왼쪽 클릭 = 등고선 절단 */
export async function cutAt(page: Page, x: number, y: number, z?: number): Promise<void> {
  await aim(page, x, y, z);
  await page.mouse.down();
  await page.mouse.up();
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test-results/shots/${name}.png` });
}

/** 객관 검사: 캔버스가 비어 있지 않은지(서로 다른 색 수, 밝기 분산) */
export async function canvasStats(page: Page): Promise<{ colors: number; variance: number }> {
  return page.evaluate(() => {
    const c = document.getElementById('game') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const set = new Set<number>();
    let sum = 0;
    let sum2 = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += l;
      sum2 += l * l;
    }
    const mean = sum / n;
    return { colors: set.size, variance: sum2 / n - mean * mean };
  });
}

/** 객관 검사: HUD 상자가 게임 화면 안에 있고 서로 겹치지 않는지(DOM 기하) */
export async function hudGeometry(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const stage = document.getElementById('stage')!.getBoundingClientRect();
    // 구역 블록(첫 여정)과 웨이브 줄(무한 웨이브·실험)은 둘 중 하나만 보인다. 힌트 줄은 보일 때만 함께 검사한다
    const shown = (id: string) => !document.getElementById(id)!.classList.contains('hidden');
    const hint = document.getElementById('hint');
    const top = ['hud-tl', 'hud-tr'].filter(shown);
    if (top.length !== 1) problems.push(`좌상단 구역 블록·우상단 웨이브 줄 중 ${top.length}개 보임`);
    const ids = [...top, 'hud-bl', 'hud-br', ...(hint && shown('hint') ? ['hint'] : [])];
    const rects = ids.map((id) => [id, document.getElementById(id)!.getBoundingClientRect()] as const);
    for (const [id, r] of rects) {
      if (r.width === 0 || r.height === 0) problems.push(`${id} 크기 0`);
      if (r.left < stage.left - 0.5 || r.right > stage.right + 0.5 || r.top < stage.top - 0.5 || r.bottom > stage.bottom + 0.5) problems.push(`${id} 화면 밖`);
      if (r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5 || r.left < -0.5 || r.top < -0.5) problems.push(`${id} 창 밖`);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i][1];
        const b = rects[j][1];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) problems.push(`${rects[i][0]}↔${rects[j][0]} 겹침`);
      }
    // 글자가 상자 밖으로 넘치는지
    for (const [id] of rects) {
      const el = document.getElementById(id)!;
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`${id} 가로 넘침`);
    }
    // 힌트 줄은 두 줄까지(UI System 01). 두 줄이면 끝 몇 글자만 다음 줄로 넘어간 고아 줄이 아니어야 한다
    if (ids.includes('hint')) {
      const range = document.createRange();
      range.selectNodeContents(hint!);
      const lines = new Map<number, number>();
      for (const r of Array.from(range.getClientRects())) lines.set(Math.round(r.top), (lines.get(Math.round(r.top)) ?? 0) + r.width);
      const widths = [...lines.values()];
      if (widths.length > 2) problems.push(`hint ${widths.length}줄`);
      else if (widths.length === 2 && Math.min(...widths) < 0.25 * Math.max(...widths)) problems.push('hint 고아 줄');
    }
    return problems;
  });
}

/**
 * 실제 키 입력으로 목표 지점(평면 px)까지 걷는다. 상태는 관찰만 하고, 축마다 가까워지면 그 키를 뗀다.
 * 막혀서 시간 안에 못 가면 실패(길이 막힌 진행 불가 상태를 잡는다).
 */
export async function walkTo(page: Page, x: number, y: number, timeout = 9000): Promise<void> {
  let held: string[] = [];
  const hold = async (keys: string[]) => {
    for (const k of held) if (!keys.includes(k)) await page.keyboard.up(k);
    for (const k of keys) if (!held.includes(k)) await page.keyboard.down(k);
    held = keys;
  };
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = (await snap(page)).player;
    const dx = x - p.x;
    const dy = y - p.y;
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
      await hold([]);
      return;
    }
    const keys: string[] = [];
    if (dx > 3) keys.push('KeyD');
    else if (dx < -3) keys.push('KeyA');
    if (dy > 3) keys.push('KeyS');
    else if (dy < -3) keys.push('KeyW');
    await hold(keys);
    await page.waitForTimeout(25);
  }
  await hold([]);
  const p = (await snap(page)).player;
  throw new Error(`walkTo(${x.toFixed(0)},${y.toFixed(0)}) 시간 초과 — 현재 ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
}

/** 칸 좌표 경유점들을 차례로 걷는다 */
export async function walkPath(page: Page, cells: [number, number][]): Promise<void> {
  for (const [cx, cy] of cells) await walkTo(page, cellC(cx), cellC(cy));
}
