type AnyRecord = Record<string, unknown>;

export type ProjectGroupKey = 'existing' | 'new' | 'intraCollab' | 'interCollab' | 'other';

export const PROJECT_GROUPS: ReadonlyArray<{ key: ProjectGroupKey; label: string }> = [
  { key: 'existing', label: '既存事業強化' },
  { key: 'new', label: '新規探索' },
  { key: 'intraCollab', label: '部門内連携' },
  { key: 'interCollab', label: '部門間連携' },
  { key: 'other', label: 'その他' },
];

export type OkrDetail = { objective: string; keyResults: string[] };

export type ProjectDetail = {
  title: string;
  group: ProjectGroupKey;
  purpose: string | null;
  hypothesis: string | null;
  summary: string | null;
  partnerDepartment: string | null;
  kpis: string[];
  okrs: OkrDetail[];
  missing: Array<'purpose' | 'hypothesis' | 'partnerDepartment' | 'okrs' | 'kpis'>;
};

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(textOf).filter((v): v is string => v !== null) : [];

const okrsOf = (value: unknown): OkrDetail[] =>
  Array.isArray(value)
    ? value
        .filter((o): o is AnyRecord => !!o && typeof o === 'object')
        .map((o) => ({ objective: textOf(o.objective) ?? '', keyResults: stringsOf(o.keyResults) }))
        .filter((o) => o.objective !== '' || o.keyResults.length > 0)
    : [];

const groupOf = (sourceType: unknown): ProjectGroupKey => {
  const key = textOf(sourceType);
  return key === 'existing' || key === 'new' || key === 'intraCollab' || key === 'interCollab' ? key : 'other';
};

/**
 * 草案のプロジェクトに、正式データ（同じ id）または新規候補（project.id）の詳細を重ねる。
 * 見つからない項目は補完せず、missing に入れる。
 */
export function projectDetailOf(
  draft: { id?: unknown; title: string; description?: string; kpis?: string[] },
  sources: { official: AnyRecord[]; candidates: AnyRecord[] },
): ProjectDetail {
  const id = draft.id === undefined || draft.id === null ? null : String(draft.id);
  const source =
    (id === null ? undefined : sources.official.find((p) => p && String(p.id) === id)) ??
    (id === null ? undefined : sources.candidates.find((p) => p && String(p.id) === id)) ??
    {};

  const purpose = textOf(source.reason);
  const hypothesis = textOf(source.hypothesis);
  const partnerDepartment = textOf(source.partnerDepartment);
  const kpis = stringsOf(source.kpis).length > 0 ? stringsOf(source.kpis) : stringsOf(draft.kpis);
  const okrs = okrsOf(source.okrs);
  const summary = textOf(draft.description);

  const missing: ProjectDetail['missing'] = [];
  if (!purpose) missing.push('purpose');
  if (!hypothesis) missing.push('hypothesis');
  if (!partnerDepartment && (source.sourceType === 'intraCollab' || source.sourceType === 'interCollab')) {
    missing.push('partnerDepartment');
  }
  if (okrs.length === 0) missing.push('okrs');
  if (kpis.length === 0) missing.push('kpis');

  return {
    title: draft.title,
    group: groupOf(source.sourceType),
    purpose,
    hypothesis,
    summary,
    partnerDepartment,
    kpis,
    okrs,
    missing,
  };
}
