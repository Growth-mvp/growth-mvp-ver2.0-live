/* 保存先（stage4_plan_documents）の書き込みの規則を、メモリ上の保存先で本番と同じに働かせるための写し。
 * 本番の規則は supabase/pending/20261110_stage4_plan_documents.sql（トリガー stage4_plan_documents_guard と表の制約）。
 * 草案（DRAFT）の ai_draft は作った後に変えられない。利用者の修正が変われば、採用・開始・規制の判断は解除される。 */
import { EMPTY_REGULATORY } from '../planView/model';
import type { UserEdits } from './mergeUserEdits';
import type { PlanDocRecord } from './planDocumentStore';
import type { PlanPatch } from './planService';

export type StoredResult = { ok: true; record: PlanDocRecord } | { ok: false; reason: string };

function canonical(value: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sorted(x)])
    );
  };
  return JSON.stringify(sorted(value));
}

export type DraftReplaceInput = { expectedVersion: number; aiDraft: Record<string, unknown>; userEdits: UserEdits };
export type DraftReplaceOutcome = { status: 'REPLACED'; record: PlanDocRecord } | { status: 'CONFLICT' } | { status: 'NOT_READY' } | { status: 'INVALID' };

/* stage4_use_draft と同じ規則：草案のみ・開始前・版番号一致・修正は元の修正の一部だけ。採用と開始と規制の判断は解除する */
export function applyDraftReplacement(current: PlanDocRecord, input: DraftReplaceInput, userId: string): DraftReplaceOutcome {
  if (current.status && current.status !== 'DRAFT') return { status: 'NOT_READY' };
  if (current.startInfo != null) return { status: 'NOT_READY' };
  if (current.version !== input.expectedVersion) return { status: 'CONFLICT' };
  if (Object.keys(input.aiDraft).length === 0) return { status: 'INVALID' };
  const subset = Object.entries(input.userEdits).every(
    ([k, v]) => Object.prototype.hasOwnProperty.call(current.userEdits, k) && canonical(current.userEdits[k]) === canonical(v)
  );
  if (!subset) return { status: 'INVALID' };
  return {
    status: 'REPLACED',
    record: {
      ...current,
      version: current.version + 1,
      updatedBy: userId,
      aiDraft: input.aiDraft,
      userEdits: input.userEdits,
      adoption: null,
      adopted: false,
      startInfo: null,
      regulatory: EMPTY_REGULATORY,
    },
  };
}

export function applyStoredPatch(current: PlanDocRecord, patch: PlanPatch, userId: string): StoredResult {
  const next: PlanDocRecord = { ...current, version: current.version + 1, updatedBy: userId };
  if (patch.userEdits !== undefined) next.userEdits = patch.userEdits;
  if (patch.aiDraft !== undefined) next.aiDraft = patch.aiDraft;
  if (patch.adoption !== undefined) next.adoption = patch.adoption;
  if (patch.regulatory !== undefined) next.regulatory = patch.regulatory;
  if (patch.startInfo !== undefined) next.startInfo = patch.startInfo;

  if (current.status === 'DRAFT' && patch.aiDraft !== undefined && canonical(patch.aiDraft) !== canonical(current.aiDraft)) {
    return { ok: false, reason: 'stage4_plan_documents: AI draft is immutable' };
  }
  if (canonical(next.userEdits) !== canonical(current.userEdits)) {
    next.adoption = null;
    next.startInfo = null;
    next.regulatory = EMPTY_REGULATORY;
  }
  next.adopted = next.adoption != null;
  if (next.startInfo != null && !next.adopted) {
    return { ok: false, reason: 'stage4_plan_documents_start_chk: a start needs an adoption' };
  }
  next.regulatory = next.regulatory ?? EMPTY_REGULATORY;
  return { ok: true, record: next };
}
