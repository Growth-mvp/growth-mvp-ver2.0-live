export type ExtraParts = { execution: string; stage4Plan: string; progress: string };
export type ExtraInclude = { execution: boolean; progress: boolean };

const EXECUTION_CUE = /実行計画|計画|施策|プロジェクト|KPI|ＫＰＩ|OKR|KR|担当|部門|見直|未達|達成|実行/i;

/** 実行サマリとSTAGE4計画を渡すべき質問か（施策・KPI・計画に触れる質問、または登録済みの部門・案件名を含む質問） */
export function isExecutionQuestion(query: string, names: readonly string[]): boolean {
  const q = query ?? '';
  return EXECUTION_CUE.test(q) || names.some((n) => n.length >= 2 && q.includes(n));
}

export function composeExtraBlock(parts: ExtraParts, include: ExtraInclude): string {
  if (!include.execution && !include.progress) return '';
  let block = '\n\n---\n';
  if (include.execution) block += `${parts.execution}\n${parts.stage4Plan}\n`;
  if (include.progress) block += `\n# 直近進捗ログ\n${parts.progress}\n`;
  return block + '---\n';
}
