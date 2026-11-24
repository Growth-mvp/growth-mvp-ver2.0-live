/* STAGE4 の実行計画書への、音声・文字の指示の解釈と変更内容の作成（AIは呼ばない。保存もしない）。
 * 計画書の草案（aiDraft）は変えず、利用者の修正（userEdits）の項目だけを作る。 */

export type Stage4Intent =
  | { kind: 'generate' }
  | { kind: 'goal'; addition: string }
  | { kind: 'due'; actionHint: string; dueText: string }
  | { kind: 'action-add' }
  | { kind: 'save' };

export type Stage4Change = { itemId: string; label: string; before: string; after: string };

export type Stage4Draft = {
  section1?: { goalState?: { text?: string } };
  section2?: { actions?: Array<{ order: number; title: string; dueYm?: string }> };
};

const DUE_CUE = /期限を(.+?)に(?:変更|変えて|して|修正)/;
const GOAL_PATTERN = /目的に(.+?)を?(?:追加|加え|入れ|足し)(?:して|て)?\s*$/;
const GOAL_CUE = /目的に.+(?:追加|加え|入れ|足し)/;
const GENERATE_PATTERN = /実行計画書?を(?:作って|作成して|つくって|作成|作って)/;
const ACTION_ADD_PATTERN = /実施事項に.+(?:追加|加え)/;
const SAVE_PATTERN = /^(?:この内容で|この計画で|この内容を)?保存して$/;

export function normalizeDigits(text: string): string {
  return text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',');
}

/** 「来年3月末」「2027年3月」「今年12月」などを、YYYY-MM に直す。読めなければ null */
export function dueYmFrom(text: string, now: Date): string | null {
  const m = normalizeDigits(text).match(/(来年|今年|再来年)?\s*((?:19|20)\d{2})?\s*年?\s*(\d{1,2})\s*月/);
  if (!m) return null;
  let year = now.getFullYear();
  if (m[1] === '来年') year += 1;
  if (m[1] === '再来年') year += 2;
  if (m[2]) year = Number(m[2]);
  const month = Number(m[3]);
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseStage4Intent(text: string): Stage4Intent | null {
  const trimmed = normalizeDigits(text.trim().replace(/[。.]$/, ''));
  if (!trimmed) return null;
  if (ACTION_ADD_PATTERN.test(trimmed)) return { kind: 'action-add' };
  if (SAVE_PATTERN.test(trimmed)) return { kind: 'save' };
  if (GENERATE_PATTERN.test(trimmed)) return { kind: 'generate' };
  const due = trimmed.match(DUE_CUE);
  if (due) {
    const before = trimmed.slice(0, due.index ?? 0);
    const hint = before.replace(/^.*?(?:実施事項|行動)の?/, '').replace(/の?$/, '');
    return { kind: 'due', actionHint: hint, dueText: due[1].trim() };
  }
  if (GOAL_CUE.test(trimmed)) {
    const m = trimmed.match(GOAL_PATTERN);
    const addition = m?.[1]?.replace(/^[、,，\s]+/, '').trim() ?? '';
    return addition ? { kind: 'goal', addition } : null;
  }
  return null;
}

export function goalAfter(before: string, addition: string): string {
  const base = before.trim().replace(/[。.]\s*$/, '');
  return base ? `${base}、${addition}。` : `${addition}。`;
}

function bigrams(text: string): Set<string> {
  const s = text.replace(/[\s、。,.]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 実施事項を、指示の語句で特定する。候補が1つに決まらなければ null（確認が必要） */
export function matchAction<T extends { order: number; title: string }>(
  actions: ReadonlyArray<T>,
  hint: string,
): T | { ambiguous: string[] } | null {
  if (actions.length === 0) return null;
  if (actions.length === 1 && hint.trim() === '') return actions[0];
  const h = bigrams(hint);
  const scored = actions
    .map((a) => {
      let shared = 0;
      for (const g of bigrams(a.title)) if (h.has(g)) shared++;
      return { action: a, score: shared };
    })
    .sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (best && best.score >= 2 && !(scored[1] && scored[1].score === best.score)) return best.action;
  if (actions.length === 1) return actions[0];
  return { ambiguous: actions.map((a) => `${a.order}. ${a.title}`) };
}

/** 草案と現在の利用者の修正から、項目の現在の値を返す */
export function currentValueOf(draft: Stage4Draft, edits: Record<string, unknown>, itemId: string, fallback: string): string {
  if (Object.prototype.hasOwnProperty.call(edits, itemId) && typeof edits[itemId] === 'string') return String(edits[itemId]);
  return fallback;
}

export function actionsOf(draft: Stage4Draft): Array<{ order: number; title: string; dueYm: string }> {
  return (draft.section2?.actions ?? []).map((a) => ({ order: a.order, title: a.title, dueYm: a.dueYm ?? '' }));
}

export function goalOf(draft: Stage4Draft): string {
  return draft.section1?.goalState?.text ?? '';
}
