import { z } from 'zod';
import {
  AdjustmentCandidateSchema,
  AdjustmentProposalSchema,
  MAX_CANDIDATES,
  collectPlanUnits,
  departmentKeyOf,
  normalizeDialogue,
  projectIdOf,
  verifyCandidates,
} from '@/lib/cascade/stage3Adjustment';
import { DEPT_PROPOSAL_ITEM_NAMES } from '@/lib/cascade/stage3Candidates';

type AnyRecord = Record<string, unknown>;

export const MAX_DRAFTS = 20;
const MAX_SELECTIONS = 80;

const StableId = z.union([z.string().min(1).max(200), z.number().finite()]);

const DraftOkrSchema = z.object({
  objective: z.string().max(300),
  keyResults: z.array(z.string().max(300)).max(10),
});

const DraftDepartmentSchema = z.object({
  id: StableId.optional(),
  name: z.string().trim().min(1).max(200),
  projects: z
    .array(
      z.object({
        id: StableId.optional(),
        title: z.string().trim().min(1).max(300),
        description: z.string().max(2000).optional(),
        kpis: z.array(z.string().max(300)).max(20).optional(),
        reason: z.string().max(2000).optional(),
        hypothesis: z.string().max(2000).optional(),
        sourceType: z.string().max(40).optional(),
        partnerDepartment: z.string().max(200).optional(),
        okrs: z.array(DraftOkrSchema).max(10).optional(),
      }),
    )
    .max(30),
});

export type DraftDepartment = z.infer<typeof DraftDepartmentSchema>;

export const CANDIDATE_PROJECT_ID = /^np-[0-9a-f]{8}$/;

/** 生成された新規候補プロジェクト。採用されるまで正式データには入らない。 */
const NewProjectCandidateSchema = z.object({
  departmentKey: z.string().min(1).max(200),
  candidateId: z.string().regex(CANDIDATE_PROJECT_ID),
  project: z.record(z.string(), z.unknown()).refine((p) => JSON.stringify(p).length <= 20_000, 'project_too_large'),
  /** 利用者が手で追加した候補。再生成しても消さない。 */
  origin: z.enum(['ai', 'manual']).optional(),
  /** 利用者が内容を直した候補。再生成しても、直した内容を残す。 */
  userEdited: z.boolean().optional(),
});

export type NewProjectCandidate = z.infer<typeof NewProjectCandidateSchema>;

export const StrategyDraftSchema = z.object({
  draftId: z.string().regex(/^draft-[A-Za-z0-9_-]{1,40}$/),
  kind: z.enum(['initial', 'regenerated']),
  version: z.number().int().min(1).max(10_000),
  createdAt: z.string().max(40),
  departments: z.array(DraftDepartmentSchema).min(1).max(30),
  newProjects: z.array(NewProjectCandidateSchema).max(60).default([]),
  generatedDepartmentKeys: z.array(z.string().max(200)).max(30).optional(),
});

export type StrategyDraft = z.infer<typeof StrategyDraftSchema>;

const ProjectSelectionSchema = z.object({
  departmentKey: z.string().min(1).max(200),
  departmentName: z.string().trim().min(1).max(200),
  candidateId: z.string().regex(CANDIDATE_PROJECT_ID),
  title: z.string().trim().min(1).max(300),
  decision: z.enum(['pending', 'applied', 'discarded', 'deferred']),
});

export type ProjectSelection = z.infer<typeof ProjectSelectionSchema>;

const AnalysisSchema = z.object({
  draftId: z.string().regex(/^draft-[A-Za-z0-9_-]{1,40}$/).nullable(),
  draftVersion: z.number().int().min(1).nullable(),
  createdAt: z.string().max(40),
  candidates: z.array(AdjustmentCandidateSchema).max(8),
  rejectedCandidates: z.number().int().min(0).max(1000),
  rejectedReferences: z.number().int().min(0).max(1000),
});

export const SELECTION_DECISIONS = ['pending', 'applied', 'discarded', 'deferred'] as const;
export const CANDIDATE_DECISIONS = ['adopted', 'deferred', 'rejected'] as const;

const SelectionSchema = z.object({
  departmentKey: z.string().min(1).max(200),
  departmentName: z.string().trim().min(1).max(200),
  item: z.enum(DEPT_PROPOSAL_ITEM_NAMES as [string, ...string[]]),
  proposed: z.record(z.string(), z.unknown()),
  base: z.record(z.string(), z.unknown()),
  decision: z.enum(SELECTION_DECISIONS),
});

export type Selection = z.infer<typeof SelectionSchema>;

/** 既存プロジェクトの、文章の項目。KPI・OKR・IDは含めない（既存の経路以外では変えない）。 */
export const PROJECT_TEXT_FIELDS = ['title', 'reason', 'hypothesis', 'description'] as const;
export type ProjectTextFields = { title: string; reason: string | null; hypothesis: string | null; description: string | null };

const ProjectTextFieldsSchema = z.object({
  title: z.string().trim().min(1).max(300),
  reason: z.string().max(2000).nullable(),
  hypothesis: z.string().max(2000).nullable(),
  description: z.string().max(2000).nullable(),
});

const MAX_PROJECT_EDITS = 60;

/** 既存プロジェクトの編集。fields は作業版の内容、base は編集時点の正式データ（確定時に照合する）。 */
const ProjectEditSchema = z.object({
  departmentKey: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  fields: ProjectTextFieldsSchema,
  base: ProjectTextFieldsSchema,
});

export type ProjectEdit = z.infer<typeof ProjectEditSchema>;

/** 既存プロジェクトの「計画から外す」（作業版上の削除予定）。確定するまで正式データは変えない。 */
const ProjectRemovalSchema = z.object({
  departmentKey: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  base: z.object({ title: z.string().trim().min(1).max(300) }),
});

export type ProjectRemoval = z.infer<typeof ProjectRemovalSchema>;

export const PROJECT_PROPOSAL_DECISIONS = ['pending', 'adopted', 'rejected'] as const;

const ProjectChangeFieldsSchema = z.object({
  title: z.string().trim().min(1).max(300),
  reason: z.string().max(2000).nullable(),
  hypothesis: z.string().max(2000).nullable(),
  description: z.string().max(2000).nullable(),
  kpis: z.array(z.string().trim().min(1).max(300)).max(10),
});

/** 調整後の再生成が出した計画・KPIの変更案。採用されるまで正式データは変えない（確定時に base と照合する）。 */
const ProjectProposalSchema = z.object({
  departmentKey: z.string().min(1).max(200),
  departmentName: z.string().trim().min(1).max(200),
  projectId: z.string().min(1).max(200),
  projectTitle: z.string().trim().min(1).max(300),
  reason: z.string().trim().min(1).max(600),
  base: ProjectChangeFieldsSchema,
  proposed: ProjectChangeFieldsSchema,
  decision: z.enum(PROJECT_PROPOSAL_DECISIONS),
});

export type ProjectProposal = z.infer<typeof ProjectProposalSchema>;

export const WorkspaceStateSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['draft', 'confirmed']),
  drafts: z.array(StrategyDraftSchema).max(MAX_DRAFTS),
  analysis: AnalysisSchema.nullable(),
  candidateDecisions: z.record(z.string().regex(/^adj-\d{1,2}$/), z.enum(CANDIDATE_DECISIONS)).default({}),
  adjustmentProposals: z.array(AdjustmentProposalSchema).max(8).default([]),
  dialogue: z
    .array(
      z.object({
        candidateId: z.string().regex(/^adj-\d{1,2}$/),
        topic: z.string().trim().min(1).max(200),
        result: z.string().trim().min(1).max(1000),
      }),
    )
    .max(80),
  selections: z.array(SelectionSchema).max(MAX_SELECTIONS),
  projectSelections: z.array(ProjectSelectionSchema).max(60).default([]),
  projectEdits: z.array(ProjectEditSchema).max(MAX_PROJECT_EDITS).default([]),
  projectRemovals: z.array(ProjectRemovalSchema).max(60).default([]),
  projectProposals: z.array(ProjectProposalSchema).max(40).default([]),
  verification: z
    .object({
      basisKey: z.string().min(1).max(40),
      createdAt: z.string().max(40),
      changeCount: z.number().int().min(0).max(100_000),
      rejectedCount: z.number().int().min(0).max(1000),
      candidates: z.array(AdjustmentCandidateSchema).max(MAX_CANDIDATES),
    })
    .nullable()
    .default(null),
  confirmed: z.object({ confirmedAt: z.string().max(40), appliedCount: z.number().int().min(0) }).nullable(),
});

export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;
export type Verification = NonNullable<WorkspaceState['verification']>;

/**
 * 確定前の計画の内容を表すキー。検証結果がこのキーと一致する間だけ、検証結果は有効とみなす。
 * 採用・編集・計画から外す等で計画の内容が変われば、キーも変わる。
 */
export function planBasisKey(state: WorkspaceState): string {
  const basis = {
    selections: state.selections
      .filter((s) => s.decision === 'applied')
      .map((s) => [s.departmentKey, s.item, s.proposed]),
    projectSelections: state.projectSelections.filter((p) => p.decision === 'applied').map((p) => p.candidateId),
    projectEdits: state.projectEdits.map((e) => [e.departmentKey, e.projectId, e.fields]),
    projectRemovals: state.projectRemovals.map((r) => [r.departmentKey, r.projectId]),
    projectProposals: state.projectProposals
      .filter((p) => p.decision === 'adopted')
      .map((p) => [p.departmentKey, p.projectId, p.proposed]),
  };
  return hash53(canonicalJson(basis));
}

/**
 * 検証結果を、ある作業版に書いてよいかを決める。計画の内容が検証時と同じ場合だけ、その検証結果は有効。
 * 計画が変わっていれば null（古い検証結果で最新の編集を上書きしない）。
 */
export function verificationFor(state: WorkspaceState, verification: Verification | null): Verification | null {
  if (!verification) return null;
  return planBasisKey(state) === verification.basisKey ? verification : null;
}

/** 作業版の内容の署名。検証結果だけを除いて比べ、検証で版が進んだだけかを判定する。 */
export function workspaceSignature(state: WorkspaceState): string {
  return hash53(canonicalJson({ ...state, verification: null }));
}

export function responseStillApplies(
  requested: { version: number | null; state: WorkspaceState },
  latest: { version: number; state: WorkspaceState },
): boolean {
  if (requested.version !== null && requested.version === latest.version) return true;
  return workspaceSignature(requested.state) === workspaceSignature(latest.state);
}

/** キーの並び順と未定義の値に依存しない直列化（保存の往復で並びが変わっても同じ値にする） */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** 文字列の短いハッシュ（同じ入力は常に同じ値。クライアントとサーバーで同じ結果になる） */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function emptyWorkspaceState(): WorkspaceState {
  return {
    schemaVersion: 1,
    status: 'draft',
    drafts: [],
    analysis: null,
    candidateDecisions: {},
    adjustmentProposals: [],
    dialogue: [],
    selections: [],
    projectSelections: [],
    projectEdits: [],
    projectRemovals: [],
    projectProposals: [],
    verification: null,
    confirmed: null,
  };
}

/** 最新の草案（版が最も大きいもの）。 */
export function latestDraft(state: WorkspaceState): StrategyDraft | null {
  return state.drafts.reduce<StrategyDraft | null>((best, d) => (!best || d.version > best.version ? d : best), null);
}

export type WorkspaceFailure =
  | 'invalid_state'
  | 'draft_department_unknown'
  | 'draft_project_duplicated'
  | 'draft_id_duplicated'
  | 'analysis_draft_unknown'
  | 'analysis_candidates_invalid'
  | 'dialogue_invalid'
  | 'decision_unknown_candidate'
  | 'selection_department_unknown'
  | 'confirmed_without_record'
  | 'confirmed_with_pending'
  | 'confirmed_with_undecided_candidate'
  | 'project_unknown'
  | 'project_edit_duplicated'
  | 'project_removal_duplicated'
  | 'project_proposal_duplicated'
  | 'project_edit_conflict';

/** 正式データのプロジェクトIDを文字列にそろえる（無い・空なら null） */
export function stableIdText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * 保存しようとする作業状態を、保存済みの正式データ（departments）と照合する。
 * 草案は既存の部門だけを指せる。候補の部門・計画は、分析に使った版（草案または正式データ）に実在する必要がある。
 */
export function verifyWorkspaceState(
  raw: unknown,
  officialDepartments: unknown,
): { ok: true; state: WorkspaceState } | { ok: false; error: WorkspaceFailure } {
  const parsed = WorkspaceStateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid_state' };
  const state = parsed.data;

  const officialDeptKeys = new Set(
    (Array.isArray(officialDepartments) ? officialDepartments : [])
      .filter((d): d is AnyRecord => !!d && typeof d === 'object')
      .map((d) => departmentKeyOf(d)),
  );

  const draftIds = new Set<string>();
  for (const draft of state.drafts) {
    if (draftIds.has(draft.draftId)) return { ok: false, error: 'draft_id_duplicated' };
    draftIds.add(draft.draftId);
    const keys = new Set<string>();
    for (const dept of draft.departments) {
      const key = departmentKeyOf(dept as AnyRecord);
      if (!officialDeptKeys.has(key) || keys.has(key)) return { ok: false, error: 'draft_department_unknown' };
      keys.add(key);
      const projectKeys = new Set<string>();
      for (const p of dept.projects) {
        const pk = projectIdOf(p as AnyRecord);
        if (projectKeys.has(pk)) return { ok: false, error: 'draft_project_duplicated' };
        projectKeys.add(pk);
      }
    }
  }

  const newProjectIds = new Map<string, string>();
  for (const draft of state.drafts) {
    const ids = new Set<string>();
    for (const np of draft.newProjects) {
      if (!officialDeptKeys.has(np.departmentKey) || ids.has(np.candidateId)) {
        return { ok: false, error: 'draft_department_unknown' };
      }
      ids.add(np.candidateId);
      newProjectIds.set(np.candidateId, np.departmentKey);
    }
  }
  for (const ps of state.projectSelections) {
    if (newProjectIds.get(ps.candidateId) !== ps.departmentKey) return { ok: false, error: 'selection_department_unknown' };
  }

  const candidateIds = new Set<string>();
  if (state.analysis) {
    const a = state.analysis;
    let units;
    if (a.draftId) {
      const draft = state.drafts.find((d) => d.draftId === a.draftId);
      if (!draft || a.draftVersion !== draft.version) return { ok: false, error: 'analysis_draft_unknown' };
      units = collectPlanUnits(draft.departments);
    } else {
      units = collectPlanUnits(officialDepartments);
    }
    const candidates = verifyCandidates(a.candidates, units);
    if (a.candidates.length > 0 && !candidates) return { ok: false, error: 'analysis_candidates_invalid' };
    for (const c of a.candidates) candidateIds.add(c.id);
    if (candidates && state.dialogue.length > 0) {
      if ('error' in normalizeDialogue(state.dialogue, candidates)) return { ok: false, error: 'dialogue_invalid' };
    } else if (!candidates && state.dialogue.length > 0) {
      return { ok: false, error: 'dialogue_invalid' };
    }
  } else if (state.dialogue.length > 0) {
    return { ok: false, error: 'dialogue_invalid' };
  }

  for (const id of Object.keys(state.candidateDecisions)) {
    if (!candidateIds.has(id)) return { ok: false, error: 'decision_unknown_candidate' };
  }

  for (const p of state.adjustmentProposals) {
    if (!candidateIds.has(p.candidateId)) return { ok: false, error: 'decision_unknown_candidate' };
    if (p.changes.some((ch) => !officialDeptKeys.has(ch.departmentKey))) {
      return { ok: false, error: 'selection_department_unknown' };
    }
  }

  for (const s of state.selections) {
    if (!officialDeptKeys.has(s.departmentKey)) return { ok: false, error: 'selection_department_unknown' };
  }

  const officialProjects = new Map<string, Set<string>>();
  for (const d of Array.isArray(officialDepartments) ? officialDepartments : []) {
    if (!d || typeof d !== 'object') continue;
    const dept = d as AnyRecord;
    const list = Array.isArray(dept.projects) ? (dept.projects as AnyRecord[]) : [];
    officialProjects.set(departmentKeyOf(dept), new Set(list.map((p) => stableIdText(p?.id)).filter((id): id is string => id !== null)));
  }
  const editedKeys = new Set<string>();
  for (const e of state.projectEdits) {
    const ref = `${e.departmentKey} ${e.projectId}`;
    if (!officialProjects.get(e.departmentKey)?.has(e.projectId)) return { ok: false, error: 'project_unknown' };
    if (editedKeys.has(ref)) return { ok: false, error: 'project_edit_duplicated' };
    editedKeys.add(ref);
  }
  const removedKeys = new Set<string>();
  for (const r of state.projectRemovals) {
    const ref = `${r.departmentKey} ${r.projectId}`;
    if (!officialProjects.get(r.departmentKey)?.has(r.projectId)) return { ok: false, error: 'project_unknown' };
    if (removedKeys.has(ref)) return { ok: false, error: 'project_removal_duplicated' };
    removedKeys.add(ref);
  }

  const proposalRefs = new Set<string>();
  for (const p of state.projectProposals) {
    const ref = `${p.departmentKey} ${p.projectId}`;
    if (!officialProjects.get(p.departmentKey)?.has(p.projectId)) return { ok: false, error: 'project_unknown' };
    if (proposalRefs.has(ref)) return { ok: false, error: 'project_proposal_duplicated' };
    proposalRefs.add(ref);
    if (p.decision === 'adopted' && (editedKeys.has(ref) || removedKeys.has(ref))) {
      return { ok: false, error: 'project_edit_conflict' };
    }
  }

  if (state.status === 'confirmed') {
    if (!state.confirmed) return { ok: false, error: 'confirmed_without_record' };
    if (state.selections.some((s) => s.decision === 'pending')) return { ok: false, error: 'confirmed_with_pending' };
    if (state.projectSelections.some((s) => s.decision === 'pending')) return { ok: false, error: 'confirmed_with_pending' };
    if ([...candidateIds].some((id) => !state.candidateDecisions[id])) {
      return { ok: false, error: 'confirmed_with_undecided_candidate' };
    }
  }

  return { ok: true, state };
}

/** 分析・再生成に使う部門データ。草案を指定された場合は、その草案の版だけを使う。 */
export function sourceDepartments(
  state: WorkspaceState,
  draftRef: { draftId: string; version: number } | null,
  officialDepartments: unknown,
): { ok: true; departments: unknown[] } | { ok: false; error: 'draft_version_mismatch' } {
  if (!draftRef) return { ok: true, departments: Array.isArray(officialDepartments) ? officialDepartments : [] };
  const draft = state.drafts.find((d) => d.draftId === draftRef.draftId);
  if (!draft || draft.version !== draftRef.version) return { ok: false, error: 'draft_version_mismatch' };
  return { ok: true, departments: draft.departments };
}
