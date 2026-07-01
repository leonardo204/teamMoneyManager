// public/app.js
// 부트스트랩: 헬스체크 + 기간(월) 선택 골격(T3, FR-11).
// 대시보드 본체는 T7에서 완성 — 여기선 기간 판별·시드·스냅샷 확인용 최소 표시만.

(async function health() {
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

// --- 기간(월) 선택 골격 ----------------------------------------------------
(function periodPicker() {
  const select = document.getElementById('period-select');
  const summary = document.getElementById('period-summary');
  const currentBadge = document.getElementById('period-current-badge');
  const catBody = document.getElementById('period-cat-body');
  const sumMembers = document.getElementById('sum-members');
  const sumPerPerson = document.getElementById('sum-perperson');
  const sumTotal = document.getElementById('sum-total');
  if (!select) return;

  // 애플리케이션 기간 상태(선택된 회계 월). 후속 태스크가 이 값을 참조한다.
  const state = { current: null, selected: null };

  const fmtWon = (n) =>
    typeof n === 'number' ? n.toLocaleString('ko-KR') + '원' : '–';

  async function loadCategories(period) {
    if (!period) return;
    state.selected = period;
    if (currentBadge) currentBadge.hidden = period !== state.current;
    try {
      const res = await fetch(`/api/periods/${period}/categories`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`categories ${res.status}`);
      const data = await res.json();

      if (sumMembers) sumMembers.textContent = String(data.member_count);
      if (sumPerPerson) sumPerPerson.textContent = fmtWon(data.per_person);
      if (sumTotal) sumTotal.textContent = fmtWon(data.total_budget);

      if (catBody) {
        catBody.innerHTML = '';
        if (!data.categories || data.categories.length === 0) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="2" class="empty">카테고리 없음</td>';
          catBody.appendChild(tr);
        } else {
          for (const c of data.categories) {
            const tr = document.createElement('tr');
            const nameTd = document.createElement('td');
            nameTd.textContent = c.name;
            const amtTd = document.createElement('td');
            amtTd.style.textAlign = 'right';
            amtTd.style.fontVariantNumeric = 'tabular-nums';
            amtTd.textContent = fmtWon(c.amount);
            tr.appendChild(nameTd);
            tr.appendChild(amtTd);
            catBody.appendChild(tr);
          }
        }
      }
      if (summary) summary.hidden = false;

      // T7 이전까지는 콘솔로도 스냅샷을 확인 가능하게 남겨둔다.
      // eslint-disable-next-line no-console
      console.info('[period] snapshot', {
        period: data.period,
        member_count: data.member_count,
        per_person: data.per_person,
        total_budget: data.total_budget,
        categories: data.categories,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[period] load categories failed:', err);
      if (summary) summary.hidden = true;
    }
  }

  async function init() {
    try {
      const res = await fetch('/api/periods', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`periods ${res.status}`);
      const data = await res.json();
      state.current = data.current;

      select.innerHTML = '';
      for (const p of data.periods) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p === data.current ? `${p} (당월)` : p;
        select.appendChild(opt);
      }
      // 기본값 = 당월.
      select.value = data.current;
      await loadCategories(data.current);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[period] init failed:', err);
      select.innerHTML = '<option>로드 실패</option>';
    }
  }

  select.addEventListener('change', () => {
    loadCategories(select.value);
  });

  init();
})();
