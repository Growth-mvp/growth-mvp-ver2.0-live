const STAGE_TERMS: Array<[RegExp, string]> = [
  [/STAGE\s?5\s?\/\s?6/gi, '業績管理・財務計画'],
  [/STAGE\s?1/gi, '現状分析'],
  [/STAGE\s?2/gi, '全社戦略'],
  [/STAGE\s?3/gi, '部門戦略'],
  [/STAGE\s?4/gi, '実行施策'],
  [/STAGE\s?5/gi, '業績管理'],
  [/STAGE\s?6/gi, '財務計画'],
  [/GROWTH\s?SHIFT/gi, ''],
  [/\bestimates?\b/gi, '見込み'],
  [/STAGE/gi, '経営計画'],
];

const DUPLICATE_PHRASES: Array<[RegExp, string]> = [
  [/財務計画の財務計画/g, '財務計画'],
  [/実行施策の実行施策/g, '実行施策'],
  [/全社戦略の全社戦略/g, '全社戦略'],
  [/部門戦略の部門戦略/g, '部門戦略'],
  [/現状分析の現状分析/g, '現状分析'],
  [/業績管理の業績管理/g, '業績管理'],
];

/** 外部の読み手に向けて、システム内部の区分名・機能名を経営用語に置き換える */
export function toBusinessWording(text: string): string {
  let out = text;
  for (const [pattern, replacement] of STAGE_TERMS) out = out.replace(pattern, replacement);
  for (const [pattern, replacement] of DUPLICATE_PHRASES) out = out.replace(pattern, replacement);
  return out;
}
