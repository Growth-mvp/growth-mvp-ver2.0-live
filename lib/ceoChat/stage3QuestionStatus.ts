/* STAGE3の6つの問いの保存状況を、部門ごとの回答数で示す。回答の本文は含めない（読み取りのみ）。
 * 保存済みの回答の数だけを扱う。確定版かどうかは、この情報からは判断しない。 */
export const STAGE3_QUESTION_TOTAL = 6;

export type Stage3QuestionStatus = 'REGISTERED' | 'PARTIAL' | 'UNREGISTERED' | 'NOT_APPLICABLE';

const LABEL: Record<Stage3QuestionStatus, string> = {
  REGISTERED: '登録済み',
  PARTIAL: '一部登録',
  UNREGISTERED: '未登録',
  NOT_APPLICABLE: '参照対象外',
};

type DeptLike = { name?: unknown; answers2?: unknown };

function answeredNumbers(answers2: unknown): Set<number> {
  const first = Array.isArray(answers2) ? (answers2[0] as { steps?: unknown } | undefined) : undefined;
  const steps = Array.isArray(first?.steps) ? (first.steps as Array<{ stepNumber?: unknown; answer?: unknown }>) : [];
  const out = new Set<number>();
  for (const s of steps) {
    const n = Number(s?.stepNumber);
    if (!Number.isInteger(n) || n < 1 || n > STAGE3_QUESTION_TOTAL) continue;
    if (typeof s?.answer === 'string' && s.answer.trim() !== '') out.add(n);
  }
  return out;
}

export function buildStage3QuestionStatusBlock(departments: unknown): { text: string; status: Stage3QuestionStatus } {
  const depts = (Array.isArray(departments) ? departments : []) as DeptLike[];
  if (depts.length === 0) {
    return {
      text: '# STAGE3の6つの問いの登録状況\n【概要】参照対象外（部門が登録されていない）',
      status: 'NOT_APPLICABLE',
    };
  }
  const lines: string[] = [];
  let registeredDepts = 0;
  let unregisteredDepts = 0;
  depts.forEach((d, i) => {
    const name = typeof d?.name === 'string' && d.name.trim() ? d.name.trim() : `部門${i + 1}（名称未登録）`;
    const answered = answeredNumbers(d?.answers2);
    const unanswered = Array.from({ length: STAGE3_QUESTION_TOTAL }, (_, k) => k + 1).filter((n) => !answered.has(n));
    if (answered.size === STAGE3_QUESTION_TOTAL) registeredDepts += 1;
    if (answered.size === 0) unregisteredDepts += 1;
    lines.push(
      unanswered.length === 0
        ? `- ${name}：回答 ${answered.size}/${STAGE3_QUESTION_TOTAL}問（すべて回答済み）`
        : `- ${name}：回答 ${answered.size}/${STAGE3_QUESTION_TOTAL}問（未回答：第${unanswered.join('・')}問）`,
    );
  });
  const status: Stage3QuestionStatus =
    registeredDepts === depts.length ? 'REGISTERED' : unregisteredDepts === depts.length ? 'UNREGISTERED' : 'PARTIAL';
  const text = [
    '# STAGE3の6つの問いの登録状況（保存済みの回答の数。回答の本文は含めない）',
    `【概要】6つの問い：${LABEL[status]}（部門${depts.length}件のうち、すべて回答済みは${registeredDepts}件）`,
    '- 保存済みの回答の数だけを示す。確定版かどうか、回答の中身は、この情報からは判断しない。',
    ...lines,
  ].join('\n');
  return { text, status };
}
