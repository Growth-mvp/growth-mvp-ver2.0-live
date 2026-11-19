import {
  collectPlanUnits,
  departmentKeyOf,
  editableKpis,
  projectIdOf,
  type PlanUnit,
  type ProjectChangeFields,
  type ProjectChangeProposal,
} from '@/lib/cascade/stage3Adjustment';
import { projectTextOf } from '@/lib/cascade/stage3Confirm';
import { isProjectActive } from '@/lib/cascade/projectLifecycle';
import { pickAdoptableProject, type DeptProposal } from '@/lib/cascade/stage3Candidates';
import type {
  DraftDepartment,
  NewProjectCandidate,
  ProjectProposal,
  ProjectSelection,
  Selection,
} from '@/lib/cascade/stage3StrategyBook';

type DraftProject = DraftDepartment['projects'][number];

type AnyRecord = Record<string, unknown>;

const hasStableId = (v: AnyRecord) =>
  (typeof v.id === 'string' && v.id.trim() !== '') || (typeof v.id === 'number' && Number.isFinite(v.id));

const clipped = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined;

const REGEN_PROPOSAL_REASON = '再生成で、この計画の内容に改善案が出ました。';

/** 計画の詳細（選定理由・仮説・連携先・目標）を、保存の上限内で草案に残す。存在する項目だけを返す。 */
function detailsOf(raw: AnyRecord | undefined): Partial<DraftProject> {
  if (!raw) return {};
  const out: Partial<DraftProject> = {};
  const reason = clipped(raw.reason, 2000);
  if (reason) out.reason = reason;
  const hypothesis = clipped(raw.hypothesis, 2000);
  if (hypothesis) out.hypothesis = hypothesis;
  const sourceType = clipped(raw.sourceType, 40);
  if (sourceType) out.sourceType = sourceType;
  const partnerDepartment = clipped(raw.partnerDepartment, 200);
  if (partnerDepartment) out.partnerDepartment = partnerDepartment;
  const okrs = (Array.isArray(raw.okrs) ? raw.okrs : [])
    .filter((o): o is AnyRecord => !!o && typeof o === 'object')
    .map((o) => ({
      objective: clipped(o.objective, 300) ?? '',
      keyResults: (Array.isArray(o.keyResults) ? o.keyResults : [])
        .map((k) => clipped(k, 300))
        .filter((k): k is string => k !== undefined)
        .slice(0, 10),
    }))
    .filter((o) => o.objective !== '' || o.keyResults.length > 0)
    .slice(0, 10);
  if (okrs.length > 0) out.okrs = okrs;
  return out;
}

/** 同じ名前で再生成された計画の内容。計画名の比較は titleKey で行う。 */
type Regenerated = { raw: AnyRecord; unit: PlanUnit };

function regeneratedByTitle(departmentName: string, candidates: AnyRecord[]): Map<string, Regenerated> {
  const out = new Map<string, Regenerated>();
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string') continue;
    const [unit] = collectPlanUnits([{ name: departmentName, projects: [raw] }]);
    if (!unit) continue;
    const key = titleKey(unit.projectTitle);
    if (!out.has(key)) out.set(key, { raw: raw as AnyRecord, unit });
  }
  return out;
}

const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 2000) : null);

/**
 * 同じ名前の既存の計画に、再生成の改善内容を重ねた文章・KPI。KPIは件数が同じ時だけ差し替える（件数が違えば現行のKPIを残す）。
 * 正式データは変えない。草案の表示と、採用時の変更案の両方がこの値を使う。
 */
function improvedFieldsOf(official: AnyRecord, re: Regenerated): ProjectChangeFields {
  const base = projectTextOf(official);
  const baseKpis = editableKpis(official) ?? [];
  const nextKpis = editableKpis(re.raw);
  return {
    title: base.title,
    reason: textOrNull(re.raw.reason) ?? base.reason,
    hypothesis: textOrNull(re.raw.hypothesis) ?? base.hypothesis,
    description: textOrNull(re.raw.description) ?? base.description,
    kpis: baseKpis.length > 0 && nextKpis !== null && nextKpis.length === baseKpis.length ? nextKpis : baseKpis,
  };
}

/**
 * 草案の部門データを作る。既存の計画（安定IDのあるもの）はそのまま、生成された候補の計画を追加する。
 * 既存の計画と同じ名前の候補は、既存の計画の内容として重ねて表示する（IDは既存のまま）。
 * 既存の計画と同じ ID の候補は追加しない。元の部門データは変えない。
 */
export function draftDepartmentsFrom(
  official: AnyRecord[],
  candidateProjects: Record<string, AnyRecord[]>,
): DraftDepartment[] {
  return official
    .filter((d) => d && typeof d === 'object' && typeof d.name === 'string' && d.name.trim() !== '')
    .map((d) => {
      const key = departmentKeyOf(d);
      const existing = collectPlanUnits([d]);
      const existingIds = new Set(existing.map((u) => u.projectId));
      const existingTitles = new Set(existing.map((u) => titleKey(u.projectTitle)));
      const extra = collectPlanUnits([{ name: d.name, projects: candidateProjects[key] ?? [] }]).filter(
        (u) => !existingIds.has(u.projectId) && !existingTitles.has(titleKey(u.projectTitle)),
      );
      const rawById = new Map<string, AnyRecord>();
      for (const p of [...(Array.isArray(d.projects) ? d.projects : []), ...(candidateProjects[key] ?? [])]) {
        if (p && typeof p === 'object' && !rawById.has(projectIdOf(p as AnyRecord))) rawById.set(projectIdOf(p as AnyRecord), p as AnyRecord);
      }
      const regenerated = regeneratedByTitle(String(d.name), candidateProjects[key] ?? []);
      const toDraft = (u: PlanUnit, raw: AnyRecord | undefined, re: Regenerated | undefined): DraftProject => {
        const improved = raw && re ? improvedFieldsOf(raw, re) : undefined;
        const details = detailsOf(raw);
        const description = improved?.description ?? (u.summary || null);
        const kpis = improved ? improved.kpis : u.kpis;
        return {
          ...(u.projectId.startsWith('id:') ? { id: u.projectId.slice(3) } : {}),
          title: u.projectTitle,
          ...(description ? { description } : {}),
          ...(kpis.length > 0 ? { kpis } : {}),
          ...details,
          ...(improved?.reason ? { reason: improved.reason } : {}),
          ...(improved?.hypothesis ? { hypothesis: improved.hypothesis } : {}),
        };
      };
      return {
        ...(hasStableId(d) ? { id: d.id as string | number } : {}),
        name: String(d.name),
        projects: [
          ...existing.map((u) => {
            const raw = rawById.get(u.projectId);
            return toDraft(u, raw, raw ? regenerated.get(titleKey(u.projectTitle)) : undefined);
          }),
          ...extra.map((u) => toDraft(u, rawById.get(u.projectId), undefined)),
        ],
      };
    });
}

/**
 * 再生成で同じ名前の既存の計画に出た改善内容を、正式データへの変更案にする。
 * 変更案は採用されるまで正式データを変えない。採用時は確定処理が base と照合して反映する。
 */
/** 再生成した部門の変更案だけを置き換える。ほかの部門の変更案（採用・保留・不採用の判断を含む）は残す。 */
export function projectProposalsAfterRegeneration(
  previous: ProjectProposal[],
  regenKeys: Set<string>,
  official: AnyRecord[],
  candidateProjects: Record<string, AnyRecord[]>,
): ProjectProposal[] {
  const regenCandidates = Object.fromEntries(Object.entries(candidateProjects).filter(([k]) => regenKeys.has(k)));
  return [
    ...previous.filter((p) => !regenKeys.has(p.departmentKey)),
    ...regeneratedProjectProposalsFrom(official, regenCandidates),
  ];
}

export function regeneratedProjectProposalsFrom(
  official: AnyRecord[],
  candidateProjects: Record<string, AnyRecord[]>,
): Array<ProjectChangeProposal & { decision: 'pending' }> {
  const out: Array<ProjectChangeProposal & { decision: 'pending' }> = [];
  for (const d of official) {
    if (!d || typeof d !== 'object' || typeof d.name !== 'string' || d.name.trim() === '') continue;
    const key = departmentKeyOf(d);
    const regenerated = regeneratedByTitle(String(d.name), candidateProjects[key] ?? []);
    for (const p of Array.isArray(d.projects) ? (d.projects as AnyRecord[]) : []) {
      if (!p || typeof p !== 'object' || !hasStableId(p) || !isProjectActive(p)) continue;
      const re = regenerated.get(titleKey(typeof p.title === 'string' ? p.title : ''));
      if (!re) continue;
      const base = { ...projectTextOf(p), kpis: editableKpis(p) ?? [] };
      const proposed = improvedFieldsOf(p, re);
      const changed =
        proposed.reason !== base.reason ||
        proposed.hypothesis !== base.hypothesis ||
        proposed.description !== base.description ||
        proposed.kpis.join('\n') !== base.kpis.join('\n');
      if (!changed) continue;
      out.push({
        departmentKey: key,
        departmentName: String(d.name),
        projectId: projectIdOf(p).replace(/^id:/, ''),
        projectTitle: base.title,
        reason: REGEN_PROPOSAL_REASON,
        base: { title: base.title, reason: base.reason, hypothesis: base.hypothesis, description: base.description, kpis: base.kpis },
        proposed,
        decision: 'pending',
      });
    }
  }
  return out;
}

/**
 * 変更案を作業状態の変更候補にする。保留・不採用の判断は残し、未判断の案だけを新しい案に置き換える。
 * 既存の判断と同じ部門・項目の案は、新しい案で置き換える（重複させない）。
 */
export function selectionsFrom(
  official: AnyRecord[],
  proposals: Record<string, DeptProposal[]>,
  previous: Selection[],
): Selection[] {
  const pendingKeys = new Set<string>();
  const pending: Selection[] = [];
  for (const d of official) {
    if (!d || typeof d !== 'object' || typeof d.name !== 'string') continue;
    const key = departmentKeyOf(d);
    for (const p of proposals[key] ?? []) {
      pendingKeys.add(`${key} ${p.item}`);
      pending.push({
        departmentKey: key,
        departmentName: String(d.name),
        item: p.item,
        proposed: p.proposed,
        base: p.base,
        // 戦略書の文章として読んで直す項目。確定時に、表示どおりの内容が正式データへ反映される。
        decision: 'applied',
      });
    }
  }
  const decided = previous.filter((s) => s.decision !== 'pending' && !pendingKeys.has(`${s.departmentKey} ${s.item}`));
  return [...decided, ...pending];
}

/** 計画名の比較用の表記（空白と大文字小文字の違いを除く）。同じ名前の計画を既存として扱うために使う。 */
export function titleKey(title: string): string {
  return title.replace(/\s+/g, '').toLowerCase();
}

/** 名称から決まる安定した候補ID（同じ部門・同じ名称の案は、再生成しても同じIDになる）。 */
export function candidateProjectId(departmentKey: string, title: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${departmentKey}|${title}`) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `np-${h.toString(16).padStart(8, '0')}`;
}

/**
 * 生成された候補プロジェクトのうち、既存の計画と重ならないものを、部門ごとの候補にする。
 * 候補は草案に保存するだけで、正式データには入れない。
 */
export function newProjectCandidatesFrom(
  official: AnyRecord[],
  candidateProjects: Record<string, AnyRecord[]>,
  previous: NewProjectCandidate[] = [],
): NewProjectCandidate[] {
  const out: NewProjectCandidate[] = [];
  for (const d of official) {
    if (!d || typeof d !== 'object' || typeof d.name !== 'string' || d.name.trim() === '') continue;
    const key = departmentKeyOf(d);
    const existingUnits = collectPlanUnits([d]);
    const existingIds = new Set(existingUnits.map((u) => u.projectId));
    const existingTitles = new Set(existingUnits.map((u) => titleKey(u.projectTitle)));
    const linkedCandidateIds = new Set(
      (Array.isArray(d.projects) ? (d.projects as AnyRecord[]) : [])
        .map((p) => (typeof p.sourceCandidateId === 'string' ? p.sourceCandidateId : null))
        .filter((x): x is string => x !== null),
    );
    const seen = new Set<string>();
    for (const p of candidateProjects[key] ?? []) {
      if (typeof p.title !== 'string' || p.title.trim() === '') continue;
      const unitId = projectIdOf(p);
      // 同じ部門で同じ名称の候補は、以前の候補IDを引き継ぐ（採否・編集・分析の参照を失わないため）
      const priorId = previous.find(
        (np) => np.departmentKey === key && titleKey(String(np.project.title ?? '')) === titleKey(String(p.title)),
      )?.candidateId;
      const candidateId = priorId ?? candidateProjectId(key, p.title.trim());
      // 同じ名前の既存の計画は、新規候補にしない（採用済みの候補は、紐づいた計画として残す）
      const sameAsExisting = existingTitles.has(titleKey(p.title)) && !linkedCandidateIds.has(candidateId);
      if (existingIds.has(unitId) || sameAsExisting || seen.has(candidateId)) continue;
      seen.add(candidateId);
      const project = JSON.parse(JSON.stringify(p)) as AnyRecord;
      if (project.hypothesis === undefined && typeof project.reason === 'string') project.hypothesis = project.reason;
      out.push({ departmentKey: key, candidateId, project });
    }
    for (const p of Array.isArray(d.projects) ? (d.projects as AnyRecord[]) : []) {
      const linked = typeof p.sourceCandidateId === 'string' ? p.sourceCandidateId : null;
      if (!linked || isProjectActive(p) || seen.has(linked)) continue;
      seen.add(linked);
      out.push({ departmentKey: key, candidateId: linked, project: pickAdoptableProject(p) });
    }
  }
  return out;
}

/**
 * 再生成した部門の候補のうち、利用者が直した候補・手動で追加した候補・採否を決めた候補は残す。
 * 再生成で同じ計画が出たときは、候補IDを既存のものに合わせ、利用者が直した内容を優先する。
 */
export function keepRegeneratedCandidates(input: {
  previous: NewProjectCandidate[];
  next: NewProjectCandidate[];
  regenKeys: Set<string>;
  decidedIds: Set<string>;
}): NewProjectCandidate[] {
  const out = [...input.next];
  const matched = new Set<number>();
  for (const prev of input.previous) {
    if (!input.regenKeys.has(prev.departmentKey)) continue;
    const kept = prev.userEdited === true || prev.origin === 'manual' || input.decidedIds.has(prev.candidateId);
    if (!kept) continue;
    const idx = out.findIndex(
      (n, i) =>
        !matched.has(i) &&
        n.departmentKey === prev.departmentKey &&
        (n.candidateId === prev.candidateId || titleKey(String(n.project.title ?? '')) === titleKey(String(prev.project.title ?? ''))),
    );
    if (idx >= 0) {
      matched.add(idx);
      out[idx] = prev.userEdited || prev.origin === 'manual' ? prev : { ...out[idx], candidateId: prev.candidateId };
    } else {
      out.push(prev);
    }
  }
  const seen = new Set<string>();
  return out.filter((n) => {
    if (seen.has(n.candidateId)) return false;
    seen.add(n.candidateId);
    return true;
  });
}

/**
 * 新規候補の採否を作業状態にする。同じ候補IDの判断は引き継ぎ、新しい候補は未判断で入る。
 */
export function projectSelectionsFrom(
  official: AnyRecord[],
  candidates: NewProjectCandidate[],
  previous: ProjectSelection[],
): ProjectSelection[] {
  const names = new Map(
    official
      .filter((d) => d && typeof d === 'object' && typeof d.name === 'string')
      .map((d) => [departmentKeyOf(d), String(d.name)]),
  );
  const decided = new Map(previous.map((s) => [s.candidateId, s.decision]));
  const activeLinked = new Set(
    official.flatMap((d) =>
      (Array.isArray(d?.projects) ? (d.projects as AnyRecord[]) : [])
        .filter((p) => typeof p.sourceCandidateId === 'string' && isProjectActive(p))
        .map((p) => p.sourceCandidateId as string),
    ),
  );
  return candidates.map((c) => ({
    departmentKey: c.departmentKey,
    departmentName: names.get(c.departmentKey) ?? c.departmentKey,
    candidateId: c.candidateId,
    title: String(c.project.title).trim(),
    decision: decided.get(c.candidateId) ?? (activeLinked.has(c.candidateId) ? 'applied' : 'pending'),
  }));
}
