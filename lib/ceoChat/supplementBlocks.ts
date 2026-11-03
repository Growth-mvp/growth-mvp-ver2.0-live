import { STAGE2_QUESTIONS_12 } from '@/lib/stage2/questions12';

const TALENT_TEXT = /人材|人員|人手|人不足|育成|採用|教育|スキル|技能|保守人材/;
const ANSWER_MAX = 160;
const FOCUS_MAX = 3;

type AnyRecord = Record<string, any>;

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

/** 人材の相談に関係する、STAGE2の登録回答を先頭に出す（登録された内容だけ。推測は加えない）。 */
export function buildFocusAnswersBlock(strategy: AnyRecord | null | undefined, query: string): string {
  if (!TALENT_TEXT.test(query ?? '')) return '';
  const answers: AnyRecord[] = Array.isArray(strategy?.answers12) ? strategy!.answers12 : [];
  const byId = new Map<string, AnyRecord>();
  for (const a of answers) if (a?.id) byId.set(String(a.id), a);

  const hits = STAGE2_QUESTIONS_12.flatMap((q) => {
    const a = byId.get(q.id);
    const answer = text(a?.answer);
    if (!answer) return [];
    if (!TALENT_TEXT.test(`${q.question} ${answer}`)) return [];
    return [`- [${q.id}・第${q.chapter}章] ${q.question}\n  回答: ${answer.slice(0, ANSWER_MAX)}`];
  }).slice(0, FOCUS_MAX);

  if (hits.length === 0) return '';
  return ['【質問に関連する登録回答（STAGE2、登録された内容。推測で補わない）】', ...hits].join('\n');
}
