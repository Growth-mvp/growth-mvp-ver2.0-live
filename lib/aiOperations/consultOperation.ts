/* 通常の経営相談の1回のAI応答から、許可された操作の候補を取り出して検証する（追加のAI呼び出しはしない）。
 * AIが出すのは操作の種類と入力内容だけで、企業・戦略・権限は認証済みのシステム側の情報を使う。
 * 保存はしない。候補は入力案になり、既存の承認カードで利用者が確認してから保存される。 */

export const ISSUE_TITLE_MAX = 100;
export const ISSUE_DESCRIPTION_MAX = 300;

export type ConsultOperationCandidate = {
  kind: 'stage1.issue';
  title: string;
  description: string;
};

export type ConsultOfferKind = 'stage1.issue';

/** 直前の操作の提案。利用者・企業・戦略・相談の単位に紐づく鍵つき（サーバーが発行し、画面が保持する） */
export type ConsultOffer = { kind: ConsultOfferKind; key: string };

const CANDIDATE_MARK = /<<OP (\{[^\n]*\})>>/g;
const OFFER_MARK = /<<OFFER (stage1\.issue)>>/g;

/** AIへの指示。操作候補が必要なときだけ、回答の最後の行に印を書かせる */
export const OPERATION_OFFER_BLOCK = [
  '【操作の提案（経営課題）】',
  '- 通常の相談への回答は、これまでどおり行う。操作が必要ないときは、この指示を無視して相談に答える。',
  '- 利用者が経営課題として記録するよう明確に求めたとき（例：「それを経営課題に入れておいて」「経営課題として〇〇を追加して」）、または直前にあなたが提案した経営課題の記録に同意されたとき（例：「お願いします」）に限り、回答の最後の行に次の1行だけを書く。',
  `  <<OP {"kind":"stage1.issue","title":"題名（${ISSUE_TITLE_MAX}字以内）","description":"説明文（${ISSUE_DESCRIPTION_MAX}字以内）"}>>`,
  '- 題名と説明文は、利用者が話した事実や言葉に基づく。推測や一般論を事実として書かない。根拠が足りないときは説明文を空にする。',
  '- 対象の経営課題が、複数の話題のどれか曖昧なときは、どれを記録するか質問し、この行は書かない。',
  '- 仮定・検討・質問の段階（「〜かな」「〜したほうがいいですか」など）では、この行を書かない。',
  '- 否定・保留（「登録しないで」「やめておく」「あとで」など）を含むときは、この行を書かない。',
  '- 経営課題として記録してよいかを確かめるだけのときは、回答の最後の行に次の1行だけを書く：<<OFFER stage1.issue>>',
  '- 1回の回答に書く印は1つまで。企業ID・戦略ID・権限には触れない。',
].join('\n');

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
  /** 他のSTAGEの検証済みの操作候補（STAGE2など） */
  extra: unknown | null;
  offer: ConsultOfferKind | null;
  /** 印に不備があった（候補・提案は捨てる） */
  rejected: boolean;
};

/** 回答から操作の印を取り除き、候補と提案の有無を返す。印は利用者の画面に出さない。
 * 安全側に倒す：候補が複数・形式不正・書きかけの印があれば、候補も提案もすべて捨てる */
export function extractConsultOperation(content: string, extra?: ExtraCandidateParser): ConsultMarkResult {
  const candidateMatches = [...content.matchAll(CANDIDATE_MARK)];
  const offerMatches = [...content.matchAll(OFFER_MARK)];
  const openCandidates = (content.match(/<<OP\b/g) ?? []).length;
  const openOffers = (content.match(/<<OFFER\b/g) ?? []).length;

  const parsed = candidateMatches.map((m) => {
    let json: unknown;
    try {
      json = JSON.parse(m[1]);
    } catch {
      return { kind: 'invalid' as const };
    }
    const stage1 = parseOperationCandidate(json);
    if (stage1) return { kind: 'stage1' as const, value: stage1 };
    const other = extra ? extra(json) : null;
    if (other === null) return { kind: 'invalid' as const };
    return other.ok ? { kind: 'extra' as const, value: other.value } : { kind: 'invalid' as const };
  });
  const malformed = openCandidates !== candidateMatches.length || openOffers !== offerMatches.length;
  const invalid = parsed.some((p) => p.kind === 'invalid');
  const rejected = malformed || invalid || candidateMatches.length > 1 || offerMatches.length > 1;

  const single = !rejected && parsed.length === 1 ? parsed[0] : null;
  const candidate = single?.kind === 'stage1' ? single.value : null;
  const extraValue = single?.kind === 'extra' ? single.value : null;
  const offer = !rejected && offerMatches.length === 1 && !candidate && !extraValue ? ('stage1.issue' as const) : null;

  const stripped = content
    .replace(CANDIDATE_MARK, '')
    .replace(OFFER_MARK, '')
    .replace(/<<(?:OP|OFFER)\b[^\n]*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { content: stripped, candidate, extra: extraValue, offer, rejected };
}

const ADD_CUE = /入れ|追加|登録|加え|足し/;
const ISSUE_CUE = /経営課題|論点/;
const AFFIRM_CUE = /^(はい|うん|そう|そうです|そうですね|そうして|そうしてください|お願い|ぜひ|いいね|いいですね|それで|それを|入れて|入れておいて|登録して|追加して)/;
const NON_COMMAND_CUE = /もし|かも|べき|たら|ではないか|どうか|いいか|よいか|でいい|したい|してほしい|検討|考え|迷|[?？]|ですか|でしょうか|かな/;
/** 否定・保留・反対・留保（「はい、でも」「やっぱり」なども含む）。指示として扱わない */
const NEGATION_CUE = /しない|しません|せず|ないで|ない(ほう|方)|やめ|よして|見送|保留|取りやめ|取り消|不要|いらない|結構|けっこう|やっぱり|やはり|ではなく|じゃなく|ではなくて|でも|けど|けれど|ただ|待って|あとで|後で|まだ|もう少し|考え直|いや|違う|だめ|ダメ/;
const SHORT_REPLY_MAX = 30;
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

/** 直前の発言が、経営課題の記録の指示・同意として明確かどうか（決定的な判定） */
export function isClearIssueInstruction(text: string, priorOffer: string | null): boolean {
  const t = text.trim();
  if (!t || NON_COMMAND_CUE.test(t) || NEGATION_CUE.test(t)) return false;
  // 「それを」「これを」など、対象を指す言い方は、直前の操作の提案が明確な時だけ（話題が複数あっても1件を勝手に選ばない）
  if (DEICTIC_CUE.test(t) && priorOffer !== 'stage1.issue') return false;
  if (ISSUE_CUE.test(t) && ADD_CUE.test(t)) return true;
  return t.length <= SHORT_REPLY_MAX && priorOffer === 'stage1.issue' && AFFIRM_CUE.test(t);
}

/** サーバー側で候補を通してよいか。役割・機能の有効化・直前の発言の明確さを確かめる */
export function allowConsultCandidate(input: {
  lastUser: string;
  priorOffer: string | null;
  role: string | null;
  enabled: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.role !== 'admin' && input.role !== 'manager') return false;
  return isClearIssueInstruction(input.lastUser, input.priorOffer);
}

function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 提案の鍵：利用者・企業・戦略・相談の単位の組に紐づく。別の組の提案は、この鍵が一致しない */
export function consultOfferKeyOf(parts: { userId: string; companyId: string; strategyId: string; thread: string }): string {
  const joined = [parts.userId, parts.companyId, parts.strategyId, parts.thread].join('');
  return fnv1a(joined, 0x811c9dc5) + fnv1a(joined, 0x9e3779b9);
}

/** 画面から戻された提案を、形だけ確かめる（鍵の一致は、サーバーが同じ組から作り直して比べる） */
export function parseConsultOffer(raw: unknown): ConsultOffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (v.kind !== 'stage1.issue') return null;
  if (typeof v.key !== 'string' || !/^[0-9a-f]{16}$/.test(v.key)) return null;
  return { kind: 'stage1.issue', key: v.key };
}
