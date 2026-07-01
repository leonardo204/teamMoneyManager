// src/server.js
// Express 앱: 로그인 게이트(FR-01) + 정적 자산 서빙 + REST API.
// 서버 시작 시 DB 파일이 없으면 getDb()가 디렉토리 생성·스키마 초기화·시드를 자동 수행.
// PORT 환경변수(기본 8080)로 리슨.
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
const PORT = Number(process.env.PORT) || 8080;

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

// 로그인: 공유 비밀번호(bcrypt 해시) 검증 후 세션 쿠키 발급.
app.post('/api/login', async (req, res) => {
  const { password } = req.body || {};
  const hash = process.env.APP_PASSWORD_HASH;

  // fail-closed: 해시 미설정이면 항상 거부하고 명확히 경고한다.
  if (!hash) {
    // eslint-disable-next-line no-console
    console.warn(
      '[auth] APP_PASSWORD_HASH is not set — 모든 로그인이 거부됩니다(fail-closed). ' +
        "`npm run hash-pw '<비밀번호>'`로 해시를 생성해 .env에 설정하세요.",
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

// 향후 보호 API(/api/*)는 이 아래에 추가한다.

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[teamMoneyManager] listening on :${PORT}  (db: ${DB_PATH})`);
});

export { app, db };
