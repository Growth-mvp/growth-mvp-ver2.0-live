/* 保存の行（stage4_plan_documents・操作履歴）と、画面・サービスの記録の相互変換。
 * 本番のゲートウェイと検証用のゲートウェイで、同じ変換を使う。 */
import { EMPTY_REGULATORY, type RegulatoryRecord } from '../planView/model';
import type { PlanDocEvent, PlanDocRecord } from './planDocumentStore';
import type { PlanPatch } from './planService';

type Row = Record<string, unknown>;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isEmptyObject = (v: unknown): boolean => v == null || (typeof v === 'object' && Object.keys(v as object).length === 0);

export function rowToRecord(row: Row): PlanDocRecord {
  const adoption = row.adoption as Row | null | undefined;
  const startInfo = row.start_info as Row | null | undefined;
  return {
    key: { companyId: String(row.company_id), strategyId: String(row.strategy_id), projectId: String(row.project_id) },
    version: Number(row.version),
    aiDraft: (row.ai_draft ?? {}) as Record<string, unknown>,
    userEdits: (row.user_edits ?? {}) as PlanDocRecord['userEdits'],
    adopted: row.adopted === true,
    updatedAt: iso(row.updated_at),
    updatedBy: String(row.updated_by),
    status: String(row.status) as PlanDocRecord['status'],
    adoption: adoption
      ? {
          version: Number(adoption.version),
          byUserId: String(adoption.by),
          at: String(adoption.at),
          edits: (adoption.edits ?? {}) as PlanDocRecord['userEdits'],
        }
      : null,
    startInfo: startInfo ? { version: Number(startInfo.version), byUserId: String(startInfo.by), at: String(startInfo.at) } : null,
    regulatory: isEmptyObject(row.regulatory) ? EMPTY_REGULATORY : (row.regulatory as RegulatoryRecord),
  };
}

export function rowToEvent(row: Row): PlanDocEvent {
  return {
    action: String(row.action),
    version: Number(row.version),
    actorUserId: row.actor_user_id == null ? null : String(row.actor_user_id),
    at: iso(row.created_at),
    payload: (row.payload ?? {}) as Record<string, unknown>,
  };
}

/* 更新の内容を、表の列の値にする（省略した項目は含めない） */
export function patchColumns(patch: PlanPatch, userId: string): Record<string, unknown> {
  const cols: Record<string, unknown> = { updated_by: userId };
  if (patch.aiDraft !== undefined) cols.ai_draft = patch.aiDraft;
  if (patch.userEdits !== undefined) cols.user_edits = patch.userEdits;
  if (patch.adoption !== undefined) {
    cols.adopted = patch.adoption !== null;
    cols.adoption = patch.adoption === null
      ? null
      : { version: patch.adoption.version, by: patch.adoption.byUserId, at: patch.adoption.at, edits: patch.adoption.edits };
  }
  if (patch.regulatory !== undefined) cols.regulatory = patch.regulatory;
  if (patch.startInfo !== undefined) {
    cols.started = patch.startInfo !== null;
    cols.start_info = patch.startInfo === null
      ? null
      : { version: patch.startInfo.version, by: patch.startInfo.byUserId, at: patch.startInfo.at };
  }
  return cols;
}

export const JSONB_COLUMNS = new Set(['user_edits', 'adoption', 'regulatory', 'start_info', 'ai_draft']);
