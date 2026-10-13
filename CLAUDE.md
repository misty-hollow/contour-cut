작업 전에 misty-hollow/AI-Dev-Workflow의 CONSTITUTION.md와 WORKFLOW.md(v1.2, 커밋 `6eee919` 고정)를 읽고 따른다.

# CLAUDE.md — Contour Cut 프로젝트 값

이 파일은 AI-Dev-Workflow v1.2를 이 저장소에 적용하는 **프로젝트 값**만 담는다. 절 기호 A~I는 PROJECT_TEMPLATE v1.2를 따른다.
실행 순서·검증 상태·실패 처리·리뷰·병합 절차는 원본이 정하고, 여기에 다시 쓰지 않는다.

## 공통 규칙 읽는 법 (사본 없음)

사용자 지시(DECISIONS P-001)에 따라 공통 문서 4개를 이 저장소에 복사하지 않는다. 원본의 "공통 규칙 사본"·`docs/ai-dev-workflow/`는 아래 고정 커밋으로 읽는다.

```
gh api -H "Accept: application/vnd.github.raw" "repos/misty-hollow/AI-Dev-Workflow/contents/CONSTITUTION.md?ref=6eee919"
gh api -H "Accept: application/vnd.github.raw" "repos/misty-hollow/AI-Dev-Workflow/contents/WORKFLOW.md?ref=6eee919"
```

- 세션 시작 때 `gh api repos/misty-hollow/AI-Dev-Workflow/commits/main --jq .sha`로 원본 main을 조회한다. 고정 커밋과 다르면 고정 커밋을 따르고 REPORT.md에 차이를 적는다. 고정 커밋 갱신은 별도 작업이다.
- 원본 저장소는 읽기만 한다(수정·이슈·PR 금지). 원본을 읽을 수 없으면 작업을 시작하지 않고 `차단됨`으로 보고한다.

## A. 식별

| 항목 | 값 |
|---|---|
| 프로젝트명 | Contour Cut — 등고선 절단기 |
| 저장소 | `misty-hollow/contour-cut` (공개) |
| 스택·언어 | TypeScript 6 + Vite 8 + Canvas 2D(게임 엔진 없음). 테스트 Vitest 5, 실행 검증 Playwright 1.63. Node 24 |
| 기본 브랜치 | main |
| 배포 형태 (전부) | 웹(데스크톱 브라우저) 하나. 로컬 `npm run dev`·`npm run preview`로 실행. 공개 배포 없음 |
| 배포·외부 공개 자동화 | 없음. CI는 외부로 아무것도 올리지 않는다(아티팩트 업로드 없음) |
| 프로젝트 고정 제약 | 런타임 외부 호출 없음(폰트·에셋 CDN 금지, 그림·소리는 코드로 생성). 유료 서비스·API 과금 없음. 다른 작품(산나비 등)의 에셋·고유 디자인을 가져오지 않는다 |

## B. 검증 명령과 필요 조건

CI 러너 OS: ubuntu-24.04(`.github/workflows/ci.yml`, job `ci` = main 필수 체크). 로컬: Windows 11 + Git Bash.

| 종류 | 명령 | 필요 조건 | 비고 |
|---|---|---|---|
| 린트 | `npm run lint` | 모든 코드 변경 | |
| 타입체크 | `npm run typecheck` | 모든 코드 변경 | `tsc --noEmit`. `build`에도 포함 |
| 테스트 | `npm test` | 모든 코드 변경 | `vitest run`. watch 금지 |
| 빌드 | `npm run build` | 모든 코드 변경 | |
| 실행 검증 ① 플레이 경로 | `npm run e2e` | 화면·입력·상태 영향 변경 | 프로덕션 빌드 + `vite preview`를 띄우고 실제 키보드·마우스로 조작. CI에서도 돈다 |
| 실행 검증 ① 객관 검사 | 같은 실행(`e2e/*.spec.ts`) | 화면 영향 변경 | 콘솔·페이지 오류 0, 빈 캔버스 아님(픽셀 분산), HUD DOM 기하(화면 밖·겹침), 상태 수치 |
| 직접 검토 ② | 같은 실행의 `test-results/shots/*.png` + 내장 브라우저로 직접 조작 | 화면 영향 변경 | 실행당 12장 상한 |
| 시간 축 | 같은 실행: 붕괴 전·중·후 표시 높이, 복구 시점 | 애니메이션·전환 변경 | 수치 위주. 손맛은 D절 |
| 배포 형태별 실행 확인 | `npm run e2e`(프로덕션 빌드 대상) | 빌드 설정·`index.html`·에셋 경로 변경 | 형태가 웹 하나라 ①과 같은 실행 |

로컬 e2e 브라우저: Playwright 기본 chromium. 받아 둔 브라우저가 없으면 `E2E_CHANNEL=msedge npm run e2e`(설치된 Edge).

디버그 핸들·내부 API 사용 범위: URL `?scenario=<이름>`(초기 배치 준비), `window.__cc.snapshot()`·`window.__cc.project()`(상태 관찰·좌표 변환)만. 검증 대상 행동(이동·대시·절단·회피)은 키보드·마우스로 한다. 상태를 바꾸는 핸들은 만들지 않는다.

대표 플레이 경로(①에서 매번):
- 타이틀 → 클릭으로 시작 → WASD 이동 → 등고선 절단(클릭) → 지형 고도 변화 → 적 낙하 → HUD 처치 수 증가
- 고지대에서 대시로 뛰어내림 → 착지 충격파로 적 기절 / 사격 적의 탄이 높은 지형에 막힘
- 피격 누적 → 게임 오버 → R로 재시작

변경 주변 탐색: 변경된 화면·입력에서 하네스 밖 조작 2~3가지를 내장 브라우저로 시도한다.

수단 확보 계획:
- 기준 스크린샷 비교 — 수단 없음. 프로토타입 단계라 화면이 계속 바뀌어 보류. 비주얼 방향이 정해지면 시드 고정 화면부터 도입(새 검사 = 저위험, 허용 오차·마스크는 C절)
- 소리 확인 — 수단 없음. ③으로 사용자 판단

실패 처리 예산: 작업당 4시간, PR CI 실행 6회(보고서만 고친 push로 도는 실행 포함). 조사·증거 수집 포함, 가설이 바뀌어도 초기화하지 않는다.

화면·입력·상태 영향 파일·영역(해당하면 영향 "있음"):
- `src/**`, `index.html`, `public/**`, `vite.config.ts`
- `e2e/**`는 게임 화면을 바꾸지 않는다. 하네스를 바꾸면 그 하네스로 ①을 다시 돌린다

## C. 고위험 기준

공통 표는 PROJECT_TEMPLATE v1.2 C절. 아래 목록을 더하고, 하나라도 해당하면 고위험. 메인은 변경 후 REPORT.md에 위험도와 근거를 한 줄 적고 사용자에게 묻지 않는다.

프로젝트별 고위험 파일(어떤 수정이든):
- `package.json`의 의존성·스크립트, `package-lock.json`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `playwright.config.ts`
- `.github/workflows/**`, `.gitattributes`
- `.claude/settings.json`, `.claude/agents/**`, 이 파일의 "공통 규칙 읽는 법"·B·C·E·F·H절

프로젝트별 고위험 영역(파일과 무관):
- 결정성: 시드 RNG와 고정 시간 간격 시뮬레이션. 깨지면 테스트·재현 조건이 흔들린다
- `e2e/**`의 기존 검사 기준 약화·삭제·건너뛰기(공통 표 "기존 테스트 기준 약화")
- 런타임 외부 호출 추가, 외부 에셋·폰트·음원 도입(라이선스)
- 핵심 규칙의 의미 변경(절단 → 붕괴 → 낙하 규칙, 이동 가능 고도차). 승인된 설계가 바뀌면 사용자 결정

프로젝트별 예외(공통 기준보다 우선, 저위험):
- `src/config.ts`의 수치 조정만 하는 변경(규칙 의미는 그대로). 화면 영향 변경이므로 ①②는 필요하고 체감은 D절
- `docs/REPORT.md` 상태 기록, README 오탈자

## D. 사용자 판단 항목 (③층)

메인은 "어느 화면에서 무엇을 보고 판단할지"와 스크린샷 경로를 적는다.
- 핵심 재미: 등고선을 베어 지형을 무너뜨리는 것이 적을 직접 때리는 것보다 재미있는지(기본 모드 1~3웨이브)
- 조작감: 이동 속도, 대시 거리, 낙차 가속, 칼날 길이·쿨다운, 타격 멈춤·화면 흔들림의 세기
- 비주얼 방향: 형광 등고선 팔레트, 픽셀 밀도, 측량사·적 실루엣, 붕괴 연출
- 난이도·전투 밀도, 소리

HUD 겹침·잘림, 빈 화면, 콘솔 오류, 규칙과 실제 동작의 불일치는 ①②로 AI가 본다.

전환 기간: 실행 검증 도입 후 처음 5개 화면 영향 작업. 메인은 ①② 통과 항목도 "병행 확인"으로 다음 할 일에 넣고 n/5를 적는다.

| n | 작업 | ② 소견 | 사용자 확인 결과 | 놓침 |
|---|---|---|---|---|

## E. 승인 필요 행동 (헌법 2-12항에 추가)

- 외부 공개 배포(GitHub Pages 등)와 저장소 공개 범위 변경
- GitHub 저장소 설정 변경(브랜치 보호·병합 방식·비밀값). 최초 설정은 부트스트랩 때 사용자 지시로 수행(DECISIONS P-004)
- 외부 에셋·폰트·음원 도입
- CI 아티팩트 업로드 추가
- AI-Dev-Workflow 원본 저장소에 대한 모든 쓰기

## F. 브랜치·커밋·병합

| 항목 | 값 |
|---|---|
| 작업 브랜치 명명 | `feat/…` `fix/…` `tune/…` `docs/…` `chore/…` |
| 커밋 메시지 | 변경 요약(`feat: …` 형식). 고위험 리뷰 전 마지막 commit 본문에 목표·기준·검증 공백 요약 |
| 병합 방식 | merge commit — `gh pr merge <N> --merge --match-head-commit <확인한 head sha>` |
| up-to-date 필수 | 켬 |
| head 브랜치 자동 삭제 | 켬 |

병합 후 로컬 브랜치만 `git branch -d`.

## G. 도구·모델

| 항목 | 값 | 확인일 |
|---|---|---|
| 메인 기본 모델 별칭 / 실제 버전 | 사용자 설정 `opus` → `claude-opus-5-5` | 2026-10-14 |
| 상위 모델 (서브에이전트에 지정 가능한지) | Agent 도구에 `model` 인자(opus·sonnet·haiku·fable)가 있다. 실제 지정 호출은 미검증 | 2026-10-14 |
| 서브에이전트 정의 위치 | `.claude/agents/implementer.md`(model: inherit), `.claude/agents/reviewer.md`(model: sonnet, 읽기 전용) | 2026-10-14 |
| 독립 리뷰 명령 | 고위험 기본: `/codex:adversarial-review --wait --base main <목표·기준·검증 공백 요약>`. 단순 확인: `/codex:review --wait --base main`. 사용자 입력 전용(모델 호출 불가 `disable-model-invocation: true`) | 2026-10-14 |
| 진단 명령과 읽기 전용 지원 | `/codex:rescue`. 요청에 "읽기 전용 진단, 코드 수정 금지"를 명시. 기본은 쓰기 가능 | 2026-10-14 |
| 도구 버전 | Codex 플러그인 `codex@openai-codex` 1.0.6, Codex CLI 0.162.1, ChatGPT 구독 로그인 | 2026-10-14 |
| 자동 리뷰 게이트 / CI 자동 수정 | 끔(플러그인 기본값 `stopReviewGate: false`, 이 저장소용 상태 파일 없음) / 끔 | 2026-10-14 |
| 권한 규칙 | `.claude/settings.json`(deny/ask). 메인은 만든 뒤 이 파일과 `settings.local.json`을 고치지 않는다 — 사용자가 고친다 | 2026-10-14 |
| 공통 규칙 버전 | 원본 `misty-hollow/AI-Dev-Workflow` 커밋 `6eee919`(v1.2). 사본 없음 | 2026-10-14 |

## H. 데이터 분리와 커밋 제외

실행 검증의 격리:
- 브라우저: Playwright Test는 테스트마다 새 브라우저 컨텍스트를 만든다. 게임은 localStorage·IndexedDB를 쓰지 않는다
- 데스크톱: 해당 없음(배포 형태가 웹뿐)
- 세이브·외부 에셋 경로가 없다. 생기면 여기에 분리 방법을 적는다

절대 커밋하지 않는다: `.claude/settings.local.json`과 백업, 인증 정보·토큰·`.env*`, `node_modules/`, `dist/`, `test-results/`, `playwright-report/`.
`.claude/` 아래 파일은 개별 경로로만 `git add` 한다(`git add .claude/`·`git add -A` 금지).

## I. 기록

- `docs/DECISIONS.md`: WORKFLOW 9절 구성.
- `docs/REPORT.md`: WORKFLOW 5절 형식. 독립 리뷰 원문은 PR 코멘트에 두고 REPORT.md에는 요약만 적는다.
