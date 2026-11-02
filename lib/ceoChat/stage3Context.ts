type AnyRecord = Record<string, any>;

export const BRIDGE_CHAR_BUDGET = 1500;

const PLACEHOLDER_MARK = '情報が生成されませんでした';
const DEFAULT_RULES = [
  '各部門ミッションは戦略の芯に対する自部門の役割を明記する',
  '各プロジェクトは重点領域または保持すべきテーマに接続する',
  'KPIは顧客価値・資源配分・行動変化を測る指標にする',
];
const LIST_MAX_ITEMS = 8;
const ITEM_MAX = 160;

const CORE_SCALARS: Array<[key: string, label: string]> = [
  ['primaryShift', '既存からの転換'],
  ['customerValue', '顧客にとっての価値'],
  ['portfolioShift', '経営資源・事業の移し方'],
  ['behaviorChange', '求める行動変化'],
];
const CORE_LISTS: Array<[key: string, label: string]> = [
  ['concreteDomains', '重点とする市場・用途・領域'],
  ['coreCapabilities', '戦略を支える強み・能力'],
  ['nonNegotiableThemes', '保持すべきテーマ'],
];

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

function usable(v: unknown): string {
  const t = clean(v);
  return t.length > 0 && !t.includes(PLACEHOLDER_MARK) ? t.slice(0, ITEM_MAX) : '';
}

function usableList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(usable).filter((x) => x.length > 0).slice(0, LIST_MAX_ITEMS);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * 保存時は strategicCore が既定値（他の配列の先頭など）で埋められるため、
 * 保存後は生成結果と既定値を区別できない。既定値と一致する項目は除外する。
 */
function isDerivedScalar(key: string, value: string, b: AnyRecord): boolean {
  const keyThemes = usableList(b.keyThemes);
  const kpi = usableList(b.kpiCriteria);
  const behaviors = usableList(b.commonBehaviorChanges);
  const source: Record<string, string | undefined> = {
    primaryShift: keyThemes[0],
    customerValue: keyThemes[1],
    portfolioShift: kpi[0],
    behaviorChange: behaviors[0],
  };
  return source[key] !== undefined && source[key] === value;
}

function isDerivedList(key: string, value: string[], b: AnyRecord): boolean {
  const keyThemes = usableList(b.keyThemes);
  const departmentIssues = usableList(b.departmentIssues);
  const fallbackThemes = Array.from(new Set([...departmentIssues, ...keyThemes])).slice(0, LIST_MAX_ITEMS);
  const source: Record<string, string[]> = {
    concreteDomains: departmentIssues.slice(0, LIST_MAX_ITEMS),
    coreCapabilities: keyThemes.slice(0, LIST_MAX_ITEMS),
    nonNegotiableThemes: fallbackThemes,
  };
  return source[key] !== undefined && sameList(source[key], value);
}

function rulesWithoutDefaults(v: unknown): string[] {
  const rules = usableList(v);
  if (sameList(rules, DEFAULT_RULES)) return [];
  return rules.filter((r) => !DEFAULT_RULES.includes(r));
}

function dateOf(v: unknown): string {
  const t = typeof v === 'string' ? v : '';
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
}

export type Stage3BridgeBlock = {
  text: string;
  state: 'present' | 'absent';
  included: string[];
  omitted: number;
};

/**
 * 既存の認可済み strategy 行の stage3_strategy_bridge だけを読む。
 * 許可項目（strategicCore・keyThemes・departmentIssues・commonBehaviorChanges・departmentTranslationRules）
 * 以外、特に kpiCriteria は含めない。
 */
export function buildStage3BridgeBlock(
  strategy: AnyRecord | null | undefined,
  opts: { budget?: number } = {}
): Stage3BridgeBlock {
  const budget = opts.budget ?? BRIDGE_CHAR_BUDGET;
  const b: AnyRecord | null =
    strategy?.stage3_strategy_bridge && typeof strategy.stage3_strategy_bridge === 'object' && !Array.isArray(strategy.stage3_strategy_bridge)
      ? strategy.stage3_strategy_bridge
      : null;

  const absent = (note: string): Stage3BridgeBlock => ({
    text: `【STAGE3 戦略展開ブリッジ】\n- ${note}。橋渡しの内容を推測で補わないでください。`,
    state: 'absent',
    included: [],
    omitted: 0,
  });

  if (!b) return absent('STAGE3の戦略展開ブリッジは登録されていません');

  const included: string[] = [];
  const core: AnyRecord = b.strategicCore && typeof b.strategicCore === 'object' ? b.strategicCore : {};
  const coreLines: string[] = [];
  for (const [key, label] of CORE_SCALARS) {
    const value = usable(core[key]);
    if (value && !isDerivedScalar(key, value, b)) {
      coreLines.push(`  - ${label}: ${value}`);
      included.push(`strategicCore.${key}`);
    }
  }
  for (const [key, label] of CORE_LISTS) {
    const list = usableList(core[key]);
    if (list.length > 0 && !isDerivedList(key, list, b)) {
      coreLines.push(`  - ${label}: ${list.join('、')}`);
      included.push(`strategicCore.${key}`);
    }
  }

  const sections: Array<{ label: string; key: string; items: string[] }> = [
    { label: '重要テーマ（生成結果）', key: 'keyThemes', items: usableList(b.keyThemes) },
    { label: '部門横断の論点（生成結果）', key: 'departmentIssues', items: usableList(b.departmentIssues) },
    { label: '社員・部門に求める行動変化（生成結果）', key: 'commonBehaviorChanges', items: usableList(b.commonBehaviorChanges) },
    { label: '部門展開のルール（生成結果）', key: 'departmentTranslationRules', items: rulesWithoutDefaults(b.departmentTranslationRules) },
  ];

  const body: string[] = [];
  if (coreLines.length > 0) {
    body.push(['- 戦略の芯（生成結果）:', ...coreLines].join('\n'));
    included.push('strategicCore');
  }
  for (const s of sections) {
    if (s.items.length > 0) {
      body.push(`- ${s.label}: ${s.items.join('、')}`);
      included.push(s.key);
    }
  }

  if (body.length === 0) return absent('STAGE3の戦略展開ブリッジは登録されていますが、利用できる内容がありません（既定値・代替文のみ）');

  const header = [
    '【STAGE3 戦略展開ブリッジ（AI生成・保存済みの内容）】',
    '- 位置づけ: STAGE2の経営者の意図・確定ストーリーとは別の、STAGE3の生成結果です。経営者が承認・採用した記録ではありません。',
    ...(dateOf(b.generatedAt) ? [`- 生成日: ${dateOf(b.generatedAt)}`] : []),
    '- 部門の役割・担当者・KPIの確定値とは結びつけないでください。この情報からは部門との対応関係を判断できません。',
    '- 既定値・代替文は除外しています。',
  ];

  const lines: string[] = [];
  let used = 0;
  const addAll = (items: string[]) => {
    for (const item of items) {
      if (used + item.length + 1 > budget) return false;
      lines.push(item);
      used += item.length + 1;
    }
    return true;
  };
  addAll(header);
  let omitted = 0;
  for (const item of body) {
    if (!addAll([item])) omitted += 1;
  }
  if (omitted > 0) lines.push(`（上限のため${omitted}件を省略）`);

  return { text: lines.join('\n'), state: 'present', included, omitted };
}
