import { isHttpsUrl } from './suggestionView';

/**
 * AI 提案候補の保存形式。swotSuggestions 内の任意フィールドとして保存する（DB スキーマは変えない）。
 * - candidatePool: 候補の一覧。各候補は内容から決まる安定 ID を持ち、配列の位置には依存しない
 * - selection: ユーザーの選択状態を候補 ID ごとに記録する。候補を再生成しても消さない
 * 確定済みの S・W・O・T 本文（store の opportunity / threat）は別に保持し、ここからは書き換えない。
 */

export const CANDIDATE_POOL_VERSION = 1 as const;
export const CANDIDATE_LIMITS = { opportunity: 30, threat: 10 } as const;
export const OPPORTUNITY_GROUPS = ['existing_market', 'new_customer_use', 'new_region', 'new_business'] as const;

export type CandidateKind = 'opportunity' | 'threat';
export type OpportunityGroup = (typeof OPPORTUNITY_GROUPS)[number];
export type CandidateGrounding =
  | 'source_unverified'
  | 'hypothesis_source_unverified'
  | 'hypothesis_with_rationale'
  | 'input_based'
  | 'needs_research';
/** linked: 出典が実在する / cited_but_unlinked: 根拠欄は出典番号を示すが紐づけが外れた / none: 出典なし */
export type CandidateSourceLink = 'linked' | 'cited_but_unlinked' | 'none';

/** market: 市場動向から / customer_need: 顧客の未充足ニーズから / both: 両方から。未設定は従来の候補（区別なし） */
export const DISCOVERY_PATHS = ['market', 'customer_need', 'both'] as const;
export type DiscoveryPath = (typeof DISCOVERY_PATHS)[number];

export type PoolCandidate = {
  id: string;
  kind: CandidateKind;
  group?: OpportunityGroup;
  discoveryPath?: DiscoveryPath;
  text: string;
  targetNeed?: string;
  companyLink?: string;
  /** 公開市場分類 ID。現在の応答形式では候補ごとに記録されないため null */
  marketCategoryIds: string[] | null;
  basis: 'fact' | 'hypothesis';
  grounding: CandidateGrounding;
  evidence: string;
  sourceIndex: number | null;
  sourceUrl: string | null;
  sourceLink: CandidateSourceLink;
  unverified: string[];
  generatedAt: string;
};

export type CandidatePool = {
  version: typeof CANDIDATE_POOL_VERSION;
  generatedAt: string;
  candidates: PoolCandidate[];
  /** 上限超過・重複で保持しなかった件数、形式不正で読み飛ばした件数（内容は含めない） */
  dropped: Record<CandidateKind, number>;
  invalid: number;
};

export type SelectionEntry = {
  candidateId: string;
  kind: CandidateKind;
  status: 'added' | 'removed';
  /** 現在の SWOT 本文に入っている文 */
  text: string;
  /** 候補として提示された元の文 */
  sourceText: string;
  edited: boolean;
  updatedAt: string;
};

export type CandidateSelection = {
  version: typeof CANDIDATE_POOL_VERSION;
  entries: Record<string, SelectionEntry>;
};

/** 候補の元になる、既存の swotSuggestions の形 */
export type SuggestionsLike = {
  opportunity?: unknown;
  threat?: unknown;
  generatedAt?: unknown;
  sources?: unknown;
  insights?: unknown;
};

const KINDS: readonly CandidateKind[] = ['opportunity', 'threat'];
const GROUPS: readonly string[] = OPPORTUNITY_GROUPS;
const GROUNDINGS: readonly string[] = [
  'source_unverified',
  'hypothesis_source_unverified',
  'hypothesis_with_rationale',
  'input_based',
  'needs_research',
];
const LINKS: readonly string[] = ['linked', 'cited_but_unlinked', 'none'];
const MAX_TEXT = 1000;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const textOf = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const isSourceIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** 空白を除いた内容から決まる ID（FNV-1a 32bit）。同じ文は同じ ID になり、並べ替えても変わらない */
export function candidateIdOf(kind: CandidateKind, text: string): string {
  const s = `${kind}\n${text.replace(/\s+/g, '')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${kind === 'opportunity' ? 'opp' : 'thr'}_${h.toString(16).padStart(8, '0')}`;
}

const emptyDropped = (): Record<CandidateKind, number> => ({ opportunity: 0, threat: 0 });

function sourceUrlsByIndex(sources: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!Array.isArray(sources)) return out;
  for (const raw of sources) {
    const s = asRecord(raw);
    const url = textOf(s.url, 2000);
    if (isSourceIndex(s.index) && isHttpsUrl(url)) out.set(s.index, url);
  }
  return out;
}

function groundingOf(basis: 'fact' | 'hypothesis', linked: boolean, evidence: string): CandidateGrounding {
  if (linked) return basis === 'fact' ? 'source_unverified' : 'hypothesis_source_unverified';
  if (basis === 'fact' && evidence) return 'input_based';
  if (evidence) return 'hypothesis_with_rationale';
  return 'needs_research';
}

function unverifiedOf(sourceLink: CandidateSourceLink, grounding: CandidateGrounding): string[] {
  const out: string[] = [];
  if (sourceLink === 'linked') out.push('source_body_not_checked');
  if (sourceLink === 'cited_but_unlinked') out.push('citation_not_linked');
  if (grounding === 'hypothesis_with_rationale' || grounding === 'hypothesis_source_unverified') out.push('inference_only');
  if (grounding === 'needs_research') out.push('needs_research');
  return out;
}

function toCandidate(
  kind: CandidateKind,
  text: string,
  insight: Record<string, unknown>,
  generatedAt: string,
  urls: Map<number, string>
): PoolCandidate {
  const basis = insight.basis === 'fact' ? 'fact' : 'hypothesis';
  const evidence = textOf(insight.evidence, 300);
  const rawIndex = isSourceIndex(insight.sourceIndex) ? insight.sourceIndex : null;
  const sourceUrl = rawIndex !== null ? urls.get(rawIndex) ?? null : null;
  const sourceIndex = sourceUrl !== null ? rawIndex : null;
  const cited = [...evidence.matchAll(/\[(\d+)\]/g)].some((m) => urls.has(Number(m[1])));
  const sourceLink: CandidateSourceLink = sourceIndex !== null ? 'linked' : cited ? 'cited_but_unlinked' : 'none';
  const grounding = groundingOf(basis, sourceIndex !== null, evidence);
  return {
    id: candidateIdOf(kind, text),
    kind,
    text,
    marketCategoryIds: null,
    basis,
    grounding,
    evidence,
    sourceIndex,
    sourceUrl,
    sourceLink,
    unverified: unverifiedOf(sourceLink, grounding),
    generatedAt,
  };
}

/** 既存の機会・脅威（と insights・sources）から候補の一覧を作る。上限を超えた分と重複は数えて捨てる */
export function buildCandidatePool(src: SuggestionsLike): CandidatePool {
  const generatedAt = textOf(src.generatedAt, 40);
  const urls = sourceUrlsByIndex(src.sources);
  const insights = asRecord(src.insights);
  const dropped = emptyDropped();
  const candidates: PoolCandidate[] = [];
  const seen = new Set<string>();

  for (const kind of KINDS) {
    const texts: unknown[] = Array.isArray(src[kind]) ? (src[kind] as unknown[]) : [];
    const insightList: unknown[] = Array.isArray(insights[kind]) ? (insights[kind] as unknown[]) : [];
    let kept = 0;
    texts.forEach((raw, i) => {
      const text = textOf(raw, MAX_TEXT);
      if (!text) return;
      const id = candidateIdOf(kind, text);
      if (seen.has(id) || kept >= CANDIDATE_LIMITS[kind]) {
        dropped[kind]++;
        return;
      }
      seen.add(id);
      kept++;
      candidates.push(toCandidate(kind, text, asRecord(insightList[i]), generatedAt, urls));
    });
  }

  return { version: CANDIDATE_POOL_VERSION, generatedAt, candidates, dropped, invalid: 0 };
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function parseCandidate(raw: unknown): PoolCandidate | null {
  const c = asRecord(raw);
  const kind = c.kind;
  const text = textOf(c.text, MAX_TEXT);
  if (!KINDS.includes(kind as CandidateKind) || !text) return null;
  if (typeof c.id !== 'string' || !c.id || c.id.length > 64) return null;
  if (c.basis !== 'fact' && c.basis !== 'hypothesis') return null;
  if (typeof c.grounding !== 'string' || !GROUNDINGS.includes(c.grounding)) return null;
  if (typeof c.sourceLink !== 'string' || !LINKS.includes(c.sourceLink)) return null;
  if (c.group !== undefined && (typeof c.group !== 'string' || !GROUPS.includes(c.group))) return null;
  if (c.sourceIndex !== null && !isSourceIndex(c.sourceIndex)) return null;
  if (c.sourceUrl !== null && (typeof c.sourceUrl !== 'string' || !isHttpsUrl(c.sourceUrl))) return null;
  if (c.marketCategoryIds !== null && !isStringArray(c.marketCategoryIds)) return null;
  if (!isStringArray(c.unverified) || typeof c.generatedAt !== 'string') return null;
  return {
    id: c.id,
    kind: kind as CandidateKind,
    ...(c.group !== undefined ? { group: c.group as OpportunityGroup } : {}),
    ...(DISCOVERY_PATHS.includes(c.discoveryPath as DiscoveryPath) ? { discoveryPath: c.discoveryPath as DiscoveryPath } : {}),
    text,
    ...(typeof c.targetNeed === 'string' ? { targetNeed: c.targetNeed.slice(0, 500) } : {}),
    ...(typeof c.companyLink === 'string' ? { companyLink: c.companyLink.slice(0, 500) } : {}),
    marketCategoryIds: c.marketCategoryIds as string[] | null,
    basis: c.basis,
    grounding: c.grounding as CandidateGrounding,
    evidence: textOf(c.evidence, 300),
    sourceIndex: c.sourceIndex as number | null,
    sourceUrl: c.sourceUrl as string | null,
    sourceLink: c.sourceLink as CandidateSourceLink,
    unverified: c.unverified,
    generatedAt: c.generatedAt,
  };
}

/** 保存済みの候補一覧を読む。形式が不正な候補は読み飛ばし、上限と重複は保存時と同じ規則で扱う */
const storedCount = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

export function parseCandidatePool(raw: unknown): CandidatePool | undefined {
  const p = asRecord(raw);
  if (p.version !== CANDIDATE_POOL_VERSION || !Array.isArray(p.candidates)) return undefined;
  const storedDropped = asRecord(p.dropped);
  const dropped: Record<CandidateKind, number> = {
    opportunity: storedCount(storedDropped.opportunity),
    threat: storedCount(storedDropped.threat),
  };
  const candidates: PoolCandidate[] = [];
  const seen = new Set<string>();
  let invalid = storedCount(p.invalid);
  for (const item of p.candidates) {
    const c = parseCandidate(item);
    if (!c) {
      invalid++;
      continue;
    }
    const count = candidates.filter((x) => x.kind === c.kind).length;
    if (seen.has(c.id) || count >= CANDIDATE_LIMITS[c.kind]) {
      dropped[c.kind]++;
      continue;
    }
    seen.add(c.id);
    candidates.push(c);
  }
  return {
    version: CANDIDATE_POOL_VERSION,
    generatedAt: textOf(p.generatedAt, 40),
    candidates,
    dropped,
    invalid,
  };
}

/** 候補一覧を持つ場合はそれを、無い場合（過去の保存形式）は機会・脅威から作った一覧を返す（保存はしない） */
export function candidatePoolOf(s: SuggestionsLike & { candidatePool?: unknown }): CandidatePool {
  return parseCandidatePool(s.candidatePool) ?? buildCandidatePool(s);
}

export function emptySelection(): CandidateSelection {
  return { version: CANDIDATE_POOL_VERSION, entries: {} };
}

const SELECTION_STATUS: readonly string[] = ['added', 'removed'];

export function parseCandidateSelection(raw: unknown): CandidateSelection | undefined {
  const sel = asRecord(raw);
  if (sel.version !== CANDIDATE_POOL_VERSION) return undefined;
  const entries = asRecord(sel.entries);
  const out: Record<string, SelectionEntry> = {};
  for (const [key, value] of Object.entries(entries)) {
    const e = asRecord(value);
    const text = textOf(e.text, MAX_TEXT);
    if (e.candidateId !== key || !KINDS.includes(e.kind as CandidateKind)) continue;
    if (typeof e.status !== 'string' || !SELECTION_STATUS.includes(e.status) || !text) continue;
    out[key] = {
      candidateId: key,
      kind: e.kind as CandidateKind,
      status: e.status as SelectionEntry['status'],
      text,
      sourceText: textOf(e.sourceText, MAX_TEXT) || text,
      edited: e.edited === true,
      updatedAt: textOf(e.updatedAt, 40),
    };
  }
  return { version: CANDIDATE_POOL_VERSION, entries: out };
}

export function selectionOf(s: { selection?: unknown } | undefined): CandidateSelection {
  return parseCandidateSelection(s?.selection) ?? emptySelection();
}

/** 候補を SWOT へ追加したことを記録する。既に追加済みの候補は、編集内容を保ったまま変えない */
export function selectCandidate(sel: CandidateSelection, c: PoolCandidate, now: string): CandidateSelection {
  const cur = sel.entries[c.id];
  if (cur && cur.status === 'added') return sel;
  const entry: SelectionEntry = {
    candidateId: c.id,
    kind: c.kind,
    status: 'added',
    text: c.text,
    sourceText: c.text,
    edited: false,
    updatedAt: now,
  };
  return { ...sel, entries: { ...sel.entries, [c.id]: entry } };
}

/** 追加済みの候補の本文を編集したことを記録する。元の文と違えば edited を立てる */
export function editSelectedCandidate(sel: CandidateSelection, id: string, text: string, now: string): CandidateSelection {
  const cur = sel.entries[id];
  const next = text.trim().slice(0, MAX_TEXT);
  if (!cur || cur.status !== 'added' || !next) return sel;
  const entry: SelectionEntry = { ...cur, text: next, edited: next !== cur.sourceText, updatedAt: now };
  return { ...sel, entries: { ...sel.entries, [id]: entry } };
}

/** 候補を SWOT から外したことを記録する。記録は残し、後で同じ候補を再選択できるようにする */
export function removeSelectedCandidate(sel: CandidateSelection, id: string, now: string): CandidateSelection {
  const cur = sel.entries[id];
  if (!cur || cur.status !== 'added') return sel;
  return { ...sel, entries: { ...sel.entries, [id]: { ...cur, status: 'removed', updatedAt: now } } };
}

/**
 * 確定済み SWOT の行と選択記録を突き合わせる。
 * 追加済みの候補の文が行に無ければ削除と記録し、行はあるが候補に対応しない文は手入力として返す。
 */
export function reconcileWithConfirmed(
  sel: CandidateSelection,
  kind: CandidateKind,
  confirmedLines: readonly string[],
  now: string
): { selection: CandidateSelection; manualLines: string[] } {
  const lines = confirmedLines.map((l) => l.trim()).filter(Boolean);
  const present = new Set(lines);
  const entries = { ...sel.entries };
  for (const e of Object.values(sel.entries)) {
    if (e.kind === kind && e.status === 'added' && !present.has(e.text)) {
      entries[e.candidateId] = { ...e, status: 'removed', updatedAt: now };
    }
  }
  const linked = new Set(
    Object.values(entries)
      .filter((e) => e.kind === kind && e.status === 'added')
      .map((e) => e.text)
  );
  return {
    selection: { ...sel, entries },
    manualLines: lines.filter((l) => !linked.has(l)),
  };
}

/**
 * 候補を保存するときの合成。空の候補で既存の候補を上書きしない。
 * 選択記録は前の状態から引き継ぎ、候補の一覧だけを差し替える。
 */
export function composeSwotSuggestions<T extends SuggestionsLike & { selection?: CandidateSelection }>(
  prev: (SuggestionsLike & { selection?: unknown }) | undefined,
  incoming: T
): T & { candidatePool: CandidatePool; selection?: CandidateSelection } {
  const hasCandidates = (s: SuggestionsLike | undefined) =>
    !!s && ((Array.isArray(s.opportunity) && s.opportunity.length > 0) || (Array.isArray(s.threat) && s.threat.length > 0));
  if (!hasCandidates(incoming) && hasCandidates(prev)) {
    return prev as unknown as T & { candidatePool: CandidatePool; selection?: CandidateSelection };
  }
  const selection = prev?.selection !== undefined ? parseCandidateSelection(prev.selection) : undefined;
  return {
    ...incoming,
    candidatePool: buildCandidatePool(incoming),
    ...(selection ? { selection } : {}),
  };
}

/** AI 提案の一覧だけを、生成ペイロードとして渡す（選択記録と候補の一覧は送らない） */
export function withoutCandidateState<T extends object>(s: T | undefined): T | undefined {
  if (!s) return s;
  const rest: Record<string, unknown> = { ...(s as Record<string, unknown>) };
  delete rest.candidatePool;
  delete rest.selection;
  return rest as T;
}
