import { isNearDuplicate, type Finding, type OtItem, type OtAnalysis, type Source } from './generateOt';
import { MARKET_CATEGORY_IDS } from './marketTaxonomy';

/** 将来の影響を述べる表現。O・T の文はこの種の表現を含むため、事実として扱わない */
export const PREDICTION_PATTERN = /可能性|見込み|増える|減る|増加|減少|拡大|縮小|高まる|低下|広がる|強まる|弱まる|増す|落ち込む/;

/** 予測・見通しを示す表現。出典がこれだけの場合、その数値は実績ではない */
export const FORECAST_PATTERN = /予測|見込み|見通し|予想/;

/** 出典との内容の一致を見るときに、共通語として数えない語（市場の一般語） */
const GENERIC_TOKENS = new Set([
  '市場', '需要', '企業', '顧客', '同社', '動向', '可能性', '影響', '拡大', '増加', '減少', '変化', '日本', '国内', '海外',
  '製造', '事業', '業界', '会社', '年度', '前年', '競争', '競合', '世界', '今後', '将来', '成長', '機会', '脅威', '出荷',
  '調達', '製品', 'サービス', 'メーカー', '向け', '対象', '地域', '数量', '金額', '前年比', 'ニーズ', '容器',
]);

const TOKEN_PATTERN = '[\\p{Script=Han}\\p{Script=Katakana}A-Za-z0-9]{2,}';

/** 項目の文と出典の主張が、内容語（市場・製品・数値の語）を1つでも共有するか */
export function sharesGroundingToken(text: string, statements: readonly string[]): boolean {
  const tokens = (s: string) => {
    const out = new Set<string>();
    const re = new RegExp(TOKEN_PATTERN, 'gu');
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const t = m[0].toLowerCase();
      if (!GENERIC_TOKENS.has(t)) out.add(t);
    }
    return out;
  };
  const own = tokens(text);
  if (own.size === 0) return false;
  return statements.some((st) => Array.from(tokens(st)).some((t) => own.has(t)));
}

/** 2桁以上の数（年度・金額・割合）。1桁の数は文中の番号や「3〜5年」の表現に当たるため対象にしない */
const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

function numbersIn(s: string): string[] {
  return (s.replace(/,/g, '').match(NUMBER_PATTERN) ?? []).filter((n) => n.replace('.', '').length >= 2);
}

/** 項目に含まれる数値・年度が、出典の主張のどれかに同じ表記で含まれるか（語の一致ではなく数値の一致だけを見る） */
export function numbersCoveredBySource(text: string, statements: readonly string[]): boolean {
  const own = numbersIn(text);
  if (own.length === 0) return true;
  const available = new Set(statements.flatMap((st) => numbersIn(st)));
  return own.every((n) => available.has(n));
}

export type QualityReport = {
  basisCorrected: number;
  sourceLinkedHypotheses: number;
  sourceIndexInvalid: number;
  invalidSourceUrls: number;
  crossListDuplicates: number;
  unknownCategoryIds: number;
  forecastFactCorrected: number;
  numberNotInSourceCorrected: number;
  unlinkedCitations: number;
  unverifiedSources: number;
  opportunityCount: number;
  threatCount: number;
  issues: string[];
};

export function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * 生成結果をプログラムで検査し、明らかな矛盾だけを補正する。
 * - 出典番号が存在しない・URL が不正な場合は、その出典を根拠にしない（sourceIndex を null）
 * - 出典の主張と項目の内容が共通語を持たない場合は、その出典を根拠にしない（sourceIndex を null）
 * - 将来の影響を述べる文・予測だけの出典に基づく文を「事実」と表示しない（hypothesis に補正）
 * - 事実の文の数値・年度が出典の主張に無い場合は「事実」と表示しない（hypothesis に補正）
 * - 分類 ID が未知の場合は報告する（推測で補わない）
 * 結果の内容（文章）は報告に含めず、件数と種類だけを返す。
 * 共通語による検査は語の一致だけを見る近似であり、内容の正しさは保証しない（実際の出典本文での確認が別途必要）。
 */
export function inspectOtResult(
  analysis: OtAnalysis,
  sources: readonly Source[],
  categoryIds: readonly string[],
  findings: readonly Finding[] = []
): { analysis: OtAnalysis; report: QualityReport } {
  const issues: string[] = [];
  const badSourceIndexes = new Set<number>();
  let invalidSourceUrls = 0;
  for (const s of sources) {
    if (!isHttpsUrl(s.url)) {
      badSourceIndexes.add(s.index);
      invalidSourceUrls++;
    }
  }
  if (invalidSourceUrls) issues.push('invalid_source_url');

  const validIndexes = new Set(sources.map((s) => s.index));
  const report: QualityReport = {
    basisCorrected: 0,
    sourceLinkedHypotheses: 0,
    sourceIndexInvalid: 0,
    invalidSourceUrls,
    crossListDuplicates: 0,
    unknownCategoryIds: categoryIds.filter((id) => !MARKET_CATEGORY_IDS.has(id)).length,
    forecastFactCorrected: 0,
    numberNotInSourceCorrected: 0,
    unlinkedCitations: 0,
    unverifiedSources: sources.filter((s) => s.contentVerified !== true).length,
    opportunityCount: analysis.opportunities.length,
    threatCount: analysis.threats.length,
    issues,
  };
  if (report.unknownCategoryIds) issues.push('unknown_category_id');
  if (
    analysis.opportunities.length < 1 ||
    analysis.opportunities.length > 5 ||
    analysis.threats.length < 1 ||
    analysis.threats.length > 5
  ) {
    issues.push('format_count');
  }

  const fix = (item: OtItem): OtItem => {
    let sourceIndex = item.sourceIndex;
    if (sourceIndex !== null && (!validIndexes.has(sourceIndex) || badSourceIndexes.has(sourceIndex))) {
      sourceIndex = null;
      report.sourceIndexInvalid++;
      issues.push('source_index_unresolved');
    }
    const cited = sourceIndex === null ? [] : findings.filter((f) => f.sourceIndex === sourceIndex);
    if (sourceIndex !== null && cited.length > 0 && !sharesGroundingToken(item.text, cited.map((f) => f.statement))) {
      sourceIndex = null;
      report.unlinkedCitations++;
      issues.push('citation_unlinked');
    }

    let basis = item.basis;
    if (basis === 'fact') {
      if (PREDICTION_PATTERN.test(item.text)) {
        basis = 'hypothesis';
        report.basisCorrected++;
        issues.push('fact_with_prediction_corrected');
      } else if (
        FORECAST_PATTERN.test(item.text) ||
        (cited.length > 0 && cited.every((f) => FORECAST_PATTERN.test(f.statement)))
      ) {
        basis = 'hypothesis';
        report.forecastFactCorrected++;
        issues.push('forecast_as_fact_corrected');
      } else if (
        sourceIndex !== null &&
        cited.length > 0 &&
        !numbersCoveredBySource(item.text, cited.map((f) => f.statement))
      ) {
        basis = 'hypothesis';
        report.numberNotInSourceCorrected++;
        issues.push('fact_number_not_in_source_corrected');
      } else if (sourceIndex === null && item.evidence.trim() === '') {
        basis = 'hypothesis';
        issues.push('fact_without_grounds');
      }
    }
    if (basis === 'hypothesis' && sourceIndex !== null) report.sourceLinkedHypotheses++;
    return { ...item, basis, sourceIndex };
  };

  const opportunities = analysis.opportunities.map(fix);
  const threats = analysis.threats.map(fix);

  for (const o of opportunities) {
    if (threats.some((t) => isNearDuplicate(o.text, t.text))) report.crossListDuplicates++;
  }
  if (report.crossListDuplicates) issues.push('cross_list_duplicate');

  return {
    analysis: { opportunities, threats },
    report: { ...report, issues: Array.from(new Set(issues)) },
  };
}
