// src/period.js
// 회계 기간(월) 유틸. 회계 단위는 월(YYYY-MM), 당월은 서버 시각 기준(2.4·2.5).
// 순수 함수만 둔다(시드/DB 의존 없음) — ensurePeriod 등 상태 변경은 db.js가 담당.

/**
 * 서버 로컬 시각 기준 당월을 'YYYY-MM'으로 반환한다.
 * new Date() 기준이므로 서버가 도는 타임존을 따른다(검증 시 `date +%Y-%m`과 동일 시계).
 * @returns {string} 'YYYY-MM'
 */
export function currentPeriod() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 0-based → 1-based
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/**
 * 'YYYY-MM' 형식 및 월 범위(01~12)를 검증한다.
 * 형식이 맞지 않거나 월이 00/13 등이면 false.
 * @param {unknown} str
 * @returns {boolean}
 */
export function isValidPeriod(str) {
  if (typeof str !== 'string') return false;
  const m = /^(\d{4})-(\d{2})$/.exec(str);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}
