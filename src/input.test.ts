import { describe, expect, it } from 'vitest';
import { CELL, FIXED_DT, LEVEL_PX, ORIGIN_Y, tune } from './config';
import { enemyUnderCursor, resolveAim } from './input';
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

describe('지형에 가려진 적은 조준을 가로채지 않는다', () => {
  it('메사 북쪽에 완전히 가려진 적: 지형을 가리키면 잡히지 않고 기존 역투영 좌표 그대로(리뷰 재현 사례)', () => {
    const w = new World('cut', 1);
    const e = w.spawnEnemy('chaser', 291, 57, 60, false);
    expect(e.z).toBe(1);
    // 상자 판정만 하면 잡혔다(지형 정보 없이)
    expect(enemyUnderCursor(291, 67, w.enemies)?.id).toBe(e.id);
    // 렌더러 순서대로 보면 그 픽셀은 메사(10·11행)가 덮는다
    expect(enemyUnderCursor(291, 67, w.enemies, w.terrain)).toBeNull();
    const a = resolveAim(291, 67, w.player.z, w.enemies, w.terrain);
    expect(a.target).toBeNull();
    expect(a.x).toBe(291);
    expect(a.y).toBe(67 - ORIGIN_Y + w.player.z * LEVEL_PX);
  });

  it('일부만 가려진 적: 메사 위로 드러난 머리 쪽은 잡히고, 메사가 덮은 발 쪽은 잡히지 않는다', () => {
    const w = new World('cut', 1);
    const e = w.spawnEnemy('chaser', 291, 50, 60, false);
    // 발끝 화면 y = 50 + 20 - 4 = 66. 메사 10행 윗면은 y = 64부터
    expect(enemyUnderCursor(291, 58, w.enemies, w.terrain)?.id).toBe(e.id);
    expect(enemyUnderCursor(291, 65, w.enemies, w.terrain)).toBeNull();
  });

  it('환원으로 떠오른 공중 적은 앞쪽 지형보다 높이 그려지므로 그대로 잡힌다', () => {
    const w = launchedApex();
    const e = w.enemies[0];
    const b = bodyOnScreen(e);
    expect(enemyUnderCursor(b.x, b.y, w.enemies, w.terrain)?.id).toBe(e.id);
  });
});
