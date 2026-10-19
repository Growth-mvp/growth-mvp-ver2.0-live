import fs from 'fs';
import path from 'path';

import pdfMake from 'pdfmake';
import fontkit from 'fontkit';

import {
  buildPlanExportDocument,
  planDocumentPlainText,
  type PlanExportDocument,
} from '@/lib/plans/export/planExportDocument';
import { buildPlanPdfDefinition, PDF_FONT_FAMILY, PDF_FONT_FILES } from '@/lib/plans/export/toPdf';

const FIXTURES = [
  { audience: 'bank', file: 'bank.md' },
  { audience: 'shareholder', file: 'shareholder.md' },
  { audience: 'employee', file: 'employee.md' },
] as const;

const GENERATED_AT = '2026-10-20T03:00:00.000Z';
const FONT_DIR = path.join(process.cwd(), 'public', 'fonts');
const REGULAR = path.join(FONT_DIR, PDF_FONT_FILES.regular);
const BOLD = path.join(FONT_DIR, PDF_FONT_FILES.bold);

pdfMake.setLocalAccessPolicy((file) => file.startsWith(FONT_DIR));
pdfMake.setUrlAccessPolicy(() => false);
pdfMake.addFonts({
  [PDF_FONT_FAMILY]: { normal: REGULAR, bold: BOLD, italics: REGULAR, bolditalics: BOLD },
});

function sample(audience: (typeof FIXTURES)[number]['audience'], file: string): PlanExportDocument {
  return buildPlanExportDocument({
    audience,
    companyName: 'サンプル株式会社',
    generatedAt: GENERATED_AT,
    markdown: fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8'),
  });
}

async function render(doc: PlanExportDocument): Promise<Buffer> {
  return pdfMake.createPdf(buildPlanPdfDefinition(doc)).getBuffer();
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '');
}

function pdfTextSequence(content: unknown[]): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if ('canvas' in record) return;
    if (typeof record.text === 'string') {
      out.push(record.text);
    } else if (Array.isArray(record.text)) {
      for (const piece of record.text) {
        out.push(typeof piece === 'string' ? piece : String((piece as { text?: unknown }).text ?? ''));
      }
    }
    if ('stack' in record) visit(record.stack);
    if ('ul' in record) visit(record.ul);
    if ('ol' in record) visit(record.ol);
    if ('table' in record) {
      const table = record.table as { body: unknown[][] };
      table.body.forEach((row) => row.forEach(visit));
    }
  };
  content.forEach(visit);
  return out;
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

describe('PDF export', () => {
  it.each(FIXTURES)('renders the $audience sample as a PDF with the model text order', async ({ audience, file }) => {
    const doc = sample(audience, file);
    const pdf = await render(doc);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/FontFile2');

    const definition = buildPlanPdfDefinition(doc);
    const pdfText = pdfTextSequence(definition.content as unknown[]).join('');
    expect(normalize(pdfText)).toBe(normalize(planDocumentPlainText(doc)));
  });

  it.each(FIXTURES)('embeds only the characters used in the $audience sample', async ({ audience, file }) => {
    const doc = sample(audience, file);
    const font = fontkit.openSync(REGULAR) as { hasGlyphForCodePoint(code: number): boolean };
    const missing = [...planDocumentPlainText(doc)]
      .filter((char) => !/\s/.test(char))
      .filter((char) => !font.hasGlyphForCodePoint(char.codePointAt(0)!));
    expect(missing).toEqual([]);
  });

  it('keeps UI-only labels out of the document', async () => {
    const text = planDocumentPlainText(sample('employee', 'employee.md'));
    for (const ui of ['PDFダウンロード', 'AI本文を生成', 'AIで再生成', 'データ詳細', '計画書本体', '印刷', '📥']) {
      expect(text).not.toContain(ui);
    }
  });

  it('paginates long documents and repeats table headers', async () => {
    const paragraphs = Array.from(
      { length: 90 },
      (_, i) => `第${i + 1}項: 当社は継続的な収益改善と資金繰りの安定化に取り組みます。数値は保存済みの本文のとおりです。`
    ).join('\n\n');
    const rows = Array.from({ length: 60 }, (_, i) => `| 施策${i + 1} | ${(i + 1) * 10}百万円 | 要確認 |`).join('\n');
    const doc = buildPlanExportDocument({
      audience: 'bank',
      companyName: 'サンプル株式会社',
      generatedAt: GENERATED_AT,
      markdown: `${paragraphs}\n\n| 施策 | 効果 | 状態 |\n|:---|---:|:---|\n${rows}`,
    });

    const pdf = await render(doc);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(4);

    const definition = buildPlanPdfDefinition(doc);
    const table = (definition.content as Array<Record<string, unknown>>).find((node) => 'table' in node)!
      .table as { headerRows: number; keepWithHeaderRows: number; dontBreakRows: boolean };
    expect(table.headerRows).toBe(1);
    expect(table.keepWithHeaderRows).toBe(1);
    expect(table.dontBreakRows).toBe(true);
  });

  it('does not call any network API while building the document', async () => {
    const fetchSpy = jest.fn();
    const original = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await render(sample('shareholder', 'shareholder.md'));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = original;
    }
  });
});
