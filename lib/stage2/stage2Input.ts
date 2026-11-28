// 利用者の明確な依頼を、STAGE2の入力操作として読み取る。
// 定型の依頼は決定的に読み取り、会話の文脈（「今の話」「先ほどの内容」）は相談 API の操作候補（<<OP>>）で受け取って検証する。
// 追加のAI呼び出しは行わない。対象や値が特定できない場合は、保存せず確認を求める。
import { z } from 'zod';
import { isNegatedOrDeferred } from '@/lib/aiOperations/consultOperation';
import { COMPANY_TARGET_UNIT_PRESETS } from './companyTargetUnit';

export type SwotField = 'strength' | 'weakness' | 'opportunity' | 'threat';

export type Stage2Op =
  | { kind: 'ceo.append'; text: string }
  | { kind: 'ceo.set'; text: string }
  | { kind: 'mvv.set'; field: 'mission' | 'vision' | 'value'; value: string }
  | { kind: 'target.add'; label: string; unit: string; base: number; dueYear?: number }
  | { kind: 'target.setBase'; id: string; label: string; unit: string; base: number }
  | { kind: 'target.update'; id: string; label: string; dueYear?: number }
  | { kind: 'target.remove'; id: string; label: string }
  | { kind: 'swot.add'; field: SwotField; text: string }
  | { kind: 'swot.replace'; field: SwotField; from: string; to: string }
  | { kind: 'swot.remove'; field: SwotField; text: string }
  | { kind: 'answer.set'; questionId: string; text: string };

/** 生成・確定は、画面の既存の処理に任せる（確定は明示承認を必要とする） */
export type Stage2Action = { kind: 'draft' } | { kind: 'final' } | { kind: 'commit' };

export type Stage2InputResult =
  | { kind: 'op'; op: Stage2Op }
  | { kind: 'action'; action: Stage2Action }
  | { kind: 'focus'; questionId: string }
  | { kind: 'approval'; op: Extract<Stage2Op, { kind: 'target.remove' }> }
  | { kind: 'clarify'; message: string };

export type Stage2Target = { id: string; label: string; unit: string; base: number; dueYear?: number };

export type Stage2InputContext = {
  targets: ReadonlyArray<Stage2Target>;
  swot: Record<SwotField, string>;
  /** 画面で選ばれている12の問い（相談の焦点） */
  focusQuestionId: string | null;
  questionIds: readonly string[];
  answers: Readonly<Record<string, string>>;
};

const CEO_MAX = 2000;
const MVV_MAX = 300;
const SWOT_MAX = 300;
const ANSWER_MAX = 4000;
const LABEL_MAX = 40;

// 仮定・検討の語は常に除外する。「〜したい」は、明確な依頼の語尾がある時は本文の内容なので除外しない
const HYPOTHETICAL = /もし|かも|かな|べき|検討|考え|でしょう|ではないか|どうか/;
const WISH = /たい/;
const EXPLICIT_DIRECTIVE = /(?:追記|追加|入れ|設定|変更|修正|登録|削除|消去)(?:して|しておいて|してください)$|にします$|にしよう$/;
const TARGET_VALUE = /^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(億円|百万円|万円|千円|円|%|件|人|回)$/;
const SWOT_FIELD: Record<string, SwotField> = { 強み: 'strength', 弱み: 'weakness', 機会: 'opportunity', 脅威: 'threat' };
const SWOT_LABEL: Record<SwotField, string> = { strength: '強み', weakness: '弱み', opportunity: '機会', threat: '脅威' };
const MVV_FIELD: Record<string, 'mission' | 'vision' | 'value'> = { ミッション: 'mission', ビジョン: 'vision', バリュー: 'value' };
const PRESETS = COMPANY_TARGET_UNIT_PRESETS as readonly string[];

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const unquote = (s: string) => s.replace(/^[「『"'\s、,，]+|[」』"'\s、,，]+$/g, '');
const clarify = (message: string): Stage2InputResult => ({ kind: 'clarify', message });

function parseTargetValue(raw: string): { base: number; unit: string } | null {
  const m = norm(raw).replace(/[。.!！]+$/, '').match(TARGET_VALUE);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base) || base < 0 || !PRESETS.includes(m[2])) return null;
  return { base, unit: m[2] };
}

/** 同じ名前の業績目標の候補。年度の指定があれば、年度で絞る */
function targetCandidates(targets: ReadonlyArray<Stage2Target>, label: string, year?: number): Stage2Target[] {
  return targets.filter((t) => unquote(t.label) === label && (year === undefined || t.dueYear === undefined || t.dueYear === year));
}

/** 文の中の行（SWOTは改行区切り）から、指定の文を含む行を探す。一致が複数なら確認する */
function swotLineMatch(text: string, needle: string): { line: string } | { message: string } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const exact = lines.filter((l) => l === needle);
  const hits = exact.length > 0 ? exact : lines.filter((l) => l.includes(needle));
  if (hits.length === 1) return { line: hits[0] };
  if (hits.length === 0) return { message: `「${needle}」は見つかりませんでした。項目の文を、そのまま指定してください。` };
  return { message: `「${needle}」に当てはまる項目が${hits.length}件あります。どれかを、項目の全文で指定してください。` };
}

/** 利用者の発言を、STAGE2の入力操作として読み取る。入力操作でなければ null（通常の相談に任せる） */
export function resolveStage2Input(raw: string, ctx: Stage2InputContext): Stage2InputResult | null {
  const text = norm(raw).replace(/[。.!！]+$/, '');
  if (!text || text.length > 400) return null;
  const explicit = EXPLICIT_DIRECTIVE.test(text);
  if (isNegatedOrDeferred(text) || HYPOTHETICAL.test(text) || (!explicit && WISH.test(text))) return null;
  if (/[?？]$|か$/.test(text)) return null;

  // 生成・確定（画面の既存の処理に任せる）
  if (/^(?:戦略の)?たたき台を(?:作って|作成して|生成して|再生成して|作り直して)(?:ください)?$/.test(text)) {
    return { kind: 'action', action: { kind: 'draft' } };
  }
  if (/^(?:経営戦略|最終戦略|戦略書|経営戦略書)を(?:作って|作成して|生成して|再生成して|作り直して)(?:ください)?$/.test(text)) {
    return { kind: 'action', action: { kind: 'final' } };
  }
  if (/^(?:全社戦略|経営戦略)を確定(?:して|してください)?$/.test(text) || /^STAGE3へ(?:引き渡して|引き渡し|引き渡してください)$/.test(text)) {
    return { kind: 'action', action: { kind: 'commit' } };
  }

  // 質問を開く（回答はしない）
  const focus = text.match(/^(ch\d-q\d+)の(?:質問|問い)を(?:開いて|選んで|表示して)(?:ください)?$/);
  if (focus) {
    if (!ctx.questionIds.includes(focus[1])) return clarify('その質問は見つかりませんでした。質問の番号を確かめてください。');
    return { kind: 'focus', questionId: focus[1] };
  }

  // 経営者の思い（追記・修正）。文脈を指す依頼（「今の話を」）は、相談の回答の操作候補で受け取る
  if (/^(?:今の話|先ほどの内容|この内容|今の議論)を経営者の思い/.test(text)) {
    return clarify('経営者の思いに入れる文を「〜」の形で教えてください（例：「経営者の思いに、地域とのつながりを大切にしたいと追記して」）。');
  }
  const ceoSet = text.match(/^経営者の思い(?:を|は)[「『]?(.+?)[」』]?に(?:変更|修正|書き換え)(?:して)?(?:ください)?$/);
  if (ceoSet) {
    const body = unquote(ceoSet[1]);
    if (!body || body.length > CEO_MAX) return clarify(`経営者の思いは1〜${CEO_MAX}字で指示してください。`);
    return { kind: 'op', op: { kind: 'ceo.set', text: body } };
  }
  const ceo = text.match(/^経営者の思い(?:に|へ)[「『]?(.+?)[」』]?(?:と|を)?(?:追記|追加|入れ)(?:して|しておいて|してください)?$/);
  if (ceo) {
    const body = unquote(ceo[1]);
    if (!body) return clarify('経営者の思いに入れる文を教えてください。');
    if (body.length > CEO_MAX) return clarify(`経営者の思いは${CEO_MAX}字以内で指示してください。`);
    return { kind: 'op', op: { kind: 'ceo.append', text: body } };
  }

  // ミッション・ビジョン・バリュー
  const mvv = text.match(/^(ミッション|ビジョン|バリュー)(?:は|を)[、,，]?[「『]?(.+?)[」』]?に(?:(?:変更|修正)(?:して)?|して)(?:ください)?$/);
  if (mvv) {
    const value = unquote(mvv[2]);
    if (!value) return clarify(`${mvv[1]}の内容を教えてください。`);
    if (value.length > MVV_MAX) return clarify(`${mvv[1]}は${MVV_MAX}字以内で指示してください。`);
    return { kind: 'op', op: { kind: 'mvv.set', field: MVV_FIELD[mvv[1]], value } };
  }

  // 業績目標の年度の修正・削除（同じ名前が複数あるときは、年度で特定する）
  const targetYear = text.match(/^(?:\d{4}年度の)?(.+?)(?:の)?目標(?:の)?年度を(\d{4})年度に(?:変更|修正)(?:して)?(?:ください)?$/);
  if (targetYear) {
    const label = unquote(targetYear[1]);
    const year = Number(targetYear[2]);
    const hits = targetCandidates(ctx.targets, label);
    if (hits.length === 0) return clarify(`「${label}」の目標は見つかりませんでした。`);
    if (hits.length > 1) return clarify(`「${label}」の目標が${hits.length}件あります。年度を添えて指示してください（例：「2030年度の${label}目標の年度を2031年度に変更して」）。`);
    return { kind: 'op', op: { kind: 'target.update', id: hits[0].id, label, dueYear: year } };
  }
  const targetRemove = text.match(/^(?:\d{4}年度の)?(.+?)(?:の)?目標(?:を|は)(?:削除|消去)(?:して|してください)?$/);
  if (targetRemove) {
    const label = unquote(targetRemove[1]);
    const hits = targetCandidates(ctx.targets, label);
    if (hits.length === 0) return clarify(`「${label}」の目標は見つかりませんでした。`);
    if (hits.length > 1) return clarify(`「${label}」の目標が${hits.length}件あります。年度を添えて指示してください。`);
    return { kind: 'approval', op: { kind: 'target.remove', id: hits[0].id, label } };
  }

  // 業績目標（追加・数値の修正）。同じ名前の目標は、値の修正として扱う
  const target =
    text.match(/^(?:(\d{4})年度の)?(.+?)(?:の)?目標(?:は|を)(.+?)(?:にしよう|にします|にして(?:ください)?|に設定(?:して)?(?:ください)?|に変更(?:して)?(?:ください)?|に修正(?:して)?(?:ください)?)$/) ??
    text.match(/^業績目標に(?:(\d{4})年度の)?(.+?)(?:の目標)?(?:は|を)(.+?)(?:を)?(?:追加|設定)(?:して)?(?:ください)?$/);
  if (target) {
    const label = unquote(target[2]);
    const year = target[1] ? Number(target[1]) : undefined;
    if (!label || label.length > LABEL_MAX) return clarify(`目標の名前（例：営業利益）を${LABEL_MAX}字以内で指示してください。`);
    const value = parseTargetValue(target[3]);
    if (!value) {
      return clarify('目標値は、単位を含めて指示してください（例：8,000万円、500件）。単位は、円・千円・万円・百万円・億円・%・件・人・回から選びます。');
    }
    const hits = targetCandidates(ctx.targets, label, year);
    if (hits.length > 1) return clarify(`「${label}」の目標が${hits.length}件あります。年度を添えて指示してください。`);
    const existing = hits[0];
    if (existing) {
      if (existing.unit !== value.unit) {
        return clarify(`「${label}」の単位は「${existing.unit}」です。同じ単位で指示してください。`);
      }
      return { kind: 'op', op: { kind: 'target.setBase', id: existing.id, label, unit: value.unit, base: value.base } };
    }
    return { kind: 'op', op: { kind: 'target.add', label, unit: value.unit, base: value.base, ...(year ? { dueYear: year } : {}) } };
  }

  // SWOT（追加・修正・削除）。修正・削除は、項目の文で特定する
  const swotReplace = text.match(/^(強み|弱み|機会|脅威)(?:の|に)[「『]?(.+?)[」』]?を[「『]?(.+?)[」』]?に(?:修正|変更)(?:して)?(?:ください)?$/);
  if (swotReplace) {
    const field = SWOT_FIELD[swotReplace[1]];
    const found = swotLineMatch(ctx.swot[field] ?? '', unquote(swotReplace[2]));
    if ('message' in found) return clarify(found.message);
    const to = unquote(swotReplace[3]);
    if (!to || to.length > SWOT_MAX) return clarify(`${SWOT_LABEL[field]}は1〜${SWOT_MAX}字で指示してください。`);
    return { kind: 'op', op: { kind: 'swot.replace', field, from: found.line, to } };
  }
  const swotRemove = text.match(/^(強み|弱み|機会|脅威)(?:から|の)[「『]?(.+?)[」』]?を(?:削除|消去|取り除)(?:して|してください)?$/);
  if (swotRemove) {
    const field = SWOT_FIELD[swotRemove[1]];
    const found = swotLineMatch(ctx.swot[field] ?? '', unquote(swotRemove[2]));
    if ('message' in found) return clarify(found.message);
    return { kind: 'op', op: { kind: 'swot.remove', field, text: found.line } };
  }
  const swot = text.match(/^(強み|弱み|機会|脅威)に[「『]?(.+?)[」』]?(?:を|と)?(?:追加|追記|加え)(?:して|しておいて|してください)?$/);
  if (swot) {
    const body = unquote(swot[2]);
    if (!body) return clarify(`${swot[1]}に加える内容を教えてください。`);
    if (body.length > SWOT_MAX) return clarify(`${swot[1]}の内容は${SWOT_MAX}字以内で指示してください。`);
    return { kind: 'op', op: { kind: 'swot.add', field: SWOT_FIELD[swot[1]], text: body } };
  }

  // 12の問いへの回答（画面で選ばれている質問）
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

// ----- 相談 API の操作候補（<<OP>>）の検証 -----

const TEXT = z.string().min(1);
const ID = z.string().min(1).max(100);

/** 相談の回答に書かれた操作候補を、許可リストと対象（ID・質問・SWOTの文）で検証する。許可されない形は null */
export function parseStage2Candidate(raw: unknown, ctx: Stage2InputContext): Stage2Op | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const kind = v.kind;
  if (typeof kind !== 'string') return null;
  const swotFieldOk = (f: unknown): f is SwotField => ['strength', 'weakness', 'opportunity', 'threat'].includes(String(f));
  try {
    switch (kind) {
      case 'ceo.append':
      case 'ceo.set': {
        const text = TEXT.max(CEO_MAX).parse(v.text).trim();
        return { kind, text };
      }
      case 'mvv.set': {
        if (!['mission', 'vision', 'value'].includes(String(v.field))) return null;
        return { kind, field: v.field as 'mission' | 'vision' | 'value', value: TEXT.max(MVV_MAX).parse(v.value).trim() };
      }
      case 'target.add': {
        const unit = String(v.unit);
        const base = Number(v.base);
        if (!PRESETS.includes(unit) || !Number.isFinite(base) || base < 0) return null;
        const label = TEXT.max(LABEL_MAX).parse(v.label).trim();
        const dueYear = v.dueYear === undefined ? undefined : Number(v.dueYear);
        if (dueYear !== undefined && !(dueYear >= 1990 && dueYear <= 2100)) return null;
        return { kind, label, unit, base, ...(dueYear ? { dueYear } : {}) };
      }
      case 'target.setBase': {
        const id = ID.parse(v.id);
        const target = ctx.targets.find((t) => t.id === id);
        const unit = String(v.unit);
        const base = Number(v.base);
        if (!target || target.unit !== unit || !Number.isFinite(base) || base < 0) return null;
        return { kind, id, label: target.label, unit, base };
      }
      case 'target.update': {
        const id = ID.parse(v.id);
        const target = ctx.targets.find((t) => t.id === id);
        const dueYear = Number(v.dueYear);
        if (!target || !(dueYear >= 1990 && dueYear <= 2100)) return null;
        return { kind, id, label: target.label, dueYear };
      }
      case 'target.remove': {
        const id = ID.parse(v.id);
        const target = ctx.targets.find((t) => t.id === id);
        return target ? { kind, id, label: target.label } : null;
      }
      case 'swot.add': {
        if (!swotFieldOk(v.field)) return null;
        return { kind, field: v.field, text: TEXT.max(SWOT_MAX).parse(v.text).trim() };
      }
      case 'swot.replace': {
        if (!swotFieldOk(v.field)) return null;
        const from = TEXT.parse(v.from).trim();
        if (!(ctx.swot[v.field] ?? '').split('\n').map((l) => l.trim()).includes(from)) return null;
        return { kind, field: v.field, from, to: TEXT.max(SWOT_MAX).parse(v.to).trim() };
      }
      case 'swot.remove': {
        if (!swotFieldOk(v.field)) return null;
        const text = TEXT.parse(v.text).trim();
        if (!(ctx.swot[v.field] ?? '').split('\n').map((l) => l.trim()).includes(text)) return null;
        return { kind, field: v.field, text };
      }
      case 'answer.set': {
        const questionId = ID.parse(v.questionId);
        if (!ctx.questionIds.includes(questionId)) return null;
        return { kind, questionId, text: TEXT.max(ANSWER_MAX).parse(v.text).trim() };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

const STAGE2_KIND_NAMES = new Set([
  'ceo.append',
  'ceo.set',
  'mvv.set',
  'target.add',
  'target.setBase',
  'target.update',
  'target.remove',
  'swot.add',
  'swot.replace',
  'swot.remove',
  'answer.set',
]);

const StageContextSchema = z.object({
  targets: z
    .array(z.object({ id: z.string().min(1).max(100), label: z.string().max(100), unit: z.string().max(10), base: z.number(), dueYear: z.number().optional() }))
    .max(50),
  swot: z.object({ strength: z.string().max(8000), weakness: z.string().max(8000), opportunity: z.string().max(8000), threat: z.string().max(8000) }),
  answers: z.record(z.string().max(100), z.string().max(8000)).optional(),
  focusQuestionId: z.string().max(40).nullable().optional(),
  questionIds: z.array(z.string().max(40)).max(50),
});

/** 画面（STAGE2）から送られた文脈を検証する。形が合わなければ null（STAGE2の操作は使わない） */
export function parseStage2Context(raw: unknown): Stage2InputContext | null {
  const r = StageContextSchema.safeParse(raw);
  if (!r.success) return null;
  return {
    targets: r.data.targets,
    swot: r.data.swot,
    answers: r.data.answers ?? {},
    focusQuestionId: r.data.focusQuestionId ?? null,
    questionIds: r.data.questionIds,
  };
}

/** 相談の操作候補のうち、STAGE2の種類を検証する（他の種類は null で、STAGE1の検証に任せる） */
export function stage2ExtraParser(ctx: Stage2InputContext) {
  return (raw: unknown): { ok: true; value: Stage2Op } | { ok: false } | null => {
    if (!raw || typeof raw !== 'object') return null;
    const kind = (raw as { kind?: unknown }).kind;
    if (typeof kind !== 'string' || !STAGE2_KIND_NAMES.has(kind)) return null;
    const op = parseStage2Candidate(raw, ctx);
    return op ? { ok: true, value: op } : { ok: false };
  };
}

/** 相談 API の操作候補の書き方（STAGE2の画面で、対象の業績目標・質問・SWOTの項目を示す） */
export function buildStage2OperationBlock(ctx: Stage2InputContext): string {
  const targets = ctx.targets.length
    ? ctxTargetsText(ctx.targets)
    : '（登録なし）';
  return [
    '【STAGE2の操作】',
    '- 会話の中で、経営者の思い・MVV・業績目標・SWOT・12の問いの回答に反映すべき内容が明らかになったときは、回答の最後の行に提案の印を1行だけ書き、本文で「〜に追記しておきましょうか？」と尋ねる。利用者が同意するまで反映されない。',
    '  提案の印：<<PROPOSE {…}>>（{…}の中身は、下の形式と同じJSON）',
    '- 提案の文を書いたら、同じ回答に提案の印を必ず書く。印を書けない問いかけは書かない。',
    '- 例：利用者「収益性を高めて社員の給与を上げたい」→ 本文の最後に「この考えを、STAGE2の『経営者の思い』に追記しておきましょうか？」と書き、続けて次の1行を書く。',
    '  <<PROPOSE {"kind":"ceo.append","text":"収益性を高め、その成果を社員の給与向上に還元できる会社を目指す。"}>>',
    '- 利用者が明確に入力・修正・追加を依頼したときは、同じJSONを <<OP {…}>> の印で書く。どの画面からでも入力欄に直接反映され、STAGE2へ移動する。',
    '- 印は1回の回答に1つまで。提案と依頼の両方を書かない。',
    '- 業績目標の削除は、<<PROPOSE {"kind":"target.remove","id":"業績目標のID","label":"..."}>> で提案する（削除は、利用者が確認の画面で承認して行う）。',
    '- 次の形式（JSON）：',
    '  {"kind":"ceo.append","text":"..."}  経営者の思いに追記（ceo.set = 全文を置き換え）',
    '  {"kind":"mvv.set","field":"mission|vision|value","value":"..."}',
    '  {"kind":"target.add","label":"...","unit":"円|千円|万円|百万円|億円|%|件|人|回","base":数値,"dueYear":年}',
    '  {"kind":"target.setBase","id":"業績目標のID","label":"...","unit":"...","base":数値}',
    '  {"kind":"target.update","id":"業績目標のID","label":"...","dueYear":年}',
    '  {"kind":"swot.add","field":"strength|weakness|opportunity|threat","text":"..."}',
    '  {"kind":"swot.replace","field":"...","from":"項目の全文","to":"..."}',
    '  {"kind":"swot.remove","field":"...","text":"項目の全文"}',
    '  {"kind":"answer.set","questionId":"質問ID","text":"..."}',
    '- 「今の話」「先ほどの内容」「先ほどの利益目標」など、会話の文脈で指すものは、会話の内容から短く書き直して text や id に入れる。会話にない事実は書かない。',
    '- 業績目標は、下の一覧の id で指定する。同じ名前の目標が複数あるときは、書かずに年度を尋ねる。',
    '- 相談・仮定・検討の段階では書かない。目標の削除は書かず、利用者に画面の確認を案内する。',
    `- 現在の業績目標: ${targets}`,
  ].join('\n');
}

function ctxTargetsText(targets: ReadonlyArray<Stage2Target>): string {
  return targets.map((t) => `${t.label}（id:${t.id}、${t.dueYear ? `${t.dueYear}年度、` : ''}${t.base}${t.unit}）`).join('、');
}

/** 相談の操作候補を許可するか：管理者・STAGE2の画面・明確な依頼（語尾が依頼の形）に限る */
export function allowStage2Candidate(input: { lastUser: string; role: string | null; enabled: boolean }): boolean {
  if (!input.enabled || input.role !== 'admin') return false;
  const t = norm(input.lastUser).replace(/[。.!！]+$/, '');
  if (!t || isNegatedOrDeferred(t) || HYPOTHETICAL.test(t)) return false;
  return EXPLICIT_DIRECTIVE.test(t);
}
