import type { PlanScope } from './scope';
import { addMonths, resolvePlanPeriod, type ResolvedPeriod } from './period';
import type { PlanSource, PeriodBasis, Stage3KpiSource } from './types';
import { splitKpisByBasis } from './kpiBasis';

export { addMonths } from './period';

export type SourceRole = 'PRIMARY' | 'SUPPORT' | 'EVIDENCE';

export type SourceItem = {
  ref: string;
  stage: 'STAGE1' | 'STAGE2' | 'STAGE3';
  role: SourceRole;
  label: string;
  text: string;
};

export type PlanContext = {
  scope: PlanScope;
  currentYm: string;
  startYm: string;
  /** null のとき、AI が仮期間を提案する */
  endYm: string | null;
  periodBasis: PeriodBasis | null;
  projectTitle: string;
  sources: SourceItem[];
  /** AIが変更できないKPI（利用者が確定したもの＋根拠の印が無い入力値） */
  stage3Kpis: Stage3KpiSource[];
  /** AIが仮に置いた目標（確定ではない。AIは書き直せる） */
  aiProvisionalKpis: Stage3KpiSource[];
  otherDepartmentKpiLabels: string[];
  ownerCandidates: string[];
};

const NOISE = /[\s、。・，．,.「」『』（）()[\]：:；;！!？?\-—/・]/g;
const STOP_BIGRAMS = new Set(['する', 'ため', 'こと', 'ので', 'られ', 'れる', 'いる', 'ある', 'など', 'して', 'への', 'から', 'より', 'です', 'ます', 'また', 'ない', 'なる']);

export function bigrams(text: string): Set<string> {
  const t = text.replace(NOISE, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    if (!STOP_BIGRAMS.has(b)) out.add(b);
  }
  return out;
}

export function relevance(text: string, corpus: Set<string>): number {
  let n = 0;
  for (const b of bigrams(text)) if (corpus.has(b)) n++;
  return n;
}

/** 規制・安全・資金・投資回収に関する制約は件数の上限に関係なく残し、残りを上限まで足す（黙って落とさない） */
const CONSTRAINT_WORDS = /規制|法令|薬機|医療機器|安全|認証|許認可|コンプライアンス|資金|投資|回収|制約|上限|リスク/;
function keepConstraints(items: string[], max: number): string[] {
  const constraints = items.filter((x) => CONSTRAINT_WORDS.test(x));
  const others = items.filter((x) => !CONSTRAINT_WORDS.test(x));
  return [...constraints, ...others.slice(0, Math.max(0, max - constraints.length))];
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** 関連性による補足情報の選び方。文字の重なりが無い項目は補足にも入れない（結論は別の枠で必ず入れる） */
function pickRelevant<T>(items: T[], textOf: (x: T) => string, corpus: Set<string>, limit: number, minScore = 1): T[] {
  return items
    .map((item) => ({ item, score: relevance(textOf(item), corpus) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}

function periodText(p: ResolvedPeriod): string {
  if (p.endYm === null) return `期限の根拠が無いため、AIが仮期間を提案する（開始 ${p.startYm}）`;
  const label: Record<PeriodBasis, string> = {
    PROJECT_DEADLINE: 'プロジェクト期限',
    COMPANY_PLAN: '全社計画期間の終了',
    STAGE3_KPI_DUE: '既存の確定KPIの期限のうち最も遅いもの',
    AI_PROVISIONAL: 'AIの仮期間',
  };
  return `計画期間は ${p.startYm} 〜 ${p.endYm}（根拠：${label[p.basis ?? 'AI_PROVISIONAL']}）`;
}

export function buildPlanContext(source: PlanSource, scope: PlanScope): PlanContext {
  const { stage1, stage2, stage3 } = source;
  const project = stage3.project;
  const dept = stage3.department;
  const period = resolvePlanPeriod(source);

  const corpus = bigrams(
    [project.title, project.hypothesis ?? '', project.rationale ?? '', ...project.kpis.map((k) => k.label)].join(' ')
  );

  const sources: SourceItem[] = [];
  const add = (item: SourceItem) => sources.push(item);

  add({ ref: 'S3-PERIOD', stage: 'STAGE3', role: 'PRIMARY', label: '計画期間の根拠', text: periodText(period) });

  add({
    ref: 'S3-PROJ',
    stage: 'STAGE3',
    role: 'PRIMARY',
    label: 'プロジェクトの目的・背景',
    text: clip([project.title, project.hypothesis, project.rationale].filter(Boolean).join(' ／ '), 400),
  });

  const latest = stage1.financeYears[0];
  if (latest) {
    const margin = stage1.operatingMarginPct === null ? '未算定' : `${stage1.operatingMarginPct}%`;
    const trend = stage1.financeYears
      .map((y) => `${y.year}年度 売上${y.revenueMYen ?? '未入力'}百万円・営業利益${y.operatingIncomeMYen ?? '未入力'}百万円`)
      .join(' / ');
    add({ ref: 'S1-FIN', stage: 'STAGE1', role: 'PRIMARY', label: '財務実績（財務制約の根拠）', text: `${trend}。直近の営業利益率 ${margin}` });
  }
  if (stage1.roicPct !== null || stage1.waccPct !== null) {
    add({
      ref: 'S1-CAP',
      stage: 'STAGE1',
      role: 'SUPPORT',
      label: '資本効率と資本コスト',
      text: `ROIC ${stage1.roicPct ?? '未算定'}%、WACC ${stage1.waccPct ?? '未算定'}%`,
    });
  }

  stage2.finalStory.slice(0, 6).forEach((c, i) =>
    add({ ref: `S2-STORY-${i + 1}`, stage: 'STAGE2', role: 'PRIMARY', label: `最終戦略の結論（${c.title}）`, text: clip(`${c.title}：${c.body}`, 300) })
  );
  if (stage2.customerValue) {
    add({ ref: 'S2-CORE', stage: 'STAGE2', role: 'PRIMARY', label: '顧客にとっての価値', text: stage2.customerValue });
  }
  keepConstraints(stage2.priorityThemes, 5).forEach((t, i) =>
    add({ ref: `S2-PRIO-${i + 1}`, stage: 'STAGE2', role: 'PRIMARY', label: '全社の重点テーマ', text: t })
  );
  keepConstraints(stage2.decisionCriteria, 3).forEach((t, i) =>
    add({ ref: `S2-DEC-${i + 1}`, stage: 'STAGE2', role: 'SUPPORT', label: '全社の判断基準', text: t })
  );
  pickRelevant(stage2.deploymentPrinciples, (t) => t, corpus, 2).forEach((t, i) =>
    add({ ref: `S2-DEP-${i + 1}`, stage: 'STAGE2', role: 'SUPPORT', label: '部門への展開原則', text: t })
  );
  const swotLetters: Array<[string, string, string]> = [
    ['S', '強み', stage2.swot.strength],
    ['W', '弱み', stage2.swot.weakness],
    ['O', '機会', stage2.swot.opportunity],
    ['T', '脅威', stage2.swot.threat],
  ];
  swotLetters.forEach(([letter, label, text]) =>
    add({
      ref: `S2-SWOT-${letter}`,
      stage: 'STAGE2',
      role: letter === 'W' || letter === 'T' ? 'PRIMARY' : 'SUPPORT',
      label: `SWOT（${label}）`,
      text,
    })
  );
  pickRelevant(stage2.evidence, (e) => `${e.question}${e.answer}`, corpus, 3, 2).forEach((e, i) =>
    add({
      ref: `S2-QA-${i + 1}`,
      stage: 'STAGE2',
      role: 'EVIDENCE',
      label: `元の議論（${e.chapterTitle}）`,
      text: clip(`Q: ${e.question} A: ${e.answer}`, 160),
    })
  );

  add({
    ref: 'S3-DEPT',
    stage: 'STAGE3',
    role: 'PRIMARY',
    label: '部門の役割・勝ち筋',
    text: [dept.mission, dept.strategicRole ?? '', ...dept.winPatterns.map((w) => `勝ち筋：${w}`), ...dept.focusLevers.map((f) => `レバー：${f}`)]
      .filter(Boolean)
      .join(' ／ '),
  });
  keepConstraints(dept.keyIssues, 5).forEach((t, i) =>
    add({ ref: `S3-ISSUE-${i + 1}`, stage: 'STAGE3', role: 'PRIMARY', label: '部門の重点課題', text: t })
  );
  if (stage3.bridge) {
    stage3.bridge.keyThemes.slice(0, 4).forEach((t, i) =>
      add({ ref: `S3-BRIDGE-${i + 1}`, stage: 'STAGE3', role: 'PRIMARY', label: 'STAGE3の結論（重点テーマ）', text: t })
    );
    stage3.bridge.commonBehaviorChanges.slice(0, 3).forEach((t, i) =>
      add({ ref: `S3-BEH-${i + 1}`, stage: 'STAGE3', role: 'PRIMARY', label: 'STAGE3の求める行動変化', text: t })
    );
  }
  pickRelevant(dept.interDeptCollab, (t) => t, corpus, 3).forEach((t, i) =>
    add({ ref: `S3-COLLAB-${i + 1}`, stage: 'STAGE3', role: 'SUPPORT', label: '部門間の連携事項', text: t })
  );
  keepConstraints(dept.alignmentRiskPoints, 4).forEach((t, i) =>
    add({ ref: `S3-RISK-${i + 1}`, stage: 'STAGE3', role: 'SUPPORT', label: 'すり合わせの論点', text: t })
  );
  pickRelevant(
    stage3.otherDepartments.flatMap((d) => d.projects.map((p) => ({ dept: d.name, ...p }))),
    (p) => `${p.title} ${p.kpiLabels.join(' ')}`,
    corpus,
    2
  ).forEach((p, i) =>
    add({
      ref: `S3-OTHER-${i + 1}`,
      stage: 'STAGE3',
      role: 'SUPPORT',
      label: `他部門の施策（${p.dept}）`,
      text: `参照のみ（この計画の確定KPIではない）：${p.title}（KPI: ${p.kpiLabels.join('、') || 'なし'}）`,
    })
  );
  const kpiSplit = splitKpisByBasis(project.kpis);
  for (const k of kpiSplit.locked) {
    add({
      ref: `S3-KPI-${k.id}`,
      stage: 'STAGE3',
      role: 'PRIMARY',
      label: k.basis === 'USER_CONFIRMED' ? '確定済みKPI（変更不可）' : '入力済みKPI（変更不可・確定の印なし）',
      text: `${k.label}：目標 ${k.target ?? '未設定'}${k.unit}、期限 ${k.due ?? '未設定'}、担当 ${k.owner ?? '未設定'}`,
    });
  }
  for (const k of kpiSplit.aiProvisional) {
    add({
      ref: `AI-KPI-${k.id}`,
      stage: 'STAGE3',
      role: 'SUPPORT',
      label: 'AIが仮に置いた目標（確定ではない・書き直し可）',
      text: `${k.label}：仮の目標 ${k.target ?? '未設定'}${k.unit}、期限 ${k.due ?? '未設定'}`,
    });
  }

  const ownerCandidates = Array.from(
    new Set([project.ownerName, ...project.kpis.map((k) => k.owner)].filter((x): x is string => !!x))
  );

  return {
    scope,
    currentYm: source.currentYm,
    startYm: period.startYm,
    endYm: period.endYm,
    periodBasis: period.basis,
    projectTitle: project.title,
    sources,
    stage3Kpis: kpiSplit.locked,
    aiProvisionalKpis: kpiSplit.aiProvisional,
    otherDepartmentKpiLabels: stage3.otherDepartments.flatMap((d) => d.projects.flatMap((p) => p.kpiLabels)),
    ownerCandidates,
  };
}
