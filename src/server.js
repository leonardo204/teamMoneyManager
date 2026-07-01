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
import { getDb, DB_PATH } from './db.js';
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

// 향후 보호 API(/api/*)는 이 아래에 추가한다.

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[teamMoneyManager] listening on :${PORT}  (db: ${DB_PATH})`);
});

export { app, db };
