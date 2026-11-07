import { buildPlanPdfDefinition } from './toPdf';
import type { PlanExportDocument } from './planExportDocument';

function tableDoc(rows: string[][]): PlanExportDocument {
  return {
    title: 'テスト',
    subtitle: [],
    blocks: [
      {
        type: 'table',
        align: ['left', 'right'],
        header: [[{ text: '項目' }], [{ text: '金額' }]],
        rows: rows.map((r) => r.map((text) => [{ text }])),
      },
    ],
  };
}

function bodyCells(def: Record<string, unknown>): Array<Array<Record<string, unknown>>> {
  const content = def.content as Array<Record<string, unknown>>;
  const table = content.find((c) => 'table' in c)!.table as { body: Array<Array<Record<string, unknown>>> };
  return table.body;
}

describe('PDFの表の金額セル', () => {
  it('金額・比率のセルは途中で折り返さない', () => {
    const body = bodyCells(buildPlanPdfDefinition(tableDoc([['売上寄与', '120百万円'], ['比率', '-3.01%']])));
    expect(body[1][1].noWrap).toBe(true);
    expect(body[2][1].noWrap).toBe(true);
  });

  it('文章のセルは従来どおり折り返す', () => {
    const body = bodyCells(buildPlanPdfDefinition(tableDoc([['説明', '施策の内容を記載している長い文章です']])));
    expect(body[1][1].noWrap).toBeUndefined();
  });

  it('金額の文字列はセルの本文を変えない', () => {
    const body = bodyCells(buildPlanPdfDefinition(tableDoc([['売上', '130,000百万円']])));
    expect(JSON.stringify(body[1][1].text)).toContain('130,000百万円');
  });
});
