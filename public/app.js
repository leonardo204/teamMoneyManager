// public/app.js
// 최소 부트스트랩: /api/health 호출 성공 시 상태 점을 .dot.ok 로 표시.
// 과구현 금지 — 비즈니스 로직은 후속 태스크.

(async function bootstrap() {
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  try {
    const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (res.ok && data && data.ok === true) {
      if (dot) dot.className = 'dot ok';
      if (label) label.textContent = '연결됨';
      return;
    }
    throw new Error('unexpected health response');
  } catch (err) {
    if (dot) dot.className = 'dot err';
    if (label) label.textContent = '연결 실패';
    // eslint-disable-next-line no-console
    console.error('[health] check failed:', err);
  }
})();
