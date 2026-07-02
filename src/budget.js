// src/budget.js
// 예산 배정(개인 할당) 순수 계산 모듈 (FR-05, PRD 2.2·2.6).
// DB·HTTP 의존이 전혀 없다 — 서버(GET/POST)와 테스트에서 단일 소스로 재사용한다.
//
// 신규 도메인 모델(개인 예산 = 전원 공통 설정값, 자투리 = balancing 카테고리 흡수).
//
// 핵심 산식(엄수):
//   total_budget           = per_person × N
//   personal_total         = per_member_budget × N + adjustments_total   (조정 ± 포함)
//   surplus(자투리)         = total_budget − common_total − personal_total
//     common_total          = 그 월 카테고리 amount 합(balancing 카테고리의 "설정값" 포함)
//   effective_common_total = common_total + surplus                      (balancing에 surplus 가산 후 전체 공용)
//   팀원별 최종 할당        = per_member_budget + 본인 조정
//
// 불변식(반드시 정확히 성립): effective_common_total + Σ(팀원별 최종) == total_budget
//   증명: (common_total + surplus) + (per_member_budget×N + adjustments_total)
//       = common_total + (total_budget − common_total − per_member_budget×N − adjustments_total)
//         + per_member_budget×N + adjustments_total
//       = total_budget ✓
//
// 엣지:
//   - N=0: 0 나눗셈 없음. total_budget=0, personal_total=adjustments_total,
//     surplus=−common_total−adjustments_total, members=[], warning='no_members'.
//   - surplus<0(개인+공용이 예산 초과): warning='over_budget'. 쓰기 API는 이 경우 400 차단(server.js).

/** 정수로 강제(비유한/NaN은 0). 원 단위 정수 화폐이므로 소수는 버림. */
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * 개인 할당 배정을 계산한다(순수 함수).
 *
 * @param {object} args
 * @param {number} args.perPerson         인당 금액(총예산 산출용).
 * @param {number} args.memberCount        해당 월 인원 N(당월은 active와 동기화된 스냅샷).
 * @param {number} args.commonTotal        공용 카테고리 합계(그 월, balancing 설정값 포함).
 * @param {number} args.perMemberBudget    개인 예산(전원 공통 설정값).
 * @param {number} args.adjustmentsTotal   개인 조정 합계(그 월, ± 포함).
 * @param {Array<{member_id:number,name:string,adjustment:number}>} [args.memberAdjustments]
 *        팀원별 조정합. 팀원별 상세(members) 산출에 사용. 비우면 aggregate만 정확.
 * @returns {{
 *   total_budget:number, common_total:number, per_member_budget:number,
 *   adjustments_total:number, personal_total:number, surplus:number,
 *   effective_common_total:number,
 *   members:Array<{member_id:number,name:string,base:number,adjustment:number,final:number}>,
 *   invariant_ok:boolean, warning:(string|null)
 * }}
 */
export function computeAllocation({
  perPerson,
  memberCount,
  commonTotal,
  perMemberBudget,
  adjustmentsTotal,
  memberAdjustments = [],
} = {}) {
  const per = toInt(perPerson);
  const N = Math.max(0, toInt(memberCount));
  const common_total = toInt(commonTotal);
  const per_member_budget = toInt(perMemberBudget);
  const adjustments_total = toInt(adjustmentsTotal);

  const total_budget = per * N;
  const personal_total = per_member_budget * N + adjustments_total;
  const surplus = total_budget - common_total - personal_total;
  const effective_common_total = common_total + surplus;

  // --- 엣지: N=0 → 팀원 없음(0 나눗셈 없음, 팀원별 상세 없음) ----------------
  if (N === 0) {
    return {
      total_budget: 0, // per × 0
      common_total,
      per_member_budget,
      adjustments_total,
      personal_total, // == adjustments_total (per_member_budget × 0)
      surplus, // == −common_total − adjustments_total
      effective_common_total, // == common_total + surplus
      members: [],
      // total_budget(0) == effective_common_total + Σfinal(0) 은 effective_common_total==0 일 때만 성립.
      invariant_ok: effective_common_total === 0,
      warning: 'no_members',
    };
  }

  // 팀원별 최종 = 개인 예산(공통) + 본인 조정. member id 오름차순.
  const sorted = [...memberAdjustments].sort((a, b) => a.member_id - b.member_id);
  const members = sorted.map((m) => {
    const adjustment = toInt(m.adjustment);
    return {
      member_id: m.member_id,
      name: m.name,
      base: per_member_budget,
      adjustment,
      final: per_member_budget + adjustment,
    };
  });

  // 불변식 실측 검증: effective_common_total + Σfinal == total_budget.
  // members가 정확히 N명이고 그 조정 합이 adjustments_total과 일치해야 정확히 성립한다.
  const sumFinal = members.reduce((s, m) => s + m.final, 0);
  const invariant_ok =
    members.length === N && effective_common_total + sumFinal === total_budget;

  const warning = surplus < 0 ? 'over_budget' : null;

  return {
    total_budget,
    common_total,
    per_member_budget,
    adjustments_total,
    personal_total,
    surplus,
    effective_common_total,
    members,
    invariant_ok,
    warning,
  };
}

/**
 * 방향-완화 surplus 가드 판정(순수 함수).
 *
 * 절대값이 아니라 "변경 방향"을 본다. 이미 음수인 상태에서 상황을 개선(또는 유지)하는
 * 편집까지 막지 않기 위함이다(초기 음수 락아웃 방지). 오직 변경 후 음수이고,
 * 그 음수가 변경 전보다 더 나빠졌을 때만 롤백 대상으로 본다.
 *
 * @param {number} before 뮤테이션 직전 surplus
 * @param {number} after  뮤테이션 직후 surplus
 * @returns {boolean} true면 롤백(차단), false면 통과(개선·유지·양수)
 */
export function shouldRollbackSurplus(before, after) {
  return after < 0 && after < before;
}

export default { computeAllocation, shouldRollbackSurplus };
