import fs from 'fs';
import path from 'path';

import JSZip from 'jszip';
import { Packer } from 'docx';

import {
  buildPlanExportDocument,
  planDocumentPlainText,
  type PlanExportDocument,
} from '@/lib/plans/export/planExportDocument';
import { buildPlanWordDocument } from '@/lib/plans/export/toWord';

const FIXTURES = [
  { audience: 'bank', file: 'bank.md' },
  { audience: 'shareholder', file: 'shareholder.md' },
  { audience: 'employee', file: 'employee.md' },
] as const;

const GENERATED_AT = '2026-10-20T03:00:00.000Z';

function sample(audience: (typeof FIXTURES)[number]['audience'], file: string): PlanExportDocument {
  return buildPlanExportDocument({
    audience,
    companyName: 'サンプル株式会社',
    generatedAt: GENERATED_AT,
    markdown: fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8'),
  });
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '');
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function unpack(doc: PlanExportDocument): Promise<JSZip> {
  const buffer = await Packer.toBuffer(buildPlanWordDocument(doc));
  return JSZip.loadAsync(buffer);
}

describe('Word export', () => {
  it.each(FIXTURES)('writes the $audience sample with the same text order as the model', async ({ audience, file }) => {
    const doc = sample(audience, file);
    const zip = await unpack(doc);
    const xml = await zip.file('word/document.xml')!.async('string');

    const wordText = [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((match) => decodeXml(match[1]))
      .join('');

    expect(normalize(wordText)).toBe(normalize(planDocumentPlainText(doc)));
  });

  it.each(FIXTURES)('uses A4 portrait, Japanese font and repeating table headers for $audience', async ({ audience, file }) => {
    const zip = await unpack(sample(audience, file));
    const xml = await zip.file('word/document.xml')!.async('string');
    const styles = await zip.file('word/styles.xml')!.async('string');

    expect(xml).toMatch(/<w:pgSz w:w="11906" w:h="16838"/);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tblHeader/>');
    expect(styles).toContain('Yu Gothic');
    expect(styles).toContain('w:styleId="Heading1"');
    expect(styles).toContain('w:styleId="Heading4"');
  });

  it('writes editable paragraphs, lists and tables rather than images', async () => {
    const zip = await unpack(sample('bank', 'bank.md'));
    const xml = await zip.file('word/document.xml')!.async('string');
    const numbering = await zip.file('word/numbering.xml')!.async('string');

    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toMatch(/<w:numPr>/);
    expect(numbering).toContain('w:abstractNum');
    expect(numbering.match(/<w:num w:numId=/g)!.length).toBeGreaterThanOrEqual(3);
    expect(zip.file(/word\/media\//)).toHaveLength(0);
    expect(xml).toContain('<w:b/>');
  });

  it('adds a page-number footer', async () => {
    const zip = await unpack(sample('shareholder', 'shareholder.md'));
    const footers = zip.file(/word\/footer\d*\.xml/);
    expect(footers.length).toBeGreaterThanOrEqual(1);
    const footerXml = await footers[0].async('string');
    expect(footerXml).toContain('PAGE');
    expect(footerXml).toContain('NUMPAGES');
  });

  it('keeps numbers and notes from the saved text', async () => {
    const zip = await unpack(sample('bank', 'bank.md'));
    const text = decodeXml((await zip.file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, ''));
    for (const expected of ['1,250', '7.8%', '要確認', '注意: 数値計画はSTAGE6']) {
      expect(text).toContain(expected);
    }
  });
});
