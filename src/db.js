// src/db.js
// better-sqlite3 커넥션 + 스키마 초기화(멱등).
// DB 파일: data/app.db (볼륨 마운트 대상). 없으면 디렉토리 자동 생성.
// 데이터 모델은 PRD 4.3 기준. FK 관계는 주석으로 표기하고 실제 제약은 최소로 둔다
// (정합성 처리는 후속 태스크에서).

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/app.db 절대 경로 (프로젝트 루트 기준 data/).
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

// 인당 기본 금액 시드 (PRD 4.3 settings.per_person).
const DEFAULT_PER_PERSON = 180000;

// 초기 카테고리 템플릿 시드 (PRD 6장 확정 정책).
const DEFAULT_CATEGORY_TEMPLATES = [
  { name: '야근', default_amount: 400000 },
  { name: '커피', default_amount: 210000 },
  { name: '간식', default_amount: 100000 },
  { name: '회식', default_amount: 100000 },
];

/**
 * data 디렉토리를 보장한다(없으면 생성).
 */
function ensureDataDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 스키마를 멱등하게 생성한다(CREATE TABLE IF NOT EXISTS).
 * @param {Database.Database} db
 */
export function initSchema(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- settings: 인당 금액 (per_person). 단일 행 운영.
    CREATE TABLE IF NOT EXISTS settings (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      per_person  INTEGER NOT NULL DEFAULT 180000
    );

    -- members: 월과 무관하게 유지되는 팀원 명단.
    -- 삭제 대신 active=0 으로 비활성 가능(FR-03).
    CREATE TABLE IF NOT EXISTS members (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      birthday  TEXT,                       -- nullable (YYYY-MM-DD)
      active    INTEGER NOT NULL DEFAULT 1  -- bool (1=활성, 0=비활성)
    );

    -- category_templates: 매월 시드에 쓰는 기본 카테고리.
    CREATE TABLE IF NOT EXISTS category_templates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      default_amount  INTEGER NOT NULL DEFAULT 0
    );

    -- period_meta: 월 시작 시점 인원 스냅샷(2.4).
    CREATE TABLE IF NOT EXISTS period_meta (
      period        TEXT PRIMARY KEY,       -- 'YYYY-MM'
      member_count  INTEGER NOT NULL DEFAULT 0
    );

    -- period_categories: 해당 월의 공용 카테고리 스냅샷.
    CREATE TABLE IF NOT EXISTS period_categories (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      period  TEXT NOT NULL,                -- FK -> period_meta.period
      name    TEXT NOT NULL,
      amount  INTEGER NOT NULL DEFAULT 0
    );

    -- adjustments: 그 월의 개인 조정(생일축하금 등). amount는 ± 허용.
    CREATE TABLE IF NOT EXISTS adjustments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      period     TEXT NOT NULL,             -- FK -> period_meta.period
      member_id  INTEGER NOT NULL,          -- FK -> members.id
      label      TEXT,
      amount     INTEGER NOT NULL DEFAULT 0 -- ± 허용
    );

    -- transactions: 지출. kind='common'이면 period_category_id, 'personal'이면 member_id.
    CREATE TABLE IF NOT EXISTS transactions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      date                TEXT NOT NULL,     -- 'YYYY-MM-DD'
      period              TEXT NOT NULL,     -- date에서 파생 'YYYY-MM'
      amount              INTEGER NOT NULL,
      kind                TEXT NOT NULL,     -- 'common' | 'personal'
      period_category_id  INTEGER,           -- FK -> period_categories.id (공용일 때)
      member_id           INTEGER,           -- FK -> members.id (개인일 때)
      card                INTEGER,           -- 1 | 2 (nullable)
      memo                TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- audit_logs: 변경 이력(FR-12). before/after는 JSON 텍스트.
    CREATE TABLE IF NOT EXISTS audit_logs (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      at      TEXT NOT NULL DEFAULT (datetime('now')),
      action  TEXT NOT NULL,                 -- 'update' | 'delete'
      target  TEXT NOT NULL,                 -- 테이블·행 id (예: 'transactions:12')
      before  TEXT,                          -- JSON
      after   TEXT                           -- JSON
    );
  `);
}

/**
 * 최초 생성 시에만 필요한 시드 데이터를 넣는다(멱등).
 * @param {Database.Database} db
 */
export function seedDefaults(db) {
  // settings 단일 행 시드.
  const hasSettings = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (hasSettings === 0) {
    db.prepare('INSERT INTO settings (id, per_person) VALUES (1, ?)').run(DEFAULT_PER_PERSON);
  }

  // category_templates 시드(비어 있을 때만).
  const hasTemplates = db.prepare('SELECT COUNT(*) AS n FROM category_templates').get().n;
  if (hasTemplates === 0) {
    const insert = db.prepare(
      'INSERT INTO category_templates (name, default_amount) VALUES (?, ?)'
    );
    const tx = db.transaction((rows) => {
      for (const r of rows) insert.run(r.name, r.default_amount);
    });
    tx(DEFAULT_CATEGORY_TEMPLATES);
  }
}

let _db = null;

/**
 * 싱글턴 DB 커넥션을 반환한다. 최초 호출 시 디렉토리 생성·스키마 초기화·시드까지 수행.
 * @returns {Database.Database}
 */
export function getDb() {
  if (_db) return _db;
  ensureDataDir();
  _db = new Database(DB_PATH);
  initSchema(_db);
  seedDefaults(_db);
  return _db;
}

export { DB_PATH, DATA_DIR, DEFAULT_PER_PERSON, DEFAULT_CATEGORY_TEMPLATES };
