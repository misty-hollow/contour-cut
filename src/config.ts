// 고정 치수. 바꾸면 화면 배치와 시나리오 좌표가 같이 바뀐다.
export const CELL = 6; // 격자 한 칸의 평면 크기(px, 내부 해상도 기준)
export const GRID_W = 80;
export const GRID_H = 41;
export const VIEW_W = 480;
export const VIEW_H = 270;
export const LEVEL_PX = 4; // 고도 1단계가 화면에서 위로 올라가는 픽셀
export const ORIGIN_Y = 20; // 평면 y=0, 고도 0이 그려지는 화면 y
export const MAX_LEVEL = 6;
export const ABYSS = -1; // 이 값 미만(=음수)은 심연
export const OUT_OF_BOUNDS = 99;
export const FIXED_DT = 1 / 60;
export const GRAVITY = 60; // 고도 단계/s²

// 조정값. 튜닝 패널(T키)이 실행 중에 바꾼다. 규칙의 의미는 바뀌지 않는다(CLAUDE.md C절 예외).
export const tune = {
  cutDrop: 3, // 베인 등고선 안쪽이 내려앉는 단계 수
  cutRadius: 6, // 붕괴 반경(칸)
  restoreSec: 7, // 붕괴 지형이 원래대로 돌아오는 시간
  restoreWarnSec: 1.2,
  bladeLen: 42, // 칼날 길이(px)
  bladeHitWidth: 7,
  cutCooldown: 0.38,
  playerSpeed: 70,
  dashSpeed: 230,
  dashTime: 0.16,
  dashCooldown: 0.55,
  dashGravityScale: 0.5, // 대시 중 낙하는 활강(중력 감소)
  fallBoostPerLevel: 0.35, // 내려선 고도 1단계당 이동 가속
  fallBoostTime: 0.8,
  fallBoostMax: 1.2,
  shockRadius: 28,
  shockStun: 1.2,
  shockKnock: 120,
  hitstop: 0.05,
  shake: 1,
};

export type Tune = typeof tune;

export const ENEMY = {
  chaser: { hp: 3, speed: 34, lungeRange: 26, windup: 0.45, lungeSpeed: 220, lungeTime: 0.22, recover: 0.9 },
  shooter: { hp: 2, speed: 22, range: 120, windup: 0.6, cooldown: 2.4, firstShot: 1.0, boltSpeed: 110, boltLife: 3 },
  fallStun: 1.4,
  bladeStun: 0.25,
  bladeKnock: 150,
  knockTime: 0.18,
};

export const PLAYER = { hp: 5, hurtInv: 1.0, respawnInv: 1.2 };
