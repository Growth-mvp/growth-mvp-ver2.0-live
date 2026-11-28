import { isGeneralKnowledgeQuestion, selectContextSources } from './contextSelection';

const CONTINUATION_START = /^(でも|ただ|いや|しかし|確かに|なるほど|はい|そう|それは|それ|その|この)/;
const CONTINUATION_ANY = /現実的|無理|難しい|できない|余裕|時間がない|人手が|予算が|不可能|違う|そこまで/;
const SHORT_REPLY_MAX = 12;
const INTERROGATIVE = /[？?]|か$|何|どう|なぜ|どこ|いつ|誰|どれ/;

/** 直前の相談を引き継ぐ継続発話では、直前の相談と結合した文を文脈判定に使う。話題が変わった発話は、そのまま使う。 */
export function consultationQueryOf(messages: ReadonlyArray<{ role: string; content?: string }>): string {
  const users = messages.filter((m) => m.role === 'user').map((m) => (m.content ?? '').trim());
  const last = users[users.length - 1] ?? '';
  const prev = users[users.length - 2] ?? '';
  if (!prev || !last) return last;
  if (selectContextSources(last).operation || isGeneralKnowledgeQuestion(last)) return last;
  const shortReply = last.length <= SHORT_REPLY_MAX && !INTERROGATIVE.test(last);
  const continuation = CONTINUATION_START.test(last) || CONTINUATION_ANY.test(last) || shortReply;
  return continuation ? `${prev}\n${last}` : last;
}
