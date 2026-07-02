// test/budget.test.js
// computeAllocation 순수 산식·불변식·엣지 케이스 검증 (node --test).
// 신규 도메인 모델: 개인 예산 = 전원 공통 설정값, 자투리(surplus) = balancing 카테고리 흡수.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAllocation, shouldRollbackSurplus } from '../src/budget.js';

test('기본 산식: surplus·effective_common_total·불변식', () => {
  const r = computeAllocation({
    perPerson: 180000,
    memberCount: 3,
    commonTotal: 100000,
    perMemberBudget: 50000,
    adjustmentsTotal: 0,
    memberAdjustments: [
      { member_id: 1, name: 'A', adjustment: 0 },
      { member_id: 2, name: 'B', adjustment: 0 },
      { member_id: 3, name: 'C', adjustment: 0 },
    ],
  });

  assert.equal(r.total_budget, 540000); // 180000 × 3
  assert.equal(r.personal_total, 150000); // 50000 × 3 + 0
  assert.equal(r.surplus, 290000); // 540000 − 100000 − 150000
  assert.equal(r.effective_common_total, 390000); // 100000 + 290000
  assert.equal(r.members.length, 3);
  for (const m of r.members) {
    assert.equal(m.base, 50000);
    assert.equal(m.final, 50000);
  }
  // 불변식: effective_common_total + Σfinal == total_budget
  const sumFinal = r.members.reduce((s, m) => s + m.final, 0);
  assert.equal(r.effective_common_total + sumFinal, r.total_budget);
  assert.equal(r.invariant_ok, true);
  assert.equal(r.warning, null);
});

test('조정 포함: 팀원별 최종 = per_member_budget + 본인 조정, 불변식 성립', () => {
  const memberAdjustments = [
    { member_id: 1, name: 'A', adjustment: 20000 },
    { member_id: 2, name: 'B', adjustment: -5000 },
    { member_id: 3, name: 'C', adjustment: 0 },
  ];
  const adjustmentsTotal = 15000; // 20000 − 5000 + 0
  const r = computeAllocation({
    perPerson: 180000,
    memberCount: 3,
    commonTotal: 100000,
    perMemberBudget: 50000,
    adjustmentsTotal,
    memberAdjustments,
  });

  assert.equal(r.total_budget, 540000);
  assert.equal(r.personal_total, 165000); // 150000 + 15000
  assert.equal(r.surplus, 275000); // 540000 − 100000 − 165000
  assert.equal(r.effective_common_total, 375000);

  const byId = Object.fromEntries(r.members.map((m) => [m.member_id, m]));
  assert.equal(byId[1].final, 70000); // 50000 + 20000
  assert.equal(byId[2].final, 45000); // 50000 − 5000
  assert.equal(byId[3].final, 50000);

  const sumFinal = r.members.reduce((s, m) => s + m.final, 0);
  assert.equal(sumFinal, 165000);
  assert.equal(r.effective_common_total + sumFinal, r.total_budget);
  assert.equal(r.invariant_ok, true);
  assert.equal(r.warning, null);
});

test('엣지 N=0: 팀원 없음 경고, 0 나눗셈 없음', () => {
  const r = computeAllocation({
    perPerson: 180000,
    memberCount: 0,
    commonTotal: 100000,
    perMemberBudget: 50000,
    adjustmentsTotal: 3000,
    memberAdjustments: [],
  });

  assert.equal(r.total_budget, 0);
  assert.equal(r.personal_total, 3000); // 50000 × 0 + 3000
  assert.equal(r.surplus, -103000); // 0 − 100000 − 3000
  assert.equal(r.effective_common_total, -3000); // 100000 + (−103000)
  assert.deepEqual(r.members, []);
  assert.equal(r.warning, 'no_members');
  // effective_common_total !== 0 이므로 불변식 미성립.
  assert.equal(r.invariant_ok, false);
});

test('엣지 N=0, common_total=0, adjustments=0 → 불변식 성립', () => {
  const r = computeAllocation({
    perPerson: 180000,
    memberCount: 0,
    commonTotal: 0,
    perMemberBudget: 50000,
    adjustmentsTotal: 0,
    memberAdjustments: [],
  });
  assert.equal(r.total_budget, 0);
  assert.equal(r.surplus, 0);
  assert.equal(r.effective_common_total, 0);
  assert.equal(r.invariant_ok, true);
  assert.equal(r.warning, 'no_members');
});

test('엣지 surplus<0: over_budget 경고(개인+공용이 예산 초과)', () => {
  const r = computeAllocation({
    perPerson: 100000,
    memberCount: 2,
    commonTotal: 50000,
    perMemberBudget: 90000,
    adjustmentsTotal: 0,
    memberAdjustments: [
      { member_id: 1, name: 'A', adjustment: 0 },
      { member_id: 2, name: 'B', adjustment: 0 },
    ],
  });

  assert.equal(r.total_budget, 200000);
  assert.equal(r.personal_total, 180000); // 90000 × 2
  assert.equal(r.surplus, -30000); // 200000 − 50000 − 180000
  assert.equal(r.effective_common_total, 20000); // 50000 + (−30000)
  assert.equal(r.warning, 'over_budget');
  // 불변식 자체는 대수적으로 성립(경고와 무관).
  const sumFinal = r.members.reduce((s, m) => s + m.final, 0);
  assert.equal(r.effective_common_total + sumFinal, r.total_budget);
  assert.equal(r.invariant_ok, true);
});

test('surplus 정확히 0: balancing이 흡수할 자투리 없음', () => {
  const r = computeAllocation({
    perPerson: 100000,
    memberCount: 2,
    commonTotal: 40000,
    perMemberBudget: 80000,
    adjustmentsTotal: 0,
    memberAdjustments: [
      { member_id: 1, name: 'A', adjustment: 0 },
      { member_id: 2, name: 'B', adjustment: 0 },
    ],
  });
  assert.equal(r.total_budget, 200000);
  assert.equal(r.surplus, 0); // 200000 − 40000 − 160000
  assert.equal(r.effective_common_total, 40000);
  assert.equal(r.warning, null);
  assert.equal(r.invariant_ok, true);
});

test('memberAdjustments 개수 불일치 시 invariant_ok=false', () => {
  // adjustments_total은 15000인데 members는 2명만(합 불일치) → 불변식 실측 실패.
  const r = computeAllocation({
    perPerson: 180000,
    memberCount: 3,
    commonTotal: 100000,
    perMemberBudget: 50000,
    adjustmentsTotal: 15000,
    memberAdjustments: [
      { member_id: 1, name: 'A', adjustment: 20000 },
      { member_id: 2, name: 'B', adjustment: -5000 },
    ],
  });
  assert.equal(r.members.length, 2); // N=3와 불일치
  assert.equal(r.invariant_ok, false);
});

test('shouldRollbackSurplus: 방향-완화 가드 판정', () => {
  // 양수로 유지 → 통과.
  assert.equal(shouldRollbackSurplus(100, 50), false);
  // 양수 → 음수(악화) → 롤백.
  assert.equal(shouldRollbackSurplus(100, -10), true);
  // 0에서 음수(악화) → 롤백(팀원 추가로 음수 유발).
  assert.equal(shouldRollbackSurplus(0, -20000), true);
  // 이미 음수인데 더 나빠짐 → 롤백(팀원 비활성이 악화시키는 경우 등).
  assert.equal(shouldRollbackSurplus(-450000, -630000), true);
  // 이미 음수인데 개선(덜 음수) → 통과(초기 음수 락아웃 방지, Fix 3).
  assert.equal(shouldRollbackSurplus(-450000, -50000), false);
  // 이미 음수인데 유지(동일) → 통과(after >= before).
  assert.equal(shouldRollbackSurplus(-100, -100), false);
  // 음수에서 양수로 개선 → 통과.
  assert.equal(shouldRollbackSurplus(-100, 300), false);
});

test('비정수/NaN 입력 방어: toInt로 절삭', () => {
  const r = computeAllocation({
    perPerson: '180000.9',
    memberCount: '2',
    commonTotal: NaN,
    perMemberBudget: 50000.7,
    adjustmentsTotal: undefined,
    memberAdjustments: [
      { member_id: 1, name: 'A', adjustment: 0 },
      { member_id: 2, name: 'B', adjustment: 0 },
    ],
  });
  assert.equal(r.total_budget, 360000); // 180000 × 2
  assert.equal(r.common_total, 0); // NaN → 0
  assert.equal(r.per_member_budget, 50000); // 50000.7 → 50000
  assert.equal(r.personal_total, 100000);
  assert.equal(r.surplus, 260000);
  assert.equal(r.invariant_ok, true);
});
