import fs from 'fs';
import path from 'path';

import {
  buildListTree,
  buildPlanExportDocument,
  markdownToBlocks,
  planDocumentPlainText,
  planExportFileName,
  tableColumnWeights,
  type PlanBlock,
  type PlanListItem,
} from '@/lib/plans/export/planExportDocument';

const FIXTURES = [
  { audience: 'bank', file: 'bank.md' },
  { audience: 'shareholder', file: 'shareholder.md' },
  { audience: 'employee', file: 'employee.md' },
] as const;

const GENERATED_AT = '2026-10-20T03:00:00.000Z';

function readFixture(file: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');
}

describe('markdownToBlocks', () => {
  it('maps headings, emphasis and paragraphs', () => {
    const blocks = markdownToBlocks('# 見出し\n\n本文は**強調**と*斜体*です。');
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, runs: [{ text: '見出し' }] });
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      runs: [
        { text: '本文は' },
        { text: '強調', bold: true },
        { text: 'と' },
        { text: '斜体', italic: true },
        { text: 'です。' },
      ],
    });
  });

  it('keeps GFM table cells, column alignment and numeric text as written', () => {
    const blocks = markdownToBlocks('| 項目 | 金額 | 率 |\n|:---|---:|:---:|\n| 売上 | ¥1,250 | 7.8% |');
    const table = blocks[0];
    expect(table.type).toBe('table');
    if (table.type !== 'table') return;
    expect(table.align).toEqual(['left', 'right', 'center']);
    expect(table.header.map((cell) => cell[0].text)).toEqual(['項目', '金額', '率']);
    expect(table.rows[0].map((cell) => cell[0].text)).toEqual(['売上', '¥1,250', '7.8%']);
  });

  it('turns blockquotes into notes and thematic breaks into rules', () => {
    const blocks = markdownToBlocks('> 注意: 要確認\n\n---');
    expect(blocks).toEqual([
      { type: 'note', runs: [{ text: '注意: 要確認' }] },
      { type: 'rule' },
    ]);
  });

  it('keeps nested ordered and bullet items with their levels', () => {
    const blocks = markdownToBlocks('1. 第一\n   - 子項目\n2. 第二');
    expect(blocks[0]).toEqual({
      type: 'list',
      items: [
        { level: 0, ordered: true, runs: [{ text: '第一' }] },
        { level: 1, ordered: false, runs: [{ text: '子項目' }] },
        { level: 0, ordered: true, runs: [{ text: '第二' }] },
      ],
    });
  });

  it('starts a new page only at the explicit page-break marker', () => {
    const types = markdownToBlocks('# 第1章\n\n本文\n\n# 第2章\n\n<!-- pagebreak -->\n\n## 節').map((b) => b.type);
    expect(types).toEqual(['heading', 'paragraph', 'heading', 'pageBreak', 'heading']);
  });

  it('drops raw HTML and control characters', () => {
    const blocks = markdownToBlocks('<div>画面用UI</div>\n\nテキストです');
    const text = blocks.map((b) => (b.type === 'paragraph' ? b.runs.map((r) => r.text).join('') : '')).join('');
    expect(text).toBe('テキストです');
  });

  it('keeps line breaks inside a paragraph as separate lines', () => {
    const blocks = markdownToBlocks('一行目  \n二行目');
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      runs: [{ text: '一行目\n二行目' }],
    });
  });
});

describe('buildListTree', () => {
  it('groups consecutive items of the same type and nests deeper levels', () => {
    const items: PlanListItem[] = [
      { level: 0, ordered: true, runs: [{ text: 'a' }] },
      { level: 1, ordered: false, runs: [{ text: 'a-1' }] },
      { level: 0, ordered: true, runs: [{ text: 'b' }] },
      { level: 0, ordered: false, runs: [{ text: 'c' }] },
    ];
    const roots = buildListTree(items);
    expect(roots.map((root) => root.ordered)).toEqual([true, false]);
    expect(roots[0].children.map((child) => child.kind)).toEqual(['item', 'list', 'item']);
    const nested = roots[0].children[1];
    expect(nested.kind === 'list' && nested.list.ordered).toBe(false);
  });
});

describe('tableColumnWeights', () => {
  it('weights columns by their longest text within bounds', () => {
    const weights = tableColumnWeights({
      header: [[{ text: 'A' }], [{ text: '売上高（百万円）' }]],
      rows: [[[{ text: 'x'.repeat(60) }], [{ text: '1,250' }]]],
    });
    expect(weights).toEqual([40, 8]);
  });
});

describe('buildPlanExportDocument', () => {
  it('uses the company name and audience heading in the title', () => {
    const doc = buildPlanExportDocument({
      audience: 'bank',
      companyName: 'サンプル株式会社',
      generatedAt: GENERATED_AT,
      markdown: '本文',
    });
    expect(doc.title).toBe('サンプル株式会社 経営改善・事業計画書');
    expect(doc.subtitle[0]).toBe('銀行向け');
    expect(doc.subtitle[1]).toMatch(/^生成日時: /);
  });

  it('falls back to the heading alone when the company name is missing', () => {
    const doc = buildPlanExportDocument({
      audience: 'employee',
      companyName: null,
      generatedAt: GENERATED_AT,
      markdown: '本文',
    });
    expect(doc.title).toBe('経営方針・実行計画書');
  });

  it.each(FIXTURES)('converts the $audience sample without UI text', ({ audience, file }) => {
    const doc = buildPlanExportDocument({
      audience,
      companyName: 'サンプル株式会社',
      generatedAt: GENERATED_AT,
      markdown: readFixture(file),
    });
    const text = planDocumentPlainText(doc);
    expect(doc.blocks.some((block: PlanBlock) => block.type === 'table')).toBe(true);
    expect(doc.blocks.some((block: PlanBlock) => block.type === 'list')).toBe(true);
    for (const ui of ['PDFダウンロード', 'AI本文を生成', 'AIで再生成', 'データ詳細', '計画書本体', '印刷', 'AIアシスタント']) {
      expect(text).not.toContain(ui);
    }
  });
});

describe('planExportFileName', () => {
  it('builds the audience and Tokyo-date based file name', () => {
    expect(planExportFileName('shareholder', GENERATED_AT, 'docx')).toBe('shareholder-plan-20261020.docx');
    expect(planExportFileName('bank', 'invalid', 'pdf')).toBe('bank-plan-undated.pdf');
  });
});
