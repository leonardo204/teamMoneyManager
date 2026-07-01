# 팀 부서비 운영 관리 웹앱 (teamMoneyManager)

팀 공용 부서비(인당 18만 원 × 팀원 수)를 공정·투명하게 기록·배분·조회하는 내부용 웹앱.

- 백엔드: Node.js 20 + Express (정적 서빙 + REST API 단일 서비스)
- DB: SQLite (`better-sqlite3`), 파일 `data/app.db` — 볼륨 마운트 대상
- 프런트: 정적 HTML + CSS + 바닐라 JS (프레임워크 없음)
- 디자인: light-console-ui 토큰(`public/design-tokens.css`)

> 현재 상태: **전 기능 구현 완료(T1~T9)** — 로그인 게이트, 기간·시드, 팀원·설정,
> 예산 계산, 지출 입력, 대시보드, 내역·감사로그, compose 배포·백업까지 완성.

---

## 로컬 실행

```bash
npm install
npm start
# 접속: http://localhost:49876
```

- 리슨 포트는 기본 **49876**(private 포트, 로컬·컨테이너 동일). well-known 8080은 충돌 회피로 쓰지 않습니다.
- 최초 기동 시 `data/app.db`가 없으면 스키마가 자동 생성되고 기본값이 시드됩니다.
- 포트를 바꾸려면: `PORT=<원하는포트> npm start`
- 스키마만 초기화: `npm run init-db`
- 헬스체크: `curl -s http://localhost:49876/api/health` → `{"ok":true}`

> `better-sqlite3`는 네이티브 모듈입니다. 로컬 설치 실패 시 Node 20/툴체인(Python3, 빌드 도구)이
> 필요할 수 있으며, 그 경우 아래 Docker 실행을 사용하세요.

---

## Docker 배포 (단일 VM, NFR-01)

단일 Linux VM에서 `docker compose up -d --build` 한 번으로 기동됩니다. 외부 SaaS 의존이
없고(NFR-01), 데이터는 named 볼륨에 영속되어 파일 복사만으로 백업됩니다(NFR-02).

### 1) 사전 요구

- Docker Engine 20+ 와 Docker Compose v2 (`docker compose version`으로 확인)
- 인바운드 포트 **49876**(HTTP 직결) 개방. HTTPS를 쓸 경우 **80/443**.

### 2) `.env` 작성

```bash
cp .env.example .env

# 공유 로그인 비밀번호의 bcrypt 해시 생성 → APP_PASSWORD_HASH 에 붙여넣기
npm run hash-pw '원하는비밀번호'        # (Node 미설치 VM이면 아래 openssl/host에서 생성)

# JWT 서명 시크릿 생성 → JWT_SECRET 에 붙여넣기
openssl rand -hex 32
```

`.env`는 **절대 커밋하지 않습니다**(`.gitignore`에 포함). `.env.example`만 저장소에 둡니다.

### 3) 기동

```bash
docker compose up -d --build
docker compose ps                       # STATUS 가 healthy 인지 확인
# 접속: http://<VM_IP>:49876
```

- 포트 **49876** (private 포트, 로컬·컨테이너 동일, `"49876:49876"`). well-known 8080은
  충돌 회피로 쓰지 않습니다.
- 최초 기동 시 볼륨에 `app.db`가 없으면 스키마·시드가 자동 생성됩니다.
- 헬스체크: 컨테이너가 node 내장 fetch로 `/api/health`를 주기 확인합니다(curl/wget 불요).

### 4) 운영 명령

```bash
docker compose logs -f app              # 로그 실시간
docker compose config                   # compose 문법 검증
docker compose restart app              # 재시작(볼륨 유지)
docker compose down                     # 종료(볼륨 유지 — 데이터 보존)
docker compose down -v                  # 종료 + 볼륨 삭제(데이터 소멸, 주의)
```

### 5) 업데이트 (새 버전 배포)

```bash
git pull
docker compose up -d --build            # 이미지 재빌드 후 무중단에 가깝게 교체
```

데이터는 볼륨에 있으므로 재빌드해도 보존됩니다.

---

## 환경변수

`.env.example`를 `.env`로 복사해 채웁니다 (실제 `.env`는 커밋 금지).

| 변수 | 설명 | 생성 예시 |
|------|------|-----------|
| `APP_PASSWORD_HASH` | 공유 로그인 비밀번호의 bcrypt 해시 | `npm run hash-pw '비밀번호'` |
| `JWT_SECRET` | JWT 서명용 랜덤 시크릿 | `openssl rand -hex 32` |
| `PORT` | 리슨 포트 (기본 49876) | — |
| `NODE_ENV` | `production`이면 쿠키 `secure` 활성 (HTTPS 뒤에서만) | 기본 미설정 |

---

## 로그인 설정 (FR-01)

단일 **공유 비밀번호**로 접근을 통제하는 게이트입니다. 성공 시 서명된 httpOnly 쿠키(JWT)가
발급되고, 미인증 접근은 로그인 페이지(HTML)로 리다이렉트되거나 401(API)을 받습니다.

**1) 비밀번호 해시 생성** — 평문 비밀번호는 어디에도 저장하지 않고, bcrypt 해시만 보관합니다.

```bash
npm run hash-pw '원하는비밀번호'
# 예: $2a$10$....  ← 출력된 해시 한 줄을 복사
```

**2) `.env`에 설정** — 생성한 해시와 JWT 시크릿을 채웁니다.

```bash
cp .env.example .env
# .env 편집:
#   APP_PASSWORD_HASH=<위에서 출력된 해시>
#   JWT_SECRET=<랜덤 시크릿, 예: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
```

**3) 기동 후 로그인** — 서버를 띄우고 `/login`에서 비밀번호를 입력합니다.

```bash
npm start            # 또는 docker compose up -d
# 브라우저: http://localhost:49876/login  (로컬·Docker 동일)
```

- `APP_PASSWORD_HASH` 미설정 시 로그인은 항상 실패(fail-closed)하며 서버 로그에 경고가 남습니다.
- 세션 쿠키(`session`)는 httpOnly · sameSite=lax · 만료 30일. `NODE_ENV=production`에서만 `secure` 플래그가 켜집니다(HTTPS 리버스 프록시 뒤 권장).
- 공개 경로(무인증): `GET /login`, `POST /api/login`, `POST /api/logout`, `GET /api/health`, 정적 자산(css/js). 그 외는 인증 필요.

---

## 데이터 백업·복원 (NFR-02)

SQLite 파일 하나(`app.db`)가 전체 상태입니다. Docker 배포에서는 named 볼륨
`teammoneymanager_data`에 저장됩니다(로컬 실행은 `data/` 디렉토리).

### 백업

```bash
# 스크립트: ./backups/app-db-YYYYmmdd-HHMMSS.tar.gz 생성 + 내용 목록 출력
./scripts/backup.sh

# 또는 수동 (동일 동작)
docker run --rm -v teammoneymanager_data:/data:ro -v "$PWD":/backup busybox \
  tar czf /backup/app-db-backup.tar.gz -C /data .
```

- 완전한 일관성을 원하면 백업 전 `docker compose stop app` 권장(SQLite WAL 반영).
- 생성된 `tar.gz`를 안전한 위치로 복사하면 백업 완료입니다.

### 복원

```bash
docker compose down                     # 앱 정지(-v 금지: 볼륨 유지)
docker run --rm -v teammoneymanager_data:/data -v "$PWD":/backup busybox \
  sh -c "rm -rf /data/* && tar xzf /backup/app-db-backup.tar.gz -C /data"
docker compose up -d
```

로컬 실행이면 `data/` 디렉토리 자체를 복사/교체하면 됩니다.

---

## (선택) HTTPS — Caddy 리버스 프록시 (NFR-05)

도메인이 있으면 `Caddyfile`과 compose의 `caddy` 서비스로 HTTPS를 자동 적용할 수 있습니다.
도메인이 없으면 이 섹션을 생략하고 `http://<VM_IP>:49876`으로 접속합니다.

1. `Caddyfile`의 `example.com`을 실제 도메인으로, `email`을 관리자 주소로 교체.
2. DNS A/AAAA 레코드가 이 VM 공인 IP를 가리키고 **80/443**이 열려 있어야 합니다.
3. `.env`에 `NODE_ENV=production`을 설정(세션 쿠키 `secure` 활성 — HTTPS 필수).
4. `caddy` 프로파일로 기동:

```bash
docker compose --profile https up -d --build
```

Caddy가 Let's Encrypt 인증서를 자동 발급/갱신하고 `app:49876`으로 리버스 프록시합니다.

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
