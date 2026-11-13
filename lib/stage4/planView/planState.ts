import { toDisplayPlan } from './adapter';
import { EMPTY_REGULATORY, isRegulatoryTask, startGate, type RegulatoryRecord } from './model';
import type { EditValue, Edits } from './documentModel';

export type PlanMode = 'read' | 'edit';

export type ProjectPlanState = {
  mode: PlanMode;
  committed: Edits;
  draft: Edits;
  adopted: boolean;
  started: boolean;
  holdNotice: boolean;
  regulatory: RegulatoryRecord;
  notice: string | null;
};

export const INITIAL_PLAN_STATE: ProjectPlanState = {
  mode: 'read',
  committed: {},
  draft: {},
  adopted: false,
  started: false,
  holdNotice: false,
  regulatory: EMPTY_REGULATORY,
  notice: null,
};

const RESET_NOTICE = '修正を反映したため、採用と実行開始の状態を解除しました。内容を確認してから、改めて採用してください。';

function sameEdits(a: Edits, b: Edits): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

export function enterEdit(s: ProjectPlanState): ProjectPlanState {
  return { ...s, mode: 'edit', draft: { ...s.committed }, notice: null };
}

export function setDraftValue(s: ProjectPlanState, key: string, value: EditValue): ProjectPlanState {
  return { ...s, draft: { ...s.draft, [key]: value } };
}

export function discardEdit(s: ProjectPlanState): ProjectPlanState {
  return { ...s, mode: 'read', draft: {} };
}

/* 文書の修正を反映する。内容が変わったら、採用と開始は解除する（古い内容を採用したままにしない） */
export function applyEdit(s: ProjectPlanState): ProjectPlanState {
  const changed = !sameEdits(s.draft, s.committed);
  const base = { ...s, mode: 'read' as const, committed: s.draft, draft: {} };
  if (!changed) return base;
  const wasAdopted = s.adopted || s.started;
  return { ...base, adopted: false, started: false, holdNotice: false, notice: wasAdopted ? RESET_NOTICE : null };
}

export function setCommittedValue(s: ProjectPlanState, key: string, value: EditValue | undefined): ProjectPlanState {
  const next = { ...s.committed };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return { ...s, committed: next };
}

export function adopt(s: ProjectPlanState, adoptable: boolean): ProjectPlanState {
  if (!adoptable || s.mode === 'edit') return s;
  return { ...s, adopted: true, notice: null };
}

export function unadopt(s: ProjectPlanState): ProjectPlanState {
  return { ...s, adopted: false, started: false, holdNotice: false };
}

export function start(s: ProjectPlanState, startable: boolean): ProjectPlanState {
  if (!startable) return s;
  return { ...s, started: true, holdNotice: false };
}

/* 開始（ローカル）：採用できれば採用し、条件がそろえば開始する（サーバーと同じ順序） */
export function startWithAdoption(s: ProjectPlanState, bundle: unknown): ProjectPlanState {
  const adoptedState = s.adopted ? s : adopt(s, computePlanView(bundle, s).d.adoption.adoptable);
  return start(adoptedState, computePlanView(bundle, adoptedState).gate.startable);
}

export function unstart(s: ProjectPlanState): ProjectPlanState {
  return { ...s, started: false };
}

/* 開始の条件が欠けたら、開始を解除して理由を残す（条件がそろっても自動では開始しない） */
export function reconcileStart(s: ProjectPlanState, startable: boolean): ProjectPlanState {
  if (s.started && !startable) return { ...s, started: false, holdNotice: true };
  return s;
}

export function setRegulatory(s: ProjectPlanState, regulatory: RegulatoryRecord): ProjectPlanState {
  return { ...s, regulatory };
}

export type PlanView = ReturnType<typeof computePlanView>;

export function computePlanView(bundle: unknown, s: ProjectPlanState) {
  const d = toDisplayPlan(bundle, s.committed);
  const owner = d.tasks.find((t) => t.id === 'owner');
  const responsibleConfirmed = owner?.done === true;
  const regulatoryTasks = d.tasks.filter(isRegulatoryTask);
  const keyTasks = d.tasks.filter((t) => t.gate === 'START' && t.id !== 'owner' && !isRegulatoryTask(t));
  const gate = startGate({
    adopted: s.adopted,
    responsibleConfirmed,
    hasRegulatoryItems: regulatoryTasks.length > 0,
    regulatory: s.regulatory,
  });
  return { d, responsibleConfirmed, regulatoryTasks, keyTasks, gate };
}
