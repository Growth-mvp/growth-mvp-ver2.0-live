/* ブラウザ側の保存先（API経由）と、プロジェクトの番号を付ける手順。画面はここを使う。
 * 保存先は「開発用のブラウザ内」と「API（永続化）」を切り替えられる。番号の付与は、戦略の版番号を見てから行う。 */
import type { UserEdits } from './mergeUserEdits';
import type { LoadOutcome, PlanDocKey, PlanDocRecord, PlanDocumentStore, WriteOutcome } from './planDocumentStore';
import { SAVE_FAILED } from './planService';

export type PlanStoreKind = 'local' | 'remote';

/* 保存先の選び方。URLの ?planStore=remote が最優先。指定が無ければ環境変数、それも無ければブラウザ内 */
export function planStoreKindFrom(search: string, envValue?: string): PlanStoreKind {
  const q = new URLSearchParams(search).get('planStore');
  if (q === 'remote' || q === 'local') return q;
  return envValue === 'remote' ? 'remote' : 'local';
}

export type ApiOptions = {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchFn?: typeof fetch;
};

type ApiResponse = { status: number; json: Record<string, unknown> };

async function request(o: ApiOptions, method: string, path: string, body?: unknown): Promise<ApiResponse | null> {
  const token = await o.getToken();
  if (!token) return { status: 401, json: {} };
  try {
    const res = await (o.fetchFn ?? fetch)(`${o.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  } catch {
    return null;
  }
}

const LOAD_FAILED = '読み込めませんでした。もう一度開いてください。';

function writeOutcome(r: ApiResponse | null, okStatus: number): WriteOutcome {
  if (!r) return { status: 'FAILED', message: SAVE_FAILED };
  if (r.status === okStatus && r.json.status === 'SAVED') {
    return { status: 'SAVED', record: r.json.record as Extract<WriteOutcome, { status: 'SAVED' }>['record'] };
  }
  if (r.status === 409 && r.json.status === 'CONFLICT') {
    return { status: 'CONFLICT', current: r.json.current as Extract<WriteOutcome, { status: 'CONFLICT' }>['current'] };
  }
  if (r.status === 404) return { status: 'NOT_FOUND' };
  if (r.status === 403) return { status: 'DENIED' };
  return { status: 'FAILED', message: SAVE_FAILED };
}

/* 草案の保存先（API）。権限と版番号の確認はサーバーで行い、ここではその結果を画面の型に変える */
export function createRemotePlanStore(o: ApiOptions): PlanDocumentStore {
  return {
    async load(_actor, key: PlanDocKey): Promise<LoadOutcome> {
      const qs = new URLSearchParams({ companyId: key.companyId, strategyId: key.strategyId, projectId: key.projectId });
      const r = await request(o, 'GET', `/api/stage4/plan-documents?${qs.toString()}`);
      if (!r) return { status: 'FAILED', message: LOAD_FAILED };
      if (r.status === 200 && r.json.status === 'FOUND') {
        return { status: 'FOUND', record: r.json.record as Extract<LoadOutcome, { status: 'FOUND' }>['record'] };
      }
      if (r.status === 200 && r.json.status === 'NONE') return { status: 'NONE' };
      if (r.status === 403) return { status: 'DENIED' };
      if (r.status === 503 && r.json.status === 'UNAVAILABLE') {
        return { status: 'UNAVAILABLE', message: String(r.json.message ?? LOAD_FAILED) };
      }
      if (r.status === 503) return { status: 'DISABLED' };
      return { status: 'FAILED', message: LOAD_FAILED };
    },

    /* 草案は生成の経路だけが作る（クライアントからは作らない） */
    async create(): Promise<WriteOutcome> {
      return { status: 'DENIED' };
    },

    async update(_actor, key, expectedVersion, input): Promise<WriteOutcome> {
      const r = await request(o, 'PUT', '/api/stage4/plan-documents', {
        ...key,
        expectedVersion,
        userEdits: input.userEdits,
      });
      return writeOutcome(r, 200);
    },
  };
}

export type ProjectView = {
  departmentIndex: number;
  projectIndex: number;
  title: string;
  projectId: string | null;
};

export type IdentityArgs = {
  companyId: string;
  strategyId: string;
  departmentIndex: number;
  projectIndex: number;
  expectedTitle: string;
  expectedRevision: number;
  newId: string;
};

/* 番号の付与の窓口。読み取り（版番号と各プロジェクトの番号）と、付与（版番号が一致した時だけ）を行う */
export type IdentityApi = {
  readStrategy(companyId: string, strategyId: string): Promise<
    | { status: 'FOUND'; revision: number; projects: ProjectView[] }
    | { status: 'DENIED' | 'NOT_FOUND' | 'FAILED' }
  >;
  assign(args: IdentityArgs): Promise<{ status: string; projectId?: string; alreadyAssigned?: boolean; revision?: number }>;
};

export function createRemoteIdentityApi(o: ApiOptions): IdentityApi {
  return {
    async readStrategy(companyId, strategyId) {
      const qs = new URLSearchParams({ companyId, strategyId });
      const r = await request(o, 'GET', `/api/stage4/project-identity?${qs.toString()}`);
      if (!r) return { status: 'FAILED' };
      if (r.status === 200 && r.json.status === 'FOUND') {
        return {
          status: 'FOUND',
          revision: Number(r.json.revision),
          projects: r.json.projects as ProjectView[],
        };
      }
      if (r.status === 403) return { status: 'DENIED' };
      if (r.status === 404) return { status: 'NOT_FOUND' };
      return { status: 'FAILED' };
    },
    async assign(args) {
      const r = await request(o, 'POST', '/api/stage4/project-identity', args);
      if (!r) return { status: 'FAILED' };
      const body = r.json as { status?: string; projectId?: string; alreadyAssigned?: boolean; revision?: number };
      if (r.status === 200 && body.status === 'ASSIGNED') {
        return { status: 'ASSIGNED', projectId: body.projectId, alreadyAssigned: body.alreadyAssigned, revision: body.revision };
      }
      if (r.status === 409) return { status: String(body.status ?? 'CONFLICT') };
      if (r.status === 403) return { status: 'FORBIDDEN' };
      if (r.status === 404) return { status: 'NOT_FOUND' };
      return { status: 'FAILED' };
    },
  };
}

export const ID_MESSAGES = {
  notFound: 'プロジェクトを特定できないため、保存できませんでした。一覧を読み直してください。',
  titleChanged: 'このプロジェクトの名称が変わっているため、番号を付けられませんでした。一覧を読み直してください。',
  revisionChanged: '他の人がSTAGE3を同時に変更しました。一覧を読み直してから、もう一度保存してください。',
  forbidden: 'この計画を保存する権限がありません。',
  failed: 'プロジェクトの番号を保存できなかったため、計画は保存していません。もう一度保存してください。',
} as const;

export type EnsureIdResult = { ok: true; projectId: string; alreadyAssigned: boolean } | { ok: false; message: string };

/* 計画書を保存する前に、プロジェクトの番号を確定させる。
 * 既に番号があれば、それを使う（書き込まない）。無ければ、戦略の版番号を見てから、その版番号のときだけ付与する。
 * 番号の付与が完了するまで、計画書は保存しない（呼び出し側の約束）。 */
export async function ensureStableProjectId(
  api: IdentityApi,
  args: Omit<IdentityArgs, 'expectedRevision'>
): Promise<EnsureIdResult> {
  const view = await api.readStrategy(args.companyId, args.strategyId);
  if (view.status === 'DENIED') return { ok: false, message: ID_MESSAGES.forbidden };
  if (view.status !== 'FOUND') return { ok: false, message: view.status === 'NOT_FOUND' ? ID_MESSAGES.notFound : ID_MESSAGES.failed };

  const target = view.projects.find((p) => p.departmentIndex === args.departmentIndex && p.projectIndex === args.projectIndex);
  if (!target) return { ok: false, message: ID_MESSAGES.notFound };
  if (target.title.trim() !== args.expectedTitle.trim()) return { ok: false, message: ID_MESSAGES.titleChanged };
  if (target.projectId) return { ok: true, projectId: target.projectId, alreadyAssigned: true };

  const out = await api.assign({ ...args, expectedRevision: view.revision });
  if (out.status === 'ASSIGNED' && out.projectId) {
    return { ok: true, projectId: out.projectId, alreadyAssigned: out.alreadyAssigned === true };
  }
  if (out.status === 'REVISION_CHANGED') return { ok: false, message: ID_MESSAGES.revisionChanged };
  if (out.status === 'TITLE_CHANGED') return { ok: false, message: ID_MESSAGES.titleChanged };
  if (out.status === 'FORBIDDEN') return { ok: false, message: ID_MESSAGES.forbidden };
  if (out.status === 'ID_IN_USE' || out.status === 'NOT_FOUND') return { ok: false, message: ID_MESSAGES.notFound };
  return { ok: false, message: ID_MESSAGES.failed };
}

/* 番号だけを入れ替えた部門の配列を作る（元の配列は変えない）。画面の状態を保存せずに合わせるために使う */
export function withProjectId(departments: unknown, departmentIndex: number, projectIndex: number, projectId: string): unknown[] {
  const list = Array.isArray(departments) ? (departments as Array<Record<string, unknown>>) : [];
  return list.map((d, di) => {
    if (di !== departmentIndex) return d;
    const projects = Array.isArray(d.projects) ? (d.projects as Array<Record<string, unknown>>) : [];
    return { ...d, projects: projects.map((p, pi) => (pi === projectIndex ? { ...p, id: projectId } : p)) };
  });
}

export type { UserEdits };

export type GenerateResult =
  | { status: 'CREATED' | 'EXISTS'; record: PlanDocRecord }
  | { status: 'IN_PROGRESS' | 'DISABLED' | 'NOT_FOUND' | 'DENIED' | 'FAILED' }
  | { status: 'UNAVAILABLE'; message: string }
  | { status: 'INVALID'; messages: string[] }
  | { status: 'MODEL_FAILED'; message: string };

export type ListResult = { status: 'FOUND'; records: PlanDocRecord[] } | { status: 'DISABLED' | 'DENIED' | 'FAILED' };

export type PreviewResult =
  | { status: 'PREVIEW'; draft: Record<string, unknown> }
  | { status: 'DISABLED' | 'NOT_FOUND' | 'DENIED' | 'FAILED' }
  | { status: 'INVALID'; messages: string[] }
  | { status: 'MODEL_FAILED'; message: string };

export type TransitionResult =
  | { status: 'OK'; record: PlanDocRecord }
  | { status: 'CONFLICT'; current: PlanDocRecord }
  | { status: 'BLOCKED'; blockers: string[] }
  | { status: 'INVALID'; message: string }
  | { status: 'NOT_FOUND' | 'NOT_READY' | 'DENIED' | 'FAILED' };

export type TransitionAction = 'ADOPT' | 'UNADOPT' | 'RECORD_REGULATORY' | 'START' | 'UNSTART';

/* 生成と採用・開始の操作の窓口。結果は、サーバーが決めたものをそのまま画面の型にする */
export function createRemotePlanOps(o: ApiOptions) {
  return {
    async generate(key: PlanDocKey): Promise<GenerateResult> {
      const r = await request(o, 'POST', '/api/stage4/plan-documents/generate', key);
      if (!r) return { status: 'FAILED' };
      const body = r.json as Record<string, unknown>;
      if ((r.status === 201 || r.status === 200) && (body.status === 'CREATED' || body.status === 'EXISTS')) {
        return { status: body.status as 'CREATED' | 'EXISTS', record: body.record as PlanDocRecord };
      }
      if (r.status === 409) return { status: 'IN_PROGRESS' };
      if (r.status === 422) return { status: 'INVALID', messages: (body.messages as string[]) ?? [] };
      if (r.status === 502) return { status: 'MODEL_FAILED', message: String(body.message ?? '') };
      if (r.status === 503 && body.status === 'UNAVAILABLE') return { status: 'UNAVAILABLE', message: String(body.message ?? '') };
      if (r.status === 503) return { status: 'DISABLED' };
      if (r.status === 404) return { status: 'NOT_FOUND' };
      if (r.status === 403) return { status: 'DENIED' };
      return { status: 'FAILED' };
    },

    /* 会社・戦略の計画書の一覧（読み取りのみ） */
    async list(companyId: string, strategyId: string): Promise<ListResult> {
      const qs = `companyId=${encodeURIComponent(companyId)}&strategyId=${encodeURIComponent(strategyId)}`;
      const r = await request(o, 'GET', `/api/stage4/plan-documents/list?${qs}`);
      if (!r) return { status: 'FAILED' };
      const body = r.json as Record<string, unknown>;
      if (r.status === 200 && body.status === 'FOUND') return { status: 'FOUND', records: (body.records as PlanDocRecord[]) ?? [] };
      if (r.status === 503) return { status: 'DISABLED' };
      if (r.status === 403) return { status: 'DENIED' };
      return { status: 'FAILED' };
    },

    /* 再生成のプレビュー。保存はされない。結果の案は、画面の中だけで比べる */
    async preview(key: PlanDocKey): Promise<PreviewResult> {
      const r = await request(o, 'POST', '/api/stage4/plan-documents/preview', key);
      if (!r) return { status: 'FAILED' };
      const body = r.json as Record<string, unknown>;
      if (r.status === 200 && body.status === 'PREVIEW') return { status: 'PREVIEW', draft: body.draft as Record<string, unknown> };
      if (r.status === 422) return { status: 'INVALID', messages: (body.messages as string[]) ?? [] };
      if (r.status === 502) return { status: 'MODEL_FAILED', message: String(body.message ?? '') };
      if (r.status === 503) return { status: 'DISABLED' };
      if (r.status === 404) return { status: 'NOT_FOUND' };
      if (r.status === 403) return { status: 'DENIED' };
      return { status: 'FAILED' };
    },

    async transition(key: PlanDocKey, expectedVersion: number, action: TransitionAction, regulatory?: unknown): Promise<TransitionResult> {
      const r = await request(o, 'POST', '/api/stage4/plan-documents/transition', { ...key, expectedVersion, action, regulatory });
      if (!r) return { status: 'FAILED' };
      const body = r.json as Record<string, unknown>;
      if (r.status === 200 && body.status === 'OK') return { status: 'OK', record: body.record as PlanDocRecord };
      if (r.status === 409 && body.status === 'CONFLICT') return { status: 'CONFLICT', current: body.current as PlanDocRecord };
      if (r.status === 422) return { status: 'BLOCKED', blockers: (body.blockers as string[]) ?? [] };
      if (r.status === 400) return { status: 'INVALID', message: String(body.message ?? '入力を確認してください') };
      if (r.status === 404) return { status: 'NOT_FOUND' };
      if (r.status === 409) return { status: 'NOT_READY' };
      if (r.status === 403) return { status: 'DENIED' };
      return { status: 'FAILED' };
    },
  };
}
