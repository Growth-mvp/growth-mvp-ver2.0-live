/* STAGE3の保存済みデータを、文書型UIへ渡すための読み取り専用の入口（DB・AI・保存には触れない）。
 * 選択は「企業・戦略・プロジェクトのキー」で行い、同名のプロジェクトを勝手に選ばない。 */
import {
  listAccessibleProjects,
  resolveProjectByKey,
  type MembershipRow,
  type ProjectListing,
  type ResolveFailure,
  type StrategyRow,
} from './projectResolver';
import { readModelFromResolved, type SavedPlanRecord, type Stage4ReadModel } from './readModel';
import type { RawPlanStrategy } from './source';

export type Stage3Selection = { companyId: string; strategyId: string; projectKey: string };

export type Stage3Tree = Array<{
  companyId: string;
  strategyId: string;
  departments: Array<{ departmentIndex: number; name: string; mission: string | null; projects: ProjectListing[] }>;
}>;

/** 文書型UIに渡す入力。保存済みの計画がなければ、その旨だけを渡す（空の計画を作らない） */
export type Stage3DocumentInput =
  | { kind: 'SAVED_PLAN'; savedAt: string; kpiChanged: boolean; plan: unknown }
  | { kind: 'NO_PLAN' };

export type Stage3ReadView =
  | { status: 'NO_DATA'; reason: ResolveFailure }
  | { status: 'READY'; key: string; model: Extract<Stage4ReadModel, { status: 'READY' }>; document: Stage3DocumentInput };

export const selectionKey = (s: Stage3Selection): string => `${s.companyId}|${s.strategyId}|${s.projectKey}`;

/* 戦略全体のうち、実行計画書の入力に使う項目（ストアのトップレベルにある名前のまま） */
export const PLAN_STRATEGY_FIELDS = [
  'strength',
  'weakness',
  'opportunity',
  'threat',
  'finalStory',
  'answers2',
  'financePL',
  'valueAnalysis',
  'midtermStrategy',
  'periodEndYear',
  'fiscalYearEnd',
  'stage3_strategy_bridge',
] as const;

export const pickPlanStrategyFields = (state: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(PLAN_STRATEGY_FIELDS.filter((k) => state[k] !== undefined).map((k) => [k, state[k]]));

export type Stage3ScopeInput = {
  storeCompanyId: string | null;
  storeStrategyId: string | null;
  storeDepartments: unknown;
  storeStrategyFields: Record<string, unknown>;
  storeCompanyName: string | null;
  storeHydrated: boolean;
  storeRestoreReady: boolean;
  storeIsRestoring: boolean;
  storePendingCompanyId: string | null;
  userCompanyId: string | null;
  userRole: string | null;
};

export type Stage3Source =
  | { status: 'LOADING' }
  | { status: 'SCOPE_MISMATCH' }
  | { status: 'NO_STRATEGY' }
  | {
      status: 'READY';
      memberships: MembershipRow[];
      strategies: StrategyRow[];
      companyLabels: Record<string, string>;
      planStrategy: RawPlanStrategy;
    };

/* 画面に載せてよいSTAGE3データかを決める。読み込み中・会社切替中は前の企業の情報を出さず、
 * ストアの企業がユーザーの現在の所属企業と一致しないときは何も出さない。 */
export function stage3SourceFromScope(i: Stage3ScopeInput): Stage3Source {
  if (!i.storeHydrated || !i.storeRestoreReady || i.storeIsRestoring || i.storePendingCompanyId) return { status: 'LOADING' };
  if (!i.userCompanyId || !i.userRole) return { status: 'LOADING' };
  if (!i.storeCompanyId) return { status: 'NO_STRATEGY' };
  if (i.storeCompanyId !== i.userCompanyId) return { status: 'SCOPE_MISMATCH' };
  if (!i.storeStrategyId) return { status: 'NO_STRATEGY' };
  return {
    status: 'READY',
    memberships: [{ company_id: i.userCompanyId, role: i.userRole }],
    strategies: [{ id: i.storeStrategyId, company_id: i.storeCompanyId, departments: i.storeDepartments }],
    companyLabels: { [i.storeCompanyId]: i.storeCompanyName?.trim() || '企業名未設定' },
    planStrategy: {
      ...i.storeStrategyFields,
      id: i.storeStrategyId,
      company_id: i.storeCompanyId,
      departments: i.storeDepartments,
    } as RawPlanStrategy,
  };
}

/** 所属している企業の、企業・戦略・部門・プロジェクトの木構造（画面の選択に使う） */
export function buildStage3Tree(args: { memberships: MembershipRow[]; strategies: StrategyRow[] }): Stage3Tree {
  const tree: Stage3Tree = [];
  for (const row of listAccessibleProjects(args)) {
    let strategy = tree.find((t) => t.companyId === row.companyId && t.strategyId === row.strategyId);
    if (!strategy) {
      strategy = { companyId: row.companyId, strategyId: row.strategyId, departments: [] };
      tree.push(strategy);
    }
    let dept = strategy.departments.find((d) => d.departmentIndex === row.departmentIndex);
    if (!dept) {
      const raw = args.strategies.find((s) => String(s.id) === row.strategyId);
      const rawDept = (Array.isArray(raw?.departments) ? (raw?.departments as Array<Record<string, unknown>>) : [])[row.departmentIndex];
      const mission = typeof rawDept?.mission === 'string' && rawDept.mission.trim() ? rawDept.mission.trim() : null;
      dept = { departmentIndex: row.departmentIndex, name: row.departmentName, mission, projects: [] };
      strategy.departments.push(dept);
    }
    dept.projects.push(row);
  }
  return tree;
}

/** 選ばれたプロジェクトの読み取りモデルと、文書型UIへの入力を組み立てる */
export function readStage3Project(args: {
  memberships: MembershipRow[];
  strategies: StrategyRow[];
  savedPlans: SavedPlanRecord[];
  selection: Stage3Selection;
}): Stage3ReadView {
  const resolved = resolveProjectByKey({
    memberships: args.memberships,
    strategies: args.strategies,
    companyId: args.selection.companyId,
    strategyId: args.selection.strategyId,
    projectKey: args.selection.projectKey,
  });
  if (!resolved.ok) return { status: 'NO_DATA', reason: resolved.reason };

  const model = readModelFromResolved(resolved.project, args.savedPlans);
  if (model.status !== 'READY') return { status: 'NO_DATA', reason: 'PROJECT_NOT_FOUND' };
  const document: Stage3DocumentInput =
    model.savedPlan.state === 'SAVED'
      ? { kind: 'SAVED_PLAN', savedAt: model.savedPlan.savedAt, kpiChanged: model.savedPlan.kpiChanged, plan: model.savedPlan.plan }
      : { kind: 'NO_PLAN' };
  return { status: 'READY', key: selectionKey(args.selection), model, document };
}
