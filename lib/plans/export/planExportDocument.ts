import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Content, List, PhrasingContent, Root, Table, TableRow } from 'mdast';

import type { PlanAudience } from '@/lib/plans/planDocumentState';

/**
 * Word・PDF 出力の共通文書モデル。
 * 保存済み本文（Markdown）をここで一度だけ解析し、両方の出力はこのモデルのみを使う。
 */

export type PlanInline = { text: string; bold?: boolean; italic?: boolean };

export type PlanListItem = { level: number; ordered: boolean; runs: PlanInline[] };

export type PlanAlign = 'left' | 'center' | 'right';

export type PlanBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; runs: PlanInline[] }
  | { type: 'paragraph'; runs: PlanInline[] }
  | { type: 'list'; items: PlanListItem[] }
  | { type: 'table'; align: PlanAlign[]; header: PlanInline[][]; rows: PlanInline[][][] }
  | { type: 'note'; runs: PlanInline[] }
  | { type: 'rule' }
  | { type: 'pageBreak' };

export type PlanExportDocument = {
  title: string;
  subtitle: string[];
  blocks: PlanBlock[];
};

export type PlanListNode = {
  ordered: boolean;
  children: PlanListChild[];
};

export type PlanListChild = { kind: 'item'; item: PlanListItem } | { kind: 'list'; list: PlanListNode };

const AUDIENCE_META: Record<PlanAudience, { heading: string; label: string }> = {
  bank: { heading: '経営改善・事業計画書', label: '銀行向け' },
  shareholder: { heading: '中期経営計画書', label: '株主向け' },
  employee: { heading: '経営方針・実行計画書', label: '社員向け' },
};

const PAGE_BREAK_MARKER = /^<!--\s*pagebreak\s*-->$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const parser = unified().use(remarkParse).use(remarkGfm);

export function buildPlanExportDocument(input: {
  audience: PlanAudience;
  companyName?: string | null;
  generatedAt: string;
  markdown: string;
}): PlanExportDocument {
  const meta = AUDIENCE_META[input.audience];
  const name = input.companyName?.trim();
  return {
    title: name ? `${name} ${meta.heading}` : meta.heading,
    subtitle: [meta.label, `生成日時: ${formatGeneratedAt(input.generatedAt)}`],
    blocks: markdownToBlocks(input.markdown),
  };
}

export function markdownToBlocks(markdown: string): PlanBlock[] {
  const tree = parser.parse(markdown) as Root;
  return compactBlocks(convertBlocks(tree.children));
}

export function buildListTree(items: PlanListItem[]): PlanListNode[] {
  const roots: PlanListNode[] = [];
  const stack: Array<{ level: number; node: PlanListNode }> = [];

  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1].level > item.level) {
      stack.pop();
    }
    let top = stack[stack.length - 1];
    if (!top || top.level < item.level || top.node.ordered !== item.ordered) {
      if (top && top.level === item.level) {
        stack.pop();
      }
      const node: PlanListNode = { ordered: item.ordered, children: [] };
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.node.children.push({ kind: 'list', list: node });
      } else {
        roots.push(node);
      }
      top = { level: item.level, node };
      stack.push(top);
    }
    top.node.children.push({ kind: 'item', item });
  }
  return roots;
}

export function planDocumentPlainText(doc: PlanExportDocument): string {
  const parts: string[] = [doc.title, ...doc.subtitle];
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'note':
        parts.push(joinText(block.runs));
        break;
      case 'list':
        parts.push(...block.items.map((item) => joinText(item.runs)));
        break;
      case 'table':
        parts.push(...block.header.map(joinText));
        for (const row of block.rows) parts.push(...row.map(joinText));
        break;
      default:
        break;
    }
  }
  return parts.join('\n');
}

export function tableColumnWeights(block: { header: PlanInline[][]; rows: PlanInline[][][] }): number[] {
  return block.header.map((_, col) => {
    const longest = Math.max(
      joinText(block.header[col]).length,
      ...block.rows.map((row) => joinText(row[col] ?? []).length)
    );
    return Math.min(Math.max(longest, 4), 40);
  });
}

export function planExportFileName(
  audience: PlanAudience,
  generatedAt: string,
  extension: 'docx' | 'pdf'
): string {
  const date = new Date(generatedAt);
  const stamp = Number.isNaN(date.getTime())
    ? 'undated'
    : date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(/-/g, '');
  return `${audience}-plan-${stamp}.${extension}`;
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '不明'
    : date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

function joinText(runs: PlanInline[]): string {
  return runs.map((item) => item.text).join('');
}

function convertBlocks(nodes: Content[]): PlanBlock[] {
  const out: PlanBlock[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        out.push({
          type: 'heading',
          level: Math.min(node.depth, 4) as 1 | 2 | 3 | 4,
          runs: toInline(node.children),
        });
        break;
      }
      case 'paragraph':
        out.push({ type: 'paragraph', runs: toInline(node.children) });
        break;
      case 'list':
        out.push({ type: 'list', items: toListItems(node, 0) });
        break;
      case 'table':
        out.push(toTable(node));
        break;
      case 'blockquote':
        out.push({ type: 'note', runs: toRunsFromBlocks(node.children) });
        break;
      case 'thematicBreak':
        out.push({ type: 'rule' });
        break;
      case 'code':
        out.push({ type: 'paragraph', runs: [run(node.value)] });
        break;
      case 'html':
        if (PAGE_BREAK_MARKER.test(node.value.trim())) out.push({ type: 'pageBreak' });
        break;
      default:
        break;
    }
  }
  return out;
}

function toListItems(list: List, level: number): PlanListItem[] {
  const items: PlanListItem[] = [];
  for (const listItem of list.children) {
    const texts: PlanInline[][] = [];
    const nested: PlanListItem[] = [];
    for (const child of listItem.children) {
      if (child.type === 'list') {
        nested.push(...toListItems(child, level + 1));
      } else {
        texts.push(toRunsFromBlock(child));
      }
    }
    items.push({ level, ordered: list.ordered === true, runs: joinRuns(texts) });
    items.push(...nested);
  }
  return items;
}

function toTable(table: Table): PlanBlock {
  const [headRow, ...bodyRows] = table.children;
  const width = Math.max(headRow?.children.length ?? 0, ...bodyRows.map((row) => row.children.length));
  const rowRuns = (row: TableRow | undefined): PlanInline[][] =>
    Array.from({ length: width }, (_, i) => {
      const cell = row?.children[i];
      const runs = cell ? toInline(cell.children) : [];
      return runs.length > 0 ? runs : [run('')];
    });
  return {
    type: 'table',
    align: Array.from({ length: width }, (_, i) => table.align?.[i] ?? 'left'),
    header: rowRuns(headRow),
    rows: bodyRows.map((row) => rowRuns(row)),
  };
}

function toRunsFromBlock(node: Content): PlanInline[] {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return toInline(node.children);
    case 'list':
      return joinRuns(toListItems(node, 0).map((item) => item.runs));
    case 'blockquote':
      return toRunsFromBlocks(node.children);
    case 'code':
      return [run(node.value)];
    default:
      if ('children' in node && Array.isArray(node.children)) {
        return toInline(node.children as PhrasingContent[]);
      }
      if ('value' in node && typeof node.value === 'string') {
        return [run(node.value)];
      }
      return [];
  }
}

function toRunsFromBlocks(nodes: Content[]): PlanInline[] {
  return joinRuns(nodes.map(toRunsFromBlock));
}

function joinRuns(parts: PlanInline[][]): PlanInline[] {
  const joined: PlanInline[][] = [];
  parts.forEach((part, i) => {
    if (i > 0) joined.push([run('\n')]);
    joined.push(part);
  });
  return mergeRuns(joined.flat());
}

function toInline(
  nodes: PhrasingContent[] = [],
  style: { bold?: boolean; italic?: boolean } = {}
): PlanInline[] {
  const runs: PlanInline[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        runs.push(run(node.value, style));
        break;
      case 'strong':
        runs.push(...toInline(node.children, { ...style, bold: true }));
        break;
      case 'emphasis':
        runs.push(...toInline(node.children, { ...style, italic: true }));
        break;
      case 'inlineCode':
        runs.push(run(node.value, style));
        break;
      case 'break':
        runs.push(run('\n', style));
        break;
      case 'image':
        runs.push(run(node.alt ?? '', style));
        break;
      case 'html':
        break;
      default:
        if ('children' in node && Array.isArray(node.children)) {
          runs.push(...toInline(node.children as PhrasingContent[], style));
        }
        break;
    }
  }
  return mergeRuns(runs);
}

function run(text: string, style: { bold?: boolean; italic?: boolean } = {}): PlanInline {
  const value: PlanInline = { text: cleanText(text) };
  if (style.bold) value.bold = true;
  if (style.italic) value.italic = true;
  return value;
}

function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(CONTROL_CHARS, '');
}

function mergeRuns(runs: PlanInline[]): PlanInline[] {
  const merged: PlanInline[] = [];
  for (const current of runs) {
    if (current.text === '') continue;
    const last = merged[merged.length - 1];
    if (last && !!last.bold === !!current.bold && !!last.italic === !!current.italic) {
      last.text += current.text;
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function compactBlocks(blocks: PlanBlock[]): PlanBlock[] {
  const out: PlanBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'pageBreak' && (out.length === 0 || out[out.length - 1].type === 'pageBreak')) {
      continue;
    }
    out.push(block);
  }
  while (out.length > 0 && out[out.length - 1].type === 'pageBreak') {
    out.pop();
  }
  return out;
}
