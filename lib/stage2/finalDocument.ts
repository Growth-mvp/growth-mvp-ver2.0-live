import type {
  CompanyTarget,
  MidtermStrategy,
  Stage2FinalDocumentEdits,
  StoryChapter,
} from '@/types/strategy';

export type StrategicAssumptions = {
  external: string[];
  internal: string[];
  implications: string[];
};

export type FinancialTargetRow = {
  label: string;
  base: number;
  unit: string;
  dueYear?: number;
};

export type UnconfirmedChanges = {
  chapters: boolean;
  document: boolean;
  midtermStrategy: boolean;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    const body = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

export function sameChapters(a: StoryChapter[], b: StoryChapter[]): boolean {
  return a.length === b.length && a.every((ch, i) => ch.title === b[i]?.title && ch.body === b[i]?.body);
}

/** 利用者の編集値を優先し、トップレベルの生成値は編集されていない項目の補完にだけ使う */
/**
 * 中計の表示値。利用者が編集した項目（midtermEditedKeys）だけを編集値から取り、それ以外は
 * トップレベルの現在の値を使う。midtermEditedKeys が無い古いデータは、編集値の全項目を編集済みとして扱う。
 */
export function resolveMidtermView(
  edits: Stage2FinalDocumentEdits | undefined | null,
  topLevel: unknown,
): MidtermStrategy {
  const top = isPlainObject(topLevel) ? (topLevel as MidtermStrategy) : ({} as MidtermStrategy);
  const stored = edits?.midtermStrategy;
  if (!isPlainObject(stored)) return top;
  const keys = edits?.midtermEditedKeys;
  const edited = keys
    ? Object.fromEntries(keys.filter((k) => k in stored).map((k) => [k, (stored as Record<string, unknown>)[k]]))
    : stored;
  return { ...top, ...(edited as Partial<MidtermStrategy>) };
}

export function mergeMidtermStrategyIntoDocumentEdits(
  edits: Stage2FinalDocumentEdits | undefined | null,
  midtermStrategy: unknown,
): Stage2FinalDocumentEdits | undefined {
  if (!isPlainObject(midtermStrategy)) return edits ?? undefined;
  return { ...(edits ?? {}), midtermStrategy: resolveMidtermView(edits, midtermStrategy) };
}

/**
 * 保存用。旧コードでも中計を表示できるよう、その時点の表示値を編集値の中計として残す。
 * 編集した項目の記録（midtermEditedKeys）は変更しない。
 */
export function withMidtermSnapshot(
  edits: Stage2FinalDocumentEdits | undefined | null,
  topLevel: unknown,
): Stage2FinalDocumentEdits | undefined {
  if (!isPlainObject(edits?.midtermStrategy)) return edits ?? undefined;
  return { ...(edits ?? {}), midtermStrategy: resolveMidtermView(edits, topLevel) };
}

/** 利用者が変更した項目だけを編集値に加える。未変更の項目はトップレベルの生成値に任せる */
export function applyMidtermPatch(
  edits: Stage2FinalDocumentEdits | undefined,
  patch: Partial<MidtermStrategy>,
): Stage2FinalDocumentEdits {
  const prior = edits?.midtermEditedKeys ?? Object.keys(edits?.midtermStrategy ?? {});
  return {
    ...(edits ?? {}),
    midtermStrategy: { ...(edits?.midtermStrategy ?? {}), ...patch },
    midtermEditedKeys: [...new Set([...prior, ...Object.keys(patch)])],
  };
}

export function resolveConclusion(edited: string | undefined, aiGenerated: string | undefined): string {
  if (edited?.trim()) return edited;
  return aiGenerated?.trim() ? aiGenerated : '';
}

export function normalizeAssumptions(raw: Partial<StrategicAssumptions>): StrategicAssumptions {
  return {
    external: raw.external ?? [],
    internal: raw.internal ?? [],
    implications: raw.implications ?? [],
  };
}

export function resolveStrategicAssumptions(
  edited: Partial<StrategicAssumptions> | undefined,
  computed: StrategicAssumptions,
): StrategicAssumptions {
  return edited ? normalizeAssumptions(edited) : computed;
}

function cleanSwotText(text: unknown): string {
  if (!text || typeof text !== 'string') return '';
  const cleaned = text
    .replace(/[*_#\-`【】]/g, ' ')
    .replace(/^[0-9０-９．.、]+[\s　]*/g, '')
    .trim();
  const firstLine = cleaned.split(/[\n。]/)[0]?.trim() || '';
  if (firstLine.length > 100) return `${firstLine.substring(0, 95)}…`;
  return firstLine;
}

/** SWOT と中計の成長戦略から、企業固有の根拠がある項目だけを作る（汎用文による補完はしない） */
type SwotSuggestionsLike = {
  strength?: unknown;
  weakness?: unknown;
  opportunity?: unknown;
  threat?: unknown;
};

type SwotDataLike = {
  strengths?: unknown;
  weaknesses?: unknown;
  opportunities?: unknown;
  threats?: unknown;
};

export function buildStrategicAssumptions(input: {
  swotSuggestions?: SwotSuggestionsLike | null;
  swotData?: SwotDataLike | null;
  midtermStrategy?: MidtermStrategy;
}): StrategicAssumptions {
  const seen = new Set<string>();
  const collect = (...lists: unknown[]): string[] => {
    const out: string[] = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const cleaned = cleanSwotText(item);
        if (cleaned && !seen.has(cleaned)) {
          seen.add(cleaned);
          out.push(cleaned);
        }
      }
    }
    return out.slice(0, 3);
  };

  const external = collect(
    input.swotSuggestions?.opportunity,
    input.swotData?.opportunities,
    input.swotSuggestions?.threat,
    input.swotData?.threats,
  );
  const internal = collect(
    input.swotSuggestions?.strength,
    input.swotData?.strengths,
    input.swotSuggestions?.weakness,
    input.swotData?.weaknesses,
  );
  const growth = cleanSwotText(input.midtermStrategy?.growthStrategy);

  return { external, internal, implications: growth ? [growth] : [] };
}

/** 確定版の結論・前提を返す。確定版が無い（旧データで下書きだけがある）場合は下書きを返さない */
export function toConfirmedEdits(
  edits: Stage2FinalDocumentEdits | undefined | null,
): Stage2FinalDocumentEdits | undefined {
  if (!edits) return undefined;
  if (edits.confirmed) return { conclusion: edits.confirmed.conclusion, assumptions: edits.confirmed.assumptions };
  if (edits.draftChangedAt) return {};
  return edits;
}

export function markDraftChanged(
  edits: Stage2FinalDocumentEdits | undefined,
  changedAt: string,
): Stage2FinalDocumentEdits {
  return { ...(edits ?? {}), draftChangedAt: changedAt };
}

/** 保存する編集内容に確定記録が無い場合、保存済みの確定記録を引き継ぐ（編集中の値で確定記録を消さない） */
export function withStoredConfirmedRecord(
  edits: Stage2FinalDocumentEdits | undefined,
  stored: Stage2FinalDocumentEdits | undefined | null,
): Stage2FinalDocumentEdits | undefined {
  if (edits?.confirmed || !stored?.confirmed) return edits;
  return { ...(edits ?? {}), confirmed: stored.confirmed };
}

export function buildConfirmedDocumentEdits(input: {
  edits: Stage2FinalDocumentEdits | undefined;
  aiGeneratedConclusion?: string;
  assumptions: StrategicAssumptions;
  confirmedAt: string;
}): Stage2FinalDocumentEdits {
  const rest: Stage2FinalDocumentEdits = { ...(input.edits ?? {}) };
  delete rest.draftChangedAt;
  return {
    ...rest,
    confirmed: {
      conclusion: resolveConclusion(input.edits?.conclusion, input.aiGeneratedConclusion),
      assumptions: input.assumptions,
      confirmedAt: input.confirmedAt,
    },
  };
}

/** 確定後に保存された章の一覧。確定版より新しい編集がある場合だけ表示対象に選ぶ */
export function pickDisplayedStory(
  input: {
    finalStoryFinal?: StoryChapter[] | null;
    finalStoryEdited?: StoryChapter[] | null;
    finalStoryDraft?: StoryChapter[] | null;
  },
  unconfirmed: UnconfirmedChanges,
): StoryChapter[] {
  const finalStory = input.finalStoryFinal ?? [];
  const edited = input.finalStoryEdited ?? [];
  if (finalStory.length > 0) return unconfirmed.chapters && edited.length > 0 ? edited : finalStory;
  if (edited.length > 0) return edited;
  return input.finalStoryDraft ?? [];
}

/**
 * 確定版と保存済みの編集内容の差分を検出する。
 * 確定スナップショットも下書きの印も無い旧データは、保存済みの値を確定済みとして扱い、差分の判定対象外にする。
 */
export function findUnconfirmedChanges(input: {
  finalStoryFinal?: StoryChapter[] | null;
  finalStoryEdited?: StoryChapter[] | null;
  edits?: Stage2FinalDocumentEdits | null;
  midtermStrategy?: MidtermStrategy | null;
  aiGeneratedConclusion?: string;
}): UnconfirmedChanges {
  const none = { chapters: false, document: false, midtermStrategy: false };
  const confirmed = input.finalStoryFinal ?? [];
  if (confirmed.length === 0) return none;
  if (!input.edits?.confirmed && !input.edits?.draftChangedAt) return none;

  const edited = input.finalStoryEdited ?? [];
  const chapters = edited.length > 0 && !sameChapters(edited, confirmed);

  const snapshot = input.edits?.confirmed;
  const conclusionNow = resolveConclusion(input.edits?.conclusion, input.aiGeneratedConclusion);
  const document = snapshot
    ? (conclusionNow !== '' && conclusionNow !== (snapshot.conclusion ?? '')) ||
      (!!input.edits?.assumptions &&
        stableStringify(normalizeAssumptions(input.edits.assumptions)) !==
          stableStringify(normalizeAssumptions(snapshot.assumptions ?? {})))
    : !!input.edits && (input.edits.conclusion !== undefined || input.edits.assumptions !== undefined);

  const topLevel = input.midtermStrategy ?? {};
  const midtermStrategy =
    !!input.edits?.midtermStrategy &&
    stableStringify(resolveMidtermView(input.edits, topLevel)) !== stableStringify(topLevel);

  return { chapters, document, midtermStrategy };
}

/** 会社の数値目標のうち、売上と営業利益を抽出する（営業利益率など別指標は除外） */
export function pickFinancialTargets(targets: CompanyTarget[] | null | undefined): {
  revenue?: FinancialTargetRow;
  operatingProfit?: FinancialTargetRow;
} {
  const usable = (targets ?? []).filter(
    (t) => typeof t?.label === 'string' && Number.isFinite(t.base) && typeof t.unit === 'string' && t.unit.trim() !== '',
  );
  const find = (keyword: string): FinancialTargetRow | undefined => {
    const hit =
      usable.find((t) => t.label.trim() === keyword) ??
      usable.find((t) => t.label.includes(keyword) && !t.label.includes('率'));
    return hit ? { label: hit.label, base: hit.base, unit: hit.unit, dueYear: hit.dueYear } : undefined;
  };
  return { revenue: find('売上'), operatingProfit: find('営業利益') };
}
