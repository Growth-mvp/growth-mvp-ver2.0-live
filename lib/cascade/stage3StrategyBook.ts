import { z } from 'zod';
import {
  AdjustmentCandidateSchema,
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

export const WorkspaceStateSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['draft', 'confirmed']),
  drafts: z.array(StrategyDraftSchema).max(MAX_DRAFTS),
  analysis: AnalysisSchema.nullable(),
  candidateDecisions: z.record(z.string().regex(/^adj-\d{1,2}$/), z.enum(CANDIDATE_DECISIONS)).default({}),
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
  confirmed: z.object({ confirmedAt: z.string().max(40), appliedCount: z.number().int().min(0) }).nullable(),
});

export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;

export function emptyWorkspaceState(): WorkspaceState {
  return {
    schemaVersion: 1,
    status: 'draft',
    drafts: [],
    analysis: null,
    candidateDecisions: {},
    dialogue: [],
    selections: [],
    projectSelections: [],
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
  | 'confirmed_with_undecided_candidate';

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

  for (const s of state.selections) {
    if (!officialDeptKeys.has(s.departmentKey)) return { ok: false, error: 'selection_department_unknown' };
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
