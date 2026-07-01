// src/server.js
// Express 앱: 로그인 게이트(FR-01) + 정적 자산 서빙 + REST API.
// 서버 시작 시 DB 파일이 없으면 getDb()가 디렉토리 생성·스키마 초기화·시드를 자동 수행.
// PORT 환경변수(기본 49876 — private 포트)로 리슨. 로컬/컨테이너 모두 동일 포트 사용.
//
// 정적 서빙 주의: 보호 대상 앱 셸(index.html)은 views/에 두고 라우트로만 전송한다.
// express.static(public, {index:false})는 css/js 등 공개 자산만 서빙(무인증 허용).

import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, DB_PATH, ensurePeriod } from './db.js';
import { currentPeriod, isValidPeriod } from './period.js';
import { computeAllocation } from './budget.js';
import {
  SESSION_COOKIE,
  signSession,
  cookieOptions,
  clearCookieOptions,
  requireAuth,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const VIEWS_DIR = path.resolve(__dirname, '..', 'views');
const PORT = Number(process.env.PORT) || 49876;

// DB 초기화(파일 없으면 스키마 자동 생성 + 시드).
const db = getDb();

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- 공개 API (인증 불필요) -----------------------------------------------
// 헬스체크: 서버·DB 기동 확인.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// 현재 로그인 비밀번호 해시를 DB(settings.password_hash)에서 읽는다(단일 소스).
// env(APP_PASSWORD_HASH)는 최초 부트스트랩(ensurePasswordHash)에서만 쓰이고,
// 이후 검증·변경은 모두 DB 해시를 기준으로 한다(런타임 변경분 보존).
function getPasswordHash() {
  const row = db.prepare('SELECT password_hash FROM settings WHERE id = 1').get();
  return row ? row.password_hash : null;
}

// 로그인: 공유 비밀번호(bcrypt 해시) 검증 후 세션 쿠키 발급.
app.post('/api/login', async (req, res) => {
  const { password } = req.body || {};
  const hash = getPasswordHash();

  // fail-closed: 해시 미설정이면 항상 거부하고 명확히 경고한다.
  if (!hash) {
    // eslint-disable-next-line no-console
    console.warn(
      '[auth] settings.password_hash is not set — 모든 로그인이 거부됩니다(fail-closed). ' +
        "최초 기동 시 APP_PASSWORD_HASH(env)로 부트스트랩되며, `npm run hash-pw '<비밀번호>'`로 " +
        '해시를 생성해 .env에 설정한 뒤 재기동하세요.',
    );
    return res.status(401).json({ ok: false, error: 'invalid password' });
  }

  if (typeof password !== 'string' || password.length === 0) {
    return res.status(401).json({ ok: false, error: 'invalid password' });
  }

  let match = false;
  try {
    match = await bcrypt.compare(password, hash);
  } catch {
    match = false;
  }

  if (!match) {
    return res.status(401).json({ ok: false, error: 'invalid password' });
  }

  // JWT_SECRET 미설정이면 서명 불가 → fail-closed.
  let token;
  try {
    token = signSession();
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[auth] JWT_SECRET is not set — 세션 발급 불가(fail-closed).');
    return res.status(401).json({ ok: false, error: 'invalid password' });
  }

  res.cookie(SESSION_COOKIE, token, cookieOptions());
  return res.json({ ok: true });
});

// 로그아웃: 세션 쿠키 제거.
app.post('/api/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, clearCookieOptions());
  res.json({ ok: true });
});

// 로그인 페이지(무인증 접근 가능).
app.get('/login', (_req, res) => {
  res.sendFile(path.join(VIEWS_DIR, 'login.html'));
});

// --- 공개 정적 자산 (css/js/폰트) -----------------------------------------
// index:false → 디렉토리 index.html 자동 서빙 금지(보호 대상 셸 유출 방지).
app.use(express.static(PUBLIC_DIR, { index: false }));

// --- 인증 게이트 -----------------------------------------------------------
// 이 지점 이후의 모든 라우트는 인증 필요.
// 미인증: /api/* → 401 JSON, 그 외(HTML) → 302 /login.
app.use(requireAuth);

// --- 보호 라우트 -----------------------------------------------------------
// 앱 셸(index.html)은 인증 후에만 전송.
app.get(['/', '/index.html'], (_req, res) => {
  res.sendFile(path.join(VIEWS_DIR, 'index.html'));
});

// --- 기간·시드 API (FR-11) -------------------------------------------------
// 회계 단위는 월(YYYY-MM). 월 최초 접근 시 그 시점 템플릿·인원으로 스냅샷 시드(불변).

// 기간 목록 + 당월. 호출 시 당월을 우선 보장(ensurePeriod)한 뒤 존재 월을 최신순으로 반환.
app.get('/api/periods', (_req, res) => {
  const current = currentPeriod();
  ensurePeriod(db, current);

  const rows = db
    .prepare('SELECT period FROM period_meta ORDER BY period DESC')
    .all();
  const periods = rows.map((r) => r.period);
  if (!periods.includes(current)) {
    periods.unshift(current);
    periods.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // 내림차순 유지
  }

  res.json({ current, periods });
});

// 해당 월 메타(인원·총예산)만.
app.get('/api/periods/:period', (req, res) => {
  const { period } = req.params;
  if (!isValidPeriod(period)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }
  ensurePeriod(db, period);

  const meta = db
    .prepare('SELECT member_count FROM period_meta WHERE period = ?')
    .get(period);
  const perPerson = db.prepare('SELECT per_person FROM settings WHERE id = 1').get().per_person;
  const memberCount = meta ? meta.member_count : 0;

  return res.json({
    period,
    member_count: memberCount,
    per_person: perPerson,
    total_budget: perPerson * memberCount,
  });
});

// 해당 월의 공용 카테고리 스냅샷 + 인원·총예산.
app.get('/api/periods/:period/categories', (req, res) => {
  const { period } = req.params;
  if (!isValidPeriod(period)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }
  ensurePeriod(db, period);

  const categories = db
    .prepare('SELECT id, name, amount FROM period_categories WHERE period = ? ORDER BY id')
    .all(period);
  const meta = db
    .prepare('SELECT member_count FROM period_meta WHERE period = ?')
    .get(period);
  const perPerson = db.prepare('SELECT per_person FROM settings WHERE id = 1').get().per_person;
  const memberCount = meta ? meta.member_count : 0;

  return res.json({
    period,
    categories,
    member_count: memberCount,
    per_person: perPerson,
    total_budget: perPerson * memberCount,
  });
});

// --- 당월 인원 동기화 헬퍼 (FR-03, PRD 2.4) --------------------------------
// 팀원 생성/삭제/active 변경 후 호출. 열려 있는 당월 스냅샷만 현재 active 인원으로
// 즉시 갱신한다. 과거 월 period_meta는 절대 건드리지 않는다(스냅샷 불변).
function syncCurrentPeriodMemberCount() {
  const cur = currentPeriod();
  ensurePeriod(db, cur);
  const n = db.prepare('SELECT COUNT(*) AS n FROM members WHERE active = 1').get().n;
  db.prepare('UPDATE period_meta SET member_count = ? WHERE period = ?').run(n, cur);
}

// period < currentPeriod() 이면 과거 월(쓰기 금지 대상).
function isPastPeriod(period) {
  return period < currentPeriod();
}

// --- 설정: 인당 금액 (FR-02 관련, per_person) ------------------------------
app.get('/api/settings', (_req, res) => {
  const row = db.prepare('SELECT per_person FROM settings WHERE id = 1').get();
  res.json({ per_person: row ? row.per_person : 0 });
});

app.put('/api/settings', (req, res) => {
  const { per_person } = req.body || {};
  if (!Number.isInteger(per_person) || per_person <= 0) {
    return res.status(400).json({ ok: false, error: 'invalid per_person' });
  }
  db.prepare('UPDATE settings SET per_person = ? WHERE id = 1').run(per_person);
  return res.json({ ok: true, per_person });
});

// --- 비밀번호 변경 (FR-01 확장) --------------------------------------------
// PUT /api/password  body: { current_password, new_password }
// requireAuth 뒤에서만 접근 가능(로그인된 세션). 현재 DB 해시로 current_password를
// 검증하고, 통과 시 새 비밀번호를 bcrypt 해시해 settings.password_hash에 저장한다.
// 민감정보(평문·해시)는 응답/로그/감사기록 어디에도 남기지 않는다.
app.put('/api/password', async (req, res) => {
  const { current_password, new_password } = req.body || {};

  const dbHash = getPasswordHash();
  // 현재 해시가 없으면(fail-closed 상태) 검증 불가 → 401.
  if (!dbHash) {
    return res.status(401).json({ ok: false, error: 'invalid_current_password' });
  }

  // 현재 비밀번호 검증.
  let currentOk = false;
  if (typeof current_password === 'string' && current_password.length > 0) {
    try {
      currentOk = await bcrypt.compare(current_password, dbHash);
    } catch {
      currentOk = false;
    }
  }
  if (!currentOk) {
    return res.status(401).json({ ok: false, error: 'invalid_current_password' });
  }

  // 새 비밀번호 정책: 문자열 + 최소 8자.
  if (typeof new_password !== 'string' || new_password.length < 8) {
    return res.status(400).json({ ok: false, error: 'weak_password' });
  }

  // 현재와 동일한 비밀번호로의 변경 방지.
  let sameAsCurrent = false;
  try {
    sameAsCurrent = await bcrypt.compare(new_password, dbHash);
  } catch {
    sameAsCurrent = false;
  }
  if (sameAsCurrent) {
    return res.status(400).json({ ok: false, error: 'same_password' });
  }

  const newHash = await bcrypt.hash(new_password, 10);
  // 변경 + 감사기록을 원자적으로. before/after에 해시·평문 저장 금지(변경 사실만 기록).
  const tx = db.transaction(() => {
    db.prepare('UPDATE settings SET password_hash = ? WHERE id = 1').run(newHash);
    db.prepare(
      `INSERT INTO audit_logs (at, action, target, before, after)
       VALUES (datetime('now'), 'update', 'settings:password', ?, ?)`,
    ).run(JSON.stringify({ changed: true }), JSON.stringify({ changed: true }));
  });
  tx();

  return res.json({ ok: true });
});

// --- 팀원 관리 (FR-03) ------------------------------------------------------
// GET: 기본 전체(active 포함). ?active=1 이면 active만.
app.get('/api/members', (req, res) => {
  const onlyActive = req.query.active === '1';
  const rows = onlyActive
    ? db
        .prepare('SELECT id, name, birthday, active FROM members WHERE active = 1 ORDER BY id')
        .all()
    : db.prepare('SELECT id, name, birthday, active FROM members ORDER BY id').all();
  res.json({ members: rows });
});

app.post('/api/members', (req, res) => {
  const { name, birthday } = req.body || {};
  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ ok: false, error: 'name required' });
  }
  const info = db
    .prepare('INSERT INTO members (name, birthday, active) VALUES (?, ?, 1)')
    .run(name.trim(), birthday || null);
  syncCurrentPeriodMemberCount();
  return res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/members/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });

  const { name, birthday, active } = req.body || {};
  const newName = name !== undefined ? String(name).trim() : existing.name;
  if (newName === '') {
    return res.status(400).json({ ok: false, error: 'name required' });
  }
  const newBirthday = birthday !== undefined ? birthday || null : existing.birthday;
  const newActive = active !== undefined ? (active ? 1 : 0) : existing.active;

  db.prepare('UPDATE members SET name = ?, birthday = ?, active = ? WHERE id = ?').run(
    newName,
    newBirthday,
    newActive,
    id,
  );
  syncCurrentPeriodMemberCount();
  return res.json({ ok: true });
});

app.delete('/api/members/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM members WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });

  // 지출 있는 팀원 하드 삭제 차단(정합성 보호) → 비활성 처리 유도.
  const refs = db
    .prepare('SELECT COUNT(*) AS n FROM transactions WHERE member_id = ?')
    .get(id).n;
  if (refs > 0) {
    return res.status(409).json({ ok: false, error: 'has_transactions' });
  }

  db.prepare('DELETE FROM members WHERE id = ?').run(id);
  syncCurrentPeriodMemberCount();
  return res.json({ ok: true });
});

// --- 카테고리 템플릿 (FR-02, 미래 월 시드용) --------------------------------
// 템플릿 편집은 미래 월 시드에만 영향. 기존/과거 period_categories는 불변.
app.get('/api/category-templates', (_req, res) => {
  const rows = db
    .prepare('SELECT id, name, default_amount FROM category_templates ORDER BY id')
    .all();
  res.json({ templates: rows });
});

app.post('/api/category-templates', (req, res) => {
  const { name, default_amount } = req.body || {};
  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ ok: false, error: 'name required' });
  }
  const amount = default_amount === undefined ? 0 : default_amount;
  if (!Number.isInteger(amount) || amount < 0) {
    return res.status(400).json({ ok: false, error: 'invalid default_amount' });
  }
  const info = db
    .prepare('INSERT INTO category_templates (name, default_amount) VALUES (?, ?)')
    .run(name.trim(), amount);
  return res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/category-templates/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM category_templates WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });

  const { name, default_amount } = req.body || {};
  const newName = name !== undefined ? String(name).trim() : existing.name;
  if (newName === '') {
    return res.status(400).json({ ok: false, error: 'name required' });
  }
  let newAmount = existing.default_amount;
  if (default_amount !== undefined) {
    if (!Number.isInteger(default_amount) || default_amount < 0) {
      return res.status(400).json({ ok: false, error: 'invalid default_amount' });
    }
    newAmount = default_amount;
  }
  db.prepare('UPDATE category_templates SET name = ?, default_amount = ? WHERE id = ?').run(
    newName,
    newAmount,
    id,
  );
  return res.json({ ok: true });
});

app.delete('/api/category-templates/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM category_templates WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });
  db.prepare('DELETE FROM category_templates WHERE id = ?').run(id);
  return res.json({ ok: true });
});

// --- 당월 카테고리 스냅샷 쓰기 (FR-02) -------------------------------------
// 과거 월(period < currentPeriod())은 스냅샷 불변 → 쓰기 금지(409).
// 당월 카테고리 금액·이름 일괄 수정.
app.put('/api/periods/:period/categories', (req, res) => {
  const { period } = req.params;
  if (!isValidPeriod(period)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }
  if (isPastPeriod(period)) {
    return res.status(409).json({ ok: false, error: 'past_period_locked' });
  }
  const { categories } = req.body || {};
  if (!Array.isArray(categories)) {
    return res.status(400).json({ ok: false, error: 'categories array required' });
  }
  // 형식 선검증(하나라도 잘못되면 아무것도 쓰지 않는다).
  for (const c of categories) {
    if (
      !c ||
      !Number.isInteger(c.id) ||
      typeof c.name !== 'string' ||
      c.name.trim() === '' ||
      !Number.isInteger(c.amount) ||
      c.amount < 0
    ) {
      return res.status(400).json({ ok: false, error: 'invalid category entry' });
    }
  }
  ensurePeriod(db, period);
  const upd = db.prepare(
    'UPDATE period_categories SET name = ?, amount = ? WHERE id = ? AND period = ?',
  );
  const tx = db.transaction((rows) => {
    for (const c of rows) upd.run(c.name.trim(), c.amount, c.id, period);
  });
  tx(categories);
  return res.json({ ok: true });
});

// 당월에 카테고리 추가.
app.post('/api/periods/:period/categories', (req, res) => {
  const { period } = req.params;
  if (!isValidPeriod(period)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }
  if (isPastPeriod(period)) {
    return res.status(409).json({ ok: false, error: 'past_period_locked' });
  }
  const { name, amount } = req.body || {};
  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ ok: false, error: 'name required' });
  }
  const amt = amount === undefined ? 0 : amount;
  if (!Number.isInteger(amt) || amt < 0) {
    return res.status(400).json({ ok: false, error: 'invalid amount' });
  }
  ensurePeriod(db, period);
  const info = db
    .prepare('INSERT INTO period_categories (period, name, amount) VALUES (?, ?, ?)')
    .run(period, name.trim(), amt);
  return res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

// 당월 카테고리 삭제. transactions 참조 시 409.
app.delete('/api/periods/:period/categories/:id', (req, res) => {
  const { period } = req.params;
  const id = Number(req.params.id);
  if (!isValidPeriod(period)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }
  if (isPastPeriod(period)) {
    return res.status(409).json({ ok: false, error: 'past_period_locked' });
  }
  const existing = db
    .prepare('SELECT id FROM period_categories WHERE id = ? AND period = ?')
    .get(id, period);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });

  const refs = db
    .prepare('SELECT COUNT(*) AS n FROM transactions WHERE period_category_id = ?')
    .get(id).n;
  if (refs > 0) {
    return res.status(409).json({ ok: false, error: 'has_transactions' });
  }
  db.prepare('DELETE FROM period_categories WHERE id = ?').run(id);
  return res.json({ ok: true });
});

// --- 개인 조정 (FR-04, PRD 2.3) --------------------------------------------
// 팀원별 ± 라인(생일축하금 등). 월(period)별로 관리.
app.get('/api/adjustments', (req, res) => {
  const period = req.query.period !== undefined ? req.query.period : currentPeriod();
  if (!isValidPeriod(period)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }
  const rows = db
    .prepare(
      `SELECT a.id, a.period, a.member_id, a.label, a.amount, m.name AS member_name
         FROM adjustments a
         LEFT JOIN members m ON m.id = a.member_id
        WHERE a.period = ?
        ORDER BY a.id`,
    )
    .all(period);
  return res.json({ period, adjustments: rows });
});

app.post('/api/adjustments', (req, res) => {
  const { period, member_id, label, amount } = req.body || {};
  const p = period !== undefined ? period : currentPeriod();
  if (!isValidPeriod(p)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }
  if (isPastPeriod(p)) {
    return res.status(409).json({ ok: false, error: 'past_period_locked' });
  }
  if (!Number.isInteger(member_id)) {
    return res.status(400).json({ ok: false, error: 'member_id required' });
  }
  const member = db.prepare('SELECT id FROM members WHERE id = ?').get(member_id);
  if (!member) return res.status(404).json({ ok: false, error: 'member not found' });
  if (!Number.isInteger(amount)) {
    return res.status(400).json({ ok: false, error: 'invalid amount' });
  }
  const info = db
    .prepare('INSERT INTO adjustments (period, member_id, label, amount) VALUES (?, ?, ?, ?)')
    .run(p, member_id, label || null, amount);
  return res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/adjustments/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM adjustments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });
  if (isPastPeriod(existing.period)) {
    return res.status(409).json({ ok: false, error: 'past_period_locked' });
  }
  const { label, amount } = req.body || {};
  const newLabel = label !== undefined ? label || null : existing.label;
  let newAmount = existing.amount;
  if (amount !== undefined) {
    if (!Number.isInteger(amount)) {
      return res.status(400).json({ ok: false, error: 'invalid amount' });
    }
    newAmount = amount;
  }
  db.prepare('UPDATE adjustments SET label = ?, amount = ? WHERE id = ?').run(
    newLabel,
    newAmount,
    id,
  );
  return res.json({ ok: true });
});

app.delete('/api/adjustments/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM adjustments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });
  if (isPastPeriod(existing.period)) {
    return res.status(409).json({ ok: false, error: 'past_period_locked' });
  }
  db.prepare('DELETE FROM adjustments WHERE id = ?').run(id);
  return res.json({ ok: true });
});

// --- 예산 배정 계산 (FR-05, PRD 2.2·2.6) -----------------------------------
// "배정(allocation)"은 인당·인원·공용·조정으로 결정되는 개인 할당이다(사용액 아님 — T6/T7 범위).
// 계산은 순수 모듈 src/budget.js(computeAllocation) 단일 소스로만 수행한다.

// GET /api/allocation?period=  (미지정 시 당월)
// 해당 월의 persisted 데이터(period_meta·period_categories·adjustments·settings·active members)로
// 전체 브레이크다운을 반환. 팀원별 상세(members)는 당월 기준 active 팀원으로 산출한다.
// 과거 월은 member_count만 스냅샷이므로 팀원별 상세는 생략하고 aggregate는 정확히 반환한다.
app.get('/api/allocation', (req, res) => {
  const period = req.query.period !== undefined ? req.query.period : currentPeriod();
  if (!isValidPeriod(period)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }
  ensurePeriod(db, period);

  const meta = db
    .prepare('SELECT member_count FROM period_meta WHERE period = ?')
    .get(period);
  const memberCount = meta ? meta.member_count : 0;
  const perPerson = db.prepare('SELECT per_person FROM settings WHERE id = 1').get().per_person;
  const commonTotal = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM period_categories WHERE period = ?')
    .get(period).s;

  // 팀원별 상세는 당월만(과거 월은 active 명단이 스냅샷 인원과 다를 수 있어 aggregate만 신뢰).
  // 불변식 보증: 당월 adjustments_total은 반드시 members(active)의 조정 합과 일치해야 한다.
  // 비활성 팀원의 조정은 수령자가 없으므로 분배 대상에서 제외한다(돈이 새지 않도록, PRD 2.2).
  let memberAdjustments = [];
  let adjustmentsTotal;
  if (period === currentPeriod()) {
    memberAdjustments = db
      .prepare(
        `SELECT m.id AS member_id, m.name AS name,
                COALESCE(
                  (SELECT SUM(a.amount) FROM adjustments a
                    WHERE a.member_id = m.id AND a.period = ?), 0
                ) AS adjustment
           FROM members m
          WHERE m.active = 1
          ORDER BY m.id`,
      )
      .all(period);
    adjustmentsTotal = memberAdjustments.reduce((sum, m) => sum + m.adjustment, 0);
  } else {
    // 과거 월은 팀원별 상세를 산출하지 않으므로(스냅샷 인원만 신뢰) 전체 조정 합을 aggregate로 사용.
    adjustmentsTotal = db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM adjustments WHERE period = ?')
      .get(period).s;
  }

  const result = computeAllocation({
    perPerson,
    memberCount,
    commonTotal,
    adjustmentsTotal,
    memberAdjustments,
  });

  return res.json({ period, per_person: perPerson, member_count: memberCount, ...result });
});

// POST /api/allocation/preview
// body: { per_person, member_count, common_total, adjustments_total } (비영속 초안값)
// 설정 화면 실시간 미리보기용. 동일 computeAllocation의 aggregate만 계산해 반환한다
// (클라이언트 산식 중복 금지 — 단일 소스).
app.post('/api/allocation/preview', (req, res) => {
  const { per_person, member_count, common_total, adjustments_total } = req.body || {};

  // 입력 방어: per_person·member_count·common_total은 0 이상 정수, adjustments_total은 ± 정수.
  if (
    !Number.isInteger(per_person) || per_person < 0 ||
    !Number.isInteger(member_count) || member_count < 0 ||
    !Number.isInteger(common_total) || common_total < 0 ||
    !Number.isInteger(adjustments_total)
  ) {
    return res.status(400).json({ ok: false, error: 'invalid preview input' });
  }

  const result = computeAllocation({
    perPerson: per_person,
    memberCount: member_count,
    commonTotal: common_total,
    adjustmentsTotal: adjustments_total,
    memberAdjustments: [],
  });

  return res.json({
    total_budget: result.total_budget,
    distributable: result.distributable,
    base_allocation: result.base_allocation,
    remainder: result.remainder,
    warning: result.warning,
  });
});

// --- 지출 입력·목록 (FR-06·10, PRD 2.1·2.5·4.3) ---------------------------
// 지출 2종: 공용(kind='common', 특정 period_category_id 풀 차감) /
//           개인(kind='personal', 특정 member_id 할당 차감).
// 날짜→기간 자동 귀속(period=date.slice(0,7)). 신규 지출은 당월만 허용해
// 과거 월 스냅샷 불변성을 지킨다. 수정/삭제·audit_logs는 T8 범위(여기선 없음).

// 'YYYY-MM-DD' 형식 + 실제 달력상 유효 날짜 검증(예: 2026-02-30 거부).
function isValidDate(str) {
  if (typeof str !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

// 지출 body 공통 검증 + 정규화(POST 신규 / PUT 수정 단일 소스).
// period는 date에서 파생하며 반드시 currentPeriod()만 허용(과거/미래 월 불변성 보호).
// 성공 시 정규화된 값, 실패 시 { error }를 반환한다(에러 코드는 POST와 동일).
function validateTransactionInput(body) {
  const { date, amount, kind, period_category_id, member_id, card, memo } = body || {};

  // date: 유효한 YYYY-MM-DD → period 파생.
  if (!isValidDate(date)) return { error: 'invalid date' };
  const period = date.slice(0, 7);
  // 당월만(과거/미래 월 불변성 보호).
  if (period !== currentPeriod()) return { error: 'date_not_in_current_period' };

  // amount: 양의 정수(≤0·비정수 거부).
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'invalid amount' };

  // kind: 'common' | 'personal'.
  if (kind !== 'common' && kind !== 'personal') return { error: 'invalid kind' };

  // card: 없거나(undefined/null) 1|2.
  let cardVal = null;
  if (card !== undefined && card !== null) {
    if (card !== 1 && card !== 2) return { error: 'invalid card' };
    cardVal = card;
  }

  let pcId = null;
  let memberId = null;
  if (kind === 'common') {
    // 공용: period_category_id 필수 + 그 period의 period_categories에 존재해야 함.
    if (!Number.isInteger(period_category_id)) return { error: 'period_category_id required' };
    const cat = db
      .prepare('SELECT id FROM period_categories WHERE id = ? AND period = ?')
      .get(period_category_id, period);
    if (!cat) return { error: 'category not found' };
    pcId = period_category_id;
    // member_id는 무시(null).
  } else {
    // 개인: member_id 필수 + 존재하는 active 팀원.
    if (!Number.isInteger(member_id)) return { error: 'member_id required' };
    const member = db
      .prepare('SELECT id FROM members WHERE id = ? AND active = 1')
      .get(member_id);
    if (!member) return { error: 'member not found' };
    memberId = member_id;
    // period_category_id는 null.
  }

  const memoVal = typeof memo === 'string' && memo.trim() !== '' ? memo.trim() : null;

  return { date, period, amount, kind, pcId, memberId, cardVal, memoVal };
}

// POST /api/transactions — 지출 1건 기록.
// body: { date, amount, kind, period_category_id?, member_id?, card?, memo? }
app.post('/api/transactions', (req, res) => {
  const v = validateTransactionInput(req.body);
  if (v.error) {
    return res.status(400).json({ ok: false, error: v.error });
  }

  ensurePeriod(db, v.period);
  const info = db
    .prepare(
      `INSERT INTO transactions
         (date, period, amount, kind, period_category_id, member_id, card, memo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(v.date, v.period, v.amount, v.kind, v.pcId, v.memberId, v.cardVal, v.memoVal);

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json({ ok: true, transaction: row });
});

// GET /api/transactions?period=&kind=&member_id=&card=
// 해당 period(미지정 시 당월)의 지출 목록. 공용은 카테고리명·개인은 팀원명을 조인.
// 최신순(date desc, id desc). 수정·삭제·전체 필터 UI는 T8.
app.get('/api/transactions', (req, res) => {
  const period = req.query.period !== undefined ? req.query.period : currentPeriod();
  if (!isValidPeriod(period)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }

  const where = ['t.period = ?'];
  const params = [period];

  if (req.query.kind !== undefined) {
    if (req.query.kind !== 'common' && req.query.kind !== 'personal') {
      return res.status(400).json({ ok: false, error: 'invalid kind' });
    }
    where.push('t.kind = ?');
    params.push(req.query.kind);
  }
  if (req.query.member_id !== undefined) {
    const mid = Number(req.query.member_id);
    if (!Number.isInteger(mid)) {
      return res.status(400).json({ ok: false, error: 'invalid member_id' });
    }
    where.push('t.member_id = ?');
    params.push(mid);
  }
  if (req.query.card !== undefined) {
    const c = Number(req.query.card);
    if (c !== 1 && c !== 2) {
      return res.status(400).json({ ok: false, error: 'invalid card' });
    }
    where.push('t.card = ?');
    params.push(c);
  }

  const rows = db
    .prepare(
      `SELECT t.id, t.date, t.period, t.amount, t.kind, t.period_category_id, t.member_id,
              t.card, t.memo, t.created_at,
              pc.name AS category_name, m.name AS member_name
         FROM transactions t
         LEFT JOIN period_categories pc ON pc.id = t.period_category_id
         LEFT JOIN members m ON m.id = t.member_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.date DESC, t.id DESC`,
    )
    .all(...params);

  return res.json({ period, transactions: rows });
});

// --- 지출 수정·삭제 + 감사로그 (FR-09·12, PRD 2.5·4.3) ----------------------
// 과거 월(period !== currentPeriod())의 지출은 수정·삭제 금지(409) — 과거 월 집계 불변성.
// 수정·삭제는 audit_logs에 자동 기록한다(action·target·before·after). 단일 공유 계정이라
// "누가"는 미식별(기록하지 않음). 감사 기록과 실제 변경은 한 트랜잭션으로 원자적 처리한다.

// PUT /api/transactions/:id — 지출 1건 수정.
app.put('/api/transactions/:id', (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ ok: false, error: 'not found' });

  // 대상의 저장된 period가 당월이 아니면 잠금(과거/미래 월 불변성). 차단이 먼저 → 감사기록 없음.
  if (before.period !== currentPeriod()) {
    return res.status(409).json({ ok: false, error: 'past_period_locked' });
  }

  // POST와 동일 검증(당월 날짜·양의정수 amount·kind·공용/개인 필수·card 1|2).
  const v = validateTransactionInput(req.body);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });

  // 검증 통과분만 원자적으로 수정 + 감사로그(update) 기록.
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE transactions
          SET date = ?, period = ?, amount = ?, kind = ?,
              period_category_id = ?, member_id = ?, card = ?, memo = ?
        WHERE id = ?`,
    ).run(v.date, v.period, v.amount, v.kind, v.pcId, v.memberId, v.cardVal, v.memoVal, id);
    const after = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    db.prepare(
      `INSERT INTO audit_logs (at, action, target, before, after)
       VALUES (datetime('now'), 'update', ?, ?, ?)`,
    ).run(`transactions:${id}`, JSON.stringify(before), JSON.stringify(after));
    return after;
  });
  const updated = tx();
  return res.json({ ok: true, transaction: updated });
});

// DELETE /api/transactions/:id — 지출 1건 삭제.
app.delete('/api/transactions/:id', (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!before) return res.status(404).json({ ok: false, error: 'not found' });

  if (before.period !== currentPeriod()) {
    return res.status(409).json({ ok: false, error: 'past_period_locked' });
  }

  // 감사로그(delete, after=null) 기록 후 삭제 — 원자적.
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO audit_logs (at, action, target, before, after)
       VALUES (datetime('now'), 'delete', ?, ?, NULL)`,
    ).run(`transactions:${id}`, JSON.stringify(before));
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  });
  tx();
  return res.json({ ok: true });
});

// GET /api/audit-logs?limit=&target= — 변경 이력 목록(FR-12), at 최신순.
// before/after는 JSON 문자열을 파싱해 객체(또는 null)로 반환한다. limit 기본 50.
app.get('/api/audit-logs', (req, res) => {
  let limit = 50;
  if (req.query.limit !== undefined) {
    const l = Number(req.query.limit);
    if (Number.isInteger(l) && l > 0 && l <= 500) limit = l;
  }
  const where = [];
  const params = [];
  if (req.query.target !== undefined) {
    where.push('target = ?');
    params.push(String(req.query.target));
  }
  const rows = db
    .prepare(
      `SELECT id, at, action, target, before, after
         FROM audit_logs
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY at DESC, id DESC
        LIMIT ?`,
    )
    .all(...params, limit);

  const safeParse = (s) => {
    if (s === null || s === undefined) return null;
    try {
      return JSON.parse(s);
    } catch {
      return s; // 파싱 불가 시 원문 문자열 그대로.
    }
  };
  const logs = rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    target: r.target,
    before: safeParse(r.before),
    after: safeParse(r.after),
  }));

  return res.json({ logs });
});

// --- 대시보드 집계 (FR-07·08·10, PRD 2.1·2.2) ------------------------------
// GET /api/dashboard?period=  (미지정 시 당월)
// 카테고리(공용) 잔액·팀원(개인) 잔액·전체 소진율·카드별 사용을 한 번에 반환.
// 산식·개인 할당은 반드시 순수 모듈 computeAllocation(src/budget.js)을 재사용한다
// (중복 구현 금지 — GET /api/allocation과 동일 방식으로 불변식을 유지).
//
// 집계 정의(PRD 2.1·2.2):
//   카테고리(공용): allocated = period_categories.amount(그 월 스냅샷),
//     used = Σ transactions(kind='common', 그 period, 해당 period_category_id).amount,
//     remaining = allocated − used, ratio = used/allocated(allocated=0이면 0). used는 초과 가능(음수 remaining).
//   팀원(개인): allocation = computeAllocation members[].final(기본+본인조정),
//     used = Σ transactions(kind='personal', 그 period, 해당 member_id).amount,
//     remaining = allocation − used, ratio = used/allocation(0이면 0).
//   전체: total_budget = per_person×N, used_total = 공용+개인, overall_ratio = used_total/total_budget(소진율).
//   카드(FR-10): 그 period 전체 지출을 card(1/2/null)로 합산.
//
// period 처리: 카테고리·totals·cards는 어느 period든 period_categories + transactions로 정확히 계산한다.
// 팀원별 상세(members)는 당월만 산출한다(과거 월은 active 명단 스냅샷이 없어 신뢰 불가) →
// 과거 월 members는 빈 배열로 두고 categories·totals·cards만 정확히 반환한다(allocation 엔드포인트와 동일 한계).
app.get('/api/dashboard', (req, res) => {
  const period = req.query.period !== undefined ? req.query.period : currentPeriod();
  if (!isValidPeriod(period)) {
    return res.status(400).json({ ok: false, error: 'invalid period format' });
  }
  ensurePeriod(db, period);

  const meta = db
    .prepare('SELECT member_count FROM period_meta WHERE period = ?')
    .get(period);
  const memberCount = meta ? meta.member_count : 0;
  const perPerson = db.prepare('SELECT per_person FROM settings WHERE id = 1').get().per_person;
  const commonTotal = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM period_categories WHERE period = ?')
    .get(period).s;

  // --- 카테고리(공용) 집계: 스냅샷 배정 − 그 카테고리 공용 지출 합 -----------
  const categories = db
    .prepare(
      `SELECT pc.id AS id, pc.name AS name, pc.amount AS allocated,
              COALESCE(
                (SELECT SUM(t.amount) FROM transactions t
                  WHERE t.kind = 'common' AND t.period = ? AND t.period_category_id = pc.id),
                0
              ) AS used
         FROM period_categories pc
        WHERE pc.period = ?
        ORDER BY pc.id`,
    )
    .all(period, period)
    .map((c) => ({
      id: c.id,
      name: c.name,
      allocated: c.allocated,
      used: c.used,
      remaining: c.allocated - c.used, // used>allocated 이면 음수(초과)
      ratio: c.allocated > 0 ? c.used / c.allocated : 0,
    }));

  // --- 개인 할당: GET /api/allocation과 동일 로직(computeAllocation 단일 소스) -
  // 당월은 active 팀원별 조정 합으로 상세를 산출하고, 그 합을 adjustments_total로 써 불변식을 보증한다.
  // 과거 월은 팀원별 상세를 산출하지 않으므로(스냅샷 인원만 신뢰) 전체 조정 합만 aggregate로 사용.
  let memberAdjustments = [];
  let adjustmentsTotal;
  if (period === currentPeriod()) {
    memberAdjustments = db
      .prepare(
        `SELECT m.id AS member_id, m.name AS name,
                COALESCE(
                  (SELECT SUM(a.amount) FROM adjustments a
                    WHERE a.member_id = m.id AND a.period = ?), 0
                ) AS adjustment
           FROM members m
          WHERE m.active = 1
          ORDER BY m.id`,
      )
      .all(period);
    adjustmentsTotal = memberAdjustments.reduce((sum, m) => sum + m.adjustment, 0);
  } else {
    adjustmentsTotal = db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM adjustments WHERE period = ?')
      .get(period).s;
  }

  const alloc = computeAllocation({
    perPerson,
    memberCount,
    commonTotal,
    adjustmentsTotal,
    memberAdjustments,
  });

  // --- 팀원(개인) 집계: 각 팀원 할당 final − 그 팀원 개인 지출 합 -------------
  // 과거 월은 alloc.members가 빈 배열이므로 members도 빈 배열(상세 미제공, categories/totals/cards만 정확).
  const personalUsedRows = db
    .prepare(
      `SELECT member_id, SUM(amount) AS used
         FROM transactions
        WHERE kind = 'personal' AND period = ?
        GROUP BY member_id`,
    )
    .all(period);
  const personalUsedByMember = new Map(personalUsedRows.map((r) => [r.member_id, r.used]));

  const members = alloc.members.map((m) => {
    const used = personalUsedByMember.get(m.member_id) || 0;
    const allocation = m.final;
    return {
      member_id: m.member_id,
      name: m.name,
      allocation,
      used,
      remaining: allocation - used, // used>allocation 이면 음수(초과)
      ratio: allocation !== 0 ? used / allocation : 0,
    };
  });

  // --- 전체 소진율 --------------------------------------------------------
  const usedCommon = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE kind = 'common' AND period = ?",
    )
    .get(period).s;
  const usedPersonal = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE kind = 'personal' AND period = ?",
    )
    .get(period).s;
  const usedTotal = usedCommon + usedPersonal;
  const totalBudget = alloc.total_budget;

  // --- 카드별 사용(FR-10): 그 period 전체 지출을 카드(1/2/null)로 합산 -------
  const card1 = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE period = ? AND card = 1')
    .get(period).s;
  const card2 = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE period = ? AND card = 2')
    .get(period).s;
  const cardNone = db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE period = ? AND card IS NULL',
    )
    .get(period).s;

  return res.json({
    period,
    per_person: perPerson,
    member_count: memberCount,
    total_budget: totalBudget,
    categories,
    members,
    totals: {
      allocated_common: commonTotal,
      used_common: usedCommon,
      used_personal: usedPersonal,
      used_total: usedTotal,
      remaining_total: totalBudget - usedTotal,
      overall_ratio: totalBudget > 0 ? usedTotal / totalBudget : 0,
    },
    cards: { card1, card2, none: cardNone },
    distributable: alloc.distributable,
    base_allocation: alloc.base_allocation,
    adjustments_total: alloc.adjustments_total,
    invariant_ok: alloc.invariant_ok,
    warning: alloc.warning,
  });
});

// 향후 보호 API(/api/*)는 이 아래에 추가한다.

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[teamMoneyManager] listening on :${PORT}  (db: ${DB_PATH})`);
});

export { app, db };
