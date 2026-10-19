import {
  buildListTree,
  tableColumnWeights,
  type PlanBlock,
  type PlanExportDocument,
  type PlanInline,
  type PlanListNode,
} from '@/lib/plans/export/planExportDocument';

export const PDF_FONT_FAMILY = 'NotoSansJP';
export const PDF_FONT_FILES = {
  regular: 'NotoSansJP-Regular.ttf',
  bold: 'NotoSansJP-Bold.ttf',
} as const;
export const PDF_FONTS = {
  [PDF_FONT_FAMILY]: {
    normal: PDF_FONT_FILES.regular,
    bold: PDF_FONT_FILES.bold,
    italics: PDF_FONT_FILES.regular,
    bolditalics: PDF_FONT_FILES.bold,
  },
};

export type PlanPdfDefinition = Record<string, unknown>;

const A4_WIDTH = 595.28;
const MARGIN_X = 57;
const MARGIN_TOP = 57;
const MARGIN_BOTTOM = 64;
const CONTENT_WIDTH = A4_WIDTH - MARGIN_X * 2;
const KEEP_WITH_HEADING_LIMIT = 300;

const TABLE_LAYOUT = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => '#94a3b8',
  vLineColor: () => '#94a3b8',
  paddingLeft: () => 5,
  paddingRight: () => 5,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

const NOTE_LAYOUT = {
  hLineWidth: () => 0,
  vLineWidth: (index: number) => (index === 0 ? 2.5 : 0),
  vLineColor: () => '#94a3b8',
  paddingLeft: () => 10,
  paddingRight: () => 8,
  paddingTop: () => 6,
  paddingBottom: () => 6,
  fillColor: () => '#f1f5f9',
};

const STYLES = {
  title: { fontSize: 17, bold: true, color: '#0f172a', margin: [0, 0, 0, 6] },
  subtitle: { fontSize: 9.5, color: '#475569', margin: [0, 0, 0, 2] },
  h1: { fontSize: 15, bold: true, color: '#0f172a', margin: [0, 14, 0, 8] },
  h2: { fontSize: 12.5, bold: true, color: '#0f172a', margin: [0, 12, 0, 6] },
  h3: { fontSize: 11, bold: true, color: '#1e293b', margin: [0, 10, 0, 4] },
  h4: { fontSize: 10.5, bold: true, color: '#334155', margin: [0, 8, 0, 3] },
  body: { fontSize: 10, lineHeight: 1.55, margin: [0, 0, 0, 6] },
  listItem: { fontSize: 10, lineHeight: 1.5, margin: [0, 0, 0, 3] },
  th: { fontSize: 9, bold: true, color: '#0f172a' },
  td: { fontSize: 9, lineHeight: 1.4 },
  note: { fontSize: 9.5, lineHeight: 1.5, color: '#334155' },
};

export function buildPlanPdfDefinition(doc: PlanExportDocument): PlanPdfDefinition {
  const content: unknown[] = [
    { text: doc.title, style: 'title' },
    ...doc.subtitle.map((text) => ({ text, style: 'subtitle' })),
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.8, lineColor: '#0f172a' }], margin: [0, 4, 0, 10] },
  ];

  const blocks = doc.blocks;
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type !== 'heading') {
      content.push(blockNode(block));
      i++;
      continue;
    }
    const group: unknown[] = [];
    while (i < blocks.length && blocks[i].type === 'heading') {
      group.push(blockNode(blocks[i]));
      i++;
    }
    if (i < blocks.length && isShortTextBlock(blocks[i])) {
      group.push(blockNode(blocks[i]));
      i++;
    }
    content.push({ stack: group, unbreakable: true });
  }

  return {
    info: { title: doc.title, creator: 'GROWTH SHIFT' },
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [MARGIN_X, MARGIN_TOP, MARGIN_X, MARGIN_BOTTOM],
    defaultStyle: { font: PDF_FONT_FAMILY, fontSize: 10, lineHeight: 1.5 },
    styles: STYLES,
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'center',
      fontSize: 8,
      color: '#64748b',
      margin: [0, 16, 0, 0],
    }),
    content,
  };
}

function headingNode(block: Extract<PlanBlock, { type: 'heading' }>): Record<string, unknown> {
  return { text: toPdfText(block.runs), style: `h${block.level}`, headlineLevel: block.level - 1 };
}

function blockNode(block: PlanBlock): Record<string, unknown> {
  switch (block.type) {
    case 'heading':
      return headingNode(block);
    case 'paragraph':
      return { text: toPdfText(block.runs), style: 'body' };
    case 'list':
      return { stack: listNodes(buildListTree(block.items)), margin: [0, 0, 0, 6] };
    case 'table':
      return tableNode(block);
    case 'note':
      return {
        table: {
          widths: [CONTENT_WIDTH - NOTE_LAYOUT.paddingLeft() - NOTE_LAYOUT.paddingRight()],
          body: [[{ text: toPdfText(block.runs), style: 'note' }]],
          dontBreakRows: true,
        },
        layout: NOTE_LAYOUT,
        margin: [0, 4, 0, 10],
      };
    case 'rule':
      return {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.6, lineColor: '#cbd5e1' }],
        margin: [0, 6, 0, 8],
      };
    case 'pageBreak':
      return { text: '', pageBreak: 'before', fontSize: 1, margin: [0, 0, 0, 0] };
  }
}

function listNodes(nodes: PlanListNode[]): unknown[] {
  return nodes.map((node) => {
    const children = node.children.map((child) =>
      child.kind === 'item'
        ? { text: toPdfText(child.item.runs), style: 'listItem' }
        : listNodes([child.list])[0]
    );
    return node.ordered ? { ol: children } : { ul: children };
  });
}

function tableNode(block: Extract<PlanBlock, { type: 'table' }>): Record<string, unknown> {
  const weights = tableColumnWeights(block);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const cellPadding = TABLE_LAYOUT.paddingLeft() + TABLE_LAYOUT.paddingRight();
  const available = CONTENT_WIDTH - weights.length * cellPadding;
  const widths = weights.map((weight) => (available * weight) / total);

  const header = block.header.map((runs, i) => ({
    text: toPdfText(runs),
    style: 'th',
    alignment: block.align[i] ?? 'left',
    fillColor: '#e2e8f0',
  }));
  const body = block.rows.map((row) =>
    row.map((runs, i) => ({ text: toPdfText(runs), style: 'td', alignment: block.align[i] ?? 'left' }))
  );

  return {
    table: { headerRows: 1, keepWithHeaderRows: 1, widths, body: [header, ...body], dontBreakRows: true },
    layout: TABLE_LAYOUT,
    margin: [0, 4, 0, 10],
  };
}

function toPdfText(runs: PlanInline[]): string | Array<Record<string, unknown>> {
  if (runs.length === 0) return '';
  return runs.map((run) => {
    const piece: Record<string, unknown> = { text: run.text };
    if (run.bold) piece.bold = true;
    if (run.italic) piece.italics = true;
    return piece;
  });
}

function isShortTextBlock(block: PlanBlock): boolean {
  if (block.type === 'paragraph' || block.type === 'note') {
    return block.runs.reduce((sum, run) => sum + run.text.length, 0) <= KEEP_WITH_HEADING_LIMIT;
  }
  if (block.type === 'list') {
    return block.items.length <= 5;
  }
  return false;
}
