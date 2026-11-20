/* 検証用PDF（test-files/ph52b2-company-statement.pdf）を、実際のPDF取り込み処理に通す。
 * pdf.js は Jest の仮想環境で動的 import を使えないため、PDF本体の解析は NODE_OPTIONS=--experimental-vm-modules のときだけ実行する。 */
jest.mock('server-only', () => ({}));

import fs from 'node:fs';
import path from 'node:path';
import { detectFileType } from './excelCsvImporter';
import { buildCandidatesFromPdfText, normalizeCandidates } from './candidateBuilder';
import { isPdfBuffer } from './pdfImporter';
import { extractProfileFromPages } from './profileExtract';
import { buildDocumentCandidate } from '@/lib/autofill/publicCandidate';

const FILE = 'ph52b2-company-statement.pdf';
const PDF_PATH = path.join(__dirname, '..', '..', '..', 'test-files', FILE);
const withVmModules = (process.env.NODE_OPTIONS ?? '').includes('experimental-vm-modules') ? describe : describe.skip;

describe('PDFの判定（CSVとして誤って解析しない）', () => {
  it('PDFのバイナリは、中に区切り文字があってもPDFと判定し、CSVとは扱わない', () => {
    const pdfLike = Buffer.from('%PDF-1.4\n1 0 obj << /Length 10, /Filter /FlateDecode >>\n', 'ascii');
    expect(isPdfBuffer(pdfLike)).toBe(true);
    expect(detectFileType(pdfLike, FILE)).toBe('unknown');
  });

  it('拡張子が無くても、PDFの先頭記号で判定する', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n,,,', 'ascii'), 'noext')).toBe('unknown');
  });

  it('CSVは従来どおりCSVとして判定する', () => {
    expect(detectFileType(Buffer.from('項目,2024\n売上高,100\n', 'utf-8'), 'a.csv')).toBe('csv');
  });
});

withVmModules('検証用PDFの読み込み（実際のPDF取り込み処理）', () => {
  it('会社基本情報・事業別財務を含め、単位換算した候補になる', async () => {
    const { parsePdf } = await import('./pdfImporter');
    const buf = fs.readFileSync(PDF_PATH);
    const result = await parsePdf(buf);

    expect(result.totalPages).toBe(5);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5]);

    const rawCandidates = buildCandidatesFromPdfText(result.pages).map((c) => ({ ...c, source: FILE }));
    const profile = extractProfileFromPages(result.pages, FILE);
    expect(profile.companyName?.value).toBe('株式会社サンプル製作所');
    expect(profile.location?.value).toBe('東京都千代田区1-1-1');
    expect(profile.employees?.value).toBe(120);
    expect(profile.businessContent?.value).toBe('産業用機械の設計・製造');

    const r = buildDocumentCandidate({ candidates: normalizeCandidates(rawCandidates), profiles: [profile], fetchedAt: 'T' });
    expect(r.status).toBe('FOUND');
    if (r.status !== 'FOUND') return;
    const c = r.candidate;

    expect(c.finance.map((y) => y.year)).toEqual([2022, 2023, 2024]);
    expect(c.finance.find((y) => y.year === 2024)).toMatchObject({
      revenue: { value: 1_400_000_000 },
      operatingIncome: { value: 280_000_000 },
      netIncome: { value: 190_000_000 },
      totalAssets: { value: 2_640_000_000 },
      netAssets: { value: 1_840_000_000 },
    });
    expect(c.segments?.items.map((s) => [s.name, s.sales, s.operatingIncome])).toEqual([
      ['事業部A', 700_000_000, 140_000_000],
      ['事業部B', 700_000_000, 140_000_000],
    ]);
    expect(c.issues.some((t) => t.includes(`${FILE}（百万円→円）`))).toBe(true);
    expect(c.issues.some((t) => t.includes('連結・単体は資料の名称から判断できない'))).toBe(true);
    expect(c.sources.filter((s) => s.source === 'DOCUMENT').map((s) => (s.source === 'DOCUMENT' ? s.fileName : ''))).toEqual([FILE]);
  });
});
