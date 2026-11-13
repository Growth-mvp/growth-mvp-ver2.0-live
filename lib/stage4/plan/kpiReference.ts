/* 計画書の参照KPI（section3.protectedKpis）を、いまの正式KPIに合わせる。
 * 正式KPIを正本とし、利用者の本文・実施事項・AIの提案は変えない。
 * 目標値が未入力のKPIは未設定のまま（0にしない）。正式データから消えたKPIは目標値を消し、名称に注記する。 */
import { splitKpisByBasis } from './kpiBasis';
import { stableIdOf } from './projectResolver';
import { kpisOfProject } from './source';

type Json = Record<string, unknown>;

export type KpiReference = { ok: true; changed: boolean; aiDraft: Json } | { ok: false; message: string };

const MISSING_NOTE = '（正式データにありません）';
const PROJECT_NOT_FOUND = '対象プロジェクトを正式データで確認できません（削除、または番号の変更の可能性）';

const withMissingNote = (label: string) => (label.endsWith(MISSING_NOTE) ? label : `${label}${MISSING_NOTE}`);

export function refreshKpiReference(aiDraft: Json, departments: unknown, projectId: string): KpiReference {
  const plan = (aiDraft.plan ?? null) as { period?: { endYm?: unknown }; section3?: Json } | null;
  if (!plan || typeof plan.section3 !== 'object' || plan.section3 === null) {
    return { ok: false, message: '計画書の内容を確認できません' };
  }
  const projects = (Array.isArray(departments) ? (departments as Array<{ projects?: unknown }>) : [])
    .flatMap((d) => (Array.isArray(d?.projects) ? (d.projects as Array<Record<string, unknown>>) : []))
    .filter((p) => stableIdOf(p) === projectId);
  if (projects.length !== 1) return { ok: false, message: PROJECT_NOT_FOUND };

  const locked = splitKpisByBasis(kpisOfProject(projects[0])).locked;
  const current = Array.isArray(plan.section3.protectedKpis) ? (plan.section3.protectedKpis as Json[]) : [];
  const byId = new Map(locked.map((c) => [c.id, c]));
  const listed = new Set(current.map((k) => k.stage3KpiId));
  const endYm = typeof plan.period?.endYm === 'string' ? plan.period.endYm : null;

  const refreshed = current.map((k): Json => {
    const c = byId.get(String(k.stage3KpiId));
    if (!c) return { ...k, label: withMissingNote(String(k.label ?? '')), target: null, targetBasis: null, confirmation: 'UNCONFIRMED' };
    return {
      ...k,
      label: c.label,
      target: c.target,
      unit: c.unit,
      due: c.due,
      owner: c.owner,
      confirmation: c.basis === 'USER_CONFIRMED' ? 'USER_CONFIRMED' : 'UNCONFIRMED',
      targetBasis: c.target === null ? null : 'STAGE_DATA',
      judgeCandidateYm: c.due === null ? endYm : null,
    };
  });

  const maxKey = Math.max(0, ...current.map((k) => Number(/^S(\d+)$/.exec(String(k.key))?.[1] ?? 0)));
  const added = locked
    .filter((c) => !listed.has(c.id))
    .map((c, i): Json => ({
      key: `S${maxKey + i + 1}`,
      origin: 'STAGE3',
      stage3KpiId: c.id,
      kind: 'UNCLASSIFIED',
      label: c.label,
      target: c.target,
      unit: c.unit,
      targetBasis: c.target === null ? null : 'STAGE_DATA',
      confirmation: c.basis === 'USER_CONFIRMED' ? 'USER_CONFIRMED' : 'UNCONFIRMED',
      due: c.due,
      owner: c.owner,
      measurement: c.basis === 'USER_CONFIRMED' ? '確定済みKPI（STAGE3）の測定方法に従う' : '入力済みKPIの測定方法は利用者が確認する',
      supportsActionOrders: [],
      judgeCandidateYm: c.due === null ? endYm : null,
    }));

  const next = [...refreshed, ...added];
  if (JSON.stringify(next) === JSON.stringify(current)) return { ok: true, changed: false, aiDraft };
  return {
    ok: true,
    changed: true,
    aiDraft: { ...aiDraft, plan: { ...(aiDraft.plan as Json), section3: { ...plan.section3, protectedKpis: next } } },
  };
}
