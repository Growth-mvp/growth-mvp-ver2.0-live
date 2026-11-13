/* 採用・規制の記録・実行開始・開始の取り消しの規則（サーバー側）。
 * 判定は画面と同じ関数（computePlanView）を使い、保存された内容だけで決める。画面の表示は信用しない。
 * 採用は AI提案KPI の確定を意味しない。ここでは okrsV2 や経路Bには触れない。 */
import { regulatoryComplete, EMPTY_REGULATORY, type RegulatoryRecord } from '../planView/model';
import { IMPACT_EDIT_PREFIX } from '../planView/impactEstimate';
import { computePlanView, INITIAL_PLAN_STATE } from '../planView/planState';
import { listEditableItems } from '../planView/regen';
import type { UserEdits } from './mergeUserEdits';
import type { PlanDocKey, PlanDocRecord } from './planDocumentStore';
import { allowed, displayedRecord, type ServiceContext } from './planService';
import { refreshKpiReference } from './kpiReference';

export const TRANSITION_ACTIONS = ['ADOPT', 'UNADOPT', 'RECORD_REGULATORY', 'START', 'UNSTART'] as const;
export type TransitionAction = (typeof TRANSITION_ACTIONS)[number] | 'USE_DRAFT';

const DECISIONS = ['NOT_APPLICABLE', 'APPLICABLE_PROCEDURE_CONFIRMED', 'UNCONFIRMED'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 500;

/* 規制・安全の判断の入力を検査する。「確認済み」だけでは通さない：判断・根拠・確認者・確認日が要る */
export type RegulatoryRule = { required: boolean; today: string };

/* required=false（規制・安全の項目が無い案件）で「適用なし」の時だけ、判断内容・根拠・確認者は要らない。確認日は今日の日付で記録する。
 * 「未確認」や「適用あり」は、項目が無くても従来どおり理由と確認者を要する（勝手に適用なしにしない） */
export function validateRegulatory(
  input: unknown,
  rule: RegulatoryRule = { required: true, today: '' }
): { ok: true; value: RegulatoryRecord } | { ok: false; message: string } {
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
  const relaxed = !rule.required && decision === 'NOT_APPLICABLE';
  if (relaxed) {
    if (!DATE.test(value.confirmedOn)) value.confirmedOn = rule.today;
    return { ok: true, value };
  }
  if (decision !== 'UNCONFIRMED') {
    if (!value.judgement) return { ok: false, message: '判断の内容を書いてください' };
    if (!value.basis) return { ok: false, message: '判断の根拠を書いてください' };
    if (!value.confirmer) return { ok: false, message: '確認者を書いてください' };
    if (!DATE.test(value.confirmedOn)) return { ok: false, message: '確認日（YYYY-MM-DD）を入れてください' };
  }
  return { ok: true, value };
}

/* 採用・開始の時に、対象の戦略とプロジェクトが正式データで確かめられるかを見る。
 * KPIの差では止めない（参照は表示のときに正式KPIへ合わせる。保存された草案は、作った後に変えられない） */
async function structureBlockers(
  ctx: ServiceContext,
  key: PlanDocKey,
  record: PlanDocRecord
): Promise<{ failed: true } | { failed: false; blockers: string[] }> {
  const row = await ctx.gateway.readStrategyRow(key.companyId, key.strategyId);
  if (!row.ok) return { failed: true };
  if (!row.value || String(row.value.id) !== key.strategyId || String(row.value.company_id) !== key.companyId) {
    return { failed: false, blockers: ['正式な戦略データを確認できません'] };
  }
  const refreshed = refreshKpiReference(record.aiDraft, row.value.departments, key.projectId);
  return { failed: false, blockers: refreshed.ok ? [] : [refreshed.message] };
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

async function transitionStored(
  ctx: ServiceContext,
  key: PlanDocKey,
  expectedVersion: number,
  action: Exclude<TransitionAction, 'USE_DRAFT'>,
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
  const required = computePlanView(record.aiDraft, state).regulatoryTasks.length > 0;
  const today = args.now.slice(0, 10);

  type Patch = Parameters<ServiceContext['gateway']['updatePlan']>[2];
  let patch: Patch;
  switch (action) {
    case 'ADOPT': {
      if (record.adoption) return { status: 'OK', record };
      const structure = await structureBlockers(ctx, key, record);
      if (structure.failed) return { status: 'FAILED', message: FAILED };
      if (structure.blockers.length > 0) return { status: 'BLOCKED', blockers: structure.blockers };
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
      const v = validateRegulatory(args.regulatory, { required, today });
      if (!v.ok) return { status: 'INVALID', message: v.message };
      patch = { regulatory: v.value, startInfo: null };
      break;
    }
    case 'START': {
      if (record.startInfo) return { status: 'OK', record };
      const structure = await structureBlockers(ctx, key, record);
      if (structure.failed) return { status: 'FAILED', message: FAILED };
      if (structure.blockers.length > 0) return { status: 'BLOCKED', blockers: structure.blockers };
      const view = computePlanView(record.aiDraft, { ...state, adopted: true });
      if (!view.d.adoption.adoptable) return { status: 'BLOCKED', blockers: view.d.adoption.blockers };
      if (!view.gate.startable) return { status: 'BLOCKED', blockers: view.gate.blockers };
      patch = {
        ...(record.adoption ? {} : { adoption: { version: expectedVersion, byUserId: ctx.userId, at: args.now, edits: record.userEdits } }),
        startInfo: { version: expectedVersion, byUserId: ctx.userId, at: args.now },
      };
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

/* 修正の残し方：実行責任者と参考試算の前提は AI原案に依らないので残す。原案の項目に無い修正は外す（外した修正は履歴に残る） */
function keepEdits(edits: UserEdits, aiDraft: Record<string, unknown>): UserEdits {
  const bundle = aiDraft as { rawOutput?: unknown; plan?: unknown };
  const draft = typeof bundle.rawOutput === 'string' ? JSON.parse(bundle.rawOutput) : bundle.plan;
  const itemIds = new Set(draft ? listEditableItems(draft).map((i) => i.itemId) : []);
  return Object.fromEntries(
    Object.entries(edits).filter(([k]) => k === 'responsible' || k.startsWith(IMPACT_EDIT_PREFIX) || itemIds.has(k))
  );
}

/* 「この案を使う」：版番号・状態・開始の有無と整合（戦略・プロジェクト・正式KPI）を確かめてから、AI原案と修正を差し替える */
async function useDraftStored(
  ctx: ServiceContext,
  key: PlanDocKey,
  expectedVersion: number,
  aiDraft: Record<string, unknown>
): Promise<TransitionOutcome> {
  const access = await allowed(ctx, key.companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: FAILED };

  const found = await ctx.gateway.findPlan(key);
  if (!found.ok) return { status: 'FAILED', message: FAILED };
  const record = found.value;
  if (!record) return { status: 'NOT_FOUND' };
  if (record.status && record.status !== 'DRAFT') return { status: 'NOT_READY' };
  if (record.startInfo) return { status: 'NOT_READY' };
  if (record.version !== expectedVersion) return { status: 'CONFLICT', current: record };

  const structure = await structureBlockers(ctx, key, { ...record, aiDraft });
  if (structure.failed) return { status: 'FAILED', message: FAILED };
  if (structure.blockers.length > 0) return { status: 'BLOCKED', blockers: structure.blockers };

  const out = await ctx.gateway.replaceDraft(key, expectedVersion, { aiDraft, userEdits: keepEdits(record.userEdits, aiDraft) }, ctx.userId);
  if (!out.ok) return { status: 'FAILED', message: FAILED };
  const result = out.value;
  switch (result.status) {
    case 'REPLACED':
      return { status: 'OK', record: await displayedRecord(ctx, result.record) };
    case 'CONFLICT': {
      const current = await ctx.gateway.findPlan(key);
      return current.ok && current.value ? { status: 'CONFLICT', current: current.value } : { status: 'FAILED', message: FAILED };
    }
    case 'NOT_READY':
      return { status: 'NOT_READY' };
    case 'NOT_FOUND':
      return { status: 'NOT_FOUND' };
    case 'DENIED':
      return { status: 'DENIED' };
    case 'INVALID':
      return { status: 'INVALID', message: '新しい案を確認できませんでした。もう一度作ってください。' };
  }
}

/* 遷移の結果は、表示と同じく、いまの正式KPIに合わせた写しで返す（保存された草案は変えない） */
export async function transitionPlan(
  ctx: ServiceContext,
  key: PlanDocKey,
  expectedVersion: number,
  action: TransitionAction,
  args: { regulatory?: unknown; now: string; aiDraft?: Record<string, unknown> }
): Promise<TransitionOutcome> {
  if (action === 'USE_DRAFT') {
    if (!args.aiDraft) return { status: 'INVALID', message: '新しい案がありません' };
    return useDraftStored(ctx, key, expectedVersion, args.aiDraft);
  }
  const out = await transitionStored(ctx, key, expectedVersion, action, { regulatory: args.regulatory, now: args.now });
  if (out.status !== 'OK') return out;
  return { status: 'OK', record: await displayedRecord(ctx, out.record) };
}
