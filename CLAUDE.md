# Claude Code 개발 가이드

> 공통 규칙(Agent Delegation, 커밋 정책, Context DB 등)은 글로벌 설정(`~/.claude/CLAUDE.md`)을 따릅니다.
> 글로벌 미설치 시: `curl -fsSL https://raw.githubusercontent.com/leonardo204/dotclaude/main/install.sh | bash`

---

## Slim 정책

이 파일은 **100줄 이하**를 유지한다. 새 지침 추가 시:
1. 매 턴 참조 필요 → 이 파일에 1줄 추가
2. 상세/예시/테이블 → ref-docs/*.md에 작성 후 여기서 참조
3. ref-docs 헤더: `# 제목 — 한 줄 설명` (모델이 첫 줄만 보고 필요 여부 판단)

---

## PROJECT

### 개요

**teamMoneyManager (팀 부서비 운영 관리 웹앱)** — 팀 공용 부서비(인당 18만 원 × 인원)를 공정·투명하게 기록·배분·조회하는 내부용 웹앱.

| 항목 | 값 |
|------|-----|
| 기술 스택 | Node.js 20 + Express · SQLite(볼륨) · 정적 HTML/CSS/바닐라 JS · docker-compose · (선택) Caddy HTTPS |
| 인증 | 단일 공유 비밀번호(bcrypt 해시) → 서명 httpOnly JWT 쿠키 |
| 빌드/실행 | `docker compose up -d` (단일 VM 자체 호스팅, 외부 SaaS 무의존) |
| 상태 | 기획 완료(PRD v0.3) · 구현 착수 전 |

### 핵심 도메인 규칙 (PRD 2장)

- **개인 예산은 전원 공통 "설정값"**(`per_member_budget`): 팀원별 최종 = 개인 예산 + 본인 조정. (옛 "잔여값 ÷ N" 모델 폐기)
- **자투리(surplus)** = `총예산(per_person×N) − 공용 합 − (개인 예산×N + 조정 합)` → 지정 **balancing 카테고리(기본 '야근')가 전액 흡수**. 불변식: `공용 최종 합 + 팀원별 최종 합 = 총예산`.
- **음수 자투리(개인+공용 합 > 총예산) 저장 차단·경고**(400). 카테고리 편집은 **템플릿 단일 UI**(당월 스냅샷만 동기화, 과거 월 불변).
- **월(YYYY-MM) 단위** 운영: 매월 1일 한도 재부여, 미사용액 **이월 없이 소멸**. 카테고리·조정·인원·인당 금액·개인 예산·balancing은 **월 시작 스냅샷**으로 고정 → 과거 월 집계 불변.
- 지출은 **공용(카테고리 풀 차감)** / **개인(대상 팀원 할당 차감)** 두 종류. 생일축하금은 공용이 아니라 **개인 조정(±) 라인**.
- 지출 있는 팀원 삭제는 **경고/비활성 처리**(정합성 보호). 수정·삭제는 `audit_logs` 기록(FR-12).

### 핵심 구현 규칙

- **디자인**: light-console-ui 토큰(`design-tokens.css`) 준수. **하드코딩 hex 금지**, 색은 `var(--…)` 토큰만(NFR-04). `.modal-overlay[hidden]` 가드 유지.
- 완료 선언 전 검증 증거 필수(빌드/기동 확인). 커밋은 사용자 명시 요청 전까지 금지.

### 문서 구조 (소유권 분리)

- **하니스 문서** (`ref-docs/claude/` 하위) — 🔒 dotclaude 소유. `dotclaude-update`가 덮어쓰니 **수정 금지**.
- **프로젝트 스펙** (`ref-docs/specs/` 하위) — 📝 자유롭게 작성. → [SDD 가이드라인](ref-docs/claude/sdd.md) · `/spec-guard`로 정합성 분석
  - 현재 스펙: [부서비 운영 관리 웹앱 PRD](ref-docs/specs/design/부서비-운영관리-웹앱-PRD.md) (design, v0.4.0)

### 하니스 상세 문서 (ref-docs/claude/)

- [Context DB](ref-docs/claude/context-db.md) — SQLite 기반 세션/태스크/결정 저장소
- [Context Monitor](ref-docs/claude/context-monitor.md) — HUD + compaction 감지/복구
- [Hooks](ref-docs/claude/hooks.md) — 5개 자동 실행 Hook 상세
- [컨벤션](ref-docs/claude/conventions.md) — 커밋, 주석, 로깅 규칙
- [셋업](ref-docs/claude/setup.md) — 새 환경 초기 설정
- [Agent Delegation](ref-docs/claude/agent-delegation.md) — 에이전트 위임/파이프라인 상세
- [SDD 가이드라인](ref-docs/claude/sdd.md) — 스펙 문서 작성/관리 규약

> 프로젝트 스펙은 `ref-docs/specs/`에 작성하고, 하니스 문서(`ref-docs/claude/`)는 건드리지 마세요.

---

*최종 업데이트: 2026-07-02*
