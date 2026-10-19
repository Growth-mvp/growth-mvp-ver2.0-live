import fs from 'fs';
import path from 'path';

import JSZip from 'jszip';
import { Packer } from 'docx';

import {
  buildPlanExportDocument,
  planDocumentPlainText,
  type PlanExportDocument,
  type PlanInline,
} from '@/lib/plans/export/planExportDocument';
import { buildPlanWordDocument } from '@/lib/plans/export/toWord';
import { buildPlanPdfDefinition } from '@/lib/plans/export/toPdf';

const FIXTURES = [
  { audience: 'bank', file: 'bank.md' },
  { audience: 'shareholder', file: 'shareholder.md' },
  { audience: 'employee', file: 'employee.md' },
] as const;

const GENERATED_AT = '2026-10-20T03:00:00.000Z';

type Structure = {
  texts: string[];
  tables: string[][][];
  listItems: string[];
  notes: string[];
};

function squash(text: string): string {
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

function xmlText(fragment: string): string {
  return decodeXml([...fragment.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(''));
}

function modelStructure(doc: PlanExportDocument): Structure {
  const structure: Structure = { texts: [], tables: [], listItems: [], notes: [] };
  const join = (runs: PlanInline[]) => squash(runs.map((run) => run.text).join(''));
  structure.texts.push(squash(doc.title), ...doc.subtitle.map(squash));
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        structure.texts.push(join(block.runs));
        break;
      case 'list':
        structure.listItems.push(...block.items.map((item) => join(item.runs)));
        break;
      case 'table':
        structure.tables.push([block.header.map(join), ...block.rows.map((row) => row.map(join))]);
        break;
      case 'note':
        structure.notes.push(join(block.runs));
        break;
      default:
        break;
    }
  }
  return structure;
}

async function wordStructure(doc: PlanExportDocument): Promise<Structure> {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildPlanWordDocument(doc)));
  const xml = await zip.file('word/document.xml')!.async('string');
  const tables = [...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map((table) =>
    [...table[1].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((row) =>
      [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) => squash(xmlText(cell[0])))
    )
  );
  const outside = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '');
  const paragraphs = [...outside.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)].map((p) => p[0]);
  return {
    texts: paragraphs
      .filter((p) => !p.includes('<w:numPr>') && !p.includes('<w:shd'))
      .map((p) => squash(xmlText(p)))
      .filter((text) => text !== ''),
    tables,
    listItems: paragraphs.filter((p) => p.includes('<w:numPr>')).map((p) => squash(xmlText(p))),
    notes: paragraphs.filter((p) => p.includes('<w:shd')).map((p) => squash(xmlText(p))),
  };
}

type PdfNode = Record<string, unknown>;

function pdfStructure(doc: PlanExportDocument): Structure {
  const definition = buildPlanPdfDefinition(doc);
  const structure: Structure = { texts: [], tables: [], listItems: [], notes: [] };
  const textOf = (node: unknown): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (node && typeof node === 'object' && 'text' in node) return textOf((node as PdfNode).text);
    return '';
  };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as PdfNode;
    if ('canvas' in record) return;
    if ('table' in record) {
      const table = record.table as { body: unknown[][]; widths: unknown[] };
      if (table.widths.length === 1 && table.body.length === 1 && table.body[0].length === 1) {
        structure.notes.push(squash(textOf(table.body[0][0])));
      } else {
        structure.tables.push(table.body.map((row) => (row as unknown[]).map((cell) => squash(textOf(cell)))));
      }
      return;
    }
    if ('ul' in record || 'ol' in record) {
      for (const child of (record.ul ?? record.ol) as unknown[]) {
        if (child && typeof child === 'object' && 'text' in (child as PdfNode)) {
          structure.listItems.push(squash(textOf(child)));
        } else {
          visit(child);
        }
      }
      return;
    }
    if ('stack' in record) {
      visit(record.stack);
      return;
    }
    if (typeof record.style === 'string' && ['title', 'subtitle', 'body', 'h1', 'h2', 'h3', 'h4'].includes(record.style)) {
      const text = squash(textOf(record));
      if (text !== '') structure.texts.push(text);
    }
  };
  (definition.content as unknown[]).forEach(visit);
  return structure;
}

describe('Word and PDF content consistency', () => {
  it.each(FIXTURES)('matches text order, tables, list items and notes for $audience', async ({ audience, file }) => {
    const doc = buildPlanExportDocument({
      audience,
      companyName: 'サンプル株式会社',
      generatedAt: GENERATED_AT,
      markdown: fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8'),
    });
    const model = modelStructure(doc);
    const word = await wordStructure(doc);
    const pdf = pdfStructure(doc);

    expect(model.texts.length).toBeGreaterThan(5);
    expect(model.tables.length).toBeGreaterThan(0);
    expect(model.listItems.length).toBeGreaterThan(0);
    expect(model.notes.length).toBeGreaterThan(0);

    expect(word.texts).toEqual(model.texts);
    expect(pdf.texts).toEqual(model.texts);
    expect(word.tables).toEqual(model.tables);
    expect(pdf.tables).toEqual(model.tables);
    expect(word.listItems).toEqual(model.listItems);
    expect(pdf.listItems).toEqual(model.listItems);
    expect(word.notes).toEqual(model.notes);
    expect(pdf.notes).toEqual(model.notes);
    expect(planDocumentPlainText(doc)).toContain(doc.title);
  });

  it('keeps table numbers as written in the saved text', () => {
    const doc = buildPlanExportDocument({
      audience: 'bank',
      companyName: 'サンプル株式会社',
      generatedAt: GENERATED_AT,
      markdown: fs.readFileSync(path.join(__dirname, 'fixtures', 'bank.md'), 'utf8'),
    });
    const grid = modelStructure(doc).tables[0];
    expect(grid[1]).toEqual(['2023年度', '1,250', '98', '7.8%']);
    expect(grid[3]).toEqual(['2025年度', '1,096', '42', '3.8%']);
  });
});
