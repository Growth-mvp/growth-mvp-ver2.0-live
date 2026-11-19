/* 報告セグメント（連結）の売上高・営業利益と、説明文にあるセグメント名を取り出す。
 * セグメント名は説明文の「〜事業」の並びから取り、件数が報告セグメントの数と一致した時だけ、順番で対応付ける。
 * 一致しなければ名前は付けず、未取得として示す。合計との差は、表示の丸め（百万円単位）の範囲までを許容する。 */
import type { CsvRow } from './edinetZip';

export const SEGMENT_SUM_TOLERANCE_YEN = 1_000_000;

export type SegmentItem = { memberCode: string; sales?: number; operatingIncome?: number };

export type SegmentExtract = {
  periodEnd: string | null;
  items: SegmentItem[];
  totals: { sales?: number; operatingIncome?: number };
  names: string[];
  checks: Array<{ metric: 'sales' | 'operatingIncome'; sumOfSegments: number; total: number; ok: boolean }>;
  issues: string[];
};

const MEMBER_PATTERN = /^jpcrp\d+-asr_E[0-9A-Z]+-\d+(.+)ReportableSegmentsMember$/;
const NAME_SPLIT = /を|の|は|が|で|と|も|に|する|及び|並びに|または|ならびに|など/;
const NAME_EXCLUDE = /^(主な|当社|関係会社|各社|当該|同|その|この)/;

const PROTECT = '';

export function segmentNamesFromText(text: string): string[] {
  const names: string[] = [];
  const protectedText = text.replace(/その/g, PROTECT);
  for (const chunk of protectedText.split(/[、。，,：:（）()「」『』\s　]/)) {
    for (const token of chunk.split(NAME_SPLIT)) {
      const t = token.replace(new RegExp(PROTECT, 'g'), 'その').trim();
      if (t.length >= 3 && t.length <= 24 && t.endsWith('事業') && !NAME_EXCLUDE.test(t) && !names.includes(t)) names.push(t);
    }
  }
  // 別の名前を末尾に含む長い語（「事業チェーンストア事業」など）は、切れ端の混入として除く
  return names.filter((n) => !names.some((m) => m !== n && n.endsWith(m)));
}

function numberOf(value: string): number | undefined {
  if (value === '' || value === '－' || value === '-') return undefined;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function extractSegments(rows: CsvRow[], periodEnd: string | null): SegmentExtract {
  const issues: string[] = [];
  const byMember = new Map<string, SegmentItem>();
  const totals: SegmentExtract['totals'] = {};

  for (const r of rows) {
    if (r.scope !== '連結' || r.unit !== '円') continue;
    if (r.elementId !== 'jppfs_cor:NetSales' && r.elementId !== 'jppfs_cor:OperatingIncome') continue;
    if (!r.contextId.startsWith('CurrentYearDuration_')) continue;
    const member = r.contextId.slice('CurrentYearDuration_'.length);
    const metric = r.elementId === 'jppfs_cor:NetSales' ? 'sales' : 'operatingIncome';
    const value = numberOf(r.value);
    if (value === undefined) continue;
    if (member === 'ReportableSegmentsMember') {
      totals[metric] = value;
      continue;
    }
    const m = MEMBER_PATTERN.exec(member);
    if (!m) continue;
    const item = byMember.get(member) ?? { memberCode: m[1] };
    item[metric] = value;
    byMember.set(member, item);
  }

  const items = [...byMember.values()];
  const checks: SegmentExtract['checks'] = [];
  for (const metric of ['sales', 'operatingIncome'] as const) {
    const total = totals[metric];
    if (total === undefined || items.length === 0) continue;
    const sum = items.reduce((acc, it) => acc + (it[metric] ?? 0), 0);
    const ok = Math.abs(sum - total) <= SEGMENT_SUM_TOLERANCE_YEN;
    checks.push({ metric, sumOfSegments: sum, total, ok });
    if (!ok) issues.push(`報告セグメントの${metric === 'sales' ? '売上高' : '営業利益'}の合計が全体と一致しない（差：${sum - total}円）`);
  }

  const description = rows.find(
    (r) => r.elementId === 'jpcrp_cor:DescriptionOfReportableSegmentsTextBlock' && r.contextId === 'CurrentYearDuration',
  )?.value ?? '';
  const names = segmentNamesFromText(description);
  let assigned: string[] = [];
  if (items.length > 0 && names.length === items.length) {
    assigned = names;
    issues.push('セグメント名は説明文の並びから対応付けた（順番どおり。要確認）');
  } else if (items.length > 0) {
    issues.push('セグメント名を説明文から特定できないため、名前は未入力のまま（区分コードのみ）');
  }

  return { periodEnd, items, totals, names: assigned, checks, issues };
}
