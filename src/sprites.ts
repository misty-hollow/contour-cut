// 캐릭터 스프라이트: 사각형 조각을 자세(pose)에 따라 배치하는 절차적 픽셀 그림. 외부 이미지 없음.
// 판정·이동은 world.ts가 정한다. 여기는 보이는 모습만 바꾼다(발끝 (x, y) 기준, 오른쪽을 보는 모습을 좌우 반전).

type Part = [number, number, number, number];

/** 카인(검은 측량사)의 자세 */
export interface KainPose {
  mirror: boolean;
  /** 북쪽(화면 위)을 보고 있으면 등이 보인다(눈 없음) */
  back: boolean;
  /** 걷기 4프레임(0~3). 서 있으면 0 */
  frame: number;
  /** 서 있을 때 숨쉬기(0 또는 -1) */
  breath: number;
  /** 윗몸 기울기(이동·대시 방향으로 +, 피격은 -) */
  lean: number;
  /** 외투 자락 펄럭임 0~2 */
  coat: number;
  air: boolean;
  /** -1 착지 눌림, 0 보통 */
  squash: number;
  /** 등에 멘 측량도 표시(손에 들고 휘두르는 동안은 숨김) */
  staff: boolean;
}

/** 걷기 프레임: [보폭, 뒷다리 들림, 앞다리 들림, 몸 오르내림] */
const WALK: [number, number, number, number][] = [
  [1, 0, 0, 0],
  [0, 1, 0, -1],
  [-1, 0, 0, 0],
  [0, 0, 1, -1],
];

export function kainParts(p: KainPose): { parts: Part[]; eye: [number, number] | null; staff: Part | null } {
  const [stride, liftA, liftB, walkBob] = p.air ? [0, 0, 0, 0] : WALK[p.frame & 3];
  const bob = walkBob + p.breath + (p.squash < 0 ? 1 : 0);
  const l = p.lean;
  const parts: Part[] = [];
  // 다리: 공중이면 접는다
  if (p.air) {
    parts.push([-2, -3, 1, 2], [1, -3, 1, 1]);
  } else if (p.squash < 0) {
    parts.push([-3, -1, 2, 1], [1, -1, 2, 1]);
  } else {
    parts.push([-2 - stride, -2, 1, 2 - liftA], [1 + stride, -2 - liftB, 1, 2 - liftB]);
  }
  // 외투 몸통(눌리면 한 칸 넓고 낮게)
  if (p.squash < 0) parts.push([-3, -6 + bob, 6, 4]);
  else parts.push([-2, -7 + bob, 4, 5]);
  // 외투 자락: 뒤로 끌린다
  parts.push([-3, -5 + bob, 1, 3]);
  if (p.coat >= 1) parts.push([-4, -4 + bob, 1, 2]);
  if (p.coat >= 2) parts.push([-5, -4 + bob - (p.frame & 1), 1, 1]);
  // 머리·모자(넓은 챙)
  parts.push([-1 + l, -9 + bob, 3, 2], [-4 + l, -10 + bob, 8, 1], [-2 + l, -12 + bob, 4, 2]);
  return {
    parts,
    eye: p.back ? null : [1 + l, -9 + bob],
    staff: p.staff ? [-5 + Math.min(0, l), -13 + bob, 1, 11] : null,
  };
}

export function drawKain(ctx: CanvasRenderingContext2D, x: number, y: number, p: KainPose, rim: string, body: string): void {
  const { parts, eye, staff } = kainParts(p);
  const rect = (rx: number, ry: number, w: number, h: number) => ctx.fillRect(p.mirror ? x - rx - w : x + rx, y + ry, w, h);
  ctx.fillStyle = rim;
  for (const [rx, ry, w, h] of parts) rect(rx - 1, ry - 1, w + 2, h + 2);
  ctx.fillStyle = body;
  for (const [rx, ry, w, h] of parts) rect(rx, ry, w, h);
  if (eye) {
    ctx.fillStyle = '#19f5c8';
    rect(eye[0], eye[1], 1, 1);
  }
  if (staff) {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.7;
    ctx.fillStyle = rim;
    rect(...staff);
    ctx.globalAlpha = a;
  }
}

export const kainKey = (p: KainPose) => `k${+p.mirror}${+p.back}${p.frame & 3}${p.breath}${p.lean}${p.coat}${+p.air}${p.squash}${+p.staff}`;

/** 쓰러진 카인: t = 쓰러진 뒤 시간(초). 비틀 → 무릎 → 엎드림, 모자는 굴러 떨어진다 */
export function drawKainDown(ctx: CanvasRenderingContext2D, x: number, y: number, mirror: boolean, t: number, rim: string): void {
  const dir = mirror ? -1 : 1;
  const r = (rx: number, ry: number, w: number, h: number) => ctx.fillRect(mirror ? x - rx - w : x + rx, y + ry, w, h);
  const parts: Part[] =
    t < 0.12
      ? [[-1, -2, 1, 2], [1, -2, 1, 2], [-3, -7, 4, 5], [-3, -9, 3, 2], [-6, -10, 8, 1], [-4, -12, 4, 2]]
      : t < 0.36
        ? [[-2, -1, 5, 1], [-2, -5, 4, 4], [-1, -7, 3, 2]]
        : [[-5, -2, 9, 2], [3, -3, 2, 2]];
  ctx.fillStyle = rim;
  for (const [rx, ry, w, h] of parts) r(rx - 1, ry - 1, w + 2, h + 2);
  ctx.fillStyle = '#000000';
  for (const [rx, ry, w, h] of parts) r(rx, ry, w, h);
  if (t >= 0.12) {
    // 떨어진 모자: 뒤쪽으로 튀었다가 땅에 눕는다
    const k = Math.min(1, (t - 0.12) / 0.4);
    const hx = Math.round(x - dir * (3 + k * 7));
    const hy = Math.round(y - 12 + k * 11 - Math.sin(k * Math.PI) * 4);
    ctx.fillStyle = rim;
    ctx.fillRect(hx - 4, hy - 1, 9, 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(hx - 3, hy, 7, 1);
  }
}

/** 주름 사냥개(돌진형)의 자세 */
export interface HoundPose {
  mirror: boolean;
  frame: number;
  /** 돌진 준비: 몸을 낮추고 떤다 */
  crouch: boolean;
  /** 돌진: 몸을 늘인다 */
  stretch: boolean;
  /** 기절: 고개를 떨군다 */
  dazed: boolean;
  /** 떨림 한 칸(-1/0/1) */
  jitter: number;
}

export function houndParts(p: HoundPose): { body: Part[]; dark: Part[]; eye: [number, number] } {
  const fr = p.frame & 3;
  const bob = p.crouch ? 1 : fr === 1 || fr === 3 ? -1 : 0;
  const j = p.jitter;
  const body: Part[] = [];
  if (p.stretch) {
    body.push([-5, -5, 9, 3], [3, -7, 3, 3], [-6, -3, 2, 1], [4, -2, 2, 1]);
  } else {
    body.push([-3 + j, -5 + bob, 7, 3]);
    // 머리: 준비 중엔 낮추고, 기절하면 떨군다
    body.push(p.crouch ? [2 + j, -6 + bob, 3, 3] : p.dazed ? [2, -5, 3, 3] : [2, -7 + bob, 3, 3]);
    // 다리: 걷기 4프레임(앞뒤로 엇갈림), 준비 중엔 뒷다리를 접어 박는다
    const legs: [number, number][] = p.crouch ? [[-3, 1], [2, 2]] : [[[-3, 2], [-2, 1], [-4, 2], [-2, 2]][fr] as [number, number], [[2, 2], [3, 2], [1, 2], [2, 1]][fr] as [number, number]];
    // 다리는 몸 아래(-2 + bob)에서 땅(0)까지. 들린 발(lh 1)은 땅에서 한 칸 떠 있다
    for (const [lx, lh] of legs) {
      const top = -2 + bob;
      const bottom = lh === 2 ? 0 : -1;
      body.push([lx + j, top, 1, Math.max(1, bottom - top)]);
    }
    // 꼬리: 걸을 때 위아래, 준비 중엔 곧추세움
    body.push([-4 + j, (p.crouch ? -8 : -6 + (fr & 1)) + bob, 1, p.crouch ? 2 : 1]);
  }
  const dark: Part[] = p.stretch ? [[-2, -5, 1, 2], [0, -5, 1, 2]] : [[-1 + j, -5 + bob, 1, 2], [1 + j, -5 + bob, 1, 2]];
  const head = body[1];
  return { body, dark, eye: [head[0] + 2, head[1] + 1] };
}

export function drawHound(ctx: CanvasRenderingContext2D, x: number, y: number, p: HoundPose, color: string): void {
  const { body, dark, eye } = houndParts(p);
  const rect = (rx: number, ry: number, w: number, h: number) => ctx.fillRect(p.mirror ? x - rx - w : x + rx, y + ry, w, h);
  ctx.fillStyle = '#12020a';
  for (const [rx, ry, w, h] of body) rect(rx - 1, ry - 1, w + 2, h + 2);
  ctx.fillStyle = color;
  for (const [rx, ry, w, h] of body) rect(rx, ry, w, h);
  ctx.fillStyle = '#12020a';
  for (const [rx, ry, w, h] of dark) rect(rx, ry, w, h);
  ctx.fillStyle = p.dazed ? '#12020a' : '#ffffff';
  rect(eye[0], eye[1], 1, 1);
}

export const houndKey = (p: HoundPose) => `h${+p.mirror}${p.frame & 3}${+p.crouch}${+p.stretch}${+p.dazed}${p.jitter}`;

/** 삼각점(사격형): 떠 있는 측량 기준점. charge = 조준 진행(0~1), recoil = 발사 반동 칸 */
export interface MarkerPose {
  hover: number;
  charge: number;
  recoilX: number;
  recoilY: number;
  tilt: number;
}

export function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, p: MarkerPose, color: string): void {
  const bx = x + p.recoilX;
  const by = y + p.hover + p.recoilY;
  // 받침 기둥(땅에 박힌 부분)은 움직이지 않는다
  ctx.fillStyle = '#0c0216';
  ctx.fillRect(x - 1, y - 3, 3, 3);
  ctx.fillStyle = '#3d1160';
  ctx.fillRect(x, y - 3, 1, 3);
  ctx.fillStyle = '#0c0216';
  ctx.fillRect(bx - 5, by - 10, 11, 7);
  ctx.fillStyle = color;
  for (let r = 0; r < 5; r++) ctx.fillRect(bx - r + (r > 2 ? p.tilt : 0), by - 9 + r, r * 2 + 1, 1);
  // 꼭짓점의 렌즈: 조준이 진행될수록 커지고 붉어진다
  if (p.charge > 0) {
    ctx.fillStyle = p.charge > 0.66 ? '#ff2d55' : '#ff9ad5';
    const rr = p.charge > 0.66 ? 1 : 0;
    ctx.fillRect(bx - rr, by - 6 - rr, 1 + rr * 2, 1 + rr * 2);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by - 6, 1, 1);
  }
}

export const markerKey = (p: MarkerPose) => `m${p.hover}${p.recoilX}${p.recoilY}${p.tilt}`;
