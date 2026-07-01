# 팀 부서비 운영 관리 웹앱 (teamMoneyManager)

팀 공용 부서비(인당 18만 원 × 팀원 수)를 공정·투명하게 기록·배분·조회하는 내부용 웹앱.

- 백엔드: Node.js 20 + Express (정적 서빙 + REST API 단일 서비스)
- DB: SQLite (`better-sqlite3`), 파일 `data/app.db` — 볼륨 마운트 대상
- 프런트: 정적 HTML + CSS + 바닐라 JS (프레임워크 없음)
- 디자인: light-console-ui 토큰(`public/design-tokens.css`)

> 현재 상태: **T1 스캐폴딩** — 서버 골격, DB 스키마·시드, 기본 UI 셸만 구현됨.
> 로그인·설정·예산 배분·지출·대시보드·내역은 후속 태스크.

---

## 로컬 실행

```bash
npm install
npm start
# 접속: http://localhost:8080
```

- 최초 기동 시 `data/app.db`가 없으면 스키마가 자동 생성되고 기본값이 시드됩니다.
- 포트를 바꾸려면: `PORT=49876 npm start`
- 스키마만 초기화: `npm run init-db`
- 헬스체크: `curl -s http://localhost:8080/api/health` → `{"ok":true}`

> `better-sqlite3`는 네이티브 모듈입니다. 로컬 설치 실패 시 Node 20/툴체인(Python3, 빌드 도구)이
> 필요할 수 있으며, 그 경우 아래 Docker 실행을 사용하세요.

---

## Docker 실행

```bash
cp .env.example .env      # 값 채우기 (APP_PASSWORD_HASH, JWT_SECRET)
docker compose up -d
# 접속: http://localhost:49876
```

- 호스트 포트 **49876** → 컨테이너 내부 **8080** 매핑 (`"49876:8080"`).
  호스트 8080은 이미 사용 중이므로 쓰지 않습니다.
- compose 문법 검증: `docker compose config`
- 로그: `docker compose logs -f app`
- 종료: `docker compose down`

---

## 환경변수

`.env.example`를 `.env`로 복사해 채웁니다 (실제 `.env`는 커밋 금지).

| 변수 | 설명 | 생성 예시 |
|------|------|-----------|
| `APP_PASSWORD_HASH` | 공유 로그인 비밀번호의 bcrypt 해시 | `node -e "console.log(require('bcryptjs').hashSync('비밀번호',10))"` |
| `JWT_SECRET` | JWT 서명용 랜덤 시크릿 | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT` | 컨테이너/프로세스 리슨 포트 (기본 8080) | — |

---

## 데이터 백업

SQLite 파일 하나(`data/app.db`)가 전체 상태입니다.

- 로컬: `data/` 디렉토리를 복사.
- Docker: 명명 볼륨 `data`를 백업.

```bash
# Docker 볼륨 백업 예시
docker run --rm -v teammoneymanager_data:/data -v "$PWD":/backup busybox \
  tar czf /backup/app-db-backup.tgz -C /data .
```

---

## 데이터 모델 (요약)

`settings`, `members`, `category_templates`, `period_meta`, `period_categories`,
`adjustments`, `transactions`, `audit_logs` — 상세는 PRD 4.3 참조.

초기 시드: `settings.per_person = 180000`,
`category_templates` = 야근 400,000 / 커피 210,000 / 간식 100,000 / 회식 100,000.

---

## 참조

- 요구사항·설계: [`ref-docs/specs/design/부서비-운영관리-웹앱-PRD.md`](ref-docs/specs/design/부서비-운영관리-웹앱-PRD.md)
- 개발 가이드: [`CLAUDE.md`](CLAUDE.md)
