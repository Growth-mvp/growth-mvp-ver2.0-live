import { lifecycleActionRefusal, type LifecycleAction } from '@/lib/cascade/projectLifecycle';
import { AuthFetchError, authFetchJson } from '@/utils/authFetch';
import { useStrategyStore } from '@/store/strategyStore';
import { findProjectPositionById } from './financeBridgeStore';

export type LifecycleWriteResult = { ok: true } | { ok: false; message: string };

type StoreView = {
  pendingCompanyId?: unknown;
  companyId?: string | null;
  strategyId?: string | null;
  departments?: unknown[];
  revision?: number;
  syncPartialSave: (result: { departments: unknown[]; revision: number; preserveUnsaved?: boolean }) => boolean;
};
const storeNow = () => useStrategyStore.getState() as unknown as StoreView;

type LifecycleResponse = { ok: true; revision: number; departments: unknown[] };

const CHANGED = '会社または戦略が切り替わったため、保存されませんでした。画面を読み込み直してから、もう一度お試しください。';
const NOT_FOUND = '対象の施策を特定できないため、保存しませんでした。一覧を読み直してください。';
const DEFAULT = '計画の変更を保存できませんでした。もう一度お試しください。';
const SAVED_RELOAD = '変更は保存されましたが、画面に反映できませんでした。画面を読み直して、結果を確認してください。';

type AnyRecord = Record<string, unknown>;

/* サーバーの書き込みは、対象の施策の「lifecycle」だけを変える。画面の未保存の編集は残し、その施策の状態だけを写す。
 * 版（revision）の条件で書かれているため、書き込み前の保存済みの内容は画面の内容と同じ。 */
export function mergeLifecycleIntoDepartments(local: unknown[], server: unknown[], projectId: string): unknown[] | null {
  const at = findProjectPositionById(local, projectId);
  const remote = findProjectPositionById(server, projectId);
  if (!at || !remote) return null;
  const dept = local[at.dIdx] as AnyRecord;
  const projects = [...(dept.projects as unknown[])];
  const project = { ...(at.project as unknown as AnyRecord) };
  const lifecycle = (remote.project as unknown as AnyRecord).lifecycle;
  if (lifecycle === undefined) delete project.lifecycle;
  else project.lifecycle = lifecycle;
  projects[at.pIdx] = project;
  const next = [...local];
  next[at.dIdx] = { ...dept, projects };
  return next;
}

const MESSAGE: Record<string, string> = {
  insufficient_role: '計画から外す・中止は、管理者と管理職だけが行えます。',
  revision_changed: '他の人が先に変更しました。画面を読み直してから、もう一度お試しください。',
  forbidden: CHANGED,
  strategy_mismatch: CHANGED,
  project_missing: NOT_FOUND,
  project_ambiguous: NOT_FOUND,
  department_ambiguous: NOT_FOUND,
  already_out: 'この施策は、すでに計画から外れています。一覧を読み直してください。',
  approved: '承認済みの計画は、計画から外せません。承認を解除してから操作してください。',
  executing: '採用済み・実行中の計画は、計画から外せません。「プロジェクトを中止する」を使ってください。',
  not_started: '実行を開始していない計画は、中止できません。計画から外してください。',
};

const REFUSAL_KEY = {
  ALREADY_OUT: 'already_out',
  APPROVED: 'approved',
  EXECUTING: 'executing',
  NOT_STARTED: 'not_started',
} as const;

function errorCodeOf(e: unknown): string | null {
  if (!(e instanceof AuthFetchError) || !e.bodyText) return null;
  try {
    const parsed = JSON.parse(e.bodyText) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}

/**
 * 施策を「計画から外す（EXCLUDE）」または「中止する（STOP）」。書き込みは サーバーの経路（/api/stage4/project-lifecycle）で行い、
 * 管理者・管理職の確認、会社・戦略・案件の照合、版（revision）の確認、計画の採用・開始の読み直しを、サーバーで行う。
 * 画面側の判定は先に分かりやすく伝えるためだけに使う。成功したら、対象の施策の状態と保存後の版を画面に反映する（未保存の編集は残す）。物理削除はしない。
 */
export async function writeProjectLifecycleToProject(args: {
  companyId: string;
  strategyId: string;
  projectId: string;
  action: LifecycleAction;
  facts: { executing: boolean; started: boolean };
}): Promise<LifecycleWriteResult> {
  const before = storeNow();
  if (before.pendingCompanyId || before.companyId !== args.companyId || before.strategyId !== args.strategyId) {
    return { ok: false, message: CHANGED };
  }
  const found = findProjectPositionById(before.departments, args.projectId);
  if (!found) return { ok: false, message: NOT_FOUND };
  const refusal = lifecycleActionRefusal(found.project, args.action, args.facts);
  if (refusal) return { ok: false, message: MESSAGE[REFUSAL_KEY[refusal]] };
  if (typeof before.revision !== 'number') return { ok: false, message: '画面を読み直してから、もう一度お試しください。' };

  try {
    const res = await authFetchJson<LifecycleResponse>('/api/stage4/project-lifecycle', {
      method: 'POST',
      json: {
        companyId: args.companyId,
        strategyId: args.strategyId,
        projectId: args.projectId,
        action: args.action,
        expectedRevision: before.revision,
      },
    });
    const now = storeNow();
    if (now.companyId !== args.companyId || now.strategyId !== args.strategyId) return { ok: false, message: CHANGED };
    const merged = mergeLifecycleIntoDepartments(now.departments ?? [], res.departments, args.projectId);
    if (!merged || !now.syncPartialSave({ departments: merged, revision: res.revision, preserveUnsaved: true })) {
      return { ok: false, message: SAVED_RELOAD };
    }
    return { ok: true };
  } catch (e) {
    const code = errorCodeOf(e);
    return { ok: false, message: (code && MESSAGE[code]) || DEFAULT };
  }
}
