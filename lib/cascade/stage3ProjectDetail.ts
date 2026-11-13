type AnyRecord = Record<string, unknown>;

export type ProjectGroupKey = 'existing' | 'new' | 'intraCollab' | 'interCollab' | 'other';

export const PROJECT_GROUPS: ReadonlyArray<{ key: ProjectGroupKey; label: string }> = [
  { key: 'existing', label: '既存事業強化' },
  { key: 'new', label: '新規探索' },
  { key: 'intraCollab', label: '部門内連携' },
  { key: 'interCollab', label: '部門間連携' },
  { key: 'other', label: 'その他' },
];

/** 既存の正式なプロジェクトか、採用前の新規候補か、照合できないか */
export type ProjectOrigin = 'official' | 'candidate' | 'unmatched';

export type OkrDetail = { objective: string; keyResults: string[] };

export type DraftProjectInput = {
  id?: unknown;
  title: string;
  description?: string;
  kpis?: string[];
  reason?: string;
  hypothesis?: string;
  sourceType?: string;
  partnerDepartment?: string;
  okrs?: OkrDetail[];
};

export type ProjectDetail = {
  title: string;
  origin: ProjectOrigin;
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
 * 草案のプロジェクトの詳細を組み立てる。草案に保存された項目を優先し、無い項目は
 * 正式データ（同じ id）または新規候補（project.id）から取る。どちらにも無ければ補完せず、missing に入れる。
 */
export function projectDetailOf(
  draft: DraftProjectInput,
  sources: { official: AnyRecord[]; candidates: AnyRecord[] },
): ProjectDetail {
  const id = draft.id === undefined || draft.id === null ? null : String(draft.id);
  const official = id === null ? undefined : sources.official.find((p) => p && String(p.id) === id);
  const candidate = id === null ? undefined : sources.candidates.find((p) => p && String(p.id) === id);
  const source: AnyRecord = official ?? candidate ?? {};
  const origin: ProjectOrigin = official ? 'official' : candidate ? 'candidate' : 'unmatched';

  const purpose = textOf(draft.reason) ?? textOf(source.reason);
  const hypothesis = textOf(draft.hypothesis) ?? textOf(source.hypothesis);
  const sourceType = textOf(draft.sourceType) ?? textOf(source.sourceType);
  const partnerDepartment = textOf(draft.partnerDepartment) ?? textOf(source.partnerDepartment);
  const kpis = stringsOf(source.kpis).length > 0 ? stringsOf(source.kpis) : stringsOf(draft.kpis);
  const okrs = okrsOf(source.okrs).length > 0 ? okrsOf(source.okrs) : okrsOf(draft.okrs);
  const summary = textOf(draft.description);

  const missing: ProjectDetail['missing'] = [];
  if (!purpose) missing.push('purpose');
  if (!hypothesis) missing.push('hypothesis');
  if (!partnerDepartment && (sourceType === 'intraCollab' || sourceType === 'interCollab')) {
    missing.push('partnerDepartment');
  }
  if (okrs.length === 0) missing.push('okrs');
  if (kpis.length === 0) missing.push('kpis');

  return {
    title: draft.title,
    origin,
    group: groupOf(sourceType),
    purpose,
    hypothesis,
    summary,
    partnerDepartment,
    kpis,
    okrs,
    missing,
  };
}
