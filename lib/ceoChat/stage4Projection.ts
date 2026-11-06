type AnyRecord = Record<string, any>;

export const EXECUTION_CHAR_BUDGET = 2400;
const MISSING = '未登録';
const OTHER_STATUS = 'その他';
const MISSION_MAX = 120;
const HEADER = '# 部門・OKR・実行計画（STAGE3・4、閲覧権限の範囲内の登録情報）';
const OMITTED_NAME_MAX = 5;
const OMITTED_NAME_CHARS = 80;
const MENTION_SHARE = 0.6;
const NAME_FIRST_MAX_PROJECTS = 20;
const GROUP_HEADER = '  概要のみ（詳細未確認）:';
const STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  review: '確認中',
  approved: '承認済み',
};

export type PlanStatusCounts = {
  承認済み: number;
  確認中: number;
  下書き: number;
  その他: number;
  未登録: number;
};

export type ExecutionAggregate = {
  departments: number;
  projects: number;
  byPlanStatus: PlanStatusCounts;
  /** 施策単位: 担当者が未登録の施策数 */
  ownerMissing: number;
  /** 施策単位: 期限が未登録の構造化KRを1件以上持つ施策数 */
  projectsDueMissing: number;
  /** 施策単位: 担当者未登録、または期限未登録KRを持つ施策数（重複なし） */
  projectsEither: number;
  /** 施策単位: 担当者未登録と期限未登録KRの両方に該当する施策数 */
  projectsBoth: number;
  /** KR単位: 全KR数（構造化 + 旧形式） */
  krTotal: number;
  /** KR単位: 構造化KRのうち期限項目が存在し、値が未登録のもの */
  krDueMissing: number;
  /** KR単位: 旧形式KR。期限項目が存在しないため、未登録とは区別して数える */
  krLegacy: number;
};

export type ExecutionSummary = {
  text: string;
  omitted: number;
  departments: { total: number; shown: number; detailed: number };
  projects: { total: number; shown: number; withKr: number; visible: number };
  complete: boolean;
  aggregate: ExecutionAggregate;
  intent: ProjectionIntent;
};

type ProjectView = {
  title: string;
  header: string;
  krLines: string[];
  impact: string;
  overviewLine: string;
};
type DeptItem = {
  name: string;
  mission: string;
  mentioned: boolean;
  views: ProjectView[];
};
type Stats = ExecutionSummary['departments'];
type ProjectStats = ExecutionSummary['projects'];

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function records(v: unknown): AnyRecord[] {
  return Array.isArray(v) ? v.filter((x): x is AnyRecord => !!x && typeof x === 'object') : [];
}

function orMissing(v: unknown): string {
  return text(v) || MISSING;
}

function mentioned(question: string, name: string): boolean {
  return name.length > 0 && question.includes(name);
}

function byMentionFirst<T>(items: T[], question: string, nameOf: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, hit: mentioned(question, nameOf(item)) ? 1 : 0 }))
    .sort((a, b) => b.hit - a.hit || a.index - b.index)
    .map((x) => x.item);
}

export type ProjectionIntent = 'list' | 'count' | 'targeted' | 'consult';

const LIST_CUE = /一覧|名称(?!(を|の)?(変更|変え|改称|改名))|リスト|施策名|施策の名前|(全施策|すべての施策|全ての施策|登録されている施策)[^。？?]{0,10}(教え|挙げ|列挙|示し|見せ)/;
const LIST_NEGATION = /一覧(に|で|を)?(せず|しな|不要|ではなく|じゃなく)/;
const COUNT_CUE = /何件|何施策|いくつ|何個|件数|何社|何名|何部門/;

export function detectProjectionIntent(question: string, departments: unknown): ProjectionIntent {
  const q = question ?? '';
  if (LIST_CUE.test(q) && !LIST_NEGATION.test(q)) return 'list';
  if (COUNT_CUE.test(q)) return 'count';
  const names = records(departments).flatMap((d) => [
    text(d.name),
    ...records(d.projects).map((p) => text(p.title ?? p.name)),
  ]);
  if (names.some((n) => n.length > 0 && q.includes(n))) return 'targeted';
  return 'consult';
}

function planStatusLabel(planStatus: unknown): string {
  if (isMissing(planStatus)) return '未設定';
  return STATUS_LABEL[text(planStatus)] ?? OTHER_STATUS;
}

function legacyKeyResults(project: AnyRecord): string[] {
  return records(project.okrs).flatMap((o) =>
    (Array.isArray(o.keyResults) ? o.keyResults : [])
      .map((k: unknown) => (typeof k === 'string' ? k : text((k as AnyRecord)?.label)))
      .filter(Boolean)
  );
}

function countKey(planStatus: unknown): keyof PlanStatusCounts {
  if (isMissing(planStatus)) return '未登録';
  const label = STATUS_LABEL[text(planStatus)];
  if (label === '承認済み') return '承認済み';
  if (label === '確認中') return '確認中';
  if (label === '下書き') return '下書き';
  return 'その他';
}

export function aggregateExecution(departments: unknown): ExecutionAggregate {
  const depts = records(departments);
  const projects = depts.flatMap((d) => records(d.projects));
  const agg: ExecutionAggregate = {
    departments: depts.length,
    projects: projects.length,
    byPlanStatus: { 承認済み: 0, 確認中: 0, 下書き: 0, その他: 0, 未登録: 0 },
    ownerMissing: 0,
    projectsDueMissing: 0,
    projectsEither: 0,
    projectsBoth: 0,
    krTotal: 0,
    krDueMissing: 0,
    krLegacy: 0,
  };
  for (const p of projects) {
    agg.byPlanStatus[countKey(p.planStatus)] += 1;
    const ownerMissing = isMissing(p.ownerName);
    if (ownerMissing) agg.ownerMissing += 1;
    const structured = records(p.okrsV2);
    let dueMissing = false;
    if (structured.length > 0) {
      for (const kr of structured) {
        agg.krTotal += 1;
        if (isMissing(kr.due)) {
          agg.krDueMissing += 1;
          dueMissing = true;
        }
      }
    } else {
      const legacy = legacyKeyResults(p);
      agg.krTotal += legacy.length;
      agg.krLegacy += legacy.length;
    }
    if (dueMissing) agg.projectsDueMissing += 1;
    if (ownerMissing || dueMissing) agg.projectsEither += 1;
    if (ownerMissing && dueMissing) agg.projectsBoth += 1;
  }
  return agg;
}

function aggregateLine(a: ExecutionAggregate): string {
  const s = a.byPlanStatus;
  return `【全件集計】部門${a.departments}件・施策${a.projects}件｜施策単位（planStatus: 承認済み${s.承認済み}・確認中${s.確認中}・下書き${s.下書き}・${OTHER_STATUS}${s.その他}・未設定${s.未登録}／施策担当未入力${a.ownerMissing}・期限${MISSING}KRあり${a.projectsDueMissing}・いずれか${a.projectsEither}（両方${a.projectsBoth}））｜KR単位: 全${a.krTotal}件・期限${MISSING}${a.krDueMissing}・旧形式${a.krLegacy}｜部門のSTAGE4状態とは別`;
}

function formatKr(kr: AnyRecord): string {
  const target = typeof kr.target === 'number' && Number.isFinite(kr.target) ? String(kr.target) : MISSING;
  const unit = text(kr.unit);
  const milestones = records(kr.milestones)
    .map((m) => {
      const title = text(m.title);
      if (!title) return '';
      const due = text(m.dueYm) || text(m.due);
      return due ? `${title}（${due}）` : title;
    })
    .filter(Boolean);
  const parts = [
    `KR: ${orMissing(kr.label)}`,
    `目標 ${target}${target === MISSING ? '' : unit}`,
    `担当 ${isMissing(kr.owner) ? 'KR担当未入力' : text(kr.owner)}`,
    `期限 ${orMissing(kr.due)}`,
  ];
  if (milestones.length > 0) parts.push(`マイルストーン ${milestones.join('、')}`);
  return `    - ${parts.join('｜')}`;
}

function formatImpact(project: AnyRecord): string {
  const deltas = records(project.impact?.metricDelta)
    .map((d) => {
      const metric = text(d.metric);
      if (!metric || typeof d.delta !== 'number' || !Number.isFinite(d.delta)) return '';
      const sign = d.delta > 0 ? '+' : '';
      return `${metric} ${sign}${d.delta}${text(d.unit)}`;
    })
    .filter(Boolean);
  return deltas.length > 0 ? `    期待成果（登録）: ${deltas.join('、')}` : '';
}

function projectView(project: AnyRecord): ProjectView {
  const title = orMissing(project.title ?? project.name);
  const status = planStatusLabel(project.planStatus);
  const links = Array.isArray(project.valueDriverLinks)
    ? project.valueDriverLinks.map(text).filter(Boolean)
    : [];
  const header = [
    `  - プロジェクト: ${title}`,
    `担当 ${isMissing(project.ownerName) ? '未入力' : text(project.ownerName)}`,
    `計画 ${status}`,
    `価値指標との対応（登録）: ${links.length > 0 ? links.join('、') : MISSING}`,
  ].join('｜');

  const krs = records(project.okrsV2);
  const krLines = krs.length > 0
    ? krs.map(formatKr)
    : records(project.okrs).map((o) => {
        const krLabels = (Array.isArray(o.keyResults) ? o.keyResults : [])
          .map((k: unknown) => (typeof k === 'string' ? k : text((k as AnyRecord)?.label)))
          .filter(Boolean);
        return `    - O: ${orMissing(o.objective)}${krLabels.length ? ` / KR: ${krLabels.join('、')}` : ''}`;
      });

  return {
    title,
    header,
    krLines,
    impact: formatImpact(project),
    overviewLine: `    ・${title}（計画 ${status}）`,
  };
}

function lineCost(lines: string[]): number {
  return lines.reduce((sum, l) => sum + l.length + 1, 0);
}

function fullBlock(v: ProjectView): string[] {
  return [v.header, ...v.krLines, ...(v.impact ? [v.impact] : [])];
}

function fitBlock(v: ProjectView, allowance: number, allowPartial: boolean): string[] | null {
  const full = fullBlock(v);
  if (lineCost(full) <= allowance) return full;
  if (!allowPartial) return null;
  const total = v.krLines.length;
  for (let k = total; k >= 0; k--) {
    const marker = k < total
      ? `    （KR${total}件のうち${k}件を表示）`
      : '    （一部の項目を省略）';
    const candidate = [v.header, ...v.krLines.slice(0, k), marker];
    if (lineCost(candidate) <= allowance) return candidate;
  }
  return null;
}

function deptHeadLine(it: DeptItem, withMission: boolean): string {
  const mission = withMission && it.mission ? `（ミッション: ${it.mission.slice(0, MISSION_MAX)}）` : '';
  return withMission
    ? `■ 部門: ${it.name}${mission}`
    : `■ 部門: ${it.name}｜施策${it.views.length}件`;
}

function coverageText(
  depts: Stats,
  projects: ProjectStats,
  complete: boolean,
  omittedDeptNames: string[],
  omittedProjects: number
): string {
  if (complete) {
    return `（充足状況: 部門${depts.total}件すべて、施策${projects.total}件すべてを参照。全件）`;
  }
  const picked: string[] = [];
  let chars = 0;
  for (const n of omittedDeptNames) {
    if (picked.length >= OMITTED_NAME_MAX || chars + n.length > OMITTED_NAME_CHARS) break;
    picked.push(n);
    chars += n.length;
  }
  const rest = omittedDeptNames.length - picked.length;
  const deptNote = omittedDeptNames.length > 0
    ? `。概要も省略された部門: ${picked.join('、')}${rest > 0 ? `、ほか${rest}部門` : ''}`
    : '';
  const projectNote = omittedProjects > 0 ? `、名称も省略された施策${omittedProjects}件` : '';
  return `（充足状況: 部門 全${depts.total}件中${depts.shown}件を参照（うち施策の詳細あり${depts.detailed}件）、施策 全${projects.total}件中${projects.visible}件を名称・概要で参照（うち詳細あり${projects.shown}件、KRまで表示${projects.withKr}件）${projectNote}。施策の詳細は一部のみ（結論より前に適用）: 全社順位（最重要・第1位など）は断定せず、参照できた施策の中の重要候補として限定する。全社の戦略課題からの議論は可能。${deptNote}）`;
}

export function buildExecutionSummaryBlock(
  departments: unknown,
  question: string,
  budget: number = EXECUTION_CHAR_BUDGET
): ExecutionSummary {
  const q = question ?? '';
  const intent = detectProjectionIntent(q, departments);
  const aggregate = aggregateExecution(departments);
  const depts = byMentionFirst(records(departments), q, (d) => text(d.name));
  if (depts.length === 0) {
    return {
      text: `${HEADER}\n（部門・プロジェクトなし）`,
      omitted: 0,
      departments: { total: 0, shown: 0, detailed: 0 },
      projects: { total: 0, shown: 0, withKr: 0, visible: 0 },
      complete: true,
      aggregate,
      intent,
    };
  }

  const items: DeptItem[] = depts.map((d) => {
    const rawProjects = byMentionFirst(records(d.projects), q, (p) => text(p.title ?? p.name));
    return {
      name: orMissing(d.name),
      mission: text(d.mission),
      mentioned: mentioned(q, text(d.name)),
      views: rawProjects.map(projectView),
    };
  });
  const deptTotal = items.length;
  const projectTotal = items.reduce((n, it) => n + it.views.length, 0);
  const aggLine = aggregateLine(aggregate);

  const fullSections = items.map((it) => {
    const body = it.views.length === 0
      ? ['  （プロジェクトなし）']
      : it.views.flatMap((v) => fullBlock(v));
    return [deptHeadLine(it, true), ...body];
  });
  const fullBody = fullSections.flat();
  const completeCoverage = coverageText(
    { total: deptTotal, shown: deptTotal, detailed: items.filter((it) => it.views.length > 0).length },
    { total: projectTotal, shown: projectTotal, withKr: projectTotal, visible: projectTotal },
    true,
    [],
    0
  );
  if (HEADER.length + 1 + completeCoverage.length + 1 + aggLine.length + 1 + lineCost(fullBody) <= budget) {
    const detailed = items.filter((it) => it.views.length > 0).length;
    return {
      text: [HEADER, completeCoverage, aggLine, ...fullBody].join('\n'),
      omitted: 0,
      departments: { total: deptTotal, shown: deptTotal, detailed },
      projects: { total: projectTotal, shown: projectTotal, withKr: projectTotal, visible: projectTotal },
      complete: true,
      aggregate,
      intent,
    };
  }

  const pickDepts = (bodyBudget: number) => {
    const shown: DeptItem[] = [];
    const omitted: string[] = [];
    let spent = 0;
    for (const it of items) {
      const cost = deptHeadLine(it, false).length + 1;
      if (spent + cost <= bodyBudget) {
        spent += cost;
        shown.push(it);
      } else {
        omitted.push(it.name);
      }
    }
    return { shown, omitted, spent };
  };
  const coverageFor = (omittedNames: string[]) => coverageText(
    { total: deptTotal, shown: deptTotal, detailed: deptTotal },
    { total: projectTotal, shown: projectTotal, withKr: projectTotal, visible: projectTotal },
    false,
    omittedNames,
    projectTotal
  );
  let reserve = coverageFor([]).length;
  let bodyBudget = 0;
  let picked = pickDepts(0);
  for (let iter = 0; iter < 3; iter++) {
    bodyBudget = budget - HEADER.length - 1 - aggLine.length - 1 - reserve - 1;
    picked = pickDepts(bodyBudget);
    const exact = coverageFor(picked.omitted).length;
    if (exact <= reserve) break;
    reserve = exact;
  }
  const shownDepts = picked.shown;
  const omittedDeptNames = picked.omitted;
  const used = picked.spent;

  const groupCost = (views: ProjectView[]) =>
    views.length > 0 ? GROUP_HEADER.length + 1 + views.reduce((n, v) => n + v.overviewLine.length + 1, 0) : 0;
  const namesAllCost = shownDepts.reduce((n, it) => n + groupCost(it.views), 0);
  type Plan = {
    detail: Map<ProjectView, string[]>;
    detailOrder: ProjectView[];
    overviewChosen: Set<ProjectView>;
  };

  const fillOverview = (detail: Map<ProjectView, string[]>, budgetLeft: number): Set<ProjectView> => {
    const overviewChosen = new Set<ProjectView>();
    const ovCursor = new Map<DeptItem, number>(shownDepts.map((it) => [it, 0]));
    const groupOpen = new Set<DeptItem>();
    let left = budgetLeft;
    let progress = true;
    while (progress && left > 0) {
      progress = false;
      for (const it of shownDepts) {
        let i = ovCursor.get(it) ?? 0;
        while (i < it.views.length && detail.has(it.views[i])) i += 1;
        if (i >= it.views.length) {
          ovCursor.set(it, i);
          continue;
        }
        const v = it.views[i];
        const cost = v.overviewLine.length + 1 + (groupOpen.has(it) ? 0 : GROUP_HEADER.length + 1);
        if (cost > left) {
          ovCursor.set(it, i);
          continue;
        }
        left -= cost;
        groupOpen.add(it);
        overviewChosen.add(v);
        ovCursor.set(it, i + 1);
        progress = true;
      }
    }
    return overviewChosen;
  };

  const makePlan = (namesFirst: boolean): Plan => {
  const detail = new Map<ProjectView, string[]>();
  const detailOrder: ProjectView[] = [];
  const cursor = new Map<DeptItem, number>(shownDepts.map((it) => [it, 0]));
  let remaining = bodyBudget - used - (namesFirst ? namesAllCost : 0);

  const distribute = (list: DeptItem[], limit: number, allowPartial: boolean) => {
    let spent = 0;
    let progress = true;
    while (progress && spent < limit) {
      progress = false;
      for (const it of list) {
        const i = cursor.get(it) ?? 0;
        if (i >= it.views.length) continue;
        const v = it.views[i];
        const ov = namesFirst ? v.overviewLine.length + 1 : 0;
        const allowance = Math.min(limit - spent, remaining - spent) + ov;
        if (allowance <= 0) continue;
        const block = fitBlock(v, allowance, allowPartial);
        if (!block) continue;
        detail.set(v, block);
        detailOrder.push(v);
        cursor.set(it, i + 1);
        spent += lineCost(block) - ov;
        progress = true;
      }
    }
    remaining -= spent;
  };

  const mentionedShown = shownDepts.filter((it) => it.mentioned);
  const runDetails = () => {
    const mentionLimit = Math.floor(remaining * MENTION_SHARE);
    if (mentionedShown.length > 0) distribute(mentionedShown, mentionLimit, false);
    distribute(shownDepts, remaining, false);
    if (mentionedShown.length > 0) distribute(mentionedShown, remaining, true);
    distribute(shownDepts, remaining, true);
  };

  if (namesFirst) {
    const overviewChosen = new Set<ProjectView>();
    for (const it of shownDepts) for (const v of it.views) overviewChosen.add(v);
    runDetails();
    return { detail, detailOrder, overviewChosen };
  }
  runDetails();
  return { detail, detailOrder, overviewChosen: fillOverview(detail, remaining) };
  };

  const everyNameVisible = (plan: Plan) =>
    shownDepts.every((it) => it.views.every((v) => plan.detail.has(v) || plan.overviewChosen.has(v)));
  const namesAllFit = used + namesAllCost <= bodyBudget;
  const nameFirst = intent === 'list' && projectTotal <= NAME_FIRST_MAX_PROJECTS && namesAllFit;
  let chosen: Plan;
  if (nameFirst) {
    chosen = makePlan(true);
  } else {
    const detailFirst = makePlan(false);
    const namesPlan = namesAllFit ? makePlan(true) : null;
    const tolerance = Math.max(2, Math.floor(detailFirst.detailOrder.length * 0.2));
    const keepsDetail = namesPlan !== null && namesPlan.detailOrder.length >= detailFirst.detailOrder.length - tolerance;
    const namesCompletes = namesPlan !== null && namesPlan.detailOrder.length >= 2 && !everyNameVisible(detailFirst);
    chosen = namesPlan && (keepsDetail || namesCompletes) ? namesPlan : detailFirst;
  }
  const { detail, detailOrder, overviewChosen } = chosen;

  const render = () => {
    const out: string[] = [];
    let detailedDepts = 0;
    let projectsShown = 0;
    let projectsWithKr = 0;
    let overviewOnly = 0;
    for (const it of shownDepts) {
      out.push(deptHeadLine(it, false));
      const blocks = it.views.filter((v) => detail.has(v));
      if (blocks.length > 0) detailedDepts += 1;
      for (const v of blocks) {
        const b = detail.get(v)!;
        out.push(...b);
        projectsShown += 1;
        if (b.some((l) => l.startsWith('    - '))) projectsWithKr += 1;
      }
      const ovs = it.views.filter((v) => !detail.has(v) && overviewChosen.has(v));
      if (ovs.length > 0) {
        out.push(GROUP_HEADER);
        out.push(...ovs.map((v) => v.overviewLine));
        overviewOnly += ovs.length;
      }
    }
    const deptStats: Stats = { total: deptTotal, shown: shownDepts.length, detailed: detailedDepts };
    const visible = projectsShown + overviewOnly;
    const projectStats: ProjectStats = { total: projectTotal, shown: projectsShown, withKr: projectsWithKr, visible };
    const complete = shownDepts.length === deptTotal && projectsShown === projectTotal;
    const coverage = coverageText(deptStats, projectStats, complete, omittedDeptNames, projectTotal - visible);
    const result = [HEADER, coverage, aggLine, ...out].join('\n');
    return { result, deptStats, projectStats, complete, visible };
  };

  let rendered = render();
  while (rendered.result.length > budget && detailOrder.length > 0) {
    const v = detailOrder.pop()!;
    detail.delete(v);
    overviewChosen.add(v);
    rendered = render();
  }

  return {
    text: rendered.result,
    omitted: projectTotal - rendered.visible,
    departments: rendered.deptStats,
    projects: rendered.projectStats,
    complete: rendered.complete,
    aggregate,
    intent,
  };
}
