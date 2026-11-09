/* 採用・規制の記録・実行開始・開始の取り消しの規則（サーバー側）。
 * 判定は画面と同じ関数（computePlanView）を使い、保存された内容だけで決める。画面の表示は信用しない。
 * 採用は AI提案KPI の確定を意味しない。ここでは okrsV2 や経路Bには触れない。 */
import { regulatoryComplete, EMPTY_REGULATORY, type RegulatoryRecord } from '../planView/model';
import { computePlanView, INITIAL_PLAN_STATE } from '../planView/planState';
import type { PlanDocKey, PlanDocRecord } from './planDocumentStore';
import { allowed, type ServiceContext } from './planService';

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
