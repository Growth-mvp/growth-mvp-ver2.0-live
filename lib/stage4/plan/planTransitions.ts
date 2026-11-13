/* 採用・規制の記録・実行開始・開始の取り消しの規則（サーバー側）。
 * 判定は画面と同じ関数（computePlanView）を使い、保存された内容だけで決める。画面の表示は信用しない。
 * 採用は AI提案KPI の確定を意味しない。ここでは okrsV2 や経路Bには触れない。 */
import { regulatoryComplete, EMPTY_REGULATORY, type RegulatoryRecord } from '../planView/model';
import { computePlanView, INITIAL_PLAN_STATE } from '../planView/planState';
import type { PlanDocKey, PlanDocRecord } from './planDocumentStore';
import { allowed, type ServiceContext } from './planService';
import { splitKpisByBasis } from './kpiBasis';
import { stableIdOf } from './projectResolver';
import { kpisOfProject } from './source';

export const TRANSITION_ACTIONS = ['ADOPT', 'UNADOPT', 'RECORD_REGULATORY', 'START', 'UNSTART'] as const;
export type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

const DECISIONS = ['NOT_APPLICABLE', 'APPLICABLE_PROCEDURE_CONFIRMED', 'UNCONFIRMED'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 500;

/* 規制・安全の判断の入力を検査する。「確認済み」だけでは通さない：判断・根拠・確認者・確認日が要る */
export function validateRegulatory(input: unknown): { ok: true; value: RegulatoryRecord } | { ok: false; message: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, message: '規制・安全の判断を入力してください' };
  const r = input as Record<string, unknown>;
  const text = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  const decision = r.decision;
  if (typeof decision !== 'string' || !(DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, message: '規制・安全の該当性を選んでください' };
  }
  const value: RegulatoryRecord = {
    decision: decision as RegulatoryRecord['decision'],
    judgement: text('judgement'),
    confirmer: text('confirmer'),
    confirmedOn: text('confirmedOn'),
    basis: text('basis'),
  };
  if (value.judgement.length > MAX_TEXT || value.basis.length > MAX_TEXT || value.confirmer.length > 100) {
    return { ok: false, message: '入力が長すぎます' };
  }
  if (decision !== 'UNCONFIRMED') {
    if (!value.judgement) return { ok: false, message: '判断の内容を書いてください' };
    if (!value.basis) return { ok: false, message: '判断の根拠を書いてください' };
    if (!value.confirmer) return { ok: false, message: '確認者を書いてください' };
    if (!DATE.test(value.confirmedOn)) return { ok: false, message: '確認日（YYYY-MM-DD）を入れてください' };
  }
  return { ok: true, value };
}

const CONFIRMATION_TEXT = { USER_CONFIRMED: '確定', UNCONFIRMED: '未確認' } as const;
const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '未設定' : String(v));

type PlannedKpi = {
  stage3KpiId: string;
  label: string;
  target: number | null;
  unit: string;
  due: string | null;
  owner: string | null;
  confirmation?: keyof typeof CONFIRMATION_TEXT;
};

/* 計画書が参照した確定KPIと、いま正式データにあるKPIの食い違い（採用・開始を止める理由）。照合は安定IDで行う。 */
export function kpiDriftOf(aiDraft: Record<string, unknown>, departments: unknown, projectId: string): string[] {
  const plan = aiDraft.plan as { section3?: { protectedKpis?: unknown } } | null | undefined;
  const planned = plan?.section3?.protectedKpis;
  if (!Array.isArray(planned)) return ['計画書に確定KPIの記録がありません。計画書を作り直してください'];
  const projects = (Array.isArray(departments) ? (departments as Array<{ projects?: unknown }>) : [])
    .flatMap((d) => (Array.isArray(d?.projects) ? (d.projects as Array<Record<string, unknown>>) : []))
    .filter((p) => stableIdOf(p) === projectId);
  if (projects.length !== 1) {
    return ['計画書の対象プロジェクトを正式データで確定できません（削除、または番号の変更の可能性）。計画書を作り直してください'];
  }
  const all = kpisOfProject(projects[0]);
  const byId = new Map(all.map((c) => [c.id, c]));
  const messages: string[] = [];
  for (const p of planned as PlannedKpi[]) {
    const c = byId.get(p.stage3KpiId);
    if (!c) {
      messages.push(`KPI「${p.label}」が正式データにありません（削除、または番号の変更）`);
      continue;
    }
    const now = c.basis === 'USER_CONFIRMED' ? 'USER_CONFIRMED' : 'UNCONFIRMED';
    const fields: Array<[string, string, string]> = [
      ['名称', p.label, c.label],
      ['目標値', shown(p.target), shown(c.target)],
      ['単位', shown(p.unit), shown(c.unit)],
      ['期限', shown(p.due), shown(c.due)],
      ['担当', shown(p.owner), shown(c.owner)],
      ['確定の状態', CONFIRMATION_TEXT[p.confirmation ?? 'UNCONFIRMED'], CONFIRMATION_TEXT[now]],
    ];
    for (const [name, was, current] of fields) {
      if (was !== current) messages.push(`KPI「${p.label}」の${name}が変わっています（計画書: ${was} → 正式データ: ${current}）`);
    }
  }
  const plannedIds = new Set((planned as PlannedKpi[]).map((p) => p.stage3KpiId));
  for (const c of splitKpisByBasis(all).locked) {
    if (!plannedIds.has(c.id)) messages.push(`KPI「${c.label}」が計画書の作成後に追加されています`);
  }
  return messages.length > 0
    ? ['正式なKPIが計画書の作成後に変わりました。計画書を作り直してから採用・開始してください', ...messages]
    : [];
}

async function kpiBlockersOf(
  ctx: ServiceContext,
  key: PlanDocKey,
  record: PlanDocRecord
): Promise<{ failed: true } | { failed: false; blockers: string[] }> {
  const row = await ctx.gateway.readStrategyRow(key.companyId, key.strategyId);
  if (!row.ok) return { failed: true };
  if (!row.value || String(row.value.id) !== key.strategyId || String(row.value.company_id) !== key.companyId) {
    return { failed: false, blockers: ['正式な戦略データを確認できません'] };
  }
  return { failed: false, blockers: kpiDriftOf(record.aiDraft, row.value.departments, key.projectId) };
}

export type TransitionOutcome =
  | { status: 'OK'; record: PlanDocRecord }
  | { status: 'CONFLICT'; current: PlanDocRecord }
  | { status: 'BLOCKED'; blockers: string[] }
  | { status: 'INVALID'; message: string }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_READY' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

const FAILED = '操作を記録できませんでした。画面を読み直してから、もう一度お試しください。';

export async function transitionPlan(
  ctx: ServiceContext,
  key: PlanDocKey,
  expectedVersion: number,
  action: TransitionAction,
  args: { regulatory?: unknown; now: string }
): Promise<TransitionOutcome> {
  const access = await allowed(ctx, key.companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: FAILED };

  const found = await ctx.gateway.findPlan(key);
  if (!found.ok) return { status: 'FAILED', message: FAILED };
  const record = found.value;
  if (!record) return { status: 'NOT_FOUND' };
  if (record.status && record.status !== 'DRAFT') return { status: 'NOT_READY' };
  if (record.version !== expectedVersion) return { status: 'CONFLICT', current: record };

  const state = {
    ...INITIAL_PLAN_STATE,
    committed: record.userEdits as typeof INITIAL_PLAN_STATE.committed,
    adopted: record.adoption != null,
    started: record.startInfo != null,
    regulatory: record.regulatory ?? EMPTY_REGULATORY,
  };

  type Patch = Parameters<ServiceContext['gateway']['updatePlan']>[2];
  let patch: Patch;
  switch (action) {
    case 'ADOPT': {
      if (record.adoption) return { status: 'OK', record };
      const kpi = await kpiBlockersOf(ctx, key, record);
      if (kpi.failed) return { status: 'FAILED', message: FAILED };
      if (kpi.blockers.length > 0) return { status: 'BLOCKED', blockers: kpi.blockers };
      const view = computePlanView(record.aiDraft, state);
      if (!view.d.adoption.adoptable) return { status: 'BLOCKED', blockers: view.d.adoption.blockers };
      patch = {
        adoption: { version: expectedVersion, byUserId: ctx.userId, at: args.now, edits: record.userEdits },
      };
      break;
    }
    case 'UNADOPT': {
      if (!record.adoption) return { status: 'OK', record };
      patch = { adoption: null, startInfo: null };
      break;
    }
    case 'RECORD_REGULATORY': {
      const v = validateRegulatory(args.regulatory);
      if (!v.ok) return { status: 'INVALID', message: v.message };
      patch = { regulatory: v.value, startInfo: null };
      break;
    }
    case 'START': {
      if (!record.adoption) return { status: 'BLOCKED', blockers: ['先に計画案を採用してください'] };
      if (record.startInfo) return { status: 'OK', record };
      const kpi = await kpiBlockersOf(ctx, key, record);
      if (kpi.failed) return { status: 'FAILED', message: FAILED };
      if (kpi.blockers.length > 0) return { status: 'BLOCKED', blockers: kpi.blockers };
      const gate = computePlanView(record.aiDraft, state).gate;
      if (!gate.startable) return { status: 'BLOCKED', blockers: gate.blockers };
      if (!regulatoryComplete(record.regulatory ?? EMPTY_REGULATORY)) {
        return { status: 'BLOCKED', blockers: ['規制・安全の判断（該当性・根拠・確認者・確認日）を記録してください'] };
      }
      patch = { startInfo: { version: expectedVersion, byUserId: ctx.userId, at: args.now } };
      break;
    }
    case 'UNSTART': {
      if (!record.startInfo) return { status: 'OK', record };
      patch = { startInfo: null };
      break;
    }
  }

  const updated = await ctx.gateway.updatePlan(key, expectedVersion, patch, ctx.userId);
  if (!updated.ok) return { status: 'FAILED', message: FAILED };
  if (updated.value) return { status: 'OK', record: updated.value };
  const current = await ctx.gateway.findPlan(key);
  if (!current.ok || !current.value) return { status: 'FAILED', message: FAILED };
  return { status: 'CONFLICT', current: current.value };
}
