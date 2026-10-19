import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions,
} from 'docx';

import {
  buildListTree,
  tableColumnWeights,
  type PlanAlign,
  type PlanBlock,
  type PlanExportDocument,
  type PlanInline,
  type PlanListNode,
} from '@/lib/plans/export/planExportDocument';
import { saveBlob } from '@/lib/plans/export/download';

const FONT = 'Yu Gothic';
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 1417;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const BULLET_REFERENCE = 'plan-bullet';
const ORDERED_REFERENCE = 'plan-ordered';

const HEADING_LEVELS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
} as const;

const ALIGNMENTS: Record<PlanAlign, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
};

const TABLE_BORDER: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: '94A3B8' };

type ListCounter = { instance: number };

export function buildPlanWordDocument(doc: PlanExportDocument): Document {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ style: 'Title', children: [new TextRun(doc.title)] }),
    ...doc.subtitle.map(
      (line) =>
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: line, color: '475569', size: 19 })],
        })
    ),
    new Paragraph({
      spacing: { before: 120, after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '0F172A', space: 4 } },
      children: [],
    }),
  ];

  const counter: ListCounter = { instance: 0 };
  for (const block of doc.blocks) {
    children.push(...blockToWord(block, counter));
  }

  return new Document({
    creator: 'GROWTH SHIFT',
    title: doc.title,
    styles: STYLES,
    numbering: NUMBERING,
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: {
              top: PAGE_MARGIN,
              bottom: PAGE_MARGIN,
              left: PAGE_MARGIN,
              right: PAGE_MARGIN,
              footer: 708,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
                    size: 18,
                    color: '64748B',
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

async function createPlanWordBlob(doc: PlanExportDocument): Promise<Blob> {
  return Packer.toBlob(buildPlanWordDocument(doc));
}

export async function downloadPlanWord(doc: PlanExportDocument, fileName: string): Promise<void> {
  saveBlob(await createPlanWordBlob(doc), fileName);
}

function blockToWord(block: PlanBlock, counter: ListCounter): Array<Paragraph | Table> {
  switch (block.type) {
    case 'heading':
      return [
        new Paragraph({
          heading: HEADING_LEVELS[block.level],
          keepNext: true,
          keepLines: true,
          children: runsToWord(block.runs),
        }),
      ];
    case 'paragraph':
      return [new Paragraph({ spacing: { after: 140 }, children: runsToWord(block.runs) })];
    case 'list':
      return listToWord(buildListTree(block.items), 0, counter);
    case 'table':
      return [tableToWord(block)];
    case 'note':
      return [
        new Paragraph({
          indent: { left: 340 },
          spacing: { before: 120, after: 160 },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: '94A3B8', space: 8 } },
          children: runsToWord(block.runs),
        }),
      ];
    case 'rule':
      return [
        new Paragraph({
          spacing: { before: 120, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 1 } },
          children: [],
        }),
      ];
    case 'pageBreak':
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

function listToWord(nodes: PlanListNode[], depth: number, counter: ListCounter): Paragraph[] {
  const out: Paragraph[] = [];
  for (const node of nodes) {
    const instance = node.ordered ? ++counter.instance : undefined;
    for (const child of node.children) {
      if (child.kind === 'item') {
        out.push(
          new Paragraph({
            numbering: {
              reference: node.ordered ? ORDERED_REFERENCE : BULLET_REFERENCE,
              level: Math.min(depth, 3),
              instance,
            },
            spacing: { after: 80, line: 320 },
            children: runsToWord(child.item.runs),
          })
        );
      } else {
        out.push(...listToWord([child.list], depth + 1, counter));
      }
    }
  }
  return out;
}

function tableToWord(block: Extract<PlanBlock, { type: 'table' }>): Table {
  const weights = tableColumnWeights(block);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => Math.floor((CONTENT_WIDTH * weight) / total));

  const row = (cells: PlanInline[][], header: boolean) =>
    new TableRow({
      tableHeader: header,
      cantSplit: true,
      children: widths.map(
        (width, i) =>
          new TableCell({
            width: { size: width, type: WidthType.DXA },
            shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E2E8F0' } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [
              new Paragraph({
                alignment: ALIGNMENTS[block.align[i] ?? 'left'],
                spacing: { after: 0, line: 300 },
                children: runsToWord(cells[i] ?? [], header),
              }),
            ],
          })
      ),
    });

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
    rows: [row(block.header, true), ...block.rows.map((cells) => row(cells, false))],
  });
}

function runsToWord(runs: PlanInline[], forceBold = false): TextRun[] {
  const out: TextRun[] = [];
  for (const item of runs) {
    item.text.split('\n').forEach((piece, index) => {
      if (index > 0) out.push(new TextRun({ text: '', break: 1 }));
      if (piece !== '') {
        out.push(
          new TextRun({
            text: piece,
            bold: forceBold || item.bold ? true : undefined,
            italics: item.italic ? true : undefined,
          })
        );
      }
    });
  }
  return out;
}

const STYLES = {
  default: {
    document: {
      run: { font: FONT, size: 21, color: '1E293B' },
      paragraph: { spacing: { line: 340 } },
    },
  },
  paragraphStyles: [
    {
      id: 'Title',
      name: 'Title',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { size: 34, bold: true, color: '0F172A' },
      paragraph: { spacing: { after: 160 } },
    },
    {
      id: 'Heading1',
      name: 'Heading 1',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { size: 30, bold: true, color: '0F172A' },
      paragraph: { spacing: { before: 360, after: 160 }, keepNext: true, keepLines: true, outlineLevel: 0 },
    },
    {
      id: 'Heading2',
      name: 'Heading 2',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { size: 26, bold: true, color: '0F172A' },
      paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, keepLines: true, outlineLevel: 1 },
    },
    {
      id: 'Heading3',
      name: 'Heading 3',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { size: 23, bold: true, color: '1E293B' },
      paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, keepLines: true, outlineLevel: 2 },
    },
    {
      id: 'Heading4',
      name: 'Heading 4',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { size: 22, bold: true, color: '334155' },
      paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 3 },
    },
  ],
};

const NUMBERING = {
  config: [
    {
      reference: BULLET_REFERENCE,
      levels: [
        {
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 420, hanging: 280 } } },
        },
        {
          level: 1,
          format: LevelFormat.BULLET,
          text: '–',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 840, hanging: 280 } } },
        },
        {
          level: 2,
          format: LevelFormat.BULLET,
          text: '・',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1260, hanging: 280 } } },
        },
        {
          level: 3,
          format: LevelFormat.BULLET,
          text: '·',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1680, hanging: 280 } } },
        },
      ],
    },
    {
      reference: ORDERED_REFERENCE,
      levels: [
        {
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 420, hanging: 420 } } },
        },
        {
          level: 1,
          format: LevelFormat.DECIMAL,
          text: '(%2)',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 840, hanging: 420 } } },
        },
        {
          level: 2,
          format: LevelFormat.DECIMAL,
          text: '%3)',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1260, hanging: 420 } } },
        },
        {
          level: 3,
          format: LevelFormat.LOWER_LETTER,
          text: '%4.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1680, hanging: 420 } } },
        },
      ],
    },
  ],
};
