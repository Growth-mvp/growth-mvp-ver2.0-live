import { z } from 'zod';
import {
  AdjustmentCandidateSchema,
  collectPlanUnits,
  departmentKeyOf,
  normalizeDialogue,
  verifyCandidates,
} from '@/lib/cascade/stage3Adjustment';
import { DEPT_PROPOSAL_ITEM_NAMES } from '@/lib/cascade/stage3Candidates';

type AnyRecord = Record<string, unknown>;

export const MAX_DRAFTS = 20;
const MAX_SELECTIONS = 80;

const DraftDepartmentSchema = z.object({
  id: z.union([z.string().min(1).max(200), z.number().finite()]),
  name: z.string().trim().min(1).max(200),
  projects: z
    .array(
      z.object({
        id: z.union([z.string().min(1).max(200), z.number().finite()]),
        title: z.string().trim().min(1).max(300),
        description: z.string().max(2000).optional(),
        kpis: z.array(z.string().max(300)).max(20).optional(),
      }),
    )
    .max(30),
});

export const StrategyDraftSchema = z.object({
  draftId: z.string().regex(/^draft-[A-Za-z0-9_-]{1,40}$/),
  kind: z.enum(['initial', 'regenerated']),
  version: z.number().int().min(1).max(10_000),
  createdAt: z.string().max(40),
  departments: z.array(DraftDepartmentSchema).min(1).max(30),
});

export type StrategyDraft = z.infer<typeof StrategyDraftSchema>;

const AnalysisSchema = z.object({
  draftId: z.string().regex(/^draft-[A-Za-z0-9_-]{1,40}$/).nullable(),
  draftVersion: z.number().int().min(1).nullable(),
  createdAt: z.string().max(40),
  candidates: z.array(AdjustmentCandidateSchema).max(8),
  rejectedCandidates: z.number().int().min(0).max(1000),
  rejectedReferences: z.number().int().min(0).max(1000),
});

const SelectionSchema = z.object({
  departmentKey: z.string().min(1).max(200),
  departmentName: z.string().trim().min(1).max(200),
  item: z.enum(DEPT_PROPOSAL_ITEM_NAMES as [string, ...string[]]),
  proposed: z.record(z.string(), z.unknown()),
  base: z.record(z.string(), z.unknown()),
  decision: z.enum(['pending', 'applied', 'discarded']),
});

export const WorkspaceStateSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['draft', 'confirmed']),
  drafts: z.array(StrategyDraftSchema).max(MAX_DRAFTS),
  analysis: AnalysisSchema.nullable(),
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
  confirmed: z.object({ confirmedAt: z.string().max(40), appliedCount: z.number().int().min(0) }).nullable(),
});

export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;

export function emptyWorkspaceState(): WorkspaceState {
  return {
    schemaVersion: 1,
    status: 'draft',
    drafts: [],
    analysis: null,
    dialogue: [],
    selections: [],
    confirmed: null,
  };
}

export type WorkspaceFailure =
  | 'invalid_state'
  | 'draft_department_unknown'
  | 'draft_project_duplicated'
  | 'draft_id_duplicated'
  | 'analysis_draft_unknown'
  | 'analysis_candidates_invalid'
  | 'dialogue_invalid'
  | 'selection_department_unknown'
  | 'confirmed_without_record'
  | 'confirmed_with_pending';

/**
 * 保存しようとする作業状態を、保存済みの正式データ（departments）と照合する。
 * 草案は既存の部門IDだけを指せる。候補の部門・計画は、分析に使った版（草案または正式データ）に実在する必要がある。
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
      if (!officialDeptKeys.has(key)) return { ok: false, error: 'draft_department_unknown' };
      if (keys.has(key)) return { ok: false, error: 'draft_department_unknown' };
      keys.add(key);
      const projectKeys = new Set<string>();
      for (const p of dept.projects) {
        const pk = String(p.id);
        if (projectKeys.has(pk)) return { ok: false, error: 'draft_project_duplicated' };
        projectKeys.add(pk);
      }
    }
  }

  if (state.analysis) {
    const a = state.analysis;
    let units;
    if (a.draftId) {
      const draft = state.drafts.find((d) => d.draftId === a.draftId);
      if (!draft) return { ok: false, error: 'analysis_draft_unknown' };
      if (a.draftVersion !== draft.version) return { ok: false, error: 'analysis_draft_unknown' };
      units = collectPlanUnits(draft.departments);
    } else {
      units = collectPlanUnits(officialDepartments);
    }
    const candidates = verifyCandidates(a.candidates, units);
    if (a.candidates.length > 0 && !candidates) return { ok: false, error: 'analysis_candidates_invalid' };
    if (candidates) {
      const dialogue = normalizeDialogue(state.dialogue, candidates);
      if (state.dialogue.length > 0 && 'error' in dialogue) return { ok: false, error: 'dialogue_invalid' };
    } else if (state.dialogue.length > 0) {
      return { ok: false, error: 'dialogue_invalid' };
    }
  } else if (state.dialogue.length > 0) {
    return { ok: false, error: 'dialogue_invalid' };
  }

  for (const s of state.selections) {
    if (!officialDeptKeys.has(s.departmentKey)) return { ok: false, error: 'selection_department_unknown' };
  }

  if (state.status === 'confirmed' && !state.confirmed) return { ok: false, error: 'confirmed_without_record' };
  if (state.status === 'confirmed' && state.selections.some((s) => s.decision === 'pending')) {
    return { ok: false, error: 'confirmed_with_pending' };
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
