export const DRAFT_CHAPTER_HEADINGS = [
  '第1章：なぜ今、変わる必要があるのか',
  '第2章：どう戦うのか',
  '第3章：どんな会社になるのか',
  '第4章：まず何をするのか',
] as const;

export type DraftField = { label: string; text: string; items: string[] };

export type DraftWinPattern = { title: string; fields: DraftField[] };

export type ParsedStrategyChapter = {
  conclusion: string | null;
  preamble: DraftField[];
  patterns: DraftWinPattern[];
};

const PATTERN_START = /^\d+\)\s*(?=(?:勝ち筋|狙う価値ドライバー)\s*[:：])/;
const LABEL_LINE = /^([^\s:：\-・（(][^:：]{0,24}?)\s*[:：]\s*(.*)$/;
const ITEM_LINE = /^[-・]\s*/;

const INLINE_LABELS = [
  '戦略結論',
  '事業ポートフォリオ判断',
  '勝ち筋',
  '重要課題・機会',
  '戦略の方向性',
  '成功する根拠',
  '克服すべき障害・リスク',
  '狙う価値ドライバー',
  '狙う顧客と未解決課題',
  '提供する新しい価値',
  '自社が選ばれる理由',
  '実現の障害・競争リスク',
  '経営判断',
  '主要戦略',
  '90日アクション',
  '根拠キーワード',
  '根拠（SWOT）',
  'SWOT判断',
  'トレードオフ',
];
const INLINE_BREAK = new RegExp(`([^\\d)）\\s])\\s+(?=(?:\\d+\\)\\s*)?(?:${INLINE_LABELS.join('|')})\\s*[:：])`, 'g');

function truncateText(text: string, limit: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function addField(fields: DraftField[], label: string, text: string): DraftField {
  const field: DraftField = { label, text, items: [] };
  fields.push(field);
  return field;
}

export function parseStrategyChapter(body: string): ParsedStrategyChapter {
  const lines = String(body ?? '')
    .replace(INLINE_BREAK, '$1\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const preamble: DraftField[] = [];
  const patterns: DraftWinPattern[] = [];
  let fields = preamble;
  let last: DraftField | undefined;

  for (const rawLine of lines) {
    const isPatternStart = PATTERN_START.test(rawLine);
    const line = isPatternStart ? rawLine.replace(/^\d+\)\s*/, '') : rawLine;
    if (isPatternStart) {
      fields = [];
      patterns.push({ title: '', fields });
      last = undefined;
    }

    if (ITEM_LINE.test(line)) {
      if (!last) last = addField(fields, '', '');
      last.items.push(line.replace(ITEM_LINE, ''));
      continue;
    }

    const labelMatch = line.match(LABEL_LINE);
    if (labelMatch) {
      const label = labelMatch[1].trim();
      const value = labelMatch[2].trim();
      if (ITEM_LINE.test(value)) {
        last = addField(fields, label, '');
        last.items.push(value.replace(ITEM_LINE, ''));
      } else {
        last = addField(fields, label, value);
      }
      continue;
    }

    if (!last) last = addField(fields, '', '');
    if (last.items.length > 0) {
      last.items[last.items.length - 1] += `\n${line}`;
    } else {
      last.text = last.text ? `${last.text}\n${line}` : line;
    }
  }

  let conclusion: string | null = null;
  const conclusionIndex = preamble.findIndex((f) => f.label === '戦略結論');
  if (conclusionIndex >= 0) {
    const found = preamble[conclusionIndex];
    conclusion = [found.text, ...found.items].filter(Boolean).join('\n').trim() || null;
    preamble.splice(conclusionIndex, 1);
  }

  for (const pattern of patterns) {
    const titleIndex = pattern.fields.findIndex((f) => f.label === '勝ち筋');
    const driverIndex = pattern.fields.findIndex((f) => f.label === '狙う価値ドライバー');
    const index = titleIndex >= 0 ? titleIndex : driverIndex;
    if (index >= 0) {
      pattern.title = pattern.fields[index].text;
      pattern.fields.splice(index, 1);
    }
    if (!pattern.title) pattern.title = '勝ち筋';
  }

  return { conclusion, preamble, patterns };
}

function findLeadLine(body: string): string | null {
  const labeled = body.match(/(?:要点|結論)\s*[:：]\s*([^\n]+)/);
  if (labeled?.[1]?.trim()) return labeled[1].trim();
  const line = String(body || '')
    .split('\n')
    .map((l) => l.trim().replace(ITEM_LINE, ''))
    .find((l) => l && !/^第[一二三四1-4]章/.test(l) && !LABEL_LINE.test(l));
  return line ?? null;
}

export function extractStrategyConclusion(storyDraft: { body: string }[]): string | null {
  const explicit = parseStrategyChapter(storyDraft[1]?.body ?? '').conclusion;
  if (explicit) return explicit;
  for (const body of [storyDraft[1]?.body ?? '', storyDraft[0]?.body ?? '']) {
    const lead = findLeadLine(body);
    if (lead) return truncateText(lead, 180);
  }
  return null;
}
