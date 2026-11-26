import { normalizePdfText } from './pdfImporter';
import { buildCandidatesFromPdfText } from './candidateBuilder';

const SPACED_PAGE = [
  '財務実績',
  '2022 年 3 月期〜2026 年 3 月期 金額単位：千円',
  '項目 2022/3 2023/3 2024/3 2025/3 2026/3',
  '売上高 161,000 162,000 166,000 168,500 172,000',
  '3. 貸借対照表（2026 年 3 月 31 日現在）',
  '現金及び預金 12,000 流動負債 26,000',
  '固定資産 54,000 純資産 28,000',
  '資産合計 84,000 負債・純資産合計 84,000',
].join('\n');

function pages(text: string) {
  return [{ pageNumber: 1, isPriority: true, text: normalizePdfText(text) }];
}

describe('PDFの空白の入り方を正規化する', () => {
  it('数字と年・月・名・千円の間の空白をつなぎ、改行は残す', () => {
    expect(normalizePdfText('2026 年 3 月期')).toBe('2026年3月期');
    expect(normalizePdfText('従業員数 15 名（2026 年 3 月末現在）')).toBe('従業員数 15名(2026年3月末現在)');
    expect(normalizePdfText('資本金 5,000 千円\n決算期 3 月末')).toBe('資本金 5,000千円\n決算期 3月末');
    expect(normalizePdfText('売上高　161,000')).toBe('売上高 161,000');
  });

  it('基準日（2026年3月31日現在）が読めると、貸借対照表は2026年度の値だけになる', () => {
    const candidates = buildCandidatesFromPdfText(pages(SPACED_PAGE));
    const bs = candidates.filter((c) => c.kind === 'companyBS');
    expect(bs.map((c) => c.year)).toEqual([2026]);
    expect(bs[0].fields).toEqual({ cash: 12_000, fixedAssets: 54_000, netAssets: 28_000, totalAssets: 84_000 });
  });

  it('基準日が読めない貸借対照表の数値を、年度の列へ推測で割り当てない', () => {
    const noDate = SPACED_PAGE.replace('3. 貸借対照表（2026 年 3 月 31 日現在）', '3. 貸借対照表');
    const candidates = buildCandidatesFromPdfText(pages(noDate));
    expect(candidates.filter((c) => c.kind === 'companyBS')).toEqual([]);
    expect(candidates.some((c) => c.kind === 'companyPL' && c.year === 2026)).toBe(true);
  });
});
