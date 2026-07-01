// src/budget.js
// 예산 배정(개인 할당) 순수 계산 모듈 (FR-05, PRD 2.2·2.6).
// DB·HTTP 의존이 전혀 없다 — 서버(GET/POST)와 테스트에서 단일 소스로 재사용한다.
//
// 핵심 산식(PRD 2.2, 엄수):
//   total_budget      = per_person × N
//   distributable     = total_budget − common_total − adjustments_total
//   base_allocation   = floor(distributable / N)
//   remainder(r)      = distributable − base_allocation × N        (항상 0..N-1)
//   → member id 오름차순으로 앞 r명에게 기본 +1 → Σ(각자 기본) == distributable (정확)
//   팀원별 최종        = 기본(+나머지 1) + 본인 조정합
//
// 불변식(반드시 성립): common_total + Σ(팀원별 최종) == total_budget (정확).
//   Σfinal = Σbase + Σadjustment = distributable + adjustments_total 이고,
//   distributable = total_budget − common_total − adjustments_total 이므로
//   common_total + Σfinal = total_budget 이 대수적으로 정확히 성립한다.
//
// 엣지:
//   - N=0: 0 나눗셈 금지. total_budget=0, base=0, members=[], warning='no_members'.
//   - distributable<0(공용+조정이 예산 초과): base가 음수일 수 있으나 계산은 그대로.
//     warning='over_budget'. floor 사용으로 remainder는 여전히 0..N-1 → 불변식 정확 성립.

/** 정수로 강제(비유한/NaN은 0). 원 단위 정수 화폐이므로 소수는 버림. */
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * 개인 할당 배정을 계산한다(순수 함수).
 *
 * @param {object} args
 * @param {number} args.perPerson         인당 금액.
 * @param {number} args.memberCount        해당 월 인원 N(당월은 active와 동기화된 스냅샷).
 * @param {number} args.commonTotal        공용 카테고리 합계(그 월).
 * @param {number} args.adjustmentsTotal   개인 조정 합계(그 월, ± 포함).
 * @param {Array<{member_id:number,name:string,adjustment:number}>} [args.memberAdjustments]
 *        팀원별 조정합. 팀원별 상세(members) 산출에 사용. 비우면 aggregate만 정확.
 * @returns {{
 *   total_budget:number, common_total:number, adjustments_total:number,
 *   distributable:number, base_allocation:number, remainder:number,
 *   members:Array<{member_id:number,name:string,base:number,adjustment:number,final:number}>,
 *   invariant_ok:boolean, warning:(string|null)
 * }}
 */
export function computeAllocation({
  perPerson,
  memberCount,
  commonTotal,
  adjustmentsTotal,
  memberAdjustments = [],
} = {}) {
  const per = toInt(perPerson);
  const N = Math.max(0, toInt(memberCount));
  const common_total = toInt(commonTotal);
  const adjustments_total = toInt(adjustmentsTotal);

  const total_budget = per * N;

  // --- 엣지: N=0 → 0 나눗셈 금지, 팀원 없음 --------------------------------
  if (N === 0) {
    return {
      total_budget: 0, // per × 0 == 0
      common_total,
      adjustments_total,
      // 정보용(팀원이 없어 실제 분배는 불가). 참고값으로 노출.
      distributable: 0 - common_total - adjustments_total,
      base_allocation: 0,
      remainder: 0,
      members: [],
      // total_budget(0) == common_total + Σfinal(0) 은 common_total==0 일 때만 성립.
      invariant_ok: common_total === 0,
      warning: 'no_members',
    };
  }

  const distributable = total_budget - common_total - adjustments_total;

  // Math.floor은 음수에서도 내림(−∞ 방향) → remainder가 항상 0..N-1 로 정규화되어
  // 음수 distributable(over_budget)에서도 Σbase == distributable 이 정확히 성립한다.
  const base_allocation = Math.floor(distributable / N);
  const remainder = distributable - base_allocation * N; // 0 <= remainder < N

  // member id 오름차순으로 앞 r명에게 기본 +1(원 단위 정확 분배).
  const sorted = [...memberAdjustments].sort((a, b) => a.member_id - b.member_id);
  const members = sorted.map((m, idx) => {
    const base = base_allocation + (idx < remainder ? 1 : 0);
    const adjustment = toInt(m.adjustment);
    return {
      member_id: m.member_id,
      name: m.name,
      base,
      adjustment,
      final: base + adjustment,
    };
  });

  // 불변식 실측 검증: common_total + Σfinal == total_budget (정확).
  // members가 정확히 N명 있어야 Σbase == distributable 이 성립한다.
  const sumFinal = members.reduce((s, m) => s + m.final, 0);
  const invariant_ok = members.length === N && common_total + sumFinal === total_budget;

  const warning = distributable < 0 ? 'over_budget' : null;

  return {
    total_budget,
    common_total,
    adjustments_total,
    distributable,
    base_allocation,
    remainder,
    members,
    invariant_ok,
    warning,
  };
}

export default { computeAllocation };
