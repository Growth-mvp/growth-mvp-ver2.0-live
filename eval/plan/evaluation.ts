/* 実行計画の品質評価：採点項目、負担の数え方、合否判定。
 * 合否は人の採点と機械的な検証の両方で決める。JSONが正常に生成されただけでは合格にしない。 */
import type { AssembledPlan, PlanIssue } from '@/lib/stage4/plan/types';

export const PLAN_CRITERIA = [
  { id: 'CONSISTENCY', name: '戦略との一貫性' },
  { id: 'WHY_CHOSEN', name: '顧客に選ばれる理由' },
  { id: 'CONCRETENESS', name: '行動の具体性' },
  { id: 'KPI_CAUSALITY', name: 'KPI・業績との因果関係' },
  { id: 'FEASIBILITY', name: '実行可能性' },
] as const;
export type CriterionId = (typeof PLAN_CRITERIA)[number]['id'];

export type SystemId = 'LEGACY' | 'ENGINE';

/** 人の採点。各項目 0〜5 点 */
export type HumanSheet = {
  caseId: string;
  system: SystemId;
  scores: Partial<Record<CriterionId, number>>;
  scorer: string;
  comment: string;
};

export type EditBurden = {
  /** 利用者が直さないと使えない箇所（エラー、担当・数値の未入力） */
  fix: number;
  /** 利用者が根拠を確かめる箇所（仮説、確認事項） */
  confirm: number;
  details: string[];
};

export type LegacyDraftJson = {
  kpis?: Array<{ label?: string; target?: unknown; unit?: string; due?: string; owner?: string }>;
  steps?: Array<{ title?: string; dueYm?: string }>;
  assumptionBasis?: Record<string, string>;
  verificationItems?: string[];
};

export type LegacyWindow = { kpiFrom: string; kpiTo: string; stepFrom: string; stepTo: string };

/** 既存STAGE4の出力の修正箇所。既存の期限の窓（KPI 3〜6か月、ステップ 1〜3か月）を基準にする */
export function countLegacyEdits(json: LegacyDraftJson, input: { stage3KpiCount: number; window: LegacyWindow }): EditBurden {
  const details: string[] = [];
  let fix = 0;
  let confirm = 0;
  const kpis = json.kpis ?? [];
  if (kpis.length !== input.stage3KpiCount) {
    fix += 1;
    details.push(`確定KPIの件数が一致しない（${kpis.length}件 / 確定 ${input.stage3KpiCount}件）`);
  }
  kpis.forEach((k, i) => {
    if (!k.owner) {
      fix += 1;
      details.push(`KPI${i + 1}：担当が空`);
    }
    if (typeof k.target !== 'number') {
      fix += 1;
      details.push(`KPI${i + 1}：目標値が数値でない`);
    }
    if (k.due && (k.due < input.window.kpiFrom || k.due > input.window.kpiTo)) {
      fix += 1;
      details.push(`KPI${i + 1}：期限 ${k.due} が窓の外`);
    }
  });
  (json.steps ?? []).forEach((s, i) => {
    if (s.dueYm && (s.dueYm < input.window.stepFrom || s.dueYm > input.window.stepTo)) {
      fix += 1;
      details.push(`ステップ${i + 1}：期限 ${s.dueYm} が窓の外`);
    }
  });
  confirm += Object.values(json.assumptionBasis ?? {}).filter((v) => v === 'HYPOTHESIS').length;
  confirm += (json.verificationItems ?? []).length;
  return { fix, confirm, details };
}

/** 新エンジンの出力の負担。3つを区別する：
 * 1. プログラム上の検証エラー（同一原因はコード単位でまとめる。個別の修正箇所には数えない）
 * 2. ユーザーが修正しなければならない内容（原因ごと）
 * 3. ユーザーによる確認だけでよい内容（実行前に必要なものと、後で確認すればよいもの） */
export type EngineBurden = {
  machineErrors: { total: number; byCode: Record<string, number> };
  userMustFix: string[];
  userConfirmBeforeStart: string[];
  userConfirmLater: string[];
  refNormalized: number;
};

export function summarizeEngineBurden(plan: AssembledPlan | null, issues: PlanIssue[]): EngineBurden {
  const errors = issues.filter((i) => i.severity === 'error');
  const byCode: Record<string, number> = {};
  for (const e of errors) byCode[e.code] = (byCode[e.code] ?? 0) + 1;

  let refNormalized = 0;
  for (const i of issues) {
    if (i.code !== 'REF_NORMALIZED') continue;
    const m = i.message.match(/(\d+) 件/);
    refNormalized += m ? Number(m[1]) : 0;
  }

  const userMustFix: string[] = [];
  const userConfirmBeforeStart: string[] = [];
  const userConfirmLater: string[] = [];
  if (plan) {
    if (plan.section5.responsible.name === null) userMustFix.push('責任者を決める');
    for (const f of plan.section4.financeItems) {
      if (f.method === 'FREE') {
        userConfirmLater.push(`財務 ${f.key}：算定式に入らない項目の考え方を確認`);
        continue;
      }
      const missing = f.inputs.filter((i) => i.value === null).map((i) => i.label);
      if (missing.length > 0) userMustFix.push(`財務 ${f.key}：数値を入力（${missing.join('、')}）`);
    }
    for (const v of plan.verificationItems) {
      (v.priority === 'BEFORE_START' ? userConfirmBeforeStart : userConfirmLater).push(v.item);
    }
    for (const i of issues) {
      if (i.severity === 'warning' && (i.code === 'STAGE3_KPI_TIMING_CONFLICT' || i.code === 'KPI_CLASS_UNCERTAIN')) {
        userConfirmLater.push(`${i.code}：${i.message}`);
      }
    }
    for (const r of plan.section3.stage3Review) {
      userConfirmLater.push(`既存KPI ${r.stage3KpiId}：${r.concern}`);
    }
  }
  return {
    machineErrors: { total: errors.length, byCode },
    userMustFix,
    userConfirmBeforeStart,
    userConfirmLater,
    refNormalized,
  };
}

export type RunJudgement = { pass: boolean; reasons: string[] };

/**
 * 合否：
 * - 全件に人の採点があり、5項目すべてに点数がある（JSON正常だけでは合格にしない）
 * - エンジンの検証エラーが無い
 * - エンジンの項目別の平均が 4.0 以上、かつどの項目も 2 点以下が無い
 * - エンジンの平均点が既存を下回らない
 * - 利用者の修正箇所（fix）の合計が既存以下
 */
export function judgeRun(args: {
  sheets: HumanSheet[];
  caseIds: string[];
  engineErrors: Record<string, number>;
  edits: Record<string, { legacy: EditBurden; engine: EditBurden }>;
}): RunJudgement {
  const reasons: string[] = [];
  const crit = PLAN_CRITERIA.map((c) => c.id);
  const scoresOf = (system: SystemId) =>
    args.caseIds.map((id) => args.sheets.find((s) => s.caseId === id && s.system === system));

  for (const system of ['LEGACY', 'ENGINE'] as const) {
    for (const [idx, sheet] of scoresOf(system).entries()) {
      if (!sheet) reasons.push(`${args.caseIds[idx]} ${system}：採点が無い`);
      else {
        for (const c of crit) if (typeof sheet.scores[c] !== 'number') reasons.push(`${args.caseIds[idx]} ${system}：${c} が未採点`);
      }
    }
  }
  if (reasons.length) return { pass: false, reasons };

  for (const id of args.caseIds) {
    if ((args.engineErrors[id] ?? 0) > 0) reasons.push(`${id}：エンジンの検証エラーが ${args.engineErrors[id]} 件`);
  }

  const avg = (system: SystemId, c: CriterionId) => {
    const xs = scoresOf(system).map((s) => s!.scores[c]!);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const overall = (system: SystemId) => crit.reduce((n, c) => n + avg(system, c), 0) / crit.length;
  for (const c of crit) {
    const a = avg('ENGINE', c);
    if (a < 4) reasons.push(`${c}：エンジンの平均 ${a.toFixed(2)} が 4.0 未満`);
    for (const s of scoresOf('ENGINE')) if (s!.scores[c]! <= 2) reasons.push(`${s!.caseId}：${c} が ${s!.scores[c]} 点（2点以下）`);
  }
  if (overall('ENGINE') < overall('LEGACY')) {
    reasons.push(`平均点：エンジン ${overall('ENGINE').toFixed(2)} が既存 ${overall('LEGACY').toFixed(2)} を下回る`);
  }
  const fixTotal = (system: 'legacy' | 'engine') => args.caseIds.reduce((n, id) => n + args.edits[id][system].fix, 0);
  if (fixTotal('engine') > fixTotal('legacy')) {
    reasons.push(`修正箇所：エンジン ${fixTotal('engine')} が既存 ${fixTotal('legacy')} を上回る`);
  }

  return { pass: reasons.length === 0, reasons };
}
