/** 確定 SWOT の1行を1項目とする。読点・句点では分けない */
export function swotItems(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  return text
    .split('\n')
    .map((line) => line.replace(/\r/g, '').trim())
    .filter(Boolean);
}

/**
 * 項目を文字数の上限まで「・」で並べる。
 * 項目は途中で切らず、入りきらない分は件数を本文と戻り値で明示する（黙って省略しない）。
 */
export function swotBullets(text: unknown, maxChars: number): { text: string; included: number; omitted: number } {
  const items = swotItems(text);
  const kept: string[] = [];
  let used = 0;
  for (const item of items) {
    if (kept.length > 0 && used + item.length > maxChars) break;
    kept.push(item);
    used += item.length + 3;
  }
  const omitted = items.length - kept.length;
  const body = kept.join(' ・ ');
  if (!body) return { text: '', included: 0, omitted: 0 };
  return {
    text: omitted > 0 ? `${body} ・（ほか${omitted}件は文字数上限のため省略）` : body,
    included: kept.length,
    omitted,
  };
}
