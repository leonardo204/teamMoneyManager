// src/init-db.js
// 스키마 초기화 전용 스크립트 (npm run init-db).
// getDb()가 디렉토리 생성·스키마 초기화·시드를 멱등하게 수행한다.

import { getDb, DB_PATH } from './db.js';

const db = getDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

// eslint-disable-next-line no-console
console.log(`[init-db] DB ready: ${DB_PATH}`);
// eslint-disable-next-line no-console
console.log(`[init-db] tables (${tables.length}): ${tables.join(', ')}`);

db.close();
