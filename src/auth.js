// src/auth.js
// 공유 비밀번호 게이트(FR-01)의 인증 유틸리티.
// - 로그인 성공 시 JWT를 httpOnly 쿠키(session)로 발급.
// - requireAuth 미들웨어: 미인증 시 HTML은 302 /login, /api/*는 401 JSON.
// 비밀번호 평문은 코드/파일에 저장하지 않는다. bcrypt 해시(APP_PASSWORD_HASH)만 검증.

import jwt from 'jsonwebtoken';

// 세션 쿠키 이름.
export const SESSION_COOKIE = 'session';

// JWT 만료(30일). 쿠키 maxAge와 동일하게 맞춘다.
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

// JWT_SECRET을 읽는다. 미설정이면 서명/검증이 불가하므로 fail-closed 대상.
function getSecret() {
  return process.env.JWT_SECRET || '';
}

// 프로덕션(HTTPS)에서만 secure 쿠키. 로컬 http에서는 false여야 쿠키가 전달된다.
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/',
  };
}

// 로그아웃 시 쿠키 제거용 옵션(maxAge 없이 동일 속성).
export function clearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

// 공유 세션 토큰 서명. payload는 고정(단일 공유 계정).
export function signSession() {
  const secret = getSecret();
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return jwt.sign({ sub: 'shared' }, secret, { expiresIn: TOKEN_TTL_SECONDS });
}

// 토큰 검증. 유효하면 payload, 아니면 null(만료/변조/시크릿 미설정 모두 null).
export function verifySession(token) {
  const secret = getSecret();
  if (!secret || !token) return null;
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

// 요청이 인증되었는지 판별.
export function isAuthenticated(req) {
  const token = req.cookies ? req.cookies[SESSION_COOKIE] : undefined;
  return verifySession(token) !== null;
}

// 인증 미들웨어. 미인증 시:
//  - /api/* 경로 → 401 JSON
//  - 그 외(HTML) → 302 /login 리다이렉트
export function requireAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }
  const wantsApi =
    req.path.startsWith('/api/') ||
    (req.headers.accept || '').includes('application/json');
  if (wantsApi) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return res.redirect(302, '/login');
}
