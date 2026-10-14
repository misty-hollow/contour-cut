# CLAUDE.md — Contour Cut

등고선을 베어 지형의 높낮이를 바꾸는 탑다운 액션 프로토타입. 저장소 `misty-hollow/contour-cut`(공개), 기본 브랜치 `main`.
결정 기록은 `docs/DECISIONS.md`, 세계관은 `docs/WORLD.md`, 현재 상태·열린 문제·다음 작업은 `docs/WORKLOG.md`.

## 협업 원칙

- 구현과 기술적 판단은 AI가 맡는다. 요청 범위 안의 통상적인 수정·검증·커밋·PR은 사용자에게 확인받지 않고 진행한다.
- 사용자에게 묻는 것은 요청 범위에서 정할 수 없는 제품 방향과 아래 "승인 필요 행동"뿐이다.
- 재미·조작감·난이도·비주얼·소리의 최종 판단은 사용자다. 직접 플레이해 볼 화면과 볼 점을 짧게 알린다. 이미 확인받은 항목은 다시 묻지 않는다.
- 요청 범위 밖의 다음 기능은 시작하지 않고 `docs/WORKLOG.md`에 적는다.
- 끝나면 바뀐 것, 실제 검증 결과, 남은 공백을 짧게 보고한다. 하지 않은 검증을 했다고 쓰지 않는다.
- `docs/WORKLOG.md`는 짧게 유지한다. 끝난 작업의 상세는 PR과 Git 이력에 둔다.

## 명령

| 목적 | 명령 |
|---|---|
| 설치 | `npm ci` |
| 개발 서버 | `npm run dev` (<http://127.0.0.1:5173>) |
| 린트 | `npm run lint` |
| 타입체크 | `npm run typecheck` |
| 단위 테스트 | `npm test` (`vitest run`, watch 금지) |
| 빌드 | `npm run build` (`tsc --noEmit` + `vite build`) |
| e2e | `npm run e2e` (프로덕션 빌드 + `vite preview` :4173, 실제 키보드·마우스). 받아 둔 chromium이 없으면 `E2E_CHANNEL=msedge npm run e2e` |

- 코드 변경: 린트·타입체크·단위 테스트·빌드. 화면·입력·상태에 영향이 있으면(`src/**`, `index.html`, `public/**`, `vite.config.ts`, `e2e/**`) e2e도 돌리고, 화면 변경은 `test-results/shots/*.png`나 내장 브라우저로 직접 본다.
- 문서·주석만 바꾼 경우: 참조와 실행 동작이 그대로인지 확인하고 CI 결과를 본다.
- CI: `.github/workflows/ci.yml`, job `ci`(ubuntu-24.04). PR(→ main)과 main push에서 린트·빌드·단위·e2e. `ci`가 main 필수 체크다.

## 프로젝트 고유 제약

- 스택: TypeScript + Vite + Canvas 2D, 게임 엔진 없음. Node 24. 의존성은 출시 2주 이상 지난 버전으로 고정(T-002).
- 결정성: 시뮬레이션은 고정 1/60초 간격과 시드 RNG(`World.step`). `Math.random`은 그리기 연출에만 쓴다.
- 핵심 규칙(절단 → 침하·붕괴 → 낙하 → 7초 지형 환원 → 에어본·공중 추가타, 이동 가능 고도차), 승인된 기본값(`src/config.ts`, P-005·P-009), 승인된 구역 설계(T-009~T-012)는 유지한다. 의미를 바꾸려면 사용자 결정.
- e2e: 검증 대상 행동(이동·대시·절단·회피)은 실제 키보드·마우스로 한다. 디버그 핸들은 `?scenario=`·`?zone=`(초기 배치), `window.__cc.snapshot()`·`window.__cc.project()`(관찰·좌표 변환)만 쓰고, 상태를 바꾸는 핸들은 만들지 않는다. 기존 검사 기준을 약화·삭제·건너뛰지 않는다(설계 변경으로 교체할 때는 PR에 근거를 적는다).
- 런타임 외부 호출 금지(폰트·에셋 CDN, 분석 스크립트 등). 그림·소리는 코드로 만든다. 다른 작품(산나비 등)의 에셋·고유 디자인을 가져오지 않는다.
- 유료 서비스·API 과금 없음. CI는 외부로 아무것도 올리지 않는다(아티팩트 업로드 없음).

## 브랜치·커밋·병합

- 작업 브랜치 `feat/…` `fix/…` `tune/…` `docs/…` `chore/…`. main에 직접 push하지 않는다. 커밋 메시지는 `feat: …` 형식.
- 병합은 사용자가 그 작업에서 병합까지 요청했을 때 한다. 병합 직전 최신 origin/main을 반영(up-to-date 필수)하고, 최종 head의 `ci` 성공을 확인한 뒤 `gh pr merge <N> --merge --match-head-commit <sha>`. `--admin`·`--auto`는 쓰지 않는다. 병합 후 main CI를 확인하고 로컬 브랜치는 `git branch -d`.
- 커밋하지 않는다: `.claude/settings.local.json`과 백업, 인증 정보·토큰·`.env*`, `node_modules/`, `dist/`, `test-results/`, `playwright-report/`. `.claude/` 아래는 개별 경로로만 `git add`(`git add .claude/`·`git add -A` 금지).

## 승인 필요 행동

- 외부 공개 배포(GitHub Pages 등), 저장소 공개 범위 변경
- GitHub 저장소 설정 변경(브랜치 보호·필수 체크·병합 방식·비밀값)
- 외부 에셋·폰트·음원 도입, 유료 서비스, CI 아티팩트 업로드 추가
- 핵심 규칙·승인된 기본값·승인된 구역 설계의 의미 변경
- `.claude/settings.json`·`.claude/settings.local.json` 변경(사용자가 직접 고친다). 권한 규칙을 다른 도구로 우회하지 않는다
- `misty-hollow/AI-Dev-Workflow` 저장소에 대한 쓰기. 이 프로젝트는 그 운영 절차를 더 이상 따르지 않는다(P-016)

## 리뷰 (선택)

- 필요하다고 판단할 때만 쓴다. 병합 조건이 아니다.
- `.claude/agents/reviewer.md`: 새 맥락에서 읽는 검토 서브에이전트(도구 Read·Grep·Glob·Bash).
- Codex 두 번째 의견·진단: AI가 직접 부를 수 있는 경로는 `codex:codex-rescue` 서브에이전트(플러그인 `codex-companion.mjs task`)뿐이다. 요청에 "읽기 전용, 코드 수정 금지"를 명시한다(명시하지 않으면 쓰기 가능 실행이 기본). 플러그인 1.0.6 소스상 `--write` 없는 task는 read-only 샌드박스로 실행되지만 이 저장소에서 격리를 직접 확인하지는 않았다 — 끝나면 `git status`로 작업 트리가 그대로인지 본다.
- `/codex:review`·`/codex:adversarial-review`는 사용자만 입력할 수 있는 명령이다. 사용자에게 입력이나 결과 전달을 요구하지 않는다.
