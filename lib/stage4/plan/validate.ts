import { bigrams, type PlanContext } from './context';
import { addMonths, PROVISIONAL_MAX_MONTHS, PROVISIONAL_MIN_MONTHS } from './period';
import { classifyKpi } from './kpiClass';
import { FINANCE_ROLES, type AiKpi, type AssembledPlan, type Claim, type FinanceRole, type PlanIssue, type ProtectedKpi } from './types';

const CUSTOMER_OUTCOME = 'CUSTOMER_OUTCOME';
const PAID_CONTRACT_EVIDENCE = /発注書|契約書|注文書|注文請書|有償開発契約/;
const MONEY_UNITS = ['円', '百万円', '¥', '万円', '億円'];
const REGULATORY_WORDS = /規制|法令|薬機|医療機器|安全|認証|許認可|コンプライアンス/;

/** 規制・安全の制約を含む入力の参照ID（草案の障害・リスク・確認事項のどれかに反映する必要がある） */
export function regulatoryConstraintRefs(ctx: PlanContext): string[] {
  return ctx.sources
    .filter((s) => (s.ref === 'S2-SWOT-T' || s.ref === 'S2-SWOT-W' || s.ref.startsWith('S3-RISK-')) && REGULATORY_WORDS.test(s.text))
    .map((s) => s.ref);
}
const COMPLETION_WORDS = /完了|算出|可能日|分類済み|比較|作成|整備|開催|実施|受講|記録件数|記録の/;
const STRONG_OUTCOME_WORDS = /削減|改善|短縮|向上|増加|増える|低減|減少|売上|利益|粗利|定着|転換|受注|継続|満足|軽減|効果|負担/;
const DUPLICATE_LABEL_SIMILARITY = 0.12;
const DUPLICATE_ITEM_SIMILARITY = 0.5;

/** 2文字の組の一致度（Jaccard）。言い換えの重複を見つけるための粗い指標 */
function jaccard(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  const union = x.size + y.size - common;
  return union === 0 ? 0 : common / union;
}
const MAX_BEFORE_START = 3;
const RECOMMENDED_ACTIONS = 5;

/** 方式ごとに算定に使う役割。ここに無い役割の入力は、その方式の計算に入らない */
const METHOD_ROLES: Record<'FUNNEL' | 'QUANTITY_UNIT_PRICE' | 'DIRECT_AMOUNT', FinanceRole[]> = {
  FUNNEL: ['MEETINGS', 'WIN_RATE', 'AVG_DEAL'],
  QUANTITY_UNIT_PRICE: ['QUANTITY', 'UNIT_PRICE'],
  DIRECT_AMOUNT: ['DIRECT_AMOUNT'],
};

const err = (code: string, path: string, message: string): PlanIssue => ({ severity: 'error', code, path, message });
const warn = (code: string, path: string, message: string): PlanIssue => ({ severity: 'warning', code, path, message });

const ROUTE_B_KEYS = new Set(['confirmed', 'confirmedAt', 'financeEffect', 'financeEffects']);

export function findRouteBKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findRouteBKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) =>
      (ROUTE_B_KEYS.has(k) ? [`${path}.${k}`] : []).concat(findRouteBKeys(v, `${path}.${k}`))
    );
  }
  return [];
}

/** 計画期間の確定値（AI仮期間を含む）が、規則の範囲にあるかを確かめる */
export function periodIssues(plan: AssembledPlan): PlanIssue[] {
  const { startYm, endYm, basis } = plan.period;
  if (basis !== 'AI_PROVISIONAL') return [];
  const lo = addMonths(startYm, PROVISIONAL_MIN_MONTHS - 1);
  const hi = addMonths(startYm, PROVISIONAL_MAX_MONTHS - 1);
  return endYm < lo || endYm > hi
    ? [err('PERIOD_PROVISIONAL_OUT_OF_RANGE', 'period', `仮期間の終了 ${endYm} が ${lo}〜${hi} の範囲外`)]
    : [];
}

type AnyKpi = (ProtectedKpi | AiKpi) & { key: string };

export function validatePlan(plan: AssembledPlan, ctx: PlanContext): PlanIssue[] {
  const issues: PlanIssue[] = [...periodIssues(plan)];
  const { startYm, endYm } = plan.period;
  const inPeriod = (ym: string | null | undefined) => !!ym && ym >= startYm && ym <= endYm;
  const refs = new Set(ctx.sources.map((s) => s.ref));
  const ownerOk = (name: string | null) => name === null || ctx.ownerCandidates.includes(name);

  const checkRefs = (list: string[], path: string) => {
    for (const r of list) {
      if (!refs.has(r)) issues.push(err('SOURCE_REF_UNKNOWN', path, `入力にない参照: ${r}`));
    }
  };
  const checkClaim = (c: Claim, path: string) => {
    checkRefs(c.sourceRefs, path);
    if ((c.basis === 'STAGE_DATA' || c.basis === 'DERIVED') && c.sourceRefs.length === 0) {
      issues.push(err('CLAIM_UNSOURCED', path, '入力の根拠が無いのに STAGE_DATA / DERIVED とされている'));
    }
  };

  // 1. 現状と障害
  const s1 = plan.section1;
  const { obstacles, ...claims } = s1;
  (Object.keys(claims) as Array<keyof typeof claims>).forEach((k) => checkClaim(claims[k] as Claim, `section1.${k}`));
  if (obstacles.length === 0) {
    issues.push(err('OBSTACLES_MISSING', 'section1.obstacles', '何が成果を妨げているか（障害）が書かれていない'));
  }
  obstacles.forEach((o, i) => {
    const p = `section1.obstacles[${i + 1}]`;
    checkRefs(o.sourceRefs, p);
    if ((o.basis === 'STAGE_DATA' || o.basis === 'DERIVED') && o.sourceRefs.length === 0) {
      issues.push(err('CLAIM_UNSOURCED', p, '入力の根拠が無いのに STAGE_DATA / DERIVED とされている'));
    }
    if (o.basis === 'HYPOTHESIS' && !o.verifyBy.trim()) {
      issues.push(err('HYPOTHESIS_WITHOUT_VERIFICATION', p, '仮説の障害に、検証の行動が無い'));
    }
  });

  // 2. 行動と成果の因果
  const actions = plan.section2.actions;
  if (actions.length > RECOMMENDED_ACTIONS) {
    issues.push(warn('ACTION_COUNT_HIGH', 'section2.actions', `主要な行動が ${actions.length} 件（原則3〜5件）`));
  }
  const orders = actions.map((a) => a.order);
  if (!orders.every((o, i) => o === i + 1)) {
    issues.push(err('ACTION_ORDER_INVALID', 'section2.actions', '行動の順序が 1 から連番になっていない'));
  }
  const dueByOrder = new Map(actions.map((a) => [a.order, a.dueYm]));

  const protectedKpis = plan.section3.protectedKpis;
  const proposed = plan.section3.proposedKpis;
  const all: AnyKpi[] = [...protectedKpis, ...proposed];
  const kpiByKey = new Map<string, AnyKpi>(all.map((k) => [k.key, k]));
  const kpiKeysOk = (keys: string[], path: string) => {
    for (const k of keys) {
      if (!kpiByKey.has(k)) issues.push(err('KPI_REF_UNKNOWN', path, `存在しないKPI ${k}`));
    }
  };

  actions.forEach((a) => {
    const p = `section2.actions[${a.order}]`;
    if (!inPeriod(a.dueYm)) issues.push(err('DUE_OUT_OF_PERIOD', p, `期限 ${a.dueYm} が計画期間 ${startYm}〜${endYm} の外`));
    checkRefs(a.sourceRefs, p);
    if (a.basis === 'STAGE_DATA' && a.sourceRefs.length === 0) {
      issues.push(err('CLAIM_UNSOURCED', p, '入力の根拠が無いのに STAGE_DATA とされている'));
    }
    kpiKeysOk(a.supportsKpiKeys, p);
    if (a.mechanism === null) {
      issues.push(err('MECHANISM_MISSING', p, '行動が、どの障害をどう変え、なぜ価値につながるかが書かれていない'));
    } else {
      if (a.mechanism.obstacleRefs.length === 0) {
        issues.push(err('MECHANISM_OBSTACLE_MISSING', p, '行動が、どの障害に対応するかが書かれていない'));
      }
      for (const r of a.mechanism.obstacleRefs) {
        if (r > obstacles.length) issues.push(err('MECHANISM_OBSTACLE_REF_UNKNOWN', p, `存在しない障害 ${r}`));
      }
    }
    for (const d of a.dependsOn) {
      const dueOfDep = dueByOrder.get(d);
      if (d >= a.order || dueOfDep === undefined) {
        issues.push(err('ACTION_DEPENDENCY_INVALID', p, `先行行動 ${d} が後続より前に存在しない`));
      } else if (dueOfDep > a.dueYm) {
        issues.push(err('DUE_ORDER_CONFLICT', p, `先行行動 ${d} の期限が、この行動より後になっている`));
      }
    }
    for (const key of a.supportsKpiKeys) {
      const kpi = kpiByKey.get(key);
      if (kpi && 'stage3KpiId' in kpi && kpi.due !== null && kpi.due < a.dueYm) {
        issues.push(warn('STAGE3_KPI_TIMING_CONFLICT', p, `既存KPI「${kpi.label}」の期限（${kpi.due}）が、それを支える行動（${a.dueYm}）より前。確認事項`));
      }
    }
  });

  const keys = all.map((k) => k.key);
  if (new Set(keys).size !== keys.length) issues.push(err('KPI_KEY_DUPLICATE', 'section3', 'KPIのキーが重複している'));

  protectedKpis.forEach((k) => {
    if (k.due !== null && !inPeriod(k.due)) {
      issues.push(warn('STAGE3_KPI_OUTSIDE_PERIOD', `section3.${k.key}`, `既存KPI「${k.label}」の期限 ${k.due} が計画期間の外。確認事項`));
    }
  });

  // 3. KPI：既存KPIの保護、活動の指標の混同、期限
  const stage3Labels = new Set(ctx.stage3Kpis.map((k) => k.label));
  const stage3Ids = new Set(ctx.stage3Kpis.map((k) => k.id));
  plan.section3.stage3Review.forEach((r, i) => {
    const p = `section3.stage3Review[${i + 1}]`;
    if (!stage3Ids.has(r.stage3KpiId)) issues.push(err('STAGE3_REVIEW_UNKNOWN_KPI', p, `存在しない確定KPI ${r.stage3KpiId}`));
    checkRefs(r.sourceRefs, p);
  });

  proposed.forEach((k, idx) => {
    const p = `section3.${k.key}`;
    if (stage3Labels.has(k.label)) {
      issues.push(err('KPI_IDENTITY_CONFLICT', p, '追加KPIが既存の確定KPIと同名で、区別できない'));
    }
    if (ctx.otherDepartmentKpiLabels.includes(k.label)) {
      issues.push(err('OTHER_DEPARTMENT_KPI_ADOPTED', p, `他部門の指標「${k.label}」を、この計画の追加KPIにしている（他部門の指標は参照のみ）`));
    }
    const duplicateOf = [...protectedKpis, ...proposed.slice(0, idx)].find(
      (o) => o.target !== null && o.target === k.target && o.unit === k.unit && jaccard(o.label, k.label) >= DUPLICATE_LABEL_SIMILARITY
    );
    if (duplicateOf) {
      issues.push(warn('KPI_DUPLICATE', p, `「${k.label}」は「${duplicateOf.label}」と測るものが重なっている（同じ目標値）。どちらかに統合する`));
    }
    if (k.target !== null && k.targetBasis !== 'AI_PROVISIONAL') {
      issues.push(err('UNCONFIRMED_AS_CONFIRMED', p, 'AIが置いた目標値が仮目標（AI_PROVISIONAL）になっていない'));
    }
    if (k.kind === 'LEADING') {
      if (COMPLETION_WORDS.test(k.label)) {
        issues.push(warn('LEADING_PROCESS_KPI', p, `「${k.label}」は記録・算出の完了を測る途中の確認。成果（不良率・廃棄量など）を動かす道筋を mechanism に書く`));
      }
    } else {
      const c = classifyKpi(k.label, k.unit);
      const completionAsOutcome = COMPLETION_WORDS.test(k.label) && !STRONG_OUTCOME_WORDS.test(k.label);
      if (c.class === 'ACTIVITY' || completionAsOutcome) {
        issues.push(err('ACTIVITY_KPI_AS_OUTCOME', p, `活動・記録の指標「${k.label}」が成果のKPIになっている（${c.class === 'ACTIVITY' ? c.reason : '完了・記録の指標'}。先行指標にするか、成果を測る指標に変える）`));
      } else if (c.class === 'UNCERTAIN') {
        issues.push(warn('KPI_CLASS_UNCERTAIN', p, `「${k.label}」が活動か成果か判定できない（${c.reason}）。利用者が確認する`));
      }
    }
    if (k.due === null) issues.push(err('KPI_DUE_REQUIRED', p, '追加KPIに期限が無い'));
    if (k.due !== null && !inPeriod(k.due)) issues.push(err('DUE_OUT_OF_PERIOD', p, `KPI期限 ${k.due} が計画期間の外`));
    if (k.kind === CUSTOMER_OUTCOME && MONEY_UNITS.includes(k.unit)) {
      issues.push(err('CUSTOMER_FINANCE_MIX', p, '顧客成果のKPIが金額単位になっている（自社の売上・利益と混同している）'));
    }
    if (!ownerOk(k.owner)) issues.push(err('OWNER_NOT_IN_CONTEXT', p, `担当 ${k.owner} が入力の担当候補にない`));
    let latestAction = '';
    for (const o of k.supportsActionOrders) {
      const d = dueByOrder.get(o);
      if (d === undefined) issues.push(err('ACTION_REF_UNKNOWN', p, `存在しない行動 ${o} を支えている`));
      else if (d > latestAction) latestAction = d;
    }
    if (k.due !== null && latestAction && k.due < latestAction) {
      issues.push(err('KPI_BEFORE_ACTION', p, 'KPIの期限が、それを支える行動の期限より前'));
    }
  });

  // 3b. 実施事項：具体性と、収益化の段階の順序（発注意思→有償契約→試作・検証→量産移行判断→量産受注）
  const STAGE_RANK: Record<string, number> = {
    ORDER_INTENT: 1,
    PAID_CONTRACT: 2,
    VALIDATION: 3,
    MASS_PRODUCTION_DECISION: 4,
    MASS_ORDER: 5,
  };
  let highestRank = 0;
  let highestOrder = 0;
  [...actions]
    .sort((x, y) => x.order - y.order)
    .forEach((a) => {
      const p = `section2.actions[${a.order}]`;
      if (a.deliverable == null || a.exitCondition == null || a.valueStage == null) {
        issues.push(err('ACTION_CONTRACT_MISSING', p, '実施事項に、成果物・次の工程への判断条件・収益化の段階のどれかが無い'));
      }
      if (a.valueStage === 'PAID_CONTRACT' && a.exitCondition != null && !PAID_CONTRACT_EVIDENCE.test(a.exitCondition)) {
        issues.push(err('PAID_CONTRACT_EVIDENCE_MISSING', p, '有償契約の段階なのに、判断条件に発注書・契約書など正式な契約の根拠が無い（意思の確認や条件の確認だけでは到達としない）'));
      }
      if (/^(整理|検討|確認|調整|共有|把握)する$/.test(a.title)) {
        issues.push(err('ACTION_TITLE_VAGUE', p, `実施事項「${a.title}」は、何をするかが分からない。対象と行う内容を書く`));
      } else if (/(整理|検討|確認|調整|共有|把握)する$/.test(a.title) && a.title.length <= 14) {
        issues.push(warn('ACTION_TITLE_VAGUE', p, `実施事項「${a.title}」は、語が短く具体性が低い。対象と行う内容を書く`));
      }
      const rank = a.valueStage ? STAGE_RANK[a.valueStage] : undefined;
      if (rank === undefined) return;
      if (rank < highestRank) {
        issues.push(err('STAGE_ORDER_CONFLICT', p, `収益化の段階が、先の行動（${highestOrder}）の段階より前に戻っている`));
      } else if (rank > highestRank) {
        highestRank = rank;
        highestOrder = a.order;
      }
    });

  // 4. 財務：算定式との整合、確認状態、顧客と自社の混同
  const kpiKind = new Map(all.map((k) => [k.key, k.kind]));
  plan.section4.financeItems.forEach((f) => {
    const p = `section4.financeItems[${f.key}]`;
    if (!inPeriod(f.startYm)) issues.push(err('DUE_OUT_OF_PERIOD', p, `効果の開始 ${f.startYm} が計画期間の外`));
    if (f.endYm !== null && (!inPeriod(f.endYm) || f.endYm < f.startYm)) {
      issues.push(err('FINANCE_PERIOD_INVALID', p, '効果の終了時期が計画期間の外、または開始より前'));
    }
    kpiKeysOk(f.basedOnKpiKeys, p);
    for (const k of f.basedOnKpiKeys) {
      if (kpiKind.get(k) === CUSTOMER_OUTCOME) {
        issues.push(err('CUSTOMER_FINANCE_MIX', p, `顧客成果のKPI ${k} を自社の財務効果の根拠にしている`));
      }
    }
    if (f.method === 'FREE' && !f.freeNote) {
      issues.push(err('FREE_NOTE_MISSING', p, '算定式に入らない項目なのに、算定の考え方（freeNote）が無い'));
    }
    if (f.method === 'FREE' && f.inputs.length === 0) {
      issues.push(err('FINANCE_INPUTS_MISSING', p, '算定に必要なデータ（数量・単価・原価・受注率など）が列挙されていない。不明なら value を null で列挙する'));
    }
    if (f.kind === 'NOT_FINANCIAL') {
      if (f.method !== 'FREE') {
        issues.push(err('NOT_FINANCIAL_METHOD_CONFLICT', p, '財務効果として扱わない項目に、算定式（method）が指定されている'));
      }
      if (!f.freeNote) {
        issues.push(err('FREE_NOTE_MISSING', p, '財務効果として扱わない項目なのに、理由と確認が必要な点（freeNote）が無い'));
      }
    }
    const profitOrPayback = /限界利益|粗利|投資回収|回収期間|回収見込み/.test(`${f.label} ${f.sourceNote} ${f.freeNote ?? ''}`);
    if (profitOrPayback && f.kind !== 'NOT_FINANCIAL') {
      issues.push(err('FINANCE_MISCLASSIFIED', p, '限界利益・投資回収は、売上増加・費用増加とは別の指標。kind を NOT_FINANCIAL にし、確認事項として残す'));
    }
    const roles = f.inputs.map((i) => i.role);
    const dup = roles.filter((r, i) => r !== 'OTHER' && roles.indexOf(r) !== i);
    for (const d of new Set(dup)) issues.push(warn('FINANCE_DUPLICATE_ROLE', p, `役割 ${d} の入力が重複している`));
    if (f.method !== 'FREE') {
      const needed = METHOD_ROLES[f.method];
      for (const r of needed) {
        if (!roles.includes(r)) issues.push(warn('FINANCE_ROLE_MISSING', p, `方式 ${f.method} に必要な入力（${r}）が無い`));
      }
      for (const i of f.inputs) {
        if (i.value !== null && !needed.includes(i.role) && i.role !== 'OTHER') {
          issues.push(warn('FINANCE_INPUT_NOT_USED', p, `入力 ${i.label}（${i.role}）は方式 ${f.method} の計算に入らない`));
        }
      }
    }
    f.inputs.forEach((input) => {
      const ip = `${p}.inputs[${input.label}]`;
      if (!(FINANCE_ROLES as readonly string[]).includes(input.role)) {
        issues.push(err('FINANCE_ROLE_UNKNOWN', ip, `未知の役割 ${input.role}`));
      }
      if (input.confirmState === 'USER_CONFIRMED') {
        issues.push(err('AI_SET_USER_CONFIRMED', ip, 'AIが利用者の確認済みを付けている（確認は利用者だけが行う）'));
      }
      if (input.value !== null && input.basis === 'UNCONFIRMED') {
        issues.push(err('UNCONFIRMED_AS_VALUE', ip, '根拠の無い値（UNCONFIRMED）が数値として入っている'));
      }
      if (input.value === null && input.basis !== 'UNCONFIRMED') {
        issues.push(warn('INPUT_VALUE_MISSING', ip, '値が null なのに根拠区分が UNCONFIRMED ではない'));
      }
      checkRefs(input.sourceRefs, ip);
      if ((input.basis === 'STAGE_DATA' || input.basis === 'DERIVED') && input.sourceRefs.length === 0) {
        issues.push(err('CLAIM_UNSOURCED', ip, '入力の根拠が無いのに STAGE_DATA / DERIVED とされている'));
      }
    });
  });

  // 5. 担当・確認事項・リスク
  const r = plan.section5.responsible;
  if (!ownerOk(r.name)) issues.push(err('OWNER_NOT_IN_CONTEXT', 'section5.responsible', `責任者 ${r.name} が入力の担当候補にない`));
  if (r.name === null) issues.push(warn('OWNER_UNSET', 'section5.responsible', '責任者が未設定のため、実行は開始できない'));
  plan.section5.roles.forEach((role, i) =>
    role.actionOrders.forEach((o) => {
      if (!dueByOrder.has(o)) issues.push(err('ACTION_REF_UNKNOWN', `section5.roles[${i + 1}]`, `存在しない行動 ${o}`));
    })
  );
  plan.section5.risks.forEach((risk, i) => {
    const p = `section5.risks[${i + 1}]`;
    if (!inPeriod(risk.confirmBy)) issues.push(err('DUE_OUT_OF_PERIOD', p, `確認期限 ${risk.confirmBy} が計画期間の外`));
    checkRefs(risk.sourceRefs, p);
  });

  const constraintRefs = regulatoryConstraintRefs(ctx);
  const addressedRefs = new Set([
    ...obstacles.flatMap((o) => o.sourceRefs),
    ...plan.section5.risks.flatMap((r) => r.sourceRefs),
    ...plan.verificationItems.flatMap((v) => v.sourceRefs),
  ]);
  for (const ref of constraintRefs) {
    if (!addressedRefs.has(ref)) {
      issues.push(
        err('REGULATORY_CONSTRAINT_NOT_ADDRESSED', 'section1.obstacles / section5.risks / verificationItems', `入力の規制・安全に関する制約（${ref}）が、障害・リスク・確認事項のどれにも反映されていない`)
      );
    }
  }

  const beforeStart = plan.verificationItems.filter((v) => v.priority === 'BEFORE_START');
  if (beforeStart.length > MAX_BEFORE_START) {
    issues.push(err('CONFIRMATION_OVERLOAD', 'verificationItems', `実行前の確認事項が ${beforeStart.length} 件（最大${MAX_BEFORE_START}件）`));
  }
  plan.verificationItems.forEach((v, i) => {
    const p = `verificationItems[${i + 1}]`;
    checkRefs(v.sourceRefs, p);
    if (v.confirmBy !== null && !inPeriod(v.confirmBy)) {
      issues.push(err('DUE_OUT_OF_PERIOD', p, `確認期限 ${v.confirmBy} が計画期間の外`));
    }
    if (v.priority === 'BEFORE_START' && v.confirmBy !== null && v.confirmBy > startYm) {
      issues.push(err('BEFORE_START_AFTER_START', p, `開始前の確認事項の期限 ${v.confirmBy} が、計画の開始月 ${startYm} より後になっている`));
    }
  });
  plan.verificationItems.forEach((a, i) =>
    plan.verificationItems.slice(i + 1).forEach((b, j) => {
      if (jaccard(a.item, b.item) >= DUPLICATE_ITEM_SIMILARITY) {
        issues.push(err('VERIFICATION_DUPLICATE', `verificationItems[${j + i + 2}]`, `確認事項が、verificationItems[${i + 1}] と同じ内容になっている`));
      }
    })
  );

  findRouteBKeys(plan).forEach((path) =>
    issues.push(err('ROUTE_B_KEY_FORBIDDEN', path, '経路B（確定済みの財務効果）の項目名がAI出力に含まれている'))
  );

  return issues;
}
