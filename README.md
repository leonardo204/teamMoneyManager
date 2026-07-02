# 팀 부서비 운영 관리 웹앱 (teamMoneyManager)

> 팀 공용 부서비(인당 18만 원 × 팀원 수)를 **공정·투명하게 기록·배분·조회**하는 내부용 웹앱.

단일 공유 계정으로 로그인해, 매월 예산을 공용 카테고리와 개인 예산으로 나누고, 남는
자투리를 지정한 카테고리가 흡수하며, 지출을 기록하고 잔액을 한눈에 확인합니다. 외부 SaaS
의존 없이 단일 VM에서 `docker compose`로 자체 호스팅합니다.

- **백엔드**: Node.js 20 + Express (정적 서빙 + REST API 단일 서비스)
- **DB**: SQLite (`better-sqlite3`), 파일 `data/app.db` — 볼륨 마운트 대상
- **프런트**: 정적 HTML + CSS + 바닐라 JS (프레임워크 없음)
- **디자인**: light-console-ui 토큰(`public/design-tokens.css`) — 밝은 콘솔 톤, 색은 토큰만
- **상태**: 전 기능 구현 완료 (로그인·기간·설정·예산·지출·대시보드·내역/감사·배포)

---

## 핵심 개념 (도메인 규칙)

이 앱에서 가장 중요한 규칙 세 가지입니다 (상세: PRD 2장).

**1. 개인 예산은 전원 공통 "설정값"이고, 남는 자투리는 지정 카테고리가 흡수한다.**

```
총예산                 = 인당 금액(180,000) × 팀원 수 N            (N은 가변)
개인 예산 합           = 개인 예산(per_member_budget) × N + 개인 조정 합
자투리(surplus)        = 총예산 − 공용 카테고리 합 − 개인 예산 합
balancing 카테고리 최종 = 설정값 + 자투리        (기본 '야근'이 자투리 흡수)
팀원별 최종            = 개인 예산 + 본인 조정액
```

개인 예산은 팀원 개별 금액이 아니라 **전원 공통 설정값 하나**입니다. 총예산에서 공용 합과
개인 예산 합을 빼고 남는 **자투리**를 지정한 **balancing 카테고리(기본 '야근')** 가 흡수합니다.
어떤 설정·인원 조합에서도 **`공용 최종 합 + 팀원별 최종 합 = 총예산`이 정확히 성립**합니다(돈이
새거나 남지 않음). 개인 예산·공용 합이 총예산을 넘겨 **자투리가 음수가 되면 저장을 차단하고
경고**합니다. 생일축하금 등은 공용이 아니라 **개인 조정(±) 라인**으로 처리합니다.

**2. 월(YYYY-MM) 단위로 운영하며, 월 시작 스냅샷은 불변이다.**

매월 1일 한도가 새로 부여되고 미사용액은 **이월 없이 소멸**합니다. 카테고리 금액·개인 조정·
인원은 **월 시작 시점의 스냅샷**으로 고정되어, 이후 설정을 바꿔도 **과거 월 집계는 불변**입니다.
열려 있는 당월만 팀원 증감 시 즉시 재계산됩니다.

**3. 지출은 공용/개인 두 종류다.**

- **공용 지출**: 해당 카테고리 풀에서 차감 (누가 썼는지 무관).
- **개인 지출**: 대상 팀원의 개인 할당에서 차감 (단일 계정이라 대상 팀원을 직접 선택).

---

## 주요 기능

화면은 상단 탭 3개로 구성됩니다.

| 탭 | 기능 |
|----|------|
| **대시보드** | 카테고리별 배정·사용·잔액 카드(소진 상태 배지), 팀원별 할당·사용·잔액 표, 전체 소진율, 카드1·2 사용 집계 |
| **설정** | 예산 실시간 미리보기(자투리·balancing 최종액), 팀원 관리(추가·수정·비활성/삭제), 공용 카테고리 단일 관리, 인당 금액·개인 예산·자투리 흡수 카테고리(balancing) 설정, 개인 조정(±), **비밀번호 변경** |
| **내역** | 지출 목록·필터(분류·팀원·카드), 수정·삭제, 변경 이력(감사 로그) |

지출 입력은 어느 화면에서든 헤더의 **"+ 지출 입력"** 버튼(빠른 금액 버튼·공용/개인 토글)으로.

- 로그인: 단일 공유 비밀번호(bcrypt) → 서명 httpOnly JWT 쿠키
- 팀원 증감 시 당월 총예산·자투리(balancing 카테고리 배정) 자동 반영 (지출 있는 팀원은 삭제 대신 비활성)
- 지출 수정·삭제는 당월만 허용(과거 월 잠금), 모든 변경은 `audit_logs`에 기록
- 과거 월도 기간 선택으로 조회 가능(집계 불변)

---

## 빠른 시작 (로컬)

```bash
npm install

# 최초 1회: 비밀번호·시크릿을 담은 .env 생성 (아래 "로그인·비밀번호" 참조)
cp .env.example .env
#   APP_PASSWORD_HASH=$(npm run hash-pw '원하는비밀번호' 로 생성한 해시)
#   JWT_SECRET=$(openssl rand -hex 32)

npm start
# 접속: http://localhost:49876/login
```

- 리슨 포트는 기본 **49876**(private 포트, 로컬·컨테이너 동일). well-known 8080은 충돌 회피로 쓰지 않습니다.
- `npm start`는 프로젝트 루트의 `.env`를 자동 로드합니다(`--env-file-if-exists`).
- 최초 기동 시 `data/app.db`가 없으면 스키마·기본값이 자동 시드됩니다.
- 포트 변경: `PORT=<원하는포트> npm start` · 스키마만 초기화: `npm run init-db`
- 헬스체크: `curl -s http://localhost:49876/api/health` → `{"ok":true}`

> `better-sqlite3`는 네이티브 모듈입니다. 로컬 설치 실패 시 Node 20/툴체인(Python3, 빌드 도구)이
> 필요할 수 있으며, 그 경우 아래 Docker 실행을 사용하세요.

---

## 로그인·비밀번호

단일 **공유 비밀번호**로 접근을 통제합니다. 성공 시 서명된 httpOnly 쿠키(JWT)가 발급되고,
미인증 접근은 로그인 페이지(HTML)로 리다이렉트되거나 401(API)을 받습니다.

**초기(부트스트랩) 비밀번호** — 최초 기동 시 DB에 비밀번호 해시가 없으면 `.env`의
`APP_PASSWORD_HASH`로 1회 채워집니다. 즉 **초기 로그인 비밀번호는 `.env`에 넣은 해시의
평문**입니다. (해시는 `npm run hash-pw '<비밀번호>'`로 생성.)

```bash
npm run hash-pw '원하는비밀번호'      # 출력된 $2a$10$... 해시를 .env의 APP_PASSWORD_HASH에
```

**비밀번호 변경** — 로그인 후 **설정 탭 → 비밀번호 변경**에서 현재/새 비밀번호로 바꿉니다.
변경된 해시는 **DB(볼륨)에 저장**되어 재기동해도 유지되며, 이후로는 `.env`가 이를 덮어쓰지
않습니다(설정 화면이 단일 관리 지점). `PUT /api/password`는 현재 비밀번호 검증 + 최소 8자
정책을 강제하고, 감사 로그에는 평문·해시를 남기지 않습니다.

- `APP_PASSWORD_HASH`(env)와 DB 해시가 **둘 다 없으면** 로그인은 항상 실패(fail-closed)하고 서버 로그에 경고가 남습니다.
- 세션 쿠키(`session`)는 httpOnly · sameSite=lax · 만료 30일. `NODE_ENV=production`에서만 `secure` 플래그가 켜집니다(HTTPS 리버스 프록시 뒤 권장).
- 공개 경로(무인증): `GET /login`, `POST /api/login`, `POST /api/logout`, `GET /api/health`, 정적 자산(css/js). 그 외는 인증 필요.
- **보안**: 저장소에는 비밀번호 평문·해시를 두지 않습니다. `.env`는 `.gitignore` 처리되어 커밋/공개되지 않습니다.

---

## Docker 배포 (단일 VM, NFR-01)

`docker compose up -d --build` 한 번으로 기동됩니다. 데이터는 named 볼륨에 영속되어 파일
복사만으로 백업됩니다(NFR-02).

### 1) 사전 요구
- Docker Engine 20+ 와 **Docker Compose v2.24+** (`env_file` raw 형식 사용 — `docker compose version`으로 확인)
- 인바운드 포트 **49876**(HTTP 직결) 개방. HTTPS를 쓸 경우 **80/443**.

### 2) `.env` 작성
```bash
cp .env.example .env
npm run hash-pw '원하는비밀번호'        # → APP_PASSWORD_HASH
openssl rand -hex 32                     # → JWT_SECRET
```
`.env`는 **절대 커밋하지 않습니다**(`.gitignore` 포함). 저장소에는 `.env.example`만 둡니다.

### 3) 기동
```bash
docker compose up -d --build
docker compose ps                        # STATUS 가 healthy 인지 확인
# 접속: http://<VM_IP>:49876
```
- 포트 매핑 `"49876:49876"`. 최초 기동 시 볼륨에 `app.db`가 없으면 스키마·시드가 자동 생성됩니다.
- 헬스체크: 컨테이너가 node 내장 fetch로 `/api/health`를 주기 확인합니다(curl/wget 불요).

### 4) 운영 명령
```bash
docker compose logs -f app              # 로그 실시간
docker compose restart app              # 재시작(볼륨 유지)
docker compose down                     # 종료(볼륨 유지 — 데이터 보존)
docker compose down -v                  # 종료 + 볼륨 삭제(데이터 소멸, 주의)
```

### 5) 업데이트
```bash
git pull
docker compose up -d --build            # 이미지 재빌드 후 교체 (볼륨 데이터 보존)
```

---

## 환경변수

| 변수 | 설명 | 생성 예시 |
|------|------|-----------|
| `APP_PASSWORD_HASH` | 초기(부트스트랩) 로그인 비밀번호의 bcrypt 해시. 최초 기동 후엔 설정 화면에서 변경(DB 저장) | `npm run hash-pw '비밀번호'` |
| `JWT_SECRET` | JWT 서명용 랜덤 시크릿 | `openssl rand -hex 32` |
| `PORT` | 리슨 포트 (기본 49876) | — |
| `NODE_ENV` | `production`이면 쿠키 `secure` 활성 (HTTPS 뒤에서만) | 기본 미설정 |

---

## 데이터 백업·복원 (NFR-02)

SQLite 파일 하나(`app.db`)가 전체 상태입니다. Docker 배포에서는 named 볼륨
`teammoneymanager_data`에, 로컬 실행은 `data/` 디렉토리에 저장됩니다.

```bash
# 백업 (./backups/app-db-YYYYmmdd-HHMMSS.tar.gz 생성)
./scripts/backup.sh

# 수동 백업
docker run --rm -v teammoneymanager_data:/data:ro -v "$PWD":/backup busybox \
  tar czf /backup/app-db-backup.tar.gz -C /data .

# 복원
docker compose down                     # (-v 금지: 볼륨 유지)
docker run --rm -v teammoneymanager_data:/data -v "$PWD":/backup busybox \
  sh -c "rm -rf /data/* && tar xzf /backup/app-db-backup.tar.gz -C /data"
docker compose up -d
```

- 완전한 일관성을 원하면 백업 전 `docker compose stop app` 권장(SQLite WAL 반영).
- 로컬 실행이면 `data/` 디렉토리 자체를 복사/교체하면 됩니다.

---

## (선택) HTTPS — Caddy 리버스 프록시 (NFR-05)

도메인이 있으면 `Caddyfile`과 compose의 `caddy` 서비스로 HTTPS를 자동 적용할 수 있습니다.
도메인이 없으면 생략하고 `http://<VM_IP>:49876`으로 접속합니다.

1. `Caddyfile`의 `example.com`을 실제 도메인으로, `email`을 관리자 주소로 교체.
2. DNS A/AAAA 레코드가 이 VM 공인 IP를 가리키고 **80/443**이 열려 있어야 합니다.
3. `.env`에 `NODE_ENV=production` 설정(세션 쿠키 `secure` 활성 — HTTPS 필수).
4. `docker compose --profile https up -d --build`

Caddy가 Let's Encrypt 인증서를 자동 발급/갱신하고 `app:49876`으로 리버스 프록시합니다.

---

## API 요약

모든 `/api/*`(로그인·헬스 제외)는 인증 쿠키가 필요합니다. 조회·집계는 `?period=YYYY-MM`(기본 당월)을 받습니다.

| 메서드·경로 | 설명 |
|------|------|
| `POST /api/login` · `POST /api/logout` | 로그인/로그아웃 |
| `PUT /api/password` | 비밀번호 변경(현재+새) |
| `GET/PUT /api/settings` | 인당 금액·개인 예산(per_member_budget)·자투리 흡수 카테고리(balancing) — 음수 자투리 저장 시 400 |
| `GET/POST/PUT/DELETE /api/members` | 팀원 관리(삭제 시 지출 있으면 409) |
| `GET/POST/PUT/DELETE /api/category-templates` | 카테고리 단일 관리(편집 시 당월 스냅샷 동기화, 과거 월 불변) |
| `GET /api/periods` · `GET /api/periods/:period[/categories]` | 기간 목록·스냅샷(당월 시드) |
| `PUT/POST/DELETE /api/periods/:period/categories[/:id]` | 당월 카테고리(과거 월 409) |
| `GET/POST/PUT/DELETE /api/adjustments` | 개인 조정(±) |
| `GET /api/allocation` · `POST /api/allocation/preview` | 개인 예산·자투리 계산·실시간 미리보기(preview 입력에 per_member_budget) |
| `GET/POST/PUT/DELETE /api/transactions[/:id]` | 지출 입력·수정·삭제(당월만, 감사 기록) |
| `GET /api/dashboard` | 카테고리·팀원 잔액·소진율·카드 집계 |
| `GET /api/audit-logs` | 변경 이력 |

---

## 프로젝트 구조

```
src/
  server.js      Express 앱 · 전 API 라우트 · 인증 게이트
  db.js          SQLite 스키마·시드·마이그레이션·ensurePeriod
  auth.js        JWT 서명/검증 · requireAuth 미들웨어 · 쿠키 옵션
  budget.js      computeAllocation() 순수 산식(불변식 보장)
  period.js      currentPeriod()/isValidPeriod() 기간 유틸
  hash-pw.js     bcrypt 해시 생성 도우미
  init-db.js     스키마 초기화 스크립트
views/           login.html · index.html (인증 후 앱 셸)
public/          design-tokens.css · app.js (정적 자산)
scripts/backup.sh  data 볼륨 백업
Dockerfile · docker-compose.yml · Caddyfile · .env.example
```

### 데이터 모델
`settings`, `members`, `category_templates`, `period_meta`, `period_categories`,
`adjustments`, `transactions`, `audit_logs` — 상세는 PRD 4.3 참조.
초기 시드: `settings.per_person = 180000`, `per_member_budget = 0`, `balancing_category = '야근'`, `category_templates` = 야근 400,000 / 커피 210,000 / 간식 100,000 / 회식 100,000. `period_meta`에는 인원과 함께 인당 금액·개인 예산·balancing 카테고리가 월 스냅샷으로 저장됩니다.

---

## 참조

- 요구사항·설계(PRD): [`ref-docs/specs/design/부서비-운영관리-웹앱-PRD.md`](ref-docs/specs/design/부서비-운영관리-웹앱-PRD.md)
- 개발 가이드: [`CLAUDE.md`](CLAUDE.md)
