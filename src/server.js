// src/server.js
// Express 앱: public/ 정적 서빙 + REST API.
// 서버 시작 시 DB 파일이 없으면 getDb()가 디렉토리 생성·스키마 초기화·시드를 자동 수행.
// PORT 환경변수(기본 8080)로 리슨.

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, DB_PATH } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8080;

// DB 초기화(파일 없으면 스키마 자동 생성 + 시드).
const db = getDb();

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- API ------------------------------------------------------------------
// 헬스체크: 서버·DB 기동 확인.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// --- static ---------------------------------------------------------------
app.use(express.static(PUBLIC_DIR));

// SPA 폴백은 아직 불필요(단일 index.html). 정적 미스는 기본 404로 둔다.

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[teamMoneyManager] listening on :${PORT}  (db: ${DB_PATH})`);
});

export { app, db };
