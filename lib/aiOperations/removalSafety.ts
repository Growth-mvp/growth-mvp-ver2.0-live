import type { StrategyState } from '@/store/strategyStore';
import type { StageOp } from './stage1Input';

export type RemovalOp = Extract<StageOp, { kind: 'segment.remove' | 'issue.remove' }>;

/** STAGE2以降の構造化データ。ここに中身があると、事業・経営課題との紐づけを安全に確認できない */
const DOWNSTREAM_FIELDS = [
  ['departments', '部門（STAGE3）'],
  ['story', 'ストーリー（STAGE2）'],
  ['storyDraft', 'ストーリーの草稿（STAGE2）'],
  ['finalStory', '最終ストーリー（STAGE2）'],
  ['finalStoryDraft', '最終ストーリーの草稿（STAGE2）'],
  ['finalStoryEdited', '最終ストーリーの編集版（STAGE2）'],
  ['finalStoryFinal', '最終ストーリー（確定版）'],
  ['midtermStrategy', '中期戦略（STAGE2）'],
  ['businessPortfolio', '事業ポートフォリオ（STAGE1→2）'],
] as const;

function hasContent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return Boolean(v);
}

/** 削除できない理由。null なら削除してよい。承認時にも同じ判定をかけ直す */
export function removalBlockReason(op: RemovalOp, st: StrategyState): string | null {
  const segments = st.businessSegments ?? [];
  if (op.kind === 'segment.remove') {
    const name = op.name;
    if (!segments.some((s) => s.name === name)) return `事業「${name}」が見つかりません。反映しませんでした。`;
    const hasFinance = (st.segmentPL?.[name]?.length ?? 0) > 0 || (st.segmentBS?.[name]?.length ?? 0) > 0;
    if (hasFinance) return `事業「${name}」には事業別の財務データがあるため、削除しません。先に財務表で数値を削除してください。`;
    const linked = ((st.stage1Issues ?? []) as Array<{ segmentName?: string }>).some((i) => i.segmentName === name);
    if (linked) return `経営課題が事業「${name}」に紐づいているため、削除しません。先に経営課題の紐づけを確かめてください。`;
  } else {
    const title = op.title;
    if (!(st.stage1Issues ?? []).some((i) => i.title === title)) return `経営課題「${title}」が見つかりません。反映しませんでした。`;
  }
  const found = DOWNSTREAM_FIELDS.filter(([field]) => hasContent((st as unknown as Record<string, unknown>)[field])).map(([, label]) => label);
  if (found.length > 0) {
    const target = op.kind === 'segment.remove' ? `事業「${op.name}」` : `経営課題「${op.title}」`;
    return `${found.join('、')}のデータがあり、${target}との紐づけを安全に確認できないため、削除しません。`;
  }
  return null;
}
