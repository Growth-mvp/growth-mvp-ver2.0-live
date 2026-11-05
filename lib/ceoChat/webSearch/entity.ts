export type FactEntity = 'self' | 'competitor' | 'market' | 'unclassified';

const LEGAL_FORM_PATTERN = '株式会社|有限会社|合同会社|\\(株\\)';
const LEGAL_FORM = new RegExp(LEGAL_FORM_PATTERN);
const OTHER_COMPANY = new RegExp(`${LEGAL_FORM_PATTERN}|ホールディングス`);
const NAME_CHAR = /[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9ー]/u;
const AFFILIATE_AFTER = /^(の?(グループ|ホールディングス|子会社|関係会社|関連会社|海外法人|国内法人)|ホールディングス|HD|グループ)/;

const MIN_CORE_LENGTH = 2;

function normalizeText(text: string): string {
  return text.replace(/㈱/g, '株式会社').normalize('NFKC');
}

/** 正式名称から法人格と空白を除いた、照合用の名称 */
export function coreCompanyName(companyName: string | undefined): string {
  return normalizeText(companyName ?? '')
    .replace(new RegExp(LEGAL_FORM_PATTERN, 'g'), '')
    .replace(/\s+/g, '');
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type SelfSpan = { start: number; end: number; affiliate: boolean };

function findSelfSpans(text: string, core: string): SelfSpan[] {
  const legal = `(?:${LEGAL_FORM_PATTERN})?`;
  const re = new RegExp(`${legal}${escapeRegExp(core)}${legal}`, 'g');
  const spans: SelfSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    const before = text.slice(0, start).slice(-1);
    const after = text.slice(end);
    if (before && NAME_CHAR.test(before)) continue;
    const affiliate = AFFILIATE_AFTER.test(after);
    if (!affiliate && after && NAME_CHAR.test(after[0])) continue;
    spans.push({ start, end, affiliate });
  }
  return spans;
}

/**
 * 事実の文が、選択中企業（自社）と競合・市場のどれに当たるかを判定する。
 * - 社名の一致だけでは断定しない。同名企業の可能性は表示側で注意を添える。
 * - グループ会社・関連会社（「○○グループ」「○○ホールディングス」など）は自社とみなさない。
 * - 自社名と他社名が同じ文に出る比較は、競合事例として扱わない。
 */
export function classifyFactEntity(text: string, companyName?: string): FactEntity {
  const normalized = normalizeText(text);
  const core = coreCompanyName(companyName);
  const spans = core.length >= MIN_CORE_LENGTH ? findSelfSpans(normalized, core) : [];

  if (spans.some((s) => s.affiliate)) return 'unclassified';

  if (spans.length > 0) {
    let rest = normalized;
    for (const s of [...spans].reverse()) rest = rest.slice(0, s.start) + ' ' + rest.slice(s.end);
    return OTHER_COMPANY.test(rest) ? 'unclassified' : 'self';
  }

  return OTHER_COMPANY.test(normalized) ? 'competitor' : 'market';
}

export type FactEntityCounts = Record<FactEntity, number>;

export function countFactEntities(texts: readonly string[], companyName?: string): FactEntityCounts {
  const counts: FactEntityCounts = { self: 0, competitor: 0, market: 0, unclassified: 0 };
  for (const t of texts) counts[classifyFactEntity(t, companyName)] += 1;
  return counts;
}
