import type {
  Department,
  Project,
  SpendAmountBasis,
  SpendCategoryCode,
  SpendDuplicateDecision,
  SpendSchedule,
} from '@/types/strategy';

export type InvestmentSource =
  | 'SKILL_PLAN'
  | 'HUMAN_INVESTMENT'
  | 'IMPACT_INVESTMENT'
  | 'IMPACT_ASSUMPTION'
  | 'INVEST_KR';

export type SpendCategory = SpendCategoryCode | 'UNCLASSIFIED';
export type AmountStatus = 'OK' | 'MISSING' | 'INVALID' | 'UNIT_PENDING';
export type DuplicateStatus =
  | 'NONE'
  | 'CANDIDATE'
  | 'DERIVED'
  | 'SAME_KEEP'
  | 'SAME_DUPLICATE'
  | 'DIFFERENT';
export type ScheduleStatus = 'VALID' | 'MISSING' | 'INVALID';
export type RecurrenceStatus = 'ONE_TIME' | 'RECURRING' | 'UNSET';

export type InvestmentRef = {
  deptIndex: number;
  projectIndex: number;
  source: InvestmentSource;
  recordIndex: number | null;
  recordId: string | null;
};

export type SpendAllocation = {
  ym: string;
  amountYen: number;
};

export type InvestmentItem = {
  itemId: string;
  source: InvestmentSource;
  ref: InvestmentRef;
  deptName: string;
  projectTitle: string;
  planStatus: string | null;
  label: string;
  sourceField: string;
  amountYen: number | null;
  amountStatus: AmountStatus;
  category: SpendCategory;
  recurrence: RecurrenceStatus;
  amountBasis: SpendAmountBasis | null;
  paymentYm: string | null;
  startYm: string | null;
  endYm: string | null;
  scheduleStatus: ScheduleStatus;
  scheduleNote?: string;
  referenceYm: string | null;
  duplicateStatus: DuplicateStatus;
  duplicateNote?: string;
  duplicateSameAsItemId: string | null;
  spend: SpendSchedule | undefined;
  counted: boolean;
  ready: boolean;
  allocation: SpendAllocation[];
  /** 期間換算後の総額。換算できない（月額・年額で期間未確定など）場合は null */
  totalYen: number | null;
  /** 金額・支出時期・プロジェクトから作る指紋。重複判断はこの指紋が一致する間だけ有効 */
  fingerprint: string;
};

export type FiscalYearBucket = {
  fiscalYear: number;
  label: string;
  amountYen: number;
};

export type InvestmentDemandSummary = {
  items: InvestmentItem[];
  enteredYen: number;
  readyYen: number;
  readyCount: number;
  yearly: FiscalYearBucket[];
  yearlyByCategory: { fiscalYear: number; CAPEX: number; OPEX: number; OTHER: number }[];
  approvedReadyYen: number;
  unapprovedReadyYen: number;
  unclassifiedYen: number;
  unclassifiedCount: number;
  unscheduledYen: number;
  basisPendingYen: number;
  basisPendingCount: number;
  candidateYen: number;
  candidateCount: number;
  periodicUnresolvedCount: number;
  unitPendingCount: number;
  missingCount: number;
  byDepartment: { deptName: string; amountYen: number }[];
  fiscalYearEndMonth: number | null;
};

const YEN = 1;
const MILLION_YEN = 1_000_000;
const YM_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DUPLICATE_TOLERANCE_YEN = 1;
const MAX_RECURRING_MONTHS = 600;

const HUMAN_TYPE_LABEL: Record<string, string> = {
  HIRE: '採用',
  TRAINING: '研修',
  OUTSOURCE: '外部委託',
  SYSTEM: 'システム',
  TOOL: 'ツール',
  OTHER: 'その他',
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeYm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const head = value.trim().slice(0, 7);
  return YM_PATTERN.test(head) ? head : null;
}

function ymIndex(ym: string): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}

function ymFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function resolveAmount(
  raw: unknown,
  factor: number | null,
): { amountYen: number | null; amountStatus: AmountStatus } {
  const value = finiteNumber(raw);
  if (value === undefined) return { amountYen: null, amountStatus: 'MISSING' };
  if (factor === null) return { amountYen: null, amountStatus: 'UNIT_PENDING' };
  if (value < 0) return { amountYen: null, amountStatus: 'INVALID' };
  return { amountYen: Math.round(value * factor), amountStatus: 'OK' };
}

export function parseFiscalYearEndMonth(value: string | undefined): number | null {
  const month = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

export function fiscalYearOf(ym: string, endMonth: number): number {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  return month <= endMonth ? year : year + 1;
}

function cleanSpend(spend: SpendSchedule): SpendSchedule | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spend)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as SpendSchedule) : undefined;
}

function isBasisConfirmed(item: InvestmentItem): boolean {
  if (item.amountBasis === null) return false;
  return item.recurrence !== 'ONE_TIME' || item.amountBasis === 'TOTAL';
}

function appendNote(note: string | undefined, next: string): string {
  return note ? `${note}; ${next}` : next;
}

function distribute(total: number, months: number): number[] {
  const base = Math.floor(total / months);
  const remainder = total - base * months;
  return Array.from({ length: months }, (_, i) => base + (i < remainder ? 1 : 0));
}

function resolveSchedule(
  spend: SpendSchedule | undefined,
  amountYen: number | null,
  amountOk: boolean,
  basis: SpendAmountBasis | null,
): {
  recurrence: RecurrenceStatus;
  paymentYm: string | null;
  startYm: string | null;
  endYm: string | null;
  status: ScheduleStatus;
  note?: string;
  allocation: SpendAllocation[];
} {
  const recurrence: RecurrenceStatus = spend?.recurrence ?? 'UNSET';
  const base = { recurrence, allocation: [] as SpendAllocation[] };

  if (recurrence === 'UNSET') {
    return { ...base, paymentYm: null, startYm: null, endYm: null, status: 'MISSING' };
  }

  if (recurrence === 'ONE_TIME') {
    const paymentYm = normalizeYm(spend?.paymentYm);
    if (!paymentYm) {
      const provided = spend?.paymentYm !== undefined && spend?.paymentYm !== null;
      return {
        ...base,
        paymentYm: null,
        startYm: null,
        endYm: null,
        status: provided ? 'INVALID' : 'MISSING',
        note: provided ? '支出月の形式が不正（YYYY-MM）' : undefined,
      };
    }
    const allocation =
      amountOk && amountYen !== null ? [{ ym: paymentYm, amountYen }] : [];
    return { ...base, paymentYm, startYm: null, endYm: null, status: 'VALID', allocation };
  }

  const startYm = normalizeYm(spend?.startYm);
  const endYm = normalizeYm(spend?.endYm);
  if (!startYm || !endYm) {
    return {
      ...base,
      paymentYm: null,
      startYm,
      endYm,
      status: 'MISSING',
      note: startYm || endYm ? '開始月・終了月の両方を入力してください' : undefined,
    };
  }
  const months = ymIndex(endYm) - ymIndex(startYm) + 1;
  if (months <= 0) {
    return { ...base, paymentYm: null, startYm, endYm, status: 'INVALID', note: '終了月が開始月より前です' };
  }
  if (months > MAX_RECURRING_MONTHS) {
    return {
      ...base,
      paymentYm: null,
      startYm,
      endYm,
      status: 'INVALID',
      note: `期間が長すぎます（最大${MAX_RECURRING_MONTHS}か月）`,
    };
  }

  let allocation: SpendAllocation[] = [];
  if (amountOk && amountYen !== null && basis !== null) {
    let total = amountYen;
    if (basis === 'MONTHLY') total = amountYen * months;
    if (basis === 'ANNUAL') total = Math.round((amountYen * months) / 12);
    const first = ymIndex(startYm);
    allocation = distribute(total, months).map((amount, i) => ({
      ym: ymFromIndex(first + i),
      amountYen: amount,
    }));
  }
  return { ...base, paymentYm: null, startYm, endYm, status: 'VALID', allocation };
}

function applyDetectedRules(items: InvestmentItem[]) {
  const impact = items.find((i) => i.ref.source === 'IMPACT_INVESTMENT');
  const assumption = items.find((i) => i.ref.source === 'IMPACT_ASSUMPTION');
  if (
    impact &&
    assumption &&
    impact.amountStatus === 'OK' &&
    assumption.amountStatus === 'OK' &&
    Math.abs((impact.amountYen ?? 0) - (assumption.amountYen ?? 0)) < DUPLICATE_TOLERANCE_YEN
  ) {
    assumption.duplicateStatus = 'DERIVED';
    assumption.duplicateNote = appendNote(
      assumption.duplicateNote,
      '必要投資額（impactInvestmentMJPY）と同額の派生値のため集計から除外',
    );
  }

  const isTotal = (i: InvestmentItem) =>
    i.ref.source === 'IMPACT_INVESTMENT' || i.ref.source === 'IMPACT_ASSUMPTION' || i.ref.source === 'INVEST_KR';
  const isDetail = (i: InvestmentItem) => i.ref.source === 'SKILL_PLAN' || i.ref.source === 'HUMAN_INVESTMENT';
  const hasPositive = (i: InvestmentItem) => i.amountStatus === 'OK' && (i.amountYen ?? 0) > 0;
  const markCandidate = (i: InvestmentItem, note: string) => {
    if (i.duplicateStatus === 'DERIVED') return;
    i.duplicateStatus = 'CANDIDATE';
    i.duplicateNote = appendNote(i.duplicateNote, note);
  };

  const totals = items.filter((i) => isTotal(i) && i.duplicateStatus !== 'DERIVED' && hasPositive(i));
  if (totals.length >= 2) {
    totals.forEach((i) => markCandidate(i, '同一プロジェクト内に総額系の投資項目が複数あるため'));
  }

  const details = items.filter((i) => isDetail(i) && hasPositive(i));
  if (details.length > 0) {
    totals.forEach((i) => markCandidate(i, '個別の投資明細（スキル・人的投資）と重複している可能性があるため'));
  }

  for (let a = 0; a < details.length; a++) {
    for (let b = a + 1; b < details.length; b++) {
      if (Math.abs((details[a].amountYen ?? 0) - (details[b].amountYen ?? 0)) < DUPLICATE_TOLERANCE_YEN) {
        markCandidate(details[a], '同額の個別明細があり同一支出の可能性があるため（金額一致のみで同一とは判定しない）');
        markCandidate(details[b], '同額の個別明細があり同一支出の可能性があるため（金額一致のみで同一とは判定しない）');
      }
    }
  }
}

const STALE_REVIEW_NOTE = '金額・支出時期・プロジェクトが前回の判断から変わったため、重複判断を再確認してください';

function applyDecisions(items: InvestmentItem[]) {
  const pending: InvestmentItem[] = [];
  for (const item of items) {
    const review = item.spend?.duplicateReview;
    if (!review || item.duplicateStatus === 'DERIVED') continue;
    if (!fingerprintMatches(review.fingerprint, item.fingerprint)) {
      item.duplicateStatus = 'CANDIDATE';
      item.duplicateNote = appendNote(item.duplicateNote, STALE_REVIEW_NOTE);
      continue;
    }
    if (review.decision === 'DIFFERENT') {
      item.duplicateStatus = 'DIFFERENT';
    } else if (review.decision === 'SAME_KEEP') {
      item.duplicateStatus = 'SAME_KEEP';
    } else {
      pending.push(item);
    }
  }
  for (const item of pending) {
    const review = item.spend?.duplicateReview;
    const target = items.find((i) => i.itemId === review?.sameAsItemId);
    if (!target) {
      item.duplicateStatus = 'CANDIDATE';
      item.duplicateNote = appendNote(item.duplicateNote, '同一支出の集計対象の明細が見つからないため除外（削除された可能性）');
    } else if (
      target !== item &&
      target.duplicateStatus === 'SAME_KEEP' &&
      fingerprintMatches(review?.sameAsFingerprint, target.fingerprint)
    ) {
      item.duplicateStatus = 'SAME_DUPLICATE';
      item.duplicateSameAsItemId = target.itemId;
    } else {
      item.duplicateStatus = 'CANDIDATE';
      item.duplicateNote = appendNote(
        item.duplicateNote,
        '集計対象の明細が確定していない、または前回の判断後に変更されたため除外',
      );
    }
  }
}

const INDEX_FALLBACK_ID = /^proj_\d+_\d+$/;

export function isPlanApproved(project: { planStatus?: string | null } | null | undefined): boolean {
  return project?.planStatus === 'approved';
}

function stableProjectId(project: Project | undefined): string | null {
  const raw = project?.id;
  if (raw === undefined || raw === null) return null;
  const id = String(raw).trim();
  if (!id || INDEX_FALLBACK_ID.test(id)) return null;
  return id;
}

function buildProjectRef(deptName: string, project: Project | undefined): string {
  const id = stableProjectId(project);
  return id ? `id:${id}` : `name:${deptName}::${project?.title ?? '（未名）'}`;
}

function buildFingerprint(parts: {
  projectRef: string;
  amountYen: number | null;
  recurrence: RecurrenceStatus;
  basis: SpendAmountBasis | null;
  paymentYm: string | null;
  startYm: string | null;
  endYm: string | null;
}): string {
  return [
    'v2',
    encodeURIComponent(parts.projectRef),
    parts.amountYen ?? '',
    parts.recurrence,
    parts.basis ?? '',
    parts.paymentYm ?? '',
    parts.startYm ?? '',
    parts.endYm ?? '',
  ].join('|');
}

type ParsedFingerprint = { projectId: string | null; projectName: string | null; fields: string };

function parseFingerprint(fp: string): ParsedFingerprint | null {
  const parts = fp.split('|');
  if (parts[0] === 'v2') {
    const ref = decodeURIComponent(parts[1] ?? '');
    const fields = parts.slice(2).join('|');
    if (ref.startsWith('id:')) return { projectId: ref.slice(3), projectName: null, fields };
    if (ref.startsWith('name:')) return { projectId: null, projectName: ref.slice(5), fields };
    return null;
  }
  const legacyKey = parts[0];
  const sep = legacyKey.lastIndexOf('::');
  if (sep < 0) return null;
  const id = legacyKey.slice(sep + 2);
  return {
    projectId: id && !INDEX_FALLBACK_ID.test(id) ? id : null,
    projectName: legacyKey.slice(0, sep),
    fields: parts.slice(1).join('|'),
  };
}

export function fingerprintMatches(stored: string | undefined, current: string): boolean {
  if (!stored) return false;
  if (stored === current) return true;
  const s = parseFingerprint(stored);
  const c = parseFingerprint(current);
  if (!s || !c || s.fields !== c.fields) return false;
  if (s.projectId && c.projectId) return s.projectId === c.projectId;
  if (!s.projectId && !c.projectId) return s.projectName === c.projectName;
  return false;
}

function buildProjectItems(
  deptName: string,
  project: Project,
  deptIndex: number,
  projectIndex: number,
): InvestmentItem[] {
  const projectTitle = project?.title ?? '（未名）';
  const planStatus = project?.planStatus ?? null;
  const projectRef = buildProjectRef(deptName, project);
  const items: InvestmentItem[] = [];

  const push = (args: {
    itemId: string;
    source: InvestmentSource;
    recordIndex: number | null;
    recordId: string | null;
    label: string;
    sourceField: string;
    amount: { amountYen: number | null; amountStatus: AmountStatus };
    spend: SpendSchedule | undefined;
    referenceYm: string | null;
    isDerivedTotal?: boolean;
  }) => {
    const basis: SpendAmountBasis | null = args.isDerivedTotal
      ? 'TOTAL'
      : args.spend?.amountBasis ?? null;
    const schedule = resolveSchedule(
      args.spend,
      args.amount.amountYen,
      args.amount.amountStatus === 'OK',
      basis,
    );
    items.push({
      itemId: args.itemId,
      source: args.source,
      ref: {
        deptIndex,
        projectIndex,
        source: args.source,
        recordIndex: args.recordIndex,
        recordId: args.recordId,
      },
      deptName,
      projectTitle,
      planStatus,
      label: args.label,
      sourceField: args.sourceField,
      amountYen: args.amount.amountYen,
      amountStatus: args.amount.amountStatus,
      category: args.spend?.category ?? 'UNCLASSIFIED',
      recurrence: schedule.recurrence,
      amountBasis: basis,
      paymentYm: schedule.paymentYm,
      startYm: schedule.startYm,
      endYm: schedule.endYm,
      scheduleStatus: schedule.status,
      scheduleNote: schedule.note,
      referenceYm: args.referenceYm,
      duplicateStatus: 'NONE',
      duplicateSameAsItemId: null,
      spend: args.spend,
      counted: false,
      ready: false,
      allocation: schedule.allocation,
      totalYen: null,
      fingerprint: buildFingerprint({
        projectRef,
        amountYen: args.amount.amountYen,
        recurrence: schedule.recurrence,
        basis,
        paymentYm: schedule.paymentYm,
        startYm: schedule.startYm,
        endYm: schedule.endYm,
      }),
    });
  };

  (project?.skillPlans ?? []).forEach((skill, i) => {
    const recordId = skill?.id ? String(skill.id) : null;
    push({
      itemId: `SKILL_PLAN:${recordId ?? `#${i}`}`,
      source: 'SKILL_PLAN',
      recordIndex: i,
      recordId,
      label: skill?.skillName || '（スキル名未設定）',
      sourceField: 'skillPlans.cost',
      amount: resolveAmount(skill?.cost, YEN),
      spend: skill?.spend,
      referenceYm: normalizeYm(skill?.dueYm),
    });
  });

  (project?.executionHumanInvestments ?? []).forEach((inv, i) => {
    const recordId = inv?.id ? String(inv.id) : null;
    const typeLabel = HUMAN_TYPE_LABEL[inv?.type ?? ''] ?? '人的投資';
    push({
      itemId: `HUMAN_INVESTMENT:${recordId ?? `#${i}`}`,
      source: 'HUMAN_INVESTMENT',
      recordIndex: i,
      recordId,
      label: `${typeLabel}${inv?.team ? `（${inv.team}）` : ''}`,
      sourceField: 'executionHumanInvestments.amount',
      amount: resolveAmount(inv?.amount, YEN),
      spend: inv?.spend,
      referenceYm: normalizeYm(inv?.timingYm),
    });
  });

  if (project?.impactInvestmentMJPY !== undefined) {
    push({
      itemId: 'IMPACT_INVESTMENT:impact',
      source: 'IMPACT_INVESTMENT',
      recordIndex: null,
      recordId: null,
      label: '必要投資額（プロジェクト総額）',
      sourceField: 'impactInvestmentMJPY',
      amount: resolveAmount(project.impactInvestmentMJPY, MILLION_YEN),
      spend: project.impactInvestmentSpend,
      referenceYm: null,
    });
  }

  const assumptions = project?.impactAssumptions;
  if (assumptions) {
    const people = finiteNumber(assumptions.peopleCount);
    const months = finiteNumber(assumptions.durationMonths);
    const monthly = finiteNumber(assumptions.monthlyCostPerPersonMJPY);
    const external = finiteNumber(assumptions.externalCostMJPY);
    const parts: number[] = [];
    if (people !== undefined && months !== undefined && monthly !== undefined) {
      parts.push(people * months * monthly);
    }
    if (external !== undefined) parts.push(external);
    if (parts.length > 0) {
      push({
        itemId: 'IMPACT_ASSUMPTION:assumption',
        source: 'IMPACT_ASSUMPTION',
        recordIndex: null,
        recordId: null,
        label: '期待成果の前提に基づく投資・費用',
        sourceField: 'impactAssumptions（人数×月数×月額＋外部費用）',
        amount: resolveAmount(parts.reduce((s, v) => s + v, 0), MILLION_YEN),
        spend: assumptions.spend,
        referenceYm: null,
        isDerivedTotal: true,
      });
    }
  }

  (project?.okrsV2 ?? []).forEach((kr, i) => {
    if (!kr || kr.kind !== 'INVEST') return;
    const recordId = kr.id ? String(kr.id) : null;
    const factor = kr.unit === 'JPY' || kr.unit === '¥' ? YEN : null;
    push({
      itemId: `INVEST_KR:${recordId ?? `#${i}`}`,
      source: 'INVEST_KR',
      recordIndex: i,
      recordId,
      label: kr.label || '（ラベル未設定）',
      sourceField: 'okrsV2[kind=INVEST].target',
      amount: resolveAmount(kr.target, factor),
      spend: kr.spend,
      referenceYm: normalizeYm(kr.due ?? kr.startYm),
    });
  });

  applyDetectedRules(items);
  applyDecisions(items);

  for (const item of items) {
    item.counted =
      item.amountStatus === 'OK' &&
      (item.duplicateStatus === 'NONE' ||
        item.duplicateStatus === 'SAME_KEEP' ||
        item.duplicateStatus === 'DIFFERENT');
    item.totalYen = computeTotalYen(item);
    item.ready =
      item.counted &&
      item.category !== 'UNCLASSIFIED' &&
      isBasisConfirmed(item) &&
      item.scheduleStatus === 'VALID' &&
      item.recurrence !== 'UNSET';
  }
  return items;
}

function computeTotalYen(item: InvestmentItem): number | null {
  if (item.amountStatus !== 'OK' || item.amountYen === null) return null;
  if (item.recurrence === 'RECURRING') {
    if (item.scheduleStatus !== 'VALID' || !isBasisConfirmed(item)) return null;
    return item.allocation.reduce((sum, a) => sum + a.amountYen, 0);
  }
  return item.amountBasis === 'TOTAL' ? item.amountYen : null;
}

export function buildInvestmentItems(departments: Department[] | null | undefined): InvestmentItem[] {
  const items: InvestmentItem[] = [];
  (departments ?? []).forEach((dept, deptIndex) => {
    (dept?.projects ?? []).forEach((project, projectIndex) => {
      if (!project) return;
      items.push(...buildProjectItems(dept?.name ?? '（未名）', project, deptIndex, projectIndex));
    });
  });
  return items;
}

export function buildInvestmentDemandSummary(
  departments: Department[] | null | undefined,
  fiscalYearEnd?: string,
): InvestmentDemandSummary {
  const items = buildInvestmentItems(departments);
  const parsedEndMonth = parseFiscalYearEndMonth(fiscalYearEnd);
  const endMonth = parsedEndMonth ?? 12;

  const yearlyMap = new Map<number, number>();
  const categoryMap = new Map<number, { CAPEX: number; OPEX: number; OTHER: number }>();
  const deptMap = new Map<string, number>();
  let enteredYen = 0;
  let readyYen = 0;
  let readyCount = 0;
  let approvedReadyYen = 0;
  let unapprovedReadyYen = 0;
  let unclassifiedYen = 0;
  let unscheduledYen = 0;
  let basisPendingYen = 0;
  let candidateYen = 0;
  let candidateCount = 0;
  let unitPendingCount = 0;
  let missingCount = 0;

  let periodicUnresolvedCount = 0;
  let unclassifiedCount = 0;
  let basisPendingCount = 0;

  for (const item of items) {
    if (item.amountStatus === 'UNIT_PENDING') unitPendingCount++;
    if (item.amountStatus === 'MISSING') missingCount++;
    if (item.duplicateStatus === 'DERIVED') continue;

    const total = item.totalYen ?? 0;
    const entered = item.amountStatus === 'OK' && item.totalYen !== null;
    if (entered) enteredYen += total;

    if (item.duplicateStatus === 'CANDIDATE' && item.amountStatus === 'OK') {
      candidateYen += item.totalYen ?? (item.amountBasis === null ? item.amountYen ?? 0 : 0);
      candidateCount++;
    }
    if (!item.counted) continue;

    if (item.category === 'UNCLASSIFIED') {
      unclassifiedCount++;
      unclassifiedYen += total;
    }
    if (!isBasisConfirmed(item)) {
      basisPendingCount++;
      basisPendingYen += item.amountYen ?? 0;
    } else if (item.scheduleStatus !== 'VALID' || item.recurrence === 'UNSET') {
      if (item.amountBasis === 'TOTAL') unscheduledYen += item.amountYen ?? 0;
      else periodicUnresolvedCount++;
    }

    if (!item.ready) continue;

    readyCount++;
    readyYen += total;
    if (item.planStatus === 'approved') approvedReadyYen += total;
    else unapprovedReadyYen += total;
    deptMap.set(item.deptName, (deptMap.get(item.deptName) ?? 0) + total);
    for (const alloc of item.allocation) {
      const fy = fiscalYearOf(alloc.ym, endMonth);
      yearlyMap.set(fy, (yearlyMap.get(fy) ?? 0) + alloc.amountYen);
      if (item.category !== 'UNCLASSIFIED') {
        const bucket = categoryMap.get(fy) ?? { CAPEX: 0, OPEX: 0, OTHER: 0 };
        bucket[item.category] += alloc.amountYen;
        categoryMap.set(fy, bucket);
      }
    }
  }

  const yearlyByCategory = [...categoryMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([fiscalYear, b]) => ({ fiscalYear, ...b }));

  const yearly: FiscalYearBucket[] = [...yearlyMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([fiscalYear, amountYen]) => ({
      fiscalYear,
      label: `${fiscalYear}年${endMonth}月期`,
      amountYen,
    }));

  return {
    items,
    yearlyByCategory,
    enteredYen,
    readyYen,
    readyCount,
    yearly,
    approvedReadyYen,
    unapprovedReadyYen,
    unclassifiedYen,
    unclassifiedCount,
    unscheduledYen,
    basisPendingYen,
    basisPendingCount,
    candidateYen,
    candidateCount,
    periodicUnresolvedCount,
    unitPendingCount,
    missingCount,
    byDepartment: [...deptMap.entries()].map(([deptName, amountYen]) => ({ deptName, amountYen })),
    fiscalYearEndMonth: parsedEndMonth,
  };
}

function setProjectRecordSpend(
  project: Project,
  ref: InvestmentRef,
  update: (prev: SpendSchedule | undefined) => SpendSchedule | undefined,
): Project | null {
  const matches = (record: { id?: unknown } | undefined) => {
    if (!record) return false;
    if (ref.recordId === null) return true;
    return String(record.id ?? '') === ref.recordId;
  };

  if (ref.source === 'IMPACT_INVESTMENT') {
    return { ...project, impactInvestmentSpend: update(project.impactInvestmentSpend) };
  }

  if (ref.source === 'IMPACT_ASSUMPTION') {
    if (!project.impactAssumptions) return null;
    return {
      ...project,
      impactAssumptions: { ...project.impactAssumptions, spend: update(project.impactAssumptions.spend) },
    };
  }

  if (ref.recordIndex === null) return null;
  const index = ref.recordIndex;

  if (ref.source === 'SKILL_PLAN') {
    const list = project.skillPlans ?? [];
    const record = list[index];
    if (!matches(record)) return null;
    const next = list.slice();
    next[index] = { ...record, spend: update(record.spend) };
    return { ...project, skillPlans: next };
  }

  if (ref.source === 'HUMAN_INVESTMENT') {
    const list = project.executionHumanInvestments ?? [];
    const record = list[index];
    if (!matches(record)) return null;
    const next = list.slice();
    next[index] = { ...record, spend: update(record.spend) };
    return { ...project, executionHumanInvestments: next };
  }

  const list = project.okrsV2 ?? [];
  const record = list[index];
  if (!matches(record)) return null;
  const next = list.slice();
  next[index] = { ...record, spend: update(record.spend) };
  return { ...project, okrsV2: next };
}

function updateDepartmentsProject(
  departments: Department[],
  deptIndex: number,
  projectIndex: number,
  updateProject: (project: Project) => Project | null,
): Department[] {
  const dept = departments[deptIndex];
  const project = dept?.projects?.[projectIndex];
  if (!project) return departments;
  const updated = updateProject(project);
  if (!updated) return departments;
  const projects = dept.projects.slice();
  projects[projectIndex] = updated;
  const nextDepartments = departments.slice();
  nextDepartments[deptIndex] = { ...dept, projects };
  return nextDepartments;
}

export function applySpendPatch(
  departments: Department[],
  ref: InvestmentRef,
  patch: Partial<SpendSchedule>,
): Department[] {
  return updateDepartmentsProject(departments, ref.deptIndex, ref.projectIndex, (project) =>
    setProjectRecordSpend(project, ref, (prev) => cleanSpend({ ...(prev ?? {}), ...patch })),
  );
}

export function applyDuplicateDecision(
  departments: Department[],
  deptIndex: number,
  projectIndex: number,
  targetItemId: string,
  decision: SpendDuplicateDecision | null,
  sameAsItemId?: string,
): Department[] {
  const project = departments[deptIndex]?.projects?.[projectIndex];
  if (!project || isPlanApproved(project)) return departments;
  const items = buildProjectItems(departments[deptIndex]?.name ?? '（未名）', project, deptIndex, projectIndex);
  const target = items.find((i) => i.itemId === targetItemId);
  if (!target) return departments;

  const setReview = (ref: InvestmentRef, review: SpendSchedule['duplicateReview']) =>
    updateDepartmentsProject(departments, ref.deptIndex, ref.projectIndex, (p) =>
      setProjectRecordSpend(p, ref, (prev) => cleanSpend({ ...(prev ?? {}), duplicateReview: review })),
    );

  if (target.duplicateStatus === 'DERIVED') return departments;

  if (decision === null) {
    return setReview(target.ref, undefined);
  }
  if (decision !== 'SAME_DUPLICATE') {
    return setReview(target.ref, { decision, fingerprint: target.fingerprint });
  }

  const keeper = items.find((i) => i.itemId === sameAsItemId);
  if (!keeper || keeper.itemId === target.itemId || keeper.amountStatus !== 'OK') return departments;
  if (keeper.duplicateStatus === 'DERIVED') return departments;

  const afterKeeper = updateDepartmentsProject(departments, keeper.ref.deptIndex, keeper.ref.projectIndex, (p) =>
    setProjectRecordSpend(p, keeper.ref, (prev) =>
      cleanSpend({ ...(prev ?? {}), duplicateReview: { decision: 'SAME_KEEP', fingerprint: keeper.fingerprint } }),
    ),
  );
  return updateDepartmentsProject(afterKeeper, target.ref.deptIndex, target.ref.projectIndex, (p) =>
    setProjectRecordSpend(p, target.ref, (prev) =>
      cleanSpend({
        ...(prev ?? {}),
        duplicateReview: {
          decision: 'SAME_DUPLICATE',
          sameAsItemId: keeper.itemId,
          fingerprint: target.fingerprint,
          sameAsFingerprint: keeper.fingerprint,
        },
      }),
    ),
  );
}

export function buildItemsForProject(
  departments: Department[] | null | undefined,
  deptIndex: number,
  projectIndex: number,
): InvestmentItem[] {
  return buildInvestmentItems(departments).filter(
    (item) => item.ref.deptIndex === deptIndex && item.ref.projectIndex === projectIndex,
  );
}

export const SPEND_CATEGORY_LABEL: Record<SpendCategory, string> = {
  CAPEX: '設備投資・資本的支出',
  OPEX: '営業費用（人件費・外注費等）',
  OTHER: 'その他の支出',
  UNCLASSIFIED: '未分類',
};
