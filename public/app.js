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

      // 대시보드 본체(T7)를 선택된 기간으로 갱신(탭 진입/기간 변경 시).
      if (window.__dashboard) window.__dashboard.render(period);

      // 스냅샷을 콘솔로도 확인 가능하게 남겨둔다.
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

// --- 탭 전환 ---------------------------------------------------------------
(function tabs() {
  const btns = Array.from(document.querySelectorAll('.tab-btn[data-tab]'));
  const panels = {
    dashboard: document.getElementById('tab-dashboard'),
    settings: document.getElementById('tab-settings'),
    history: document.getElementById('tab-history'),
  };
  if (btns.length === 0) return;

  let settingsLoaded = false;

  function activate(name) {
    for (const b of btns) b.classList.toggle('active', b.dataset.tab === name);
    for (const key of Object.keys(panels)) {
      if (panels[key]) panels[key].hidden = key !== name;
    }
    if (name === 'settings' && !settingsLoaded && window.__settings) {
      settingsLoaded = true;
      window.__settings.load();
    }
    // 대시보드 재진입 시 마지막 선택 기간으로 재렌더(기간 상태는 대시보드 모듈이 보유).
    if (name === 'dashboard' && window.__dashboard) {
      window.__dashboard.refresh();
    }
  }

  for (const b of btns) {
    b.addEventListener('click', () => activate(b.dataset.tab));
  }
})();

// --- 설정 탭: 팀원·카테고리·개인 조정 CRUD (T4) ---------------------------
(function settings() {
  const fmtWon = (n) =>
    typeof n === 'number' ? n.toLocaleString('ko-KR') + '원' : '–';

  // 애플리케이션 설정 상태.
  const state = { current: null, members: [], adjustments: [] };

  // --- 모달 헬퍼(.modal-overlay[hidden] 가드) -----------------------------
  const openModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  };
  const closeModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  };
  // 오버레이/닫기 버튼 배선.
  for (const el of document.querySelectorAll('[data-close]')) {
    el.addEventListener('click', () => closeModal(el.getAttribute('data-close')));
  }
  for (const ov of document.querySelectorAll('.modal-overlay')) {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) ov.hidden = true;
    });
  }

  const showMsg = (id, text) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  };

  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...opts,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    return { res, data };
  }

  // --- 확인 모달(재사용) --------------------------------------------------
  let confirmCb = null;
  const confirmOk = document.getElementById('confirm-modal-ok');
  if (confirmOk) {
    confirmOk.addEventListener('click', async () => {
      const cb = confirmCb;
      confirmCb = null;
      closeModal('confirm-modal');
      if (cb) await cb();
    });
  }
  function askConfirm(text, okLabel, cb) {
    const t = document.getElementById('confirm-modal-text');
    if (t) t.textContent = text;
    if (confirmOk) confirmOk.textContent = okLabel || '삭제';
    confirmCb = cb;
    openModal('confirm-modal');
  }

  // ======================= 개인 할당 미리보기 (FR-05) =======================
  // 화면의 현재 초안값(인당·당월 카테고리 합·조정 합·활성 인원)을 모아 서버
  // POST /api/allocation/preview 로 계산한다. 산식은 서버 단일 소스(클라 중복 금지).
  let previewTimer = null;

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  const activeMemberCount = () => state.members.filter((m) => m.active).length;

  // 화면의 당월 카테고리 금액 입력 합(저장 전 초안).
  function draftCommonTotal() {
    let sum = 0;
    if (setcatBody) {
      for (const inp of setcatBody.querySelectorAll('input[data-field="amount"]')) {
        const v = Number((inp.value || '').trim() || '0');
        if (Number.isFinite(v)) sum += Math.trunc(v);
      }
    }
    return sum;
  }

  // 조정 합(± 포함). 저장된 당월 조정 라인 기준.
  function draftAdjustmentsTotal() {
    let sum = 0;
    for (const a of state.adjustments) {
      const v = Number(a.amount);
      if (Number.isFinite(v)) sum += Math.trunc(v);
    }
    return sum;
  }

  function draftPerPerson() {
    const el = document.getElementById('per-person-input');
    const v = Number((el ? el.value : '').trim());
    return Number.isInteger(v) && v >= 0 ? v : 0;
  }

  async function runPreview() {
    if (state.current) setText('alloc-period', state.current);

    const per_person = draftPerPerson();
    const member_count = activeMemberCount();
    const common_total = draftCommonTotal();
    const adjustments_total = draftAdjustmentsTotal();

    // 입력값 파생 표시(즉시). base·distributable·총예산은 서버 응답으로 확정.
    setText('alloc-members', String(member_count));
    setText('alloc-perperson', fmtWon(per_person));
    setText('alloc-common', fmtWon(common_total));
    setText('alloc-adj', (adjustments_total > 0 ? '+' : '') + fmtWon(adjustments_total));

    try {
      const { res, data } = await api('/api/allocation/preview', {
        method: 'POST',
        body: JSON.stringify({ per_person, member_count, common_total, adjustments_total }),
      });
      const warn = document.getElementById('alloc-warn');
      if (res.ok && data) {
        setText('alloc-total', fmtWon(data.total_budget));
        setText('alloc-distributable', fmtWon(data.distributable));
        setText(
          'alloc-base',
          member_count > 0 ? fmtWon(data.base_allocation) : '계산 불가 (인원 0)',
        );
        if (warn) warn.hidden = data.warning !== 'over_budget';
      } else {
        setText('alloc-total', '–');
        setText('alloc-distributable', '–');
        setText('alloc-base', '–');
        if (warn) warn.hidden = true;
      }
    } catch (_) {
      /* noop */
    }
  }

  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 250);
  }

  // ======================= 팀원 관리 =======================
  const memberBody = document.getElementById('member-body');

  function renderMembers() {
    if (!memberBody) return;
    memberBody.innerHTML = '';
    if (state.members.length === 0) {
      memberBody.innerHTML = '<tr><td colspan="4" class="empty">팀원 없음</td></tr>';
      return;
    }
    for (const m of state.members) {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = m.name;
      const bdTd = document.createElement('td');
      bdTd.textContent = m.birthday || '–';
      const stTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = m.active ? 'badge badge-ok' : 'badge badge-warn';
      badge.textContent = m.active ? 'active' : 'inactive';
      stTd.appendChild(badge);

      const actTd = document.createElement('td');
      actTd.style.textAlign = 'right';
      actTd.style.whiteSpace = 'nowrap';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn';
      editBtn.type = 'button';
      editBtn.textContent = '수정';
      editBtn.style.marginLeft = '0.3rem';
      editBtn.addEventListener('click', () => openMemberModal(m));

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn';
      toggleBtn.type = 'button';
      toggleBtn.textContent = m.active ? '비활성' : '활성';
      toggleBtn.style.marginLeft = '0.3rem';
      toggleBtn.addEventListener('click', () => toggleMember(m));

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.type = 'button';
      delBtn.textContent = '삭제';
      delBtn.style.marginLeft = '0.3rem';
      delBtn.addEventListener('click', () => deleteMember(m));

      actTd.appendChild(editBtn);
      actTd.appendChild(toggleBtn);
      actTd.appendChild(delBtn);

      tr.appendChild(nameTd);
      tr.appendChild(bdTd);
      tr.appendChild(stTd);
      tr.appendChild(actTd);
      memberBody.appendChild(tr);
    }
  }

  async function loadMembers() {
    const { res, data } = await api('/api/members');
    if (res.ok && data) {
      state.members = data.members || [];
      renderMembers();
      schedulePreview();
    }
  }

  function openMemberModal(m) {
    document.getElementById('member-modal-id').value = m ? m.id : '';
    document.getElementById('member-modal-name').value = m ? m.name : '';
    document.getElementById('member-modal-birthday').value = m ? m.birthday || '' : '';
    document.getElementById('member-modal-title').textContent = m ? '팀원 수정' : '팀원 추가';
    showMsg('member-modal-msg', '');
    openModal('member-modal');
  }

  document.getElementById('member-add-btn').addEventListener('click', () => openMemberModal(null));
  document.getElementById('member-modal-save').addEventListener('click', async () => {
    const id = document.getElementById('member-modal-id').value;
    const name = document.getElementById('member-modal-name').value.trim();
    const birthday = document.getElementById('member-modal-birthday').value.trim();
    if (!name) {
      showMsg('member-modal-msg', '이름을 입력하세요.');
      return;
    }
    const body = { name, birthday: birthday || null };
    const { res } = id
      ? await api(`/api/members/${id}`, { method: 'PUT', body: JSON.stringify(body) })
      : await api('/api/members', { method: 'POST', body: JSON.stringify(body) });
    if (res.ok) {
      closeModal('member-modal');
      showMsg('member-msg', '');
      await loadMembers();
      await syncMemberDependents();
    } else {
      showMsg('member-modal-msg', '저장에 실패했습니다.');
    }
  });

  async function toggleMember(m) {
    const { res } = await api(`/api/members/${m.id}`, {
      method: 'PUT',
      body: JSON.stringify({ active: m.active ? false : true }),
    });
    if (res.ok) {
      await loadMembers();
      await syncMemberDependents();
    }
  }

  function deleteMember(m) {
    askConfirm(`'${m.name}' 팀원을 삭제할까요?`, '삭제', async () => {
      const { res, data } = await api(`/api/members/${m.id}`, { method: 'DELETE' });
      if (res.status === 409 && data && data.error === 'has_transactions') {
        showMsg('member-msg', '지출 내역이 있어 삭제 불가 — 비활성 처리하세요.');
        return;
      }
      if (res.ok) {
        showMsg('member-msg', '');
        await loadMembers();
        await syncMemberDependents();
      } else {
        showMsg('member-msg', '삭제에 실패했습니다.');
      }
    });
  }

  // 팀원 변동 시 인원 의존 표시(당월 요약·조정 팀원 목록) 갱신.
  async function syncMemberDependents() {
    await loadCurrentCategories();
    fillAdjMemberSelect();
  }

  // ======================= 인당 금액 (per_person) =======================
  async function loadPerPerson() {
    const { res, data } = await api('/api/settings');
    if (res.ok && data) {
      document.getElementById('per-person-input').value = data.per_person;
    }
  }
  document.getElementById('per-person-save').addEventListener('click', async () => {
    const raw = document.getElementById('per-person-input').value.trim();
    const val = Number(raw);
    if (!Number.isInteger(val) || val <= 0) {
      showMsg('per-person-msg', '양의 정수를 입력하세요.');
      return;
    }
    const { res } = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ per_person: val }),
    });
    if (res.ok) {
      showMsg('per-person-msg', '저장됨');
      await loadCurrentCategories();
    } else {
      showMsg('per-person-msg', '저장 실패');
    }
  });

  // ======================= 카테고리 템플릿 =======================
  const tmplBody = document.getElementById('tmpl-body');

  function renderTemplates(list) {
    if (!tmplBody) return;
    tmplBody.innerHTML = '';
    if (!list || list.length === 0) {
      tmplBody.innerHTML = '<tr><td colspan="3" class="empty">템플릿 없음</td></tr>';
      return;
    }
    for (const t of list) {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.textContent = t.name;
      const amtTd = document.createElement('td');
      amtTd.style.textAlign = 'right';
      amtTd.textContent = fmtWon(t.default_amount);
      const actTd = document.createElement('td');
      actTd.style.textAlign = 'right';
      actTd.style.whiteSpace = 'nowrap';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn';
      editBtn.type = 'button';
      editBtn.textContent = '수정';
      editBtn.addEventListener('click', () => openTmplModal(t));

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.type = 'button';
      delBtn.textContent = '삭제';
      delBtn.style.marginLeft = '0.3rem';
      delBtn.addEventListener('click', () =>
        askConfirm(`템플릿 '${t.name}'을 삭제할까요?`, '삭제', async () => {
          const { res } = await api(`/api/category-templates/${t.id}`, { method: 'DELETE' });
          if (res.ok) await loadTemplates();
        }),
      );

      actTd.appendChild(editBtn);
      actTd.appendChild(delBtn);
      tr.appendChild(nameTd);
      tr.appendChild(amtTd);
      tr.appendChild(actTd);
      tmplBody.appendChild(tr);
    }
  }

  async function loadTemplates() {
    const { res, data } = await api('/api/category-templates');
    if (res.ok && data) renderTemplates(data.templates);
  }

  function openTmplModal(t) {
    document.getElementById('tmpl-modal-id').value = t ? t.id : '';
    document.getElementById('tmpl-modal-name').value = t ? t.name : '';
    document.getElementById('tmpl-modal-amount').value = t ? t.default_amount : '';
    document.getElementById('tmpl-modal-title').textContent = t ? '템플릿 수정' : '템플릿 추가';
    showMsg('tmpl-modal-msg', '');
    openModal('tmpl-modal');
  }
  document.getElementById('tmpl-add-btn').addEventListener('click', () => openTmplModal(null));
  document.getElementById('tmpl-modal-save').addEventListener('click', async () => {
    const id = document.getElementById('tmpl-modal-id').value;
    const name = document.getElementById('tmpl-modal-name').value.trim();
    const amount = Number(document.getElementById('tmpl-modal-amount').value.trim() || '0');
    if (!name) {
      showMsg('tmpl-modal-msg', '카테고리명을 입력하세요.');
      return;
    }
    if (!Number.isInteger(amount) || amount < 0) {
      showMsg('tmpl-modal-msg', '금액은 0 이상의 정수여야 합니다.');
      return;
    }
    const body = { name, default_amount: amount };
    const { res } = id
      ? await api(`/api/category-templates/${id}`, { method: 'PUT', body: JSON.stringify(body) })
      : await api('/api/category-templates', { method: 'POST', body: JSON.stringify(body) });
    if (res.ok) {
      closeModal('tmpl-modal');
      await loadTemplates();
    } else {
      showMsg('tmpl-modal-msg', '저장에 실패했습니다.');
    }
  });

  // ======================= 당월 카테고리 스냅샷 =======================
  const setcatBody = document.getElementById('setcat-body');
  let currentCats = [];

  function renderCurrentCats() {
    if (!setcatBody) return;
    setcatBody.innerHTML = '';
    if (!currentCats || currentCats.length === 0) {
      setcatBody.innerHTML = '<tr><td colspan="3" class="empty">카테고리 없음</td></tr>';
      return;
    }
    for (const c of currentCats) {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.className = 'input';
      nameInput.type = 'text';
      nameInput.value = c.name;
      nameInput.dataset.catId = c.id;
      nameInput.dataset.field = 'name';
      nameTd.appendChild(nameInput);

      const amtTd = document.createElement('td');
      amtTd.style.textAlign = 'right';
      const amtInput = document.createElement('input');
      amtInput.className = 'input';
      amtInput.type = 'text';
      amtInput.inputMode = 'numeric';
      amtInput.value = c.amount;
      amtInput.dataset.catId = c.id;
      amtInput.dataset.field = 'amount';
      amtInput.style.textAlign = 'right';
      amtTd.appendChild(amtInput);

      const actTd = document.createElement('td');
      actTd.style.textAlign = 'right';
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.type = 'button';
      delBtn.textContent = '삭제';
      delBtn.addEventListener('click', () =>
        askConfirm(`당월 카테고리 '${c.name}'을 삭제할까요?`, '삭제', async () => {
          const { res, data } = await api(
            `/api/periods/${state.current}/categories/${c.id}`,
            { method: 'DELETE' },
          );
          if (res.status === 409 && data && data.error === 'has_transactions') {
            showMsg('setcat-msg', '지출 내역이 있어 삭제 불가합니다.');
            return;
          }
          if (res.ok) {
            showMsg('setcat-msg', '');
            await loadCurrentCategories();
          }
        }),
      );
      actTd.appendChild(delBtn);

      tr.appendChild(nameTd);
      tr.appendChild(amtTd);
      tr.appendChild(actTd);
      setcatBody.appendChild(tr);
    }
  }

  async function loadCurrentCategories() {
    if (!state.current) return;
    const { res, data } = await api(`/api/periods/${state.current}/categories`);
    if (res.ok && data) {
      currentCats = data.categories || [];
      renderCurrentCats();
      const lbl = document.getElementById('setcat-period');
      if (lbl) lbl.textContent = state.current;
      schedulePreview();
    }
  }

  document.getElementById('setcat-save').addEventListener('click', async () => {
    const inputs = setcatBody.querySelectorAll('input[data-cat-id]');
    const byId = {};
    for (const inp of inputs) {
      const cid = Number(inp.dataset.catId);
      if (!byId[cid]) byId[cid] = { id: cid };
      if (inp.dataset.field === 'name') byId[cid].name = inp.value.trim();
      else byId[cid].amount = Number(inp.value.trim() || '0');
    }
    const categories = Object.values(byId);
    for (const c of categories) {
      if (!c.name) {
        showMsg('setcat-msg', '카테고리명을 비울 수 없습니다.');
        return;
      }
      if (!Number.isInteger(c.amount) || c.amount < 0) {
        showMsg('setcat-msg', '금액은 0 이상의 정수여야 합니다.');
        return;
      }
    }
    const { res } = await api(`/api/periods/${state.current}/categories`, {
      method: 'PUT',
      body: JSON.stringify({ categories }),
    });
    if (res.ok) {
      showMsg('setcat-msg', '당월 금액 저장됨');
      await loadCurrentCategories();
    } else {
      showMsg('setcat-msg', '저장에 실패했습니다.');
    }
  });

  document.getElementById('setcat-add-btn').addEventListener('click', () => {
    document.getElementById('setcat-modal-name').value = '';
    document.getElementById('setcat-modal-amount').value = '';
    showMsg('setcat-modal-msg', '');
    openModal('setcat-modal');
  });
  document.getElementById('setcat-modal-save').addEventListener('click', async () => {
    const name = document.getElementById('setcat-modal-name').value.trim();
    const amount = Number(document.getElementById('setcat-modal-amount').value.trim() || '0');
    if (!name) {
      showMsg('setcat-modal-msg', '카테고리명을 입력하세요.');
      return;
    }
    if (!Number.isInteger(amount) || amount < 0) {
      showMsg('setcat-modal-msg', '금액은 0 이상의 정수여야 합니다.');
      return;
    }
    const { res } = await api(`/api/periods/${state.current}/categories`, {
      method: 'POST',
      body: JSON.stringify({ name, amount }),
    });
    if (res.ok) {
      closeModal('setcat-modal');
      await loadCurrentCategories();
    } else {
      showMsg('setcat-modal-msg', '추가에 실패했습니다.');
    }
  });

  // ======================= 개인 조정 =======================
  const adjBody = document.getElementById('adj-body');

  function fillAdjMemberSelect() {
    const sel = document.getElementById('adj-modal-member');
    if (!sel) return;
    sel.innerHTML = '';
    for (const m of state.members) {
      if (!m.active) continue;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    }
  }

  function renderAdjustments(list) {
    if (!adjBody) return;
    adjBody.innerHTML = '';
    if (!list || list.length === 0) {
      adjBody.innerHTML = '<tr><td colspan="4" class="empty">조정 없음</td></tr>';
      return;
    }
    for (const a of list) {
      const tr = document.createElement('tr');
      const memTd = document.createElement('td');
      memTd.textContent = a.member_name || `#${a.member_id}`;
      const lblTd = document.createElement('td');
      lblTd.textContent = a.label || '–';
      const amtTd = document.createElement('td');
      amtTd.style.textAlign = 'right';
      amtTd.textContent = (a.amount > 0 ? '+' : '') + fmtWon(a.amount);
      const actTd = document.createElement('td');
      actTd.style.textAlign = 'right';
      actTd.style.whiteSpace = 'nowrap';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn';
      editBtn.type = 'button';
      editBtn.textContent = '수정';
      editBtn.addEventListener('click', () => openAdjModal(a));

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.type = 'button';
      delBtn.textContent = '삭제';
      delBtn.style.marginLeft = '0.3rem';
      delBtn.addEventListener('click', () =>
        askConfirm('이 조정 라인을 삭제할까요?', '삭제', async () => {
          const { res } = await api(`/api/adjustments/${a.id}`, { method: 'DELETE' });
          if (res.ok) await loadAdjustments();
        }),
      );

      actTd.appendChild(editBtn);
      actTd.appendChild(delBtn);
      tr.appendChild(memTd);
      tr.appendChild(lblTd);
      tr.appendChild(amtTd);
      tr.appendChild(actTd);
      adjBody.appendChild(tr);
    }
  }

  async function loadAdjustments() {
    if (!state.current) return;
    const { res, data } = await api(`/api/adjustments?period=${state.current}`);
    if (res.ok && data) {
      state.adjustments = data.adjustments || [];
      renderAdjustments(state.adjustments);
      const lbl = document.getElementById('adj-period');
      if (lbl) lbl.textContent = state.current;
      schedulePreview();
    }
  }

  function openAdjModal(a) {
    fillAdjMemberSelect();
    document.getElementById('adj-modal-id').value = a ? a.id : '';
    if (a) document.getElementById('adj-modal-member').value = a.member_id;
    document.getElementById('adj-modal-label').value = a ? a.label || '' : '';
    document.getElementById('adj-modal-amount').value = a ? a.amount : '';
    document.getElementById('adj-modal-member').disabled = !!a;
    document.getElementById('adj-modal-title').textContent = a ? '조정 수정' : '조정 추가';
    showMsg('adj-modal-msg', '');
    openModal('adj-modal');
  }
  document.getElementById('adj-add-btn').addEventListener('click', () => openAdjModal(null));
  document.getElementById('adj-modal-save').addEventListener('click', async () => {
    const id = document.getElementById('adj-modal-id').value;
    const memberId = Number(document.getElementById('adj-modal-member').value);
    const label = document.getElementById('adj-modal-label').value.trim();
    const amount = Number(document.getElementById('adj-modal-amount').value.trim() || '');
    if (!Number.isInteger(amount)) {
      showMsg('adj-modal-msg', '금액은 정수여야 합니다(± 허용).');
      return;
    }
    let out;
    if (id) {
      out = await api(`/api/adjustments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ label: label || null, amount }),
      });
    } else {
      if (!Number.isInteger(memberId)) {
        showMsg('adj-modal-msg', '팀원을 선택하세요.');
        return;
      }
      out = await api('/api/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          period: state.current,
          member_id: memberId,
          label: label || null,
          amount,
        }),
      });
    }
    if (out.res.ok) {
      closeModal('adj-modal');
      await loadAdjustments();
    } else {
      showMsg('adj-modal-msg', '저장에 실패했습니다.');
    }
  });

  // --- 초기 로드 ----------------------------------------------------------
  async function load() {
    try {
      const { res, data } = await api('/api/periods');
      if (res.ok && data) state.current = data.current;
    } catch (_) {
      /* noop */
    }
    await Promise.all([loadMembers(), loadPerPerson(), loadTemplates()]);
    fillAdjMemberSelect();
    await loadCurrentCategories();
    await loadAdjustments();
  }

  // 미리보기 실시간 갱신 배선(디바운스 250ms). 입력은 버블링되므로 컨테이너 위임.
  const perPersonInputEl = document.getElementById('per-person-input');
  if (perPersonInputEl) perPersonInputEl.addEventListener('input', schedulePreview);
  if (setcatBody) setcatBody.addEventListener('input', schedulePreview);

  // 탭 모듈이 최초 진입 시 호출.
  window.__settings = { load };
})();

// --- 지출 입력·최근 목록 (T6, FR-06·10) ------------------------------------
// 헤더의 "+ 지출 입력"으로 어느 탭에서나 접근 가능. 저장은 POST /api/transactions,
// 최근 목록은 GET /api/transactions?period=. 날짜→기간 자동 귀속·당월만 서버가 강제.
(function expenses() {
  const addBtn = document.getElementById('expense-add-btn');
  if (!addBtn) return;

  const fmtWon = (n) =>
    typeof n === 'number' ? n.toLocaleString('ko-KR') + '원' : '–';

  const openModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  };
  const closeModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  };
  const showMsg = (id, text) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  };

  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...opts,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    return { res, data };
  }

  // 지출 입력 상태(선택 분류·카드). period는 서버 당월을 기준으로 확인만 한다.
  const state = { current: null, kind: 'common', card: null };

  const dateInput = document.getElementById('expense-date');
  const amountInput = document.getElementById('expense-amount');
  const catField = document.getElementById('expense-cat-field');
  const memberField = document.getElementById('expense-member-field');
  const catSelect = document.getElementById('expense-category');
  const memberSelect = document.getElementById('expense-member');
  const memoInput = document.getElementById('expense-memo');

  function todayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async function loadCurrent() {
    try {
      const { res, data } = await api('/api/periods');
      if (res.ok && data) state.current = data.current;
    } catch (_) {
      /* noop */
    }
  }

  async function loadCategories() {
    if (!state.current || !catSelect) return;
    const { res, data } = await api(`/api/periods/${state.current}/categories`);
    if (res.ok && data) {
      catSelect.innerHTML = '';
      for (const c of data.categories || []) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        catSelect.appendChild(opt);
      }
    }
  }

  async function loadMembers() {
    if (!memberSelect) return;
    const { res, data } = await api('/api/members?active=1');
    if (res.ok && data) {
      memberSelect.innerHTML = '';
      for (const m of data.members || []) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        memberSelect.appendChild(opt);
      }
    }
  }

  // 분류에 따라 카테고리/팀원 필드를 조건부 노출.
  function setKind(kind) {
    state.kind = kind;
    for (const b of document.querySelectorAll('.tab-btn[data-kind]')) {
      b.classList.toggle('active', b.dataset.kind === kind);
    }
    if (catField) catField.hidden = kind !== 'common';
    if (memberField) memberField.hidden = kind !== 'personal';
  }

  function setCard(card) {
    state.card = card; // 1 | 2 | null
    for (const b of document.querySelectorAll('.tab-btn[data-card]')) {
      const v = b.dataset.card === '' ? null : Number(b.dataset.card);
      b.classList.toggle('active', v === card);
    }
  }

  // 분류 토글.
  for (const b of document.querySelectorAll('.tab-btn[data-kind]')) {
    b.addEventListener('click', () => setKind(b.dataset.kind));
  }
  // 카드 토글.
  for (const b of document.querySelectorAll('.tab-btn[data-card]')) {
    b.addEventListener('click', () =>
      setCard(b.dataset.card === '' ? null : Number(b.dataset.card)),
    );
  }
  // 빠른 금액 버튼(누적).
  for (const b of document.querySelectorAll('[data-quick]')) {
    b.addEventListener('click', () => {
      if (!amountInput) return;
      const cur = Math.trunc(Number((amountInput.value || '').trim() || '0')) || 0;
      const add = Number(b.dataset.quick);
      amountInput.value = String((cur < 0 ? 0 : cur) + add);
    });
  }
  const clearBtn = document.getElementById('expense-amount-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (amountInput) amountInput.value = '';
    });
  }

  async function openExpenseModal() {
    await loadCurrent();
    await Promise.all([loadCategories(), loadMembers()]);
    if (dateInput) dateInput.value = todayStr();
    if (amountInput) amountInput.value = '';
    if (memoInput) memoInput.value = '';
    setKind('common');
    setCard(null);
    showMsg('expense-modal-msg', '');
    openModal('expense-modal');
  }

  addBtn.addEventListener('click', openExpenseModal);

  document.getElementById('expense-modal-save').addEventListener('click', async () => {
    const date = dateInput ? dateInput.value : '';
    const amount = Math.trunc(Number((amountInput ? amountInput.value : '').trim()));
    if (!date) {
      showMsg('expense-modal-msg', '날짜를 선택하세요.');
      return;
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      showMsg('expense-modal-msg', '금액은 0보다 큰 정수여야 합니다.');
      return;
    }
    const body = { date, amount, kind: state.kind, card: state.card };
    if (state.kind === 'common') {
      const cid = Number(catSelect ? catSelect.value : '');
      if (!Number.isInteger(cid)) {
        showMsg('expense-modal-msg', '카테고리를 선택하세요.');
        return;
      }
      body.period_category_id = cid;
    } else {
      const mid = Number(memberSelect ? memberSelect.value : '');
      if (!Number.isInteger(mid)) {
        showMsg('expense-modal-msg', '대상 팀원을 선택하세요.');
        return;
      }
      body.member_id = mid;
    }
    const memo = memoInput ? memoInput.value.trim() : '';
    if (memo) body.memo = memo;

    const { res, data } = await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.ok) {
      closeModal('expense-modal');
      await loadRecent();
    } else {
      const err = data && data.error ? data.error : '';
      let msg = '저장에 실패했습니다.';
      if (err === 'date_not_in_current_period') msg = '당월 날짜만 입력할 수 있습니다.';
      else if (err === 'invalid amount') msg = '금액을 확인하세요(0보다 큰 정수).';
      else if (err === 'category not found') msg = '카테고리를 확인하세요.';
      else if (err === 'member not found') msg = '대상 팀원을 확인하세요.';
      showMsg('expense-modal-msg', msg);
    }
  });

  // --- 최근 지출 미니 목록 -------------------------------------------------
  const recentBody = document.getElementById('recent-body');
  const cardLabel = (c) => (c === 1 ? '카드 1' : c === 2 ? '카드 2' : '–');

  async function loadRecent() {
    await loadCurrent();
    const lbl = document.getElementById('recent-period');
    if (lbl) lbl.textContent = state.current || '–';
    if (!recentBody || !state.current) return;
    const { res, data } = await api(`/api/transactions?period=${state.current}`);
    if (!res.ok || !data) return;
    const rows = (data.transactions || []).slice(0, 8);
    recentBody.innerHTML = '';
    if (rows.length === 0) {
      recentBody.innerHTML = '<tr><td colspan="5" class="empty">지출 없음</td></tr>';
      return;
    }
    for (const t of rows) {
      const tr = document.createElement('tr');

      const dateTd = document.createElement('td');
      dateTd.textContent = t.date;

      const kindTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = t.kind === 'common' ? 'badge badge-ok' : 'badge badge-warn';
      badge.textContent = t.kind === 'common' ? '공용' : '개인';
      kindTd.appendChild(badge);

      const targetTd = document.createElement('td');
      targetTd.textContent =
        t.kind === 'common' ? t.category_name || '–' : t.member_name || '–';

      const cardTd = document.createElement('td');
      cardTd.textContent = cardLabel(t.card);

      const amtTd = document.createElement('td');
      amtTd.style.textAlign = 'right';
      amtTd.style.fontVariantNumeric = 'tabular-nums';
      amtTd.textContent = fmtWon(t.amount);

      tr.appendChild(dateTd);
      tr.appendChild(kindTd);
      tr.appendChild(targetTd);
      tr.appendChild(cardTd);
      tr.appendChild(amtTd);
      recentBody.appendChild(tr);
    }
  }

  const refreshBtn = document.getElementById('recent-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadRecent);

  loadRecent();
})();

// --- 대시보드 본체 (T7, FR-07·08·10) ---------------------------------------
// 선택된 기간(period)으로 GET /api/dashboard 를 호출해 전체 소진율·카테고리 카드·
// 팀원 테이블·카드 집계를 렌더한다. 산식/할당은 서버(computeAllocation) 단일 소스 —
// 클라이언트는 표시만 한다. 기간 선택(periodPicker)과 탭 전환(tabs)이 render/refresh를 호출한다.
(function dashboard() {
  const fmtWon = (n) =>
    typeof n === 'number' ? n.toLocaleString('ko-KR') + '원' : '–';
  // 소진율(0..1)을 퍼센트 문자열로. 소수 1자리.
  const fmtPct = (r) =>
    Number.isFinite(r) ? (r * 100).toFixed(1) + '%' : '–';

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  // ≥80% 임박, 초과(사용>배정)는 danger. 카테고리·팀원 상태 배지 공통 규칙.
  function statusClass(used, allocated) {
    if (used > allocated) return 'danger'; // 초과
    const ratio = allocated > 0 ? used / allocated : 0;
    if (ratio >= 0.8) return 'warn'; // 임박
    return 'ok'; // 여유
  }
  function statusLabel(cls) {
    return cls === 'danger' ? '초과' : cls === 'warn' ? '임박' : '여유';
  }

  async function api(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    return { res, data };
  }

  // ---- 전체 요약 · 소진율 ----
  function renderSummary(d) {
    const t = d.totals || {};
    setText('dash-period', d.period || '–');
    setText('dash-total', fmtWon(d.total_budget));
    setText('dash-used', fmtWon(t.used_total));
    setText('dash-remaining', fmtWon(t.remaining_total));
    setText('dash-used-common', fmtWon(t.used_common));
    setText('dash-used-personal', fmtWon(t.used_personal));

    const ratio = typeof t.overall_ratio === 'number' ? t.overall_ratio : 0;
    setText('dash-ratio', fmtPct(ratio));

    const fill = document.getElementById('dash-progress');
    if (fill) {
      const pct = Math.max(0, Math.min(100, ratio * 100));
      fill.style.width = pct + '%';
      const over = ratio > 1;
      const warn = !over && ratio >= 0.8;
      fill.classList.toggle('over', over);
      fill.classList.toggle('warn', warn);
    }
    const overBadge = document.getElementById('dash-over-badge');
    if (overBadge) overBadge.hidden = ratio <= 1;
  }

  // ---- 카테고리 카드 (FR-07) ----
  function renderCategoryCards(d) {
    const wrap = document.getElementById('dash-cat-cards');
    if (!wrap) return;
    wrap.innerHTML = '';
    const cats = d.categories || [];
    if (cats.length === 0) {
      wrap.innerHTML = '<p class="empty">카테고리 없음</p>';
      return;
    }
    for (const c of cats) {
      const cls = statusClass(c.used, c.allocated);
      const card = document.createElement('div');
      card.className = 'card';

      const head = document.createElement('div');
      head.style.display = 'flex';
      head.style.alignItems = 'center';
      head.style.justifyContent = 'space-between';
      head.style.gap = '0.5rem';
      head.style.marginBottom = '0.6rem';

      const nameEl = document.createElement('strong');
      nameEl.textContent = c.name;

      const badge = document.createElement('span');
      badge.className = 'badge badge-' + cls;
      badge.textContent = statusLabel(cls);

      head.appendChild(nameEl);
      head.appendChild(badge);

      const line = (label, value, danger) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.fontSize = '0.82rem';
        row.style.marginBottom = '0.25rem';
        const l = document.createElement('span');
        l.className = 'muted';
        l.textContent = label;
        const v = document.createElement('span');
        v.style.fontVariantNumeric = 'tabular-nums';
        if (danger) v.style.color = 'var(--danger)';
        v.textContent = value;
        row.appendChild(l);
        row.appendChild(v);
        return row;
      };

      card.appendChild(head);
      card.appendChild(line('배정', fmtWon(c.allocated)));
      card.appendChild(line('사용', fmtWon(c.used)));
      card.appendChild(line('잔액', fmtWon(c.remaining), c.remaining < 0));

      // 카테고리별 소진율 진행바(토큰 색만).
      const prog = document.createElement('div');
      prog.className = 'progress';
      prog.style.marginTop = '0.5rem';
      const fill = document.createElement('div');
      fill.className = 'progress-fill' + (cls === 'danger' ? ' over' : cls === 'warn' ? ' warn' : '');
      fill.style.width = Math.max(0, Math.min(100, (c.ratio || 0) * 100)) + '%';
      prog.appendChild(fill);
      card.appendChild(prog);

      const pct = document.createElement('div');
      pct.className = 'hint';
      pct.style.marginTop = '0.35rem';
      pct.style.textAlign = 'right';
      pct.textContent = '소진율 ' + fmtPct(c.ratio || 0);
      card.appendChild(pct);

      wrap.appendChild(card);
    }
  }

  // ---- 팀원 테이블 (FR-08) ----
  function renderMemberTable(d) {
    const body = document.getElementById('dash-member-body');
    const hint = document.getElementById('dash-member-hint');
    if (!body) return;
    body.innerHTML = '';
    const members = d.members || [];

    if (members.length === 0) {
      // 과거 월은 팀원별 스냅샷이 없어 상세 미제공(categories/totals/cards는 정확).
      body.innerHTML =
        '<tr><td colspan="6" class="empty">당월에서만 팀원별 상세를 제공합니다.</td></tr>';
      if (hint) {
        hint.textContent =
          '과거 월은 팀원 명단 스냅샷이 없어 팀원별 잔액을 표시하지 않습니다(전체·카테고리·카드 집계는 정확).';
        hint.hidden = false;
      }
      return;
    }
    if (hint) hint.hidden = true;

    for (const m of members) {
      const cls = statusClass(m.used, m.allocation);
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = m.name;

      const allocTd = document.createElement('td');
      allocTd.style.textAlign = 'right';
      allocTd.style.fontVariantNumeric = 'tabular-nums';
      allocTd.textContent = fmtWon(m.allocation);

      const usedTd = document.createElement('td');
      usedTd.style.textAlign = 'right';
      usedTd.style.fontVariantNumeric = 'tabular-nums';
      usedTd.textContent = fmtWon(m.used);

      const remTd = document.createElement('td');
      remTd.style.textAlign = 'right';
      remTd.style.fontVariantNumeric = 'tabular-nums';
      if (m.remaining < 0) remTd.style.color = 'var(--danger)';
      remTd.textContent = fmtWon(m.remaining);

      const ratioTd = document.createElement('td');
      ratioTd.style.textAlign = 'right';
      ratioTd.style.fontVariantNumeric = 'tabular-nums';
      if (m.ratio > 1) ratioTd.style.color = 'var(--danger)';
      ratioTd.textContent = fmtPct(m.ratio || 0);

      const stTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge badge-' + cls;
      badge.textContent = statusLabel(cls);
      stTd.appendChild(badge);

      tr.appendChild(nameTd);
      tr.appendChild(allocTd);
      tr.appendChild(usedTd);
      tr.appendChild(remTd);
      tr.appendChild(ratioTd);
      tr.appendChild(stTd);
      body.appendChild(tr);
    }
  }

  // ---- 카드별 사용 (FR-10) ----
  function renderCards(d) {
    const c = d.cards || {};
    setText('dash-card1', fmtWon(c.card1 || 0));
    setText('dash-card2', fmtWon(c.card2 || 0));
    setText('dash-card-none', fmtWon(c.none || 0));
  }

  // 마지막 렌더 기간(탭 재진입 refresh용).
  let lastPeriod = null;

  async function render(period) {
    if (!period) return;
    lastPeriod = period;
    try {
      const { res, data } = await api(`/api/dashboard?period=${period}`);
      if (!res.ok || !data) throw new Error(`dashboard ${res.status}`);
      renderSummary(data);
      renderCategoryCards(data);
      renderMemberTable(data);
      renderCards(data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[dashboard] render failed:', err);
    }
  }

  function refresh() {
    if (lastPeriod) render(lastPeriod);
  }

  window.__dashboard = { render, refresh };
})();
