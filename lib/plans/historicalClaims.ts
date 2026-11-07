export type HistoricalFinanceRow = {
  year: number;
  revenue?: number;
  operatingIncome?: number;
  netIncome?: number;
};

type MetricKey = 'revenue' | 'operatingIncome' | 'netIncome';

const METRICS: Array<{ key: MetricKey; label: string; words: string[] }> = [
  { key: 'revenue', label: '売上高', words: ['売上高', '売上'] },
  { key: 'operatingIncome', label: '営業利益', words: ['営業利益'] },
  { key: 'netIncome', label: '当期純利益', words: ['当期純利益', '純利益'] },
];
const INCREASE_WORDS = ['増加', '伸長', '拡大', '上昇', '伸び', '増収', '増益', '回復'];
const DECREASE_WORDS = ['減少', '縮小', '低下', '下落', '減収', '減益'];
const BOTTOM_CLAIM = /(\d{4})年(?:を|に)?底/;
const PERIOD_CLAIM = /(\d{4})年から(\d{4})年/;
const BULLET_PREFIX = /^(\s*(?:[-*]\s+|\d+[.．]\s+))?([\s\S]*)$/;

function seriesOf(rows: HistoricalFinanceRow[], key: MetricKey): Array<[number, number]> {
  return rows
    .map((r): [number, number | undefined] => [r.year, r[key]])
    .filter((entry): entry is [number, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .sort((a, b) => a[0] - b[0]);
}

function bottomClaimHolds(year: number, s: Array<[number, number]>): boolean {
  const at = s.find(([y]) => y === year);
  if (!at || s.length < 2) return false;
  const min = Math.min(...s.map(([, v]) => v));
  if (at[1] !== min || s.filter(([, v]) => v === min).length !== 1) return false;
  return s[s.length - 1][1] > at[1];
}

function periodClaimHolds(from: number, to: number, up: boolean, s: Array<[number, number]>): boolean {
  const a = s.find(([y]) => y === from);
  const b = s.find(([y]) => y === to);
  if (!a || !b) return false;
  return up ? b[1] > a[1] : b[1] < a[1];
}

/** 文が過去実績と合わない、または実績で確認できない断定を含むときに、その指標名を返す */
function wrongMetricLabels(sentence: string, rows: HistoricalFinanceRow[]): string[] | null {
  const metrics = METRICS.filter((m) => m.words.some((w) => sentence.includes(w)));
  if (metrics.length === 0) return null;
  const up = INCREASE_WORDS.some((w) => sentence.includes(w));
  const down = DECREASE_WORDS.some((w) => sentence.includes(w));
  const bottom = sentence.match(BOTTOM_CLAIM);
  const period = sentence.match(PERIOD_CLAIM);
  let wrong = false;
  if (bottom) {
    const year = Number(bottom[1]);
    for (const m of metrics) if (!bottomClaimHolds(year, seriesOf(rows, m.key))) wrong = true;
  }
  if (period && up !== down) {
    const from = Number(period[1]);
    const to = Number(period[2]);
    for (const m of metrics) if (!periodClaimHolds(from, to, up, seriesOf(rows, m.key))) wrong = true;
  }
  return wrong ? metrics.map((m) => m.label) : null;
}

/** 過去実績を引用した文の増減・底の断定を実績と照合し、合わない文を実績表を参照する文に差し替える */
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
        const labels = wrongMetricLabels(sentence, rows);
        if (!labels) return part;
        corrected.push(sentence);
        return `${labels.join('、')}の過去実績の推移は、実績表のとおりです。`;
      })
      .join('');
    return `${prefix}${fixed}`;
  });
  return { text: lines.join('\n'), corrected };
}
