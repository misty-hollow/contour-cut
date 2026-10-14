import { describe, expect, it } from 'vitest';
import { CELL, FIXED_DT, LEVEL_PX, ORIGIN_Y, tune } from './config';
import { enemyUnderCursor } from './input';
import { emptyInput, World } from './world';

const c = (n: number) => (n + 0.5) * CELL;

/** combo: 꼭대기 적을 가두고 다가가 환원으로 떠오른 정점까지 */
function launchedApex(): World {
  const w = new World('combo', 1);
  const cut = emptyInput();
  cut.aimX = c(18);
  cut.aimY = c(26);
  cut.cut = true;
  w.step(FIXED_DT, cut);
  const walk = emptyInput();
  walk.moveX = -1;
  for (let k = 0; k < 90; k++) w.step(FIXED_DT, walk);
  const e = w.enemies[0];
  for (let k = 0; k < (tune.restoreSec + 1) * 60 && !(e.state === 'launched' && e.vz <= 0); k++) w.step(FIXED_DT, emptyInput());
  return w;
}

/** 적이 화면에 그려진 몸통 중심(카메라 적용 전 화면 좌표) */
const bodyOnScreen = (e: { x: number; y: number; z: number }) => ({ x: e.x, y: e.y + ORIGIN_Y - e.z * LEVEL_PX - 6 });

describe('보이는 적 조준', () => {
  it('공중에 뜬 적의 그려진 몸통을 가리키면 그 적이 잡힌다. 빈 땅은 잡히지 않는다', () => {
    const w = launchedApex();
    const e = w.enemies[0];
    expect(e.state).toBe('launched');
    expect(e.z).toBeGreaterThan(4.5);
    const b = bodyOnScreen(e);
    expect(enemyUnderCursor(b.x, b.y, w.enemies)?.id).toBe(e.id);
    // 같은 평면 위치를 지면 높이로 그린 자리(공중 적 몸통이 아닌 곳)는 잡히지 않는다
    expect(enemyUnderCursor(e.x, e.y + ORIGIN_Y - 1 * LEVEL_PX - 6, w.enemies)).toBeNull();
  });

  it('공중 적을 보이는 대로 클릭하면 추가타가 들어간다(플레이어 고도로 역투영하던 옛 방식은 빗나감)', () => {
    const b0 = launchedApex();
    const e0 = b0.enemies[0];
    const screen = bodyOnScreen(e0);
    // 옛 방식: 화면 좌표를 플레이어 고도 평면으로 되돌림
    const old = emptyInput();
    old.aimX = screen.x;
    old.aimY = screen.y - ORIGIN_Y + b0.player.z * LEVEL_PX;
    old.cut = true;
    b0.step(FIXED_DT, old);
    expect(b0.stats.airHits).toBe(0);

    const w = launchedApex();
    const e = w.enemies[0];
    const s = bodyOnScreen(e);
    const t = enemyUnderCursor(s.x, s.y, w.enemies);
    expect(t?.id).toBe(e.id);
    const inp = emptyInput();
    inp.aimX = t!.x;
    inp.aimY = t!.y;
    inp.cut = true;
    w.step(FIXED_DT, inp);
    expect(w.stats.airHits).toBe(1);
  });
});
