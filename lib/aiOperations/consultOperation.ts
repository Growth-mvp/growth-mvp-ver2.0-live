/* 通常の経営相談の1回のAI応答から、操作の印を取り出して検証する（追加のAI呼び出しはしない）。
 * AIが出すのは操作の種類と入力内容だけで、企業・戦略・権限は認証済みのシステム側の情報を使う。
 * <<OP>>：利用者が明確に依頼したときの直接の操作（既存の反映処理に渡す）。
 * <<PROPOSE>>：AIからの提案（内容は保持し、利用者の同意の後に反映する。反映はここでは行わない）。 */
import type { Stage2Op } from '@/lib/stage2/stage2Input';

export const ISSUE_TITLE_MAX = 100;
export const ISSUE_DESCRIPTION_MAX = 300;

export type ConsultOperationCandidate = {
  kind: 'stage1.issue';
  title: string;
  description: string;
};

const CANDIDATE_MARK = /<<OP (\{[^\n]*\})>>/g;
const PROPOSE_MARK = /<<PROPOSE (\{[^\n]*\})>>/g;

/** AIへの指示（STAGE1の経営課題）。提案は会話の中で示し、同意の後に反映する */
export const OPERATION_PROPOSAL_BLOCK = [
  '【操作の提案（経営課題）】',
  '- 通常の相談への回答は、これまでどおり行う。提案が必要ないときは、この指示を無視して相談に答える。',
  '- 新たな経営課題が明らかになった、または既存の経営課題を見直す必要が生じたときは、回答の最後の行に次の1行だけを書き、本文で「経営課題として記録しましょうか？」と尋ねる。',
  `  <<PROPOSE {"kind":"stage1.issue","title":"題名（${ISSUE_TITLE_MAX}字以内）","description":"説明文（${ISSUE_DESCRIPTION_MAX}字以内）"}>>`,
  '- 利用者が経営課題として記録するよう明確に求めたときは、回答の最後の行に次の形式の1行を書く（直接反映される）。',
  `  <<OP {"kind":"stage1.issue","title":"題名（${ISSUE_TITLE_MAX}字以内）","description":"説明文（${ISSUE_DESCRIPTION_MAX}字以内）"}>>`,
  '- 題名と説明文は、利用者が話した事実や言葉に基づく。推測や一般論を事実として書かない。根拠が足りないときは説明文を空にする。',
  '- 対象の経営課題が、複数の話題のどれか曖昧なときは、どれを記録するか質問し、印は書かない。',
  '- 仮定・検討・質問の段階（「〜かな」「〜したほうがいいですか」など）では、提案の印を書かない。',
  '- 否定・保留（「登録しないで」「やめておく」「あとで」など）を含むときは、印を書かない。',
  '- 同じ内容の提案は、既に登録されている経営課題と重複するときは書かない。断られた提案は、繰り返さない。',
  '- 提案の文（「〜を経営課題として記録しましょうか？」）を書いたら、同じ回答の最後の行に必ず提案の印を書く。印を書けない問いかけは書かない。',
  '- 例：利用者「新規の商談が増えないのが悩みです」→ 本文の最後に「新規の商談が増えない点を、経営課題として記録しておきましょうか？」と書き、続けて次の1行を書く。',
  '  <<PROPOSE {"kind":"stage1.issue","title":"新規の商談が増えない","description":"利用者が、新規の商談が増えないことを悩みとして話した。"}>>',
  '- 1回の回答に書く印は1つまで。企業ID・戦略ID・権限には触れない。',
].join('\n');

const PROPOSAL_ASK =
  /(追記|記録|反映|登録|入れ|加え|追加|設定|修正|変更)[^。\n？?]{0,40}(しておきましょうか|しましょうか|しておきますか|しますか|しておきましょう)[？?]/;
export const UNBACKED_PROPOSAL_NOTE =
  '（反映の具体案を組み立てられなかったため、ここでは提案しません。反映したい内容を、もう一度具体的にお聞かせください。）';

/** 反映の問いかけ（「〜に追記しておきましょうか？」）を含むか */
export function asksProposalQuestion(content: string): boolean {
  return PROPOSAL_ASK.test(content);
}

/** 提案の印がないまま書かれた反映の問いかけを、実行できない提案として見せないように書き換える */
export function withoutUnbackedProposal(content: string): string {
  const lines = content.split('\n').map((line) => (PROPOSAL_ASK.test(line) ? UNBACKED_PROPOSAL_NOTE : line));
  return lines.filter((line, i) => !(line === UNBACKED_PROPOSAL_NOTE && lines[i - 1] === UNBACKED_PROPOSAL_NOTE)).join('\n');
}

export function parseOperationCandidate(raw: unknown): ConsultOperationCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (v.kind !== 'stage1.issue') return null;
  if (typeof v.title !== 'string') return null;
  const title = v.title.trim();
  if (title === '' || title.length > ISSUE_TITLE_MAX || /[\r\n]/.test(title)) return null;
  const description = typeof v.description === 'string' ? v.description.trim() : '';
  if (description.length > ISSUE_DESCRIPTION_MAX) return null;
  return { kind: 'stage1.issue', title, description };
}

/** 他のSTAGEの操作候補の検証（呼び出し側が渡す）。対象でない形は null、検証に失敗した形は ok:false */
export type ExtraCandidateParser = (raw: unknown) => { ok: true; value: unknown } | { ok: false } | null;

export type ConsultMarkResult = {
  content: string;
  candidate: ConsultOperationCandidate | null;
  /** 他のSTAGEの検証済みの直接の操作（STAGE2など） */
  extra: unknown | null;
  /** 検証済みの提案（STAGE1・STAGE2の操作。反映は利用者の同意の後） */
  proposal: ConsultOperationCandidate | Stage2Op | null;
  /** 印に不備があった（候補・提案は捨てる） */
  rejected: boolean;
};

type ParsedMark = { kind: 'stage1'; value: ConsultOperationCandidate } | { kind: 'extra'; value: unknown } | { kind: 'invalid' };

/** 回答から操作の印を取り除き、候補と提案を返す。印は利用者の画面に出さない。
 * 安全側に倒す：印が複数・形式不正・書きかけのときは、候補も提案もすべて捨てる */
export function extractConsultOperation(content: string, extra?: ExtraCandidateParser): ConsultMarkResult {
  const opMatches = [...content.matchAll(CANDIDATE_MARK)];
  const proposeMatches = [...content.matchAll(PROPOSE_MARK)];
  const total = opMatches.length + proposeMatches.length;
  const openMarks = (content.match(/<<(?:OP|PROPOSE)\b/g) ?? []).length;

  const parse = (json: string): ParsedMark => {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { kind: 'invalid' };
    }
    const stage1 = parseOperationCandidate(raw);
    if (stage1) return { kind: 'stage1', value: stage1 };
    const other = extra ? extra(raw) : null;
    if (other === null) return { kind: 'invalid' };
    return other.ok ? { kind: 'extra', value: other.value } : { kind: 'invalid' };
  };
  const parsedOps = opMatches.map((m) => parse(m[1]));
  const parsedProposals = proposeMatches.map((m) => parse(m[1]));
  const invalid = [...parsedOps, ...parsedProposals].some((p) => p.kind === 'invalid');
  const rejected = openMarks !== total || invalid || total > 1;

  const single = !rejected && total === 1 ? (opMatches.length === 1 ? parsedOps[0] : parsedProposals[0]) : null;
  const candidate = single && opMatches.length === 1 && single.kind === 'stage1' ? single.value : null;
  const extraValue = single && opMatches.length === 1 && single.kind === 'extra' ? single.value : null;
  const proposal =
    single && proposeMatches.length === 1 && single.kind !== 'invalid' ? (single.value as ConsultOperationCandidate | Stage2Op) : null;

  const stripped = content
    .replace(CANDIDATE_MARK, '')
    .replace(PROPOSE_MARK, '')
    .replace(/<<(?:OP|PROPOSE)\b[^\n]*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { content: stripped, candidate, extra: extraValue, proposal, rejected };
}

const ADD_CUE = /入れ|追加|登録|加え|足し/;
const ISSUE_CUE = /経営課題|論点/;
const NON_COMMAND_CUE = /もし|かも|べき|たら|ではないか|どうか|いいか|よいか|でいい|したい|してほしい|検討|考え|迷|[?？]|ですか|でしょうか|かな/;
/** 否定・保留・反対・留保（「はい、でも」「やっぱり」なども含む）。指示として扱わない */
const NEGATION_CUE = /しない|しません|せず|ないで|ない(ほう|方)|やめ|よして|見送|保留|取りやめ|取り消|不要|いらない|結構|けっこう|やっぱり|やはり|ではなく|じゃなく|ではなくて|でも|けど|けれど|ただ|待って|あとで|後で|まだ|もう少し|考え直|いや|違う|だめ|ダメ/;
const DEICTIC_CUE = /それ|これ|あれ|さっき/;
const DEICTIC_TITLE = /^(それ|これ|あれ|さっき|上記|先ほど|今の|その|この)/;

/** 否定・保留・反対を含む発言か（操作の指示として扱わない） */
export function isNegatedOrDeferred(text: string): boolean {
  return NEGATION_CUE.test(text);
}

/** 題名が「それ」「これ」などの指示語だけか（直前の文脈が無いと、何を指すか決まらない） */
export function isDeicticTitle(title: string): boolean {
  return DEICTIC_TITLE.test(title.trim());
}

/** 経営課題の記録の依頼として明確かどうか（決定的な判定）。
 * 「それを」などの指示語は、直前に操作の提案が開いている時だけ依頼として扱う（話題が複数あっても1件を勝手に選ばない） */
export function isClearIssueInstruction(text: string, openProposal: boolean): boolean {
  const t = text.trim();
  if (!t || NON_COMMAND_CUE.test(t) || NEGATION_CUE.test(t)) return false;
  if (DEICTIC_CUE.test(t) && !openProposal) return false;
  return ISSUE_CUE.test(t) && ADD_CUE.test(t);
}

/** サーバー側で直接の操作候補を通してよいか。役割・機能の有効化・依頼の明確さを確かめる */
export function allowConsultCandidate(input: {
  lastUser: string;
  openProposal: boolean;
  role: string | null;
  enabled: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.role !== 'admin' && input.role !== 'manager') return false;
  return isClearIssueInstruction(input.lastUser, input.openProposal);
}
