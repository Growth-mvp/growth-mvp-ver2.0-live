export type HistoricalFinanceRow = {
  year: number;
  revenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
};

type MetricKey = 'revenue' | 'grossProfit' | 'operatingIncome' | 'netIncome';

const METRICS: Array<{ key: MetricKey; label: string; words: string[] }> = [
  { key: 'revenue', label: '売上高', words: ['売上高'] },
  { key: 'grossProfit', label: '売上総利益', words: ['売上総利益'] },
  { key: 'operatingIncome', label: '営業利益', words: ['営業利益'] },
  { key: 'netIncome', label: '当期純利益', words: ['当期純利益', '純利益'] },
];
const INCREASE_WORDS = ['増加', '伸長', '拡大', '上昇', '伸び', '増収', '増益', '回復'];
const DECREASE_WORDS = ['減少', '縮小', '低下', '下落', '減収', '減益'];
const BOTTOM_CLAIM = /(\d{4})年(?:を|に)?底/;
const BULLET_PREFIX = /^(\s*(?:[-*]\s+|\d+[.．]\s+))?([\s\S]*)$/;

function seriesOf(rows: HistoricalFinanceRow[], key: MetricKey): Array<[number, number]> {
  return rows
    .map((r): [number, number | undefined] => [r.year, r[key]])
    .filter((entry): entry is [number, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .sort((a, b) => a[0] - b[0]);
}

function valueAt(s: Array<[number, number]>, year: number): number | undefined {
  return s.find(([y]) => y === year)?.[1];
}

function bottomClaimHolds(year: number, s: Array<[number, number]>): boolean {
  const at = valueAt(s, year);
  if (at === undefined || s.length < 2) return false;
  const min = Math.min(...s.map(([, v]) => v));
  if (at !== min || s.filter(([, v]) => v === min).length !== 1) return false;
  return s[s.length - 1][1] > at;
}

/** 指標の後ろから次の読点・句点までの範囲で、最初に現れる向きの語 */
function directionAfter(sentence: string, word: string): 'up' | 'down' | undefined {
  const start = sentence.indexOf(word);
  if (start < 0) return undefined;
  const rest = sentence.slice(start + word.length).split(/[、。]/)[0];
  const up = INCREASE_WORDS.findIndex((w) => rest.includes(w));
  const down = DECREASE_WORDS.findIndex((w) => rest.includes(w));
  const upAt = up < 0 ? Infinity : Math.min(...INCREASE_WORDS.filter((w) => rest.includes(w)).map((w) => rest.indexOf(w)));
  const downAt = down < 0 ? Infinity : Math.min(...DECREASE_WORDS.filter((w) => rest.includes(w)).map((w) => rest.indexOf(w)));
  if (upAt === Infinity && downAt === Infinity) return undefined;
  return upAt < downAt ? 'up' : 'down';
}

function actualWord(change: number): string {
  if (change > 0) return '増加';
  if (change < 0) return '減少';
  return '横ばい';
}

type MetricClaim = { label: string; direction?: 'up' | 'down'; key: MetricKey; words: string[] };

/**
 * 文の照合。誤りまたは実績で確認できない断定があれば、実績から求めた事実の文を返す。
 * 誤りがなければ null。
 */
function correctedSentence(sentence: string, rows: HistoricalFinanceRow[]): string | null {
  const claims: MetricClaim[] = METRICS.filter((m) => m.words.some((w) => sentence.includes(w))).map((m) => {
    const word = m.words.find((w) => sentence.includes(w)) ?? m.words[0];
    return { label: m.label, key: m.key, words: m.words, direction: directionAfter(sentence, word) };
  });
  if (claims.length === 0) return null;

  const years = [...new Set([...sentence.matchAll(/(\d{4})年/g)].map((m) => Number(m[1])))];
  const bottom = sentence.match(BOTTOM_CLAIM);
  const comparison = years.length >= 2 && /より|比べ/.test(sentence);
  const period = years.length >= 2 && !comparison && sentence.includes('から');

  let wrong = false;
  let neutral = false;
  if (bottom) {
    const year = Number(bottom[1]);
    for (const c of claims) if (!bottomClaimHolds(year, seriesOf(rows, c.key))) wrong = true;
    if (wrong) neutral = true;
  }

  const statements: string[] = [];
  for (const c of claims) {
    if (!c.direction) continue;
    const s = seriesOf(rows, c.key);
    const [later, earlier] = comparison ? [years[0], years[1]] : [years[1], years[0]];
    if (!period && !comparison) continue;
    const vLater = valueAt(s, later);
    const vEarlier = valueAt(s, earlier);
    const claimHolds =
      vLater !== undefined &&
      vEarlier !== undefined &&
      (c.direction === 'up' ? vLater > vEarlier : vLater < vEarlier);
    if (!claimHolds) wrong = true;
    if (vLater !== undefined && vEarlier !== undefined) {
      const word = actualWord(vLater - vEarlier);
      statements.push(
        comparison
          ? `${years[0]}年度の${c.label}は${years[1]}年度より${word}しました。`
          : `${years[0]}年から${years[1]}年にかけて${c.label}は${word}しました。`,
      );
    } else {
      neutral = true;
    }
  }

  if (!wrong && !neutral) return null;
  if (neutral || statements.length === 0) {
    return `${claims.map((c) => c.label).join('、')}の過去実績の推移は、実績表のとおりです。`;
  }
  return statements.join('');
}

/** 過去実績を引用した文の増減・底の断定を実績と照合し、合わない文を実績から求めた事実の文に差し替える */
export function correctHistoricalClaims(
  text: string,
  rows: HistoricalFinanceRow[],
): { text: string; corrected: string[] } {
  if (rows.length === 0) return { text, corrected: [] };
  const corrected: string[] = [];
  const lines = text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('|')) return line;
    const [, prefix = '', body] = line.match(BULLET_PREFIX) ?? ['', '', line];
    const fixed = body
      .split(/(?<=。)/)
      .map((part) => {
        const sentence = part.trim();
        if (sentence === '') return part;
        const replacement = correctedSentence(sentence, rows);
        if (replacement === null) return part;
        corrected.push(sentence);
        return replacement;
      })
      .join('');
    return `${prefix}${fixed}`;
  });
  return { text: lines.join('\n'), corrected };
}
