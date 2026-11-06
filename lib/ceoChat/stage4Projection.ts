type AnyRecord = Record<string, any>;

export const EXECUTION_CHAR_BUDGET = 2400;
const MISSING = '未登録';
const MISSION_MAX = 120;
const HEADER = '# 部門・OKR・実行計画（STAGE3・4、閲覧権限の範囲内の登録情報）';
const COVERAGE_RESERVE = 300;
const OMITTED_NAME_MAX = 5;
const OMITTED_NAME_CHARS = 80;
const MENTION_SHARE = 0.6;
const STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  review: '確認中',
  approved: '承認済み',
};

export type ExecutionSummary = {
  text: string;
  omitted: number;
  departments: { total: number; shown: number; detailed: number };
  projects: { total: number; shown: number; withKr: number };
  complete: boolean;
};

type ProjectParts = { header: string; krLines: string[]; impact: string };
type DeptItem = {
  name: string;
  mission: string;
  mentioned: boolean;
  rawProjects: AnyRecord[];
  projects: ProjectParts[];
};
type Stats = ExecutionSummary['departments'];
type ProjectStats = ExecutionSummary['projects'];

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
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
    `担当 ${orMissing(kr.owner)}`,
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

function projectParts(project: AnyRecord): ProjectParts {
  const title = orMissing(project.title ?? project.name);
  const status = STATUS_LABEL[text(project.planStatus)] ?? MISSING;
  const links = Array.isArray(project.valueDriverLinks)
    ? project.valueDriverLinks.map(text).filter(Boolean)
    : [];
  const header = [
    `  - プロジェクト: ${title}`,
    `担当 ${orMissing(project.ownerName)}`,
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

  return { header, krLines, impact: formatImpact(project) };
}

function lineCost(lines: string[]): number {
  return lines.reduce((sum, l) => sum + l.length + 1, 0);
}

function fullProjectBlock(p: ProjectParts): string[] {
  return [p.header, ...p.krLines, ...(p.impact ? [p.impact] : [])];
}

function fitProjectBlock(p: ProjectParts, allowance: number, allowPartial: boolean): string[] | null {
  const full = fullProjectBlock(p);
  if (lineCost(full) <= allowance) return full;
  if (!allowPartial) return null;
  const total = p.krLines.length;
  for (let k = total; k >= 0; k--) {
    const marker = k < total
      ? `    （KR${total}件のうち${k}件を表示）`
      : '    （一部の項目を省略）';
    const candidate = [p.header, ...p.krLines.slice(0, k), marker];
    if (lineCost(candidate) <= allowance) return candidate;
  }
  return null;
}

function coverageText(
  depts: Stats,
  projects: ProjectStats,
  complete: boolean,
  omittedNames: string[]
): string {
  if (complete) {
    return `（充足状況: 部門${depts.total}件すべて、施策${projects.total}件すべてを参照。全件）`;
  }
  const picked: string[] = [];
  let chars = 0;
  for (const n of omittedNames) {
    if (picked.length >= OMITTED_NAME_MAX || chars + n.length > OMITTED_NAME_CHARS) break;
    picked.push(n);
    chars += n.length;
  }
  const rest = omittedNames.length - picked.length;
  const names = omittedNames.length > 0
    ? `。概要も省略された部門: ${picked.join('、')}${rest > 0 ? `、ほか${rest}部門` : ''}`
    : '';
  return `（充足状況: 部門 全${depts.total}件中${depts.shown}件を参照（うち施策の詳細あり${depts.detailed}件）、施策 全${projects.total}件中${projects.shown}件を参照（うちKRまで表示${projects.withKr}件）。施策の詳細は一部のみです。この制約を結論より前に適用すること: 全社で最も重要・全社第1位など全社の順位を断定せず、参照できた施策の中での重要候補として限定して述べる。全社の戦略課題から論じることは可能。${names}）`;
}

export function buildExecutionSummaryBlock(
  departments: unknown,
  question: string,
  budget: number = EXECUTION_CHAR_BUDGET
): ExecutionSummary {
  const q = question ?? '';
  const depts = byMentionFirst(records(departments), q, (d) => text(d.name));
  if (depts.length === 0) {
    return {
      text: `${HEADER}\n（部門・プロジェクトなし）`,
      omitted: 0,
      departments: { total: 0, shown: 0, detailed: 0 },
      projects: { total: 0, shown: 0, withKr: 0 },
      complete: true,
    };
  }

  const items: DeptItem[] = depts.map((d) => {
    const rawProjects = byMentionFirst(records(d.projects), q, (p) => text(p.title ?? p.name));
    return {
      name: orMissing(d.name),
      mission: text(d.mission),
      mentioned: mentioned(q, text(d.name)),
      rawProjects,
      projects: rawProjects.map(projectParts),
    };
  });
  const deptTotal = items.length;
  const projectTotal = items.reduce((n, it) => n + it.rawProjects.length, 0);
  const detailedTotal = items.filter((it) => it.projects.length > 0).length;

  const fullSections = items.map((it) => {
    const mission = it.mission ? `（ミッション: ${it.mission.slice(0, MISSION_MAX)}）` : '';
    const body = it.projects.length === 0
      ? ['  （プロジェクトなし）']
      : it.projects.flatMap((p) => fullProjectBlock(p));
    return [`■ 部門: ${it.name}${mission}`, ...body];
  });
  const fullBody = fullSections.flat();
  const completeCoverage = coverageText(
    { total: deptTotal, shown: deptTotal, detailed: detailedTotal },
    { total: projectTotal, shown: projectTotal, withKr: projectTotal },
    true,
    []
  );
  if (HEADER.length + 1 + completeCoverage.length + 1 + lineCost(fullBody) <= budget) {
    return {
      text: [HEADER, completeCoverage, ...fullBody].join('\n'),
      omitted: 0,
      departments: { total: deptTotal, shown: deptTotal, detailed: detailedTotal },
      projects: { total: projectTotal, shown: projectTotal, withKr: projectTotal },
      complete: true,
    };
  }

  const bodyBudget = budget - HEADER.length - 1 - COVERAGE_RESERVE;
  const shownDepts: DeptItem[] = [];
  const omittedNames: string[] = [];
  let used = 0;
  for (const it of items) {
    const overview = `■ 部門: ${it.name}｜施策${it.rawProjects.length}件`;
    const cost = overview.length + 1;
    if (used + cost <= bodyBudget) {
      used += cost;
      shownDepts.push(it);
    } else {
      omittedNames.push(it.name);
    }
  }

  const detail = new Map<DeptItem, string[][]>(shownDepts.map((it) => [it, []]));
  const cursor = new Map<DeptItem, number>(shownDepts.map((it) => [it, 0]));
  let remaining = bodyBudget - used;

  const distribute = (list: DeptItem[], limit: number, allowPartial: boolean) => {
    let spent = 0;
    let progress = true;
    while (progress && spent < limit) {
      progress = false;
      for (const it of list) {
        const i = cursor.get(it) ?? 0;
        if (i >= it.projects.length) continue;
        const allowance = Math.min(limit - spent, remaining - spent);
        const block = fitProjectBlock(it.projects[i], allowance, allowPartial);
        if (!block) continue;
        detail.get(it)!.push(block);
        cursor.set(it, i + 1);
        spent += lineCost(block);
        progress = true;
      }
    }
    remaining -= spent;
  };

  const mentionedShown = shownDepts.filter((it) => it.mentioned);
  const mentionLimit = Math.floor(remaining * MENTION_SHARE);
  if (mentionedShown.length > 0) distribute(mentionedShown, mentionLimit, false);
  distribute(shownDepts, remaining, false);
  if (mentionedShown.length > 0) distribute(mentionedShown, remaining, true);
  distribute(shownDepts, remaining, true);

  const out: string[] = [];
  let projectsShown = 0;
  let projectsWithKr = 0;
  let detailedDepts = 0;
  for (const it of shownDepts) {
    out.push(`■ 部門: ${it.name}｜施策${it.rawProjects.length}件`);
    const blocks = detail.get(it) ?? [];
    if (blocks.length > 0) detailedDepts += 1;
    for (const block of blocks) {
      out.push(...block);
      projectsShown += 1;
      if (block.some((l) => l.startsWith('    - '))) projectsWithKr += 1;
    }
  }

  const complete = shownDepts.length === deptTotal && projectsShown === projectTotal;
  const deptStats: Stats = { total: deptTotal, shown: shownDepts.length, detailed: detailedDepts };
  const projectStats: ProjectStats = { total: projectTotal, shown: projectsShown, withKr: projectsWithKr };
  return {
    text: [HEADER, coverageText(deptStats, projectStats, complete, omittedNames), ...out].join('\n'),
    omitted: projectTotal - projectsShown,
    departments: deptStats,
    projects: projectStats,
    complete,
  };
}
