/* STAGE5・6の経営点検（PHASE 3）。事実はプログラムで決め、AIには事実だけを渡して仮説と改善案を書かせる。
 * 数値は既存の計算結果（資金繰り試算・見通し・計画と実績の照合・KRの実績・実施事項の進捗）をそのまま使う。 */

import { fingerprint } from './companionMilestones';

export type RiskCategory = 'CASH' | 'TARGET' | 'PLAN_GAP' | 'KR_OVERDUE' | 'ACTION_STALLED';

export type RiskFact = { category: RiskCategory; text: string };

export type CashYearInput = { year: number; shortfallYen: number | null; premise: string };
export type TargetSource = 'STAGE2' | 'STAGE6';
export type TargetGapInput = {
  metric: '売上' | '営業利益';
  source: TargetSource;
  fiscalYear: number | null;
  gapYen: number | null;
};

export type RiskStatus = 'ISSUES' | 'NO_ISSUE' | 'INSUFFICIENT' | 'FAILED';

export const TARGET_SOURCE_LABEL: Record<TargetSource, string> = {
  STAGE2: 'STAGE2の業績目標',
  STAGE6: 'STAGE6の経営目標',
};
export type PlanGapInput = {
  label: string;
  where: string;
  fiscalYear: number;
  planYen: number;
  actualYen: number | null;
  complete: boolean;
};
export type KrInput = {
  label: string;
  where: string;
  kind: string;
  unit: string;
  due?: string;
  target?: number;
  actual?: number;
};
export type ActionInput = { where: string; inProgress: boolean; updatedAt: string };

export type RiskInput = {
  now: Date;
  cash: CashYearInput[];
  targets: TargetGapInput[];
  planGaps: PlanGapInput[];
  krs: KrInput[];
  actions: ActionInput[];
};

export const STALL_DAYS = 30;
export const PLAN_GAP_RATIO = 0.2;
export const MAX_FACTS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOWER_IS_BETTER: ReadonlySet<string> = new Set(['CHURN', 'COST_FIXED', 'COST_VARIABLE']);

const yen = (v: number) => `${Math.round(v).toLocaleString('ja-JP')}円`;

/** 期限（YYYY-MM-DD または YYYY-MM）の終わりの時刻。解釈できなければ null */
export function dueEndOf(due: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return new Date(`${due}T23:59:59`);
  const m = /^(\d{4})-(\d{2})$/.exec(due);
  if (m) return new Date(Number(m[1]), Number(m[2]), 0, 23, 59, 59);
  return null;
}

function krValueText(v: number, unit: string): string {
  return unit === '%' ? `${Math.round(v * 1000) / 10}%` : `${v}${unit}`;
}

function krFacts(input: RiskInput): RiskFact[] {
  const out: RiskFact[] = [];
  for (const kr of input.krs) {
    if (!kr.due) continue;
    const end = dueEndOf(kr.due);
    if (!end || end.getTime() >= input.now.getTime()) continue;
    const name = `「${kr.label}」（${kr.where}）`;
    if (kr.actual === undefined) {
      out.push({ category: 'KR_OVERDUE', text: `期限（${kr.due}）を過ぎたが、実績が未登録：${name}` });
      continue;
    }
    if (kr.target === undefined) continue;
    const lower = LOWER_IS_BETTER.has(kr.kind);
    const missed = lower ? kr.actual > kr.target : kr.actual < kr.target;
    if (missed) {
      out.push({
        category: 'KR_OVERDUE',
        text: `期限（${kr.due}）を過ぎ、実績 ${krValueText(kr.actual, kr.unit)} が目標 ${krValueText(kr.target, kr.unit)} に届いていない：${name}`,
      });
    }
  }
  return out;
}

export function detectRiskFacts(input: RiskInput): RiskFact[] {
  const facts: RiskFact[] = [];

  for (const y of input.cash) {
    if (y.shortfallYen === null || y.shortfallYen <= 0) continue;
    facts.push({
      category: 'CASH',
      text: `${y.year}年度：施策反映・借入反映後の期末現預金が最低現預金を ${yen(y.shortfallYen)} 下回る見込み（資金繰り試算。${y.premise}）`,
    });
  }

  for (const t of input.targets) {
    if (t.gapYen === null || t.gapYen <= 0) continue;
    const at = t.fiscalYear !== null ? `${t.fiscalYear}年度の` : '';
    facts.push({
      category: 'TARGET',
      text: `${at}${t.metric}：${TARGET_SOURCE_LABEL[t.source]}に対して ${yen(t.gapYen)} 不足（施策反映後の見通し）`,
    });
  }

  for (const g of input.planGaps) {
    if (!g.complete || g.actualYen === null || g.planYen <= 0) continue;
    if (g.actualYen >= g.planYen * (1 - PLAN_GAP_RATIO)) continue;
    const pct = Math.round((g.actualYen / g.planYen) * 100);
    facts.push({
      category: 'PLAN_GAP',
      text: `${g.fiscalYear}年度の売上効果「${g.label}」（${g.where}）：計画 ${yen(g.planYen)} に対し、登録実績 ${yen(g.actualYen)}（計画比 ${pct}%）`,
    });
  }

  facts.push(...krFacts(input));

  const cutoff = input.now.getTime() - STALL_DAYS * DAY_MS;
  const stalled = input.actions.filter((a) => {
    if (!a.inProgress) return false;
    const at = Date.parse(a.updatedAt);
    return Number.isFinite(at) && at <= cutoff;
  });
  if (stalled.length > 0) {
    const names = stalled.slice(0, 3).map((a) => a.where).join('、');
    facts.push({
      category: 'ACTION_STALLED',
      text: `進行中のまま${STALL_DAYS}日以上更新がない実施事項：${stalled.length}件（${names}${stalled.length > 3 ? ' ほか' : ''}）`,
    });
  }

  return facts.slice(0, MAX_FACTS);
}

/** 資金不足・経営目標の未達は、通常の進行案内より優先して示す */
export function isSeriousRisk(facts: RiskFact[]): boolean {
  return facts.some((f) => f.category === 'CASH' || f.category === 'TARGET');
}

/** 点検結果に付くAI所見の状態。事実は常に返し、所見の状態だけをこれで示す */
export type AiState =
  | 'NOT_NEEDED'
  | 'GENERATED'
  | 'REUSED'
  | 'IN_PROGRESS'
  | 'FAILED_TODAY'
  | 'STALE'
  | 'OTHER_STRATEGY'
  | 'UNAVAILABLE'
  | 'FAILED';

/** 所見が無い状態の説明（所見がある状態は null） */
export const AI_NOTE: Partial<Record<AiState, string>> = {
  IN_PROGRESS: '当日の所見は、別の利用者の点検で作成中です。作成されると、次に開いた時に表示されます。',
  FAILED_TODAY: '当日の所見は作成できませんでした。次の点検は明日以降に行われます。',
  STALE: '当日作成した所見は、点検の事実が更新されたため表示していません。上の事実は最新の保存済みデータに基づきます。',
  OTHER_STRATEGY: '当日の所見は、別の戦略の点検で作成されたため表示していません。',
  UNAVAILABLE: '所見を作成するための確認ができなかったため、AI所見は作成していません。上の事実は確認できます。',
  FAILED: 'AI所見を取得できませんでした。上の事実を確認してください。',
};

export function riskStatusOf(facts: RiskFact[], coverage: string[]): RiskStatus {
  if (facts.length > 0) return 'ISSUES';
  return coverage.length > 0 ? 'INSUFFICIENT' : 'NO_ISSUE';
}

export const STATUS_TITLE: Record<RiskStatus, string> = {
  ISSUES: '経営点検（STAGE5・6）：AIの助言',
  NO_ISSUE: '経営点検（STAGE5・6）：点検できた範囲では問題なし',
  INSUFFICIENT: '経営点検（STAGE5・6）：判断材料が不足しています',
  FAILED: '経営点検（STAGE5・6）：点検できませんでした',
};

/** AIを呼ばずに定型文で示す本文の冒頭（ISSUES 以外） */
export const STATUS_LEAD: Record<Exclude<RiskStatus, 'ISSUES'>, string> = {
  NO_ISSUE: '保存済みデータから点検できた範囲では、問題は検出されませんでした。',
  INSUFFICIENT: '判断材料が不足している項目があるため、経営点検の結論は出せません。下の項目を入力すると、次の点検で判断できます。',
  FAILED: '経営点検の処理に失敗したため、所見は作っていません。次の点検は明日以降に行われます。',
};

/** 点検していない範囲。表示で必ず添え、点検済みと誤認させない */
export const NOT_CHECKED_NOTE =
  '点検していない範囲：費用（OPEX・コスト削減・追加費用）の計画と実績、会社全体のKR（経営目標）の進捗。これらは判断の材料に含めていません。';

export function riskFingerprint(facts: RiskFact[]): string {
  return fingerprint(facts.map((f) => f.text));
}

export function renderRiskFacts(facts: RiskFact[]): string[] {
  return facts.map((f) => `- ${f.text}`);
}

export const RISK_GUARD = [
  'あなたは経営コンサルタントです。',
  '「事実」は、保存済みデータから既存の計算で得た確定した内容です。',
  '- 事実の数値・年度・名称は、そのまま使う。変えたり、足したり、推測で補ったりしない。',
  '- 事実に「前提」が付く場合は、その前提を保ったまま書く。借入計画が確定しているとは書かない。',
  '- 経営目標は、事実の一覧に示された目標だけを前提にする。一覧にない目標との比較は書かない。',
  '- 表面の数値だけでなく、その原因を「仮説」として考える（例：「仮説：〜の可能性があります」）。事実とは区別して書く。',
  '- 全体最適の視点で、部門の施策が全社の目標にどう効くかを見る。',
  '- 改善策は「見直しの候補」として示し、優先する一点を先に書く。決定は利用者に委ねる。',
  '- 部門をまたぐ論点を、最大3点、短く示す（目的と手段の違い、部門間の認識のずれ、社員が自分で判断して動けるかを観点にする）。',
  '- 親しみやすく誠実な言葉で書く。AIから話しかける場面なので、相手の発言を受け止める前置きや過剰な共感は書かない。',
  '- 画面の操作手順は書かない。',
  '- 事実の一覧にない項目について、有無や数値を推測せず、「未登録」と決めつけない。判断できない点は「この点検では判断していない」と書く。',
  '- 全体で600字以内。見出しは「仮説」「見直しの候補」「部門横断の論点」の3つだけにする。',
].join('\n');

export function buildRiskPrompt(factLines: string[]): string {
  return ['以下の事実を読み、経営点検の所見を書いてください。', '', '事実：', ...factLines].join('\n');
}

export const RISK_FACT_LABEL = '経営点検（STAGE5・6、保存済みデータの計算結果）';
