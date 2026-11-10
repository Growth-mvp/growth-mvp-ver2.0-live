/* STAGE5 の実施事項の進捗。実施事項は、実行開始時点のAI草案（変わらない）と開始日時から安定キーを作る。
 * 並び替え・利用者の修正・再保存で、記録が別の実施事項に移らない。KRとの紐づけは利用者が選んだものだけを保存する。 */

export const ACTION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DONE'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  NOT_STARTED: '未着手',
  IN_PROGRESS: '進行中',
  DONE: '完了',
};

export const RESULT_MAX = 500;

export type ActionProgressRecord = {
  status: ActionStatus;
  result: string;
  krIds: string[];
  updatedAt: string;
  updatedBy: string;
};

export type ActionProgressPatch = { status?: ActionStatus; result?: string; krIds?: string[] };

const canonical = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
};

/** 保存時の並び（JSONBの鍵順）に依存しない、AI草案の行動の指紋 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(canonical(v));
}

/* 32bit FNV-1a。同期的に決まる指紋（キーの衝突は、開始日時と順番も含めて判定する） */
export function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export type AiAction = { order: number; [k: string]: unknown };

export function aiActionsOf(aiDraft: unknown): AiAction[] {
  const actions = (aiDraft as { plan?: { section2?: { actions?: unknown } } } | null)?.plan?.section2?.actions;
  if (!Array.isArray(actions)) return [];
  return actions.filter((a): a is AiAction => !!a && typeof a === 'object' && typeof (a as AiAction).order === 'number');
}

/** 開始済みの計画の実施事項ごとのキー（順番 → キー） */
export function actionKeysFor(startedAt: string, aiDraft: unknown): Array<{ order: number; key: string }> {
  return aiActionsOf(aiDraft).map((a) => ({ order: a.order, key: `${startedAt}|${a.order}|${fnv1a32(canonicalJson(a))}` }));
}

const isStatus = (v: unknown): v is ActionStatus => typeof v === 'string' && (ACTION_STATUSES as readonly string[]).includes(v);

/** 保存された進捗のうち、形の正しいものだけを読む（不正な項目は捨てる） */
export function progressOf(project: unknown): Record<string, ActionProgressRecord> {
  const raw = (project as { executionProgress?: unknown } | null)?.executionProgress;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ActionProgressRecord> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Partial<ActionProgressRecord> | null;
    if (!r || typeof r !== 'object' || !isStatus(r.status)) continue;
    out[key] = {
      status: r.status,
      result: typeof r.result === 'string' ? r.result : '',
      krIds: Array.isArray(r.krIds) ? r.krIds.filter((x): x is string => typeof x === 'string') : [],
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
      updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy : '',
    };
  }
  return out;
}

export type ProgressCheck = { ok: true } | { ok: false; reason: string };

/** 書き込みの前の検証：実施事項が今の計画にあること、状態・成果の長さ、KRが同じ案件にあること */
export function checkProgressPatch(args: {
  actionKey: string;
  allowedKeys: string[];
  patch: ActionProgressPatch;
  okrIds: string[];
}): ProgressCheck {
  if (!args.allowedKeys.includes(args.actionKey)) return { ok: false, reason: '実施事項が、開始された計画に見つかりません' };
  if (args.patch.status !== undefined && !isStatus(args.patch.status)) return { ok: false, reason: '進捗の状態が不正です' };
  if (args.patch.result !== undefined && args.patch.result.length > RESULT_MAX) {
    return { ok: false, reason: `成果は${RESULT_MAX}字以内で入力してください` };
  }
  if (args.patch.krIds !== undefined) {
    const known = new Set(args.okrIds);
    if (args.patch.krIds.some((id) => !known.has(id))) return { ok: false, reason: '紐づけるKRが、同じプロジェクトにありません' };
  }
  return { ok: true };
}

/** 実施事項の記録を1件更新した後の、案件の項目（他の項目は変えない） */
export function withActionProgress(project: Record<string, unknown>, actionKey: string, record: ActionProgressRecord): Record<string, unknown> {
  return { ...project, executionProgress: { ...progressOf(project), [actionKey]: record } };
}

export function nextRecord(args: {
  existing: ActionProgressRecord | undefined;
  patch: ActionProgressPatch;
  nowIso: string;
  userId: string;
}): ActionProgressRecord {
  return {
    status: args.patch.status ?? args.existing?.status ?? 'NOT_STARTED',
    result: args.patch.result ?? args.existing?.result ?? '',
    krIds: args.patch.krIds ?? args.existing?.krIds ?? [],
    updatedAt: args.nowIso,
    updatedBy: args.userId,
  };
}

export function sameProgress(a: ActionProgressRecord | undefined, b: ActionProgressRecord): boolean {
  return !!a && a.status === b.status && a.result === b.result && a.krIds.join(',') === b.krIds.join(',');
}
