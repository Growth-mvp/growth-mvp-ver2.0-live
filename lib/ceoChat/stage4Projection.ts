type AnyRecord = Record<string, any>;

export const EXECUTION_CHAR_BUDGET = 2400;
const MISSING = '未登録';
const MISSION_MAX = 120;
const STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  review: '確認中',
  approved: '承認済み',
};

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
  return deltas.length > 0 ? `期待成果（登録）: ${deltas.join('、')}` : '';
}

function formatProject(project: AnyRecord): string[] {
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
  const lines = [header];

  const krs = records(project.okrsV2);
  if (krs.length > 0) {
    lines.push(...krs.map(formatKr));
  } else {
    records(project.okrs).forEach((o) => {
      const krLabels = (Array.isArray(o.keyResults) ? o.keyResults : [])
        .map((k: unknown) => (typeof k === 'string' ? k : text((k as AnyRecord)?.label)))
        .filter(Boolean);
      lines.push(`    - O: ${orMissing(o.objective)}${krLabels.length ? ` / KR: ${krLabels.join('、')}` : ''}`);
    });
  }

  const impact = formatImpact(project);
  if (impact) lines.push(`    ${impact}`);

  return lines;
}

export function buildExecutionSummaryBlock(
  departments: unknown,
  question: string,
  budget: number = EXECUTION_CHAR_BUDGET
): { text: string; omitted: number } {
  const q = question ?? '';
  const depts = byMentionFirst(records(departments), q, (d) => text(d.name));
  const header = '# 部門・OKR・実行計画（STAGE3・4、閲覧権限の範囲内の登録情報）';
  if (depts.length === 0) return { text: `${header}\n（部門・プロジェクトなし）`, omitted: 0 };

  const blocks: string[][] = [];
  depts.forEach((d) => {
    const mission = text(d.mission);
    const deptLines = [
      `■ 部門: ${orMissing(d.name)}${mission ? `（ミッション: ${mission.slice(0, MISSION_MAX)}）` : ''}`,
    ];
    const projects = byMentionFirst(records(d.projects), q, (p) => text(p.title ?? p.name));
    if (projects.length === 0) deptLines.push('  （プロジェクトなし）');
    projects.forEach((p) => deptLines.push(...formatProject(p)));
    blocks.push(deptLines);
  });

  const out: string[] = [header];
  let used = header.length + 1;
  let omitted = 0;
  for (const lines of blocks) {
    for (const line of lines) {
      if (used + line.length + 1 > budget) {
        omitted += 1;
        continue;
      }
      out.push(line);
      used += line.length + 1;
    }
  }
  if (omitted > 0) out.push(`（上限のため${omitted}行を省略）`);
  return { text: out.join('\n'), omitted };
}
