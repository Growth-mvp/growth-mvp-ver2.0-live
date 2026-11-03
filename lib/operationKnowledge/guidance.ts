import { findScreenById } from '@/lib/screens/screenRegistry';
import { getOperationsForScreen, isGuidanceEnabled } from './lookup';
import { OPERATIONS, type OperationEntry, type OperationRole } from './operations';

export const GUIDANCE_CHAR_BUDGET = 3000;
export const GUIDANCE_MAX_OPERATIONS = 6;
export const COMPOUND_MAX_OPERATIONS = 2;
const MATCH_THRESHOLD = 2;
const STEPS_SHOWN = 3;

const ROLE_RANK: Record<OperationRole, number> = { member: 0, manager: 1, admin: 2 };
const ROLE_LABEL: Record<OperationRole, string> = {
  member: '所属メンバーなら実行できる',
  manager: '管理職以上',
  admin: '管理者のみ',
};

export type QuestionKind = 'operation' | 'compound' | 'consult' | 'none';

const ONBOARDING_CUE = /(初めて|はじめて|何から)/;
const STRONG_OPERATION_CUE = /(この画面|次は|次に|使い方|使う|ボタン|タブ|見当たら|保存)/;
const WEAK_OPERATION_CUE = /(どうすれば|どうやって|どうしたら|やり方|進め方|手順|作りたい|作る|作成|生成|入力|追加|削除|編集|更新|共有|依頼|何をす|何のため|目的|どこ|開く)/;
const APP_OBJECT = /(画面|欄|部門|SWOT|たたき台|論点|計画書|ルーム|セグメント|財務データ|業績目標|メトリクス|分析|KPI|OKR|STAGE|ステージ|GROWTH|アプリ)/i;
const CONSULT_CUE = /(売上|利益|伸び|成果|効果|本当に|正しい|根拠|判断|リスク|投資|収益|原価|なぜ|動か|動いて|やる気|不満|反発|業績|市場|競合|戦略は|戦略で|勝て|方向性|どう思う)/;
const ELEMENT_WORD = /(ボタン|タブ|項目|欄|リンク)/;
/* 画面の用語（財務効果・算定根拠など）は、経営相談の判定から外す。「効果」「根拠」は経営の語としても使われるため */
const APP_TERM = /(財務効果|財務換算|算定根拠|KR(の)?実績|実績を記録|条件付きPL|条件付きCF|統一PL|参考判定|未算定|確認済み|この案を金額に反映|効果の種類|旧北極星|金額が分からない|金額の入力)/;
const APP_TERM_OPERATION_CUE = /(入力|入れ|何を|どこ|種類|単位|開始|記録|確認|反映|違い|見方|読み方|意味|どう考|どうすれば|どうしたら|書けば|例|って何|とは|何ですか|何です|何？)/;
const APP_TERM_IN_CONSULT_CHECK = /(財務効果|算定根拠|KR(の)?実績|条件付きPL|条件付きCF|統一PL|参考判定|未算定|確認済み|旧北極星)/g;

const STAGE_SCREEN_BY_NUMBER: Record<number, string> = {
  1: 'stage1',
  2: 'stage2',
  3: 'stage3',
  4: 'stage4',
  5: 'stage5',
  6: 'stage6',
};

const QUERY_STOP_BIGRAMS = new Set([
  'する', 'ると', 'ます', 'です', 'ばい', 'いい', 'どう', '方法', '何を', '何か', 'ここ', 'この', 'その',
  'して', 'どこ', '使い', 'ださ', 'くだ', '分か', '教え', 'ので', '画面', '操作', '次は', '次に', 'ため',
  'とは', 'ある', 'ない', 'もの', 'こと', 'には', 'のか', 'れば', 'うと', 'ての', 'では', 'から', 'ける',
  'れる', 'した', 'どれ', '全部', 'ボタ', 'ンは',
]);

export function normalizeRole(role: unknown): OperationRole {
  return role === 'admin' || role === 'manager' ? role : 'member';
}

export function classifyQuestion(text: string): QuestionKind {
  const mentioned = detectMentionedScreenIds(text).length > 0;
  const object = mentioned || APP_OBJECT.test(text);
  const appTerm = APP_TERM.test(text);
  const operation =
    ONBOARDING_CUE.test(text) ||
    STRONG_OPERATION_CUE.test(text) ||
    (WEAK_OPERATION_CUE.test(text) && object) ||
    (appTerm && APP_TERM_OPERATION_CUE.test(text));
  const consult = CONSULT_CUE.test(text.replace(APP_TERM_IN_CONSULT_CHECK, ''));
  if (operation && consult) return 'compound';
  if (operation) return 'operation';
  if (consult) return 'consult';
  return 'none';
}

export function detectOperationIntent(text: string): boolean {
  const kind = classifyQuestion(text);
  return kind === 'operation' || kind === 'compound';
}

export function detectMentionedScreenIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(/(?:STAGE|stage|ステージ)\s*([0-9])/g)) {
    const screenId = STAGE_SCREEN_BY_NUMBER[Number(match[1])];
    if (screenId) ids.push(screenId);
  }
  if (/組織変革|ルーム|違和感|すり合わせ/.test(text)) ids.push('org-personal', 'org-shared');
  const planAudience: string[] = [];
  if (/銀行/.test(text)) planAudience.push('plan-bank');
  if (/株主/.test(text)) planAudience.push('plan-shareholder');
  if (/社員向け/.test(text)) planAudience.push('plan-employee');
  if (planAudience.length > 0) ids.push(...planAudience);
  else if (/経営計画書|計画書/.test(text)) ids.push('plan-hub', 'plan-bank', 'plan-shareholder', 'plan-employee');
  if (/条件付きPL|条件付きCF|統一PL|参考判定|未算定/.test(text)) ids.push('stage6');
  if (/財務効果|算定根拠|効果の種類|この案を金額に反映|旧北極星/.test(text)) ids.push('stage4');
  if (/KR(の)?実績|実績を記録/.test(text)) ids.push('stage5');
  return [...new Set(ids)];
}

function squash(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(text: string): Set<string> {
  const compact = squash(text.toLowerCase());
  const out = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) {
    const pair = compact.slice(i, i + 2);
    if (!QUERY_STOP_BIGRAMS.has(pair)) out.add(pair);
  }
  return out;
}

function relevance(op: OperationEntry, queryBigrams: Set<string>): number {
  const haystack = bigrams([op.label, op.purpose, ...op.steps, op.save.target].join(''));
  let score = 0;
  for (const pair of queryBigrams) if (haystack.has(pair)) score++;
  return score;
}

function nextScreenLine(screenId: string): string | null {
  const match = /^stage([1-5])$/.exec(screenId);
  if (!match) return null;
  const next = findScreenById(`stage${Number(match[1]) + 1}`);
  return next ? `次の画面: ${next.label}（${next.pathname}）` : null;
}

function formatOperation(op: OperationEntry): string {
  const save = op.save.kind === 'unverified' ? '未確認（案内しない）' : op.save.target;
  const shown = op.steps.slice(0, STEPS_SHOWN).map((step, i) => `${i + 1}. ${step}`).join(' ');
  const rest = op.steps.length > STEPS_SHOWN ? '（残りの手順は、追加で尋ねられたら説明してください）' : '';
  return [
    `- 「${op.label}」（${op.operationId}）: ${op.purpose}`,
    `  手順: ${shown}${rest}`,
    `  条件: ${op.conditions}`,
    `  権限: ${ROLE_LABEL[op.permission.minRole]}`,
    `  保存: ${save}`,
  ].join('\n');
}

const RULES_BLOCK = [
  '【回答の原則（操作案内）】',
  '1. 最初に、その画面（または対象）で何をする場所かを一言で説明する。',
  '2. 目的を先に示し、次の1〜3手順だけを番号付きで案内する。詳細は、利用者の追加質問に応じて説明する。',
  '3. 入力が必要なときは、何を入れるかを示す。例を示すときは登録情報の範囲に限り、それ以外の例は「例（推測）」と明記する。',
  '4. 上の操作一覧にない操作・ボタン・機能は案内しない。対象のボタンや画面が特定できないときは、推測せず、ボタン名または画面を一つだけ尋ねる。管理者向けの未解決の機能（論点の編集、次の対応の登録、反映候補の作成など）は、利用可能な操作として案内しない。',
  '5. 権限・表示条件・未確認の項目は、その条件を明記する。未確認の内容は確定事項として言わない。実装・登録情報にない用途、効果、評価、人事への影響は断定せず、述べる場合は「推測」と明記する。',
  '6. 質問は一度に一つまでにする。',
  '7. 操作案内と経営相談を混同しない。経営の判断を求められたら、操作案内ではなく経営相談として答える。複合の質問では、経営相談の回答を優先し、操作案内は補助として短く添える。',
  '8. 最後に、次に行う一歩を示す。',
  '9. 財務効果は、利用者自身が内容を確かめて確認するものとして案内する。利用者に代わって確認済みにする、金額に反映する、と案内しない。',
].join('\n');

const HEADER = '【操作案内（登録簿に基づく）】\nこの案内は登録済みの操作だけを根拠にしています。登録にない操作は案内しないでください。';

export type GuidanceInput = {
  screenId: string | null;
  query: string;
  role: unknown;
};

export type GuidanceResult = {
  text: string;
  operationCount: number;
  screenIds: string[];
  excludedByRole: number;
};

const EMPTY: GuidanceResult = { text: '', operationCount: 0, screenIds: [], excludedByRole: 0 };

type Group = { screenId: string | null; ops: OperationEntry[] };

function buildPool(screenIds: string[]): OperationEntry[] {
  const seen = new Set<string>();
  const screenOps: OperationEntry[] = [];
  const globalOps: OperationEntry[] = [];
  for (const screenId of screenIds) {
    if (!isGuidanceEnabled(screenId)) continue;
    for (const op of getOperationsForScreen(screenId)) {
      if (seen.has(op.operationId)) continue;
      seen.add(op.operationId);
      (op.screenIds.length === 0 ? globalOps : screenOps).push(op);
    }
  }
  return [...screenOps, ...globalOps];
}

function groupOps(ops: OperationEntry[], screenIds: string[]): Group[] {
  const byScreen = new Map<string | null, OperationEntry[]>();
  for (const op of ops) {
    const screenId = op.screenIds.find((id) => screenIds.includes(id)) ?? null;
    byScreen.set(screenId, [...(byScreen.get(screenId) ?? []), op]);
  }
  const groups: Group[] = screenIds.map((screenId) => ({ screenId, ops: byScreen.get(screenId) ?? [] }));
  groups.push({ screenId: null, ops: byScreen.get(null) ?? [] });
  return groups;
}

function render(groups: Group[], excludedByRole: number, nextLine: string | null, compound: boolean): string {
  const parts: string[] = [HEADER];
  if (compound) {
    parts.push('※ この質問には経営相談の要素も含まれています。下の操作案内は補助として短く添え、経営判断は通常どおり答えてください。');
  }
  for (const group of groups) {
    if (group.ops.length === 0) continue;
    const screen = group.screenId ? findScreenById(group.screenId) : null;
    parts.push(screen ? `■ ${screen.label}（${screen.pathname}）` : '■ 全画面共通');
    parts.push(...group.ops.map(formatOperation));
  }
  if (excludedByRole > 0) {
    parts.push('※ 権限により、一部の操作は案内の対象外です（管理者または管理職が行います）。');
  }
  if (nextLine) parts.push(nextLine);
  parts.push(RULES_BLOCK);
  return parts.join('\n\n');
}

function findLabelMatch(query: string): OperationEntry | null {
  const q = squash(query);
  return OPERATIONS.find((op) => op.label.length >= 2 && q.includes(squash(op.label))) ?? null;
}

function clarifyText(screenId: string | null): string {
  const current = screenId ? findScreenById(screenId) : null;
  const where = current ? `現在の画面は「${current.label}」です。` : '';
  return [
    HEADER,
    `${where}ご質問の対象（ボタンや画面）を、登録された操作から特定できません。推測で操作を案内せず、次のどちらか一つだけを尋ねてください：「画面上のボタンの表示名」または「探している画面」。`,
    RULES_BLOCK,
  ].join('\n\n');
}

export function buildOperationGuidance(input: GuidanceInput): GuidanceResult {
  const kind = classifyQuestion(input.query);
  if (kind === 'consult' || kind === 'none') return EMPTY;

  const role = normalizeRole(input.role);
  const mentioned = detectMentionedScreenIds(input.query);
  const labelMatch = findLabelMatch(input.query);

  if (kind === 'operation' && mentioned.length === 0 && !labelMatch && ELEMENT_WORD.test(input.query)) {
    return { text: clarifyText(input.screenId), operationCount: 0, screenIds: [], excludedByRole: 0 };
  }

  let focusScreens = mentioned.length > 0 ? mentioned : input.screenId ? [input.screenId] : [];
  if (mentioned.length === 0 && labelMatch?.screenIds.length) {
    focusScreens = [labelMatch.screenIds[0]];
  }
  if (mentioned.length === 0 && ONBOARDING_CUE.test(input.query) && !(input.screenId && isGuidanceEnabled(input.screenId))) {
    focusScreens = ['stage1'];
  }

  if (focusScreens.length === 0) {
    const text = [
      HEADER,
      '現在の画面を特定できないため、画面ごとの操作は案内できません。どの画面についての質問かを一つだけ尋ねてください。',
      RULES_BLOCK,
    ].join('\n\n');
    return { text, operationCount: 0, screenIds: [], excludedByRole: 0 };
  }

  const pool = buildPool(focusScreens);
  if (pool.length === 0) {
    const label = focusScreens.map((id) => findScreenById(id)?.label ?? id).join('、');
    const text = [
      HEADER,
      `${label} の操作情報は登録されていません。推測で案内せず、「その操作は確認できる情報がありません」と伝え、画面内の見出しやボタン名を探すか、管理者に確認するよう案内してください。`,
      RULES_BLOCK,
    ].join('\n\n');
    return { text, operationCount: 0, screenIds: focusScreens, excludedByRole: 0 };
  }

  const allowed = pool.filter((op) => ROLE_RANK[op.permission.minRole] <= ROLE_RANK[role]);
  const excludedByRole = pool.length - allowed.length;

  const queryPairs = bigrams(input.query);
  const matched = allowed
    .map((op, index) => ({ op, index, score: relevance(op, queryPairs) }))
    .filter((x) => x.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.op);
  const matchedIds = new Set(matched.map((op) => op.operationId));
  const overview = allowed.filter((op) => !matchedIds.has(op.operationId));
  const limit = kind === 'compound' ? COMPOUND_MAX_OPERATIONS : GUIDANCE_MAX_OPERATIONS;
  let picked = [...matched, ...overview].slice(0, limit);

  const nextLine = nextScreenLine(focusScreens[0]);
  const compound = kind === 'compound';

  let text = render(groupOps(picked, focusScreens), excludedByRole, nextLine, compound);
  while (text.length > GUIDANCE_CHAR_BUDGET && picked.length > 0) {
    picked = picked.slice(0, -1);
    text = render(groupOps(picked, focusScreens), excludedByRole, nextLine, compound);
  }

  return { text, operationCount: picked.length, screenIds: focusScreens, excludedByRole };
}
