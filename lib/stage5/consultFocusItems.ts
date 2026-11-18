/* STAGE5：実行支援の画面の内容を、相談の文脈（ConsultFocus の項目）に変換する（純粋関数）。
 * saved は「正式に保存済みの値と同じ」という意味。入力中の値・書き込み中（busy）の値・判定できない値は saved=false にする。
 * 保存済みの値は、画面と同じ読み取り元（戦略の store の値）から取る。項目の長さは、サーバーの検査（ConsultFocusSchema）を通る範囲に切る。 */
import { ACTION_STATUS_LABEL, type ActionStatus } from '@/lib/stage5/actionProgress';
import { parseFinanceActualInput, type FinanceActualItem } from '@/lib/stage5/financeActuals';
import { krActualView } from '@/lib/stage5/krActual';
import type { KRStructured } from '@/types/strategy';

export type ConsultItem = { label: string; value: string; saved: boolean };

/** 相談の項目の上限（ConsultFocusSchema と同じ） */
export const CONSULT_ITEMS_MAX = 12;
/** 文章欄の上限（ConsultFocusSchema の検査で文脈全体が落ちないように、送る前に切る） */
export const CONSULT_DRAFT_MAX = 4000;
const ACTION_ITEMS_MAX = 6;
const LABEL_MAX = 80;
const VALUE_MAX = 600;
const YM_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 任意の文字列を、上限の長さに切る */
export function consultText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

const labelOf = (s: string) => consultText(s.trim() || '項目', LABEL_MAX);
const valueOf = (s: string) => consultText(s.trim(), VALUE_MAX);

export type ConsultActionRow = { no: number; title: string; status: ActionStatus; memo: string; saved: boolean };

type ActionSavedLike = { status: ActionStatus; result: string };
type ActionDraftLike = { status: ActionStatus; memo: string };

/** 実施事項ごとの進捗の行。下書き（編集中）があり保存済みと違えば未保存。書き込み中はすべて未保存。 */
export function consultActionRows(args: {
  actions: ReadonlyArray<{ no: number; title: string; actionKey: string }>;
  progress: Readonly<Record<string, ActionSavedLike>>;
  drafts: Readonly<Record<string, ActionDraftLike>>;
  busy: boolean;
}): ConsultActionRow[] {
  return args.actions
    .filter((a) => a.actionKey !== '')
    .map((a) => {
      const saved = args.progress[a.actionKey];
      const savedStatus: ActionStatus = saved?.status ?? 'NOT_STARTED';
      const savedMemo = saved?.result ?? '';
      const draft = args.drafts[a.actionKey];
      const dirty = draft !== undefined && (draft.status !== savedStatus || draft.memo !== savedMemo);
      return {
        no: a.no,
        title: a.title,
        status: draft?.status ?? savedStatus,
        memo: draft?.memo ?? savedMemo,
        saved: !dirty && !args.busy,
      };
    });
}

function actionItem(r: ConsultActionRow): ConsultItem {
  const memo = r.memo.trim();
  return {
    label: labelOf(`${r.no}. ${r.title}`),
    value: valueOf(`状態：${ACTION_STATUS_LABEL[r.status]}／進捗メモ：${memo || '未入力'}`),
    saved: r.saved,
  };
}

/** 実績の登録フォームの、KR の入力欄（保存前の値） */
export type KrInputLike = { value: string; asOf: string };

/** 入力欄の値が、保存済みの実績と違うか（違えば未保存の入力）。判定できない場合も未保存として扱う */
function krPending(k: KRStructured, input: KrInputLike | undefined): boolean {
  const typed = input?.value.trim() ?? '';
  if (!input || typed === '') return false;
  const actual = k.actual;
  if (!actual) return true;
  return !(Number(typed) === actual.value && input.asOf.trim() === actual.asOf);
}

function krItem(k: KRStructured, input: KrInputLike | undefined, busy: boolean): ConsultItem {
  const name = String(k.label ?? '').trim() || '（名称未設定）';
  const unit = String(k.unit ?? '');
  const view = krActualView(k);
  if (input && krPending(k, input)) {
    const asOf = input.asOf.trim() || '未入力';
    return {
      label: labelOf(name),
      value: valueOf(`目標 ${view.targetText}／入力中の実績 ${input.value.trim()}${unit}（基準日 ${asOf}・未保存）`),
      saved: false,
    };
  }
  const actual = view.status === 'recorded' ? `実績 ${view.actualText}（基準日 ${view.asOf}）` : '実績 未登録';
  return { label: labelOf(name), value: valueOf(`目標 ${view.targetText}／${actual}`), saved: !busy };
}

function financeItem(item: FinanceActualItem, ym: string, typedRaw: string | undefined, busy: boolean): ConsultItem | null {
  if (!item.recordable) return null;
  const registered = item.actuals.find((a) => a.ym === ym);
  const typed = (typedRaw ?? '').trim();
  const label = labelOf(`${item.label}（財務実績）`);
  if (typed !== '') {
    const parsed = parseFinanceActualInput({ ym, amount: typed, note: '' });
    const same = parsed.ok && !!registered && registered.amountYen === parsed.amountYen;
    if (!same) return { label, value: valueOf(`${ym} 入力中の金額 ${typed}円（未保存）`), saved: false };
  }
  const shown = registered ? `${registered.amountYen.toLocaleString('ja-JP')}円` : '未登録';
  return { label, value: valueOf(`${ym}：${shown}`), saved: !busy };
}

/** 実績の登録フォームの、表示中の入力状態（保存はしない） */
export type RegistrationConsultInput = {
  ym: string;
  finance: Readonly<Record<string, string>>;
  kr: Readonly<Record<string, KrInputLike>>;
  busy: boolean;
};

/**
 * 実行支援の画面の項目。実施事項の進捗（最大6件）・KRの実績・財務実績を並べ、未保存のものを先頭にして最大12件まで。
 * 対象年月が選ばれていない場合は、財務実績の項目を出さない（画面にも値が出ていないため）。
 */
export function consultExecItems(args: {
  actionRows: readonly ConsultActionRow[];
  krs: readonly KRStructured[];
  financeItems: readonly FinanceActualItem[];
  registration: RegistrationConsultInput | null;
}): ConsultItem[] {
  const reg = args.registration;
  const busy = reg?.busy ?? false;
  const ym = reg?.ym ?? '';

  const actions = [...args.actionRows]
    .sort((a, b) => Number(a.saved) - Number(b.saved))
    .slice(0, ACTION_ITEMS_MAX)
    .map(actionItem);
  const krs = args.krs.map((k) => {
    const input: KrInputLike | undefined = k.id ? reg?.kr[k.id] : undefined;
    return krItem(k, input, busy);
  });
  const finance = YM_PATTERN.test(ym)
    ? args.financeItems
        .map((item) => financeItem(item, ym, reg?.finance[item.itemKey], busy))
        .filter((x): x is ConsultItem => x !== null)
    : [];

  const all = [...actions, ...krs, ...finance];
  return [...all.filter((i) => !i.saved), ...all.filter((i) => i.saved)].slice(0, CONSULT_ITEMS_MAX);
}
