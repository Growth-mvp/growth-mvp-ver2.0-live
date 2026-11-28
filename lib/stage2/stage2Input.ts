// 利用者の明確な依頼を、STAGE2の入力操作として決定的に読み取る（AIは呼ばない）。
// 対象や値が特定できない場合は、保存せず確認を求める。仮定・相談・否定の発言は操作にしない。
import { isNegatedOrDeferred } from '@/lib/aiOperations/consultOperation';
import { COMPANY_TARGET_UNIT_PRESETS } from './companyTargetUnit';

export type Stage2Op =
  | { kind: 'ceo.append'; text: string }
  | { kind: 'mvv.set'; field: 'mission' | 'vision' | 'value'; value: string }
  | { kind: 'target.add'; label: string; unit: string; base: number; dueYear?: number }
  | { kind: 'target.setBase'; id: string; label: string; unit: string; base: number }
  | { kind: 'swot.add'; field: 'strength' | 'weakness' | 'opportunity' | 'threat'; text: string }
  | { kind: 'answer.set'; questionId: string; text: string };

/** 生成・確定は、既存の処理（ボタンと同じ処理）に任せる。確定は承認（画面のボタン）を必要とする */
export type Stage2Action = { kind: 'draft' } | { kind: 'final' } | { kind: 'commit' };

export type Stage2InputResult =
  | { kind: 'op'; op: Stage2Op }
  | { kind: 'action'; action: Stage2Action }
  | { kind: 'clarify'; message: string };

export type Stage2InputContext = {
  targets: ReadonlyArray<{ id: string; label: string; unit: string; base: number; dueYear?: number }>;
  /** 画面で選ばれている12の問い（相談の焦点）。「この質問への回答は」の対象になる */
  focusQuestionId: string | null;
  questionIds: readonly string[];
};

const CEO_MAX = 2000;
const MVV_MAX = 300;
const SWOT_MAX = 300;
const ANSWER_MAX = 4000;
const LABEL_MAX = 40;

// 仮定・検討の語は常に除外する。「〜したい」は、明確な依頼の語尾（追記して等）がある時は本文の内容なので除外しない
const HYPOTHETICAL = /もし|かも|かな|べき|検討|考え|でしょう|ではないか|どうか/;
const WISH = /たい/;
const EXPLICIT_DIRECTIVE = /(?:追記|追加|入れ|設定|変更|修正|登録)(?:して|しておいて|してください)$|にします$|にしよう$/;
const TARGET_VALUE = /^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(億円|百万円|万円|千円|円|%|件|人|回)$/;
const SWOT_FIELD: Record<string, 'strength' | 'weakness' | 'opportunity' | 'threat'> = {
  強み: 'strength',
  弱み: 'weakness',
  機会: 'opportunity',
  脅威: 'threat',
};
const MVV_FIELD: Record<string, 'mission' | 'vision' | 'value'> = {
  ミッション: 'mission',
  ビジョン: 'vision',
  バリュー: 'value',
};

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const unquote = (s: string) => s.replace(/^[「『"'\s、,，]+|[」』"'\s、,，]+$/g, '');
const clarify = (message: string): Stage2InputResult => ({ kind: 'clarify', message });

function parseTargetValue(raw: string): { base: number; unit: string } | null {
  const m = norm(raw).replace(/[。.!！]+$/, '').match(TARGET_VALUE);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base) || base < 0) return null;
  if (!(COMPANY_TARGET_UNIT_PRESETS as readonly string[]).includes(m[2])) return null;
  return { base, unit: m[2] };
}

/** 利用者の発言を、STAGE2の入力操作として読み取る。入力操作でなければ null（通常の相談に任せる） */
export function resolveStage2Input(raw: string, ctx: Stage2InputContext): Stage2InputResult | null {
  const text = norm(raw).replace(/[。.!！]+$/, '');
  if (!text || text.length > 400) return null;
  const explicit = EXPLICIT_DIRECTIVE.test(text);
  if (isNegatedOrDeferred(text) || HYPOTHETICAL.test(text) || (!explicit && WISH.test(text))) return null;
  if (/[?？]$|か$/.test(text)) return null;

  // 生成・確定（既存の処理に任せる）
  if (/^(?:戦略の)?たたき台を(?:作って|作成して|生成して|再生成して|作り直して)(?:ください)?$/.test(text)) {
    return { kind: 'action', action: { kind: 'draft' } };
  }
  if (/^(?:経営戦略|最終戦略|戦略書|経営戦略書)を(?:作って|作成して|生成して|再生成して|作り直して)(?:ください)?$/.test(text)) {
    return { kind: 'action', action: { kind: 'final' } };
  }
  if (/^(?:全社戦略|経営戦略)を確定(?:して|してください)?$/.test(text) || /^STAGE3へ(?:引き渡して|引き渡し|引き渡してください)$/.test(text)) {
    return { kind: 'action', action: { kind: 'commit' } };
  }

  // 経営者の思い（追記）。文脈の参照（「今の話を」）は、ここでは読み取らず、直接の指定を求める
  if (/^(?:今の話|先ほどの内容|この内容|今の議論)を経営者の思い/.test(text)) {
    return clarify('経営者の思いに入れる文を「〜」の形で教えてください（例：「経営者の思いに、地域とのつながりを大切にしたいと追記して」）。');
  }
  const ceo = text.match(/^経営者の思い(?:に|へ)[「『]?(.+?)[」』]?(?:と|を)?(?:追記|追加|入れ)(?:して|しておいて|してください)?$/);
  if (ceo) {
    const body = unquote(ceo[1]);
    if (!body) return clarify('経営者の思いに入れる文を教えてください。');
    if (body.length > CEO_MAX) return clarify(`経営者の思いは${CEO_MAX}字以内で指示してください。`);
    return { kind: 'op', op: { kind: 'ceo.append', text: body } };
  }

  // ミッション・ビジョン・バリュー（設定）
  const mvv = text.match(/^(ミッション|ビジョン|バリュー)(?:は|を)[「『]?(.+?)[」』]?(?:に(?:変更|修正|して)|です)(?:してください)?$/);
  if (mvv) {
    const value = unquote(mvv[2]);
    if (!value) return clarify(`${mvv[1]}の内容を教えてください。`);
    if (value.length > MVV_MAX) return clarify(`${mvv[1]}は${MVV_MAX}字以内で指示してください。`);
    return { kind: 'op', op: { kind: 'mvv.set', field: MVV_FIELD[mvv[1]], value } };
  }

  // 業績目標（追加・修正）。既存の同じ名前の目標は、値の修正として扱う
  const target =
    text.match(/^(?:(\d{4})年度の)?(.+?)(?:の)?目標(?:は|を)(.+?)(?:にしよう|にします|にして(?:ください)?|に設定(?:して)?(?:ください)?|に変更(?:して)?(?:ください)?|に修正(?:して)?(?:ください)?|です)$/) ??
    text.match(/^業績目標に(?:(\d{4})年度の)?(.+?)(?:の目標)?(?:は|を)(.+?)(?:を)?(?:追加|設定)(?:して)?(?:ください)?$/);
  if (target) {
    const label = unquote(target[2]);
    const year = target[1] ? Number(target[1]) : undefined;
    if (!label || label.length > LABEL_MAX) return clarify(`目標の名前（例：営業利益）を${LABEL_MAX}字以内で指示してください。`);
    const value = parseTargetValue(target[3]);
    if (!value) {
      return clarify('目標値は、単位を含めて指示してください（例：8,000万円、500件）。単位は、円・千円・万円・百万円・億円・%・件・人・回から選びます。');
    }
    const existing = ctx.targets.find((t) => unquote(t.label) === label && (year === undefined || t.dueYear === undefined || t.dueYear === year));
    if (existing) {
      if (existing.unit !== value.unit) {
        return clarify(`「${label}」の単位は「${existing.unit}」です。同じ単位で指示してください。`);
      }
      return { kind: 'op', op: { kind: 'target.setBase', id: existing.id, label, unit: value.unit, base: value.base } };
    }
    return { kind: 'op', op: { kind: 'target.add', label, unit: value.unit, base: value.base, ...(year ? { dueYear: year } : {}) } };
  }

  // SWOT（追加）
  const swot = text.match(/^(強み|弱み|機会|脅威)に[「『]?(.+?)[」』]?(?:を|と)?(?:追加|追記|加え)(?:して|しておいて|してください)?$/);
  if (swot) {
    const body = unquote(swot[2]);
    if (!body) return clarify(`${swot[1]}に加える内容を教えてください。`);
    if (body.length > SWOT_MAX) return clarify(`${swot[1]}の内容は${SWOT_MAX}字以内で指示してください。`);
    return { kind: 'op', op: { kind: 'swot.add', field: SWOT_FIELD[swot[1]], text: body } };
  }

  // 12の問いへの回答（画面で選ばれている質問。明示の質問番号は、質問IDで指定する）
  const answer = text.match(/^(?:この|今の)(?:質問|問い)への(?:回答|答え)は[「『]?(.+?)[」』]?(?:です|と(?:して|答えて))?$/);
  if (answer) {
    if (!ctx.focusQuestionId) return clarify('回答する質問を、画面で選んでから指示してください（例：「この質問への回答は、〇〇です」）。');
    const body = unquote(answer[1]);
    if (!body) return clarify('回答の内容を教えてください。');
    if (body.length > ANSWER_MAX) return clarify(`回答は${ANSWER_MAX}字以内で指示してください。`);
    return { kind: 'op', op: { kind: 'answer.set', questionId: ctx.focusQuestionId, text: body } };
  }

  return null;
}
