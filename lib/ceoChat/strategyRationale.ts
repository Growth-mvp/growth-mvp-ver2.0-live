import { STAGE2_QUESTIONS_12 } from '@/lib/stage2/questions12';

export const RATIONALE_CHAR_BUDGET = 3000;

const ANSWER_MAX = 120;
const DEEP_DIVE_MAX = 120;
const DEEP_DIVE_QUESTION_MAX = 80;
const INTENT_MAX = 400;
const STORY_BODY_MAX = 160;
const CANDIDATE_RATIONALE_MAX = 120;
const CANDIDATE_LIMIT = 3;
const OMISSION_RESERVE = 40;

type AnyRecord = Record<string, any>;

export type StoryStatus = 'confirmed' | 'draft' | 'none';

export type CanonicalStory = {
  status: StoryStatus;
  chapters: AnyRecord[];
};

export type RationaleStats = {
  answered: number;
  total: number;
  deepDiveUnreflected: number;
  storyStatus: StoryStatus;
  candidateCount: number;
  primarySelected: boolean;
  omitted: number;
};

const STORY_LABEL: Record<StoryStatus, string> = {
  confirmed: '確定版',
  draft: '下書き（未確定）',
  none: '未作成',
};

function nonEmptyArray(v: unknown): v is AnyRecord[] {
  return Array.isArray(v) && v.length > 0;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function clip(v: unknown, max: number): string {
  const t = text(v).replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * 最終ストーリーの正本は確定版（finalStoryFinal）。確定版がなければ、
 * 生成・編集中の内容を下書きとして扱い、確定版とは区別して返す。
 */
export function selectCanonicalStory(s: AnyRecord | null | undefined): CanonicalStory {
  if (nonEmptyArray(s?.finalStoryFinal)) return { status: 'confirmed', chapters: s.finalStoryFinal };
  if (nonEmptyArray(s?.finalStory)) return { status: 'draft', chapters: s.finalStory };
  if (nonEmptyArray(s?.finalStoryEdited)) return { status: 'draft', chapters: s.finalStoryEdited };
  if (nonEmptyArray(s?.finalStoryDraft)) return { status: 'draft', chapters: s.finalStoryDraft };
  return { status: 'none', chapters: [] };
}

function isReflected(deepDive: AnyRecord | undefined): boolean {
  const answer = text(deepDive?.answer);
  return answer.length > 0 && text(deepDive?.appliedAnswer) === answer;
}

function isUnreflected(deepDive: AnyRecord | undefined): boolean {
  return text(deepDive?.answer).length > 0 && !isReflected(deepDive);
}

/**
 * 保存済みの STAGE2 データから、経営者の意図と戦略の経緯を表すブロックを作る。
 * 項目は質問IDと出典を保ったまま、上限内で追加する（超える項目は省略数として明示する）。
 */
export function buildStrategyRationaleBlock(
  s: AnyRecord | null | undefined,
  opts: { budget?: number; storyInAgentPrompt?: boolean } = {}
): { text: string; stats: RationaleStats } {
  const budget = opts.budget ?? RATIONALE_CHAR_BUDGET;
  const story = selectCanonicalStory(s);
  const answers: AnyRecord[] = Array.isArray(s?.answers12) ? s!.answers12 : [];
  const answerById = new Map<string, AnyRecord>();
  for (const a of answers) if (a?.id) answerById.set(String(a.id), a);

  const answered = STAGE2_QUESTIONS_12.filter((q) => text(answerById.get(q.id)?.answer).length > 0).length;
  const deepDiveUnreflected = answers.filter((a) => isUnreflected(a?.deepDive)).length;
  const candidates: AnyRecord[] = Array.isArray(s?.winPatternsCandidate) ? s!.winPatternsCandidate : [];
  const primaryId = text(s?.winPatternPrimary);
  const primarySelected = primaryId.length > 0;
  const segments: string[] = (Array.isArray(s?.businessSegments) ? s!.businessSegments : [])
    .map((seg: AnyRecord) => text(seg?.name))
    .filter((n: string) => n.length > 0);

  const stats: RationaleStats = {
    answered,
    total: STAGE2_QUESTIONS_12.length,
    deepDiveUnreflected,
    storyStatus: story.status,
    candidateCount: candidates.length,
    primarySelected,
    omitted: 0,
  };

  const lines: string[] = [];
  let used = 0;
  const limit = budget - OMISSION_RESERVE;
  const add = (item: string, { reserved = false }: { reserved?: boolean } = {}): void => {
    const cost = item.length + 1;
    if (!reserved && used + cost > limit) {
      stats.omitted += 1;
      return;
    }
    lines.push(item);
    used += cost;
  };

  add(
    [
      '【戦略の根拠（保存済みのSTAGE2データ。未保存の編集は含まない）】',
      '- 事実は、ここに保存済みとして書かれた項目だけとする。AI生成の候補・仮説・解釈・提案は「候補」「仮説」「推測」と書き、事実の欄に入れない。',
      '- 勝ち筋の採用は「採用記録」の項目だけで判断する。候補の並び順や画面の内部参照は、採用を意味しない。採用記録がなければ「正式に採用した」と言わない。',
      '- なぜ選んだかを問われたら、確認できる経営者の意図と戦略の根拠を説明し、記録のない意思決定理由は断定しない。',
      '- 深掘り回答や顧客課題の記述は、検証データがない限り仮説として扱い、検証済みの顧客事実として断定しない。',
      '- 12問・深掘り・勝ち筋は全社の回答で、事業ごとには分かれていない。事業をまたいで統合しない。回答は必要な範囲に絞る。',
    ].join('\n'),
    { reserved: true }
  );

  add(
    `- 根拠の充足: 12問の回答あり ${answered}/${stats.total}件、未反映の深掘り ${deepDiveUnreflected}件、` +
      `最終ストーリー ${STORY_LABEL[story.status]}、勝ち筋候補 ${candidates.length}件、` +
      `勝ち筋の採用記録 ${primarySelected ? 'あり' : 'なし'}`,
    { reserved: true }
  );

  const intent = text(s?.ceoIntent);
  add(intent ? `- 経営者の意図（登録済み）: ${clip(intent, INTENT_MAX)}` : '- 経営者の意図: 登録なし');

  if (opts.storyInAgentPrompt) {
    add(`- 最終ストーリーの状態: ${STORY_LABEL[story.status]}（本文は【戦略ストーリー要約】を参照）`);
  } else if (story.status === 'none') {
    add('- 最終ストーリー: 未作成');
  } else {
    add(`- 最終ストーリー（${STORY_LABEL[story.status]}）`);
    story.chapters.forEach((c, i) => {
      add(`  第${i + 1}章「${clip(c?.title, 40)}」: ${clip(c?.body, STORY_BODY_MAX)}`);
    });
  }
  if (story.status === 'confirmed') {
    add('- 確定ストーリーの確定は、勝ち筋候補のどれかを採用した記録ではない（採用記録は下の勝ち筋の項目だけ）。');
  }

  for (const q of STAGE2_QUESTIONS_12) {
    const a = answerById.get(q.id);
    const answer = text(a?.answer);
    const head = `- [${q.id}・第${q.chapter}章] ${q.question}`;
    if (!answer) {
      add(`- [${q.id}] 未入力`);
      continue;
    }
    const note = isReflected(a?.deepDive) ? '（深掘りを元回答に反映済み）' : '';
    add(`${head}\n  回答${note}: ${clip(answer, ANSWER_MAX)}`);
  }

  for (const a of answers) {
    if (!isUnreflected(a?.deepDive)) continue;
    const d = a.deepDive;
    add(
      `- 未反映の深掘り（${a.id}）: 問い「${clip(d.question, DEEP_DIVE_QUESTION_MAX)}」 ` +
        `回答「${clip(d.answer, DEEP_DIVE_MAX)}」（元の回答には未反映。経営者が確定した事実ではなく、仮説として扱う）`
    );
  }

  if (candidates.length > 0) {
    if (primarySelected) {
      const primary = candidates.find((c) => String(c?.id) === primaryId);
      add(`- 勝ち筋の採用記録（保存済み）: ${primary?.name ?? primaryId}`);
    } else {
      add('- この項目には正式な採用記録がありません（記録がないことは、未採用が確定していることを意味しない）。候補の並び順は採用を意味しません。');
    }
    candidates.slice(0, CANDIDATE_LIMIT).forEach((c) => {
      const drivers = Array.isArray(c?.valueDrivers) ? c.valueDrivers.join('、') : '';
      const why = text(c?.rationale)
        ? clip(c.rationale, CANDIDATE_RATIONALE_MAX)
        : '登録なし';
      const adopted = primarySelected && String(c?.id) === primaryId;
      const status = adopted ? '採用記録あり' : '採用記録なし';
      add(`- 勝ち筋候補（AI生成、${status}）: ${text(c?.name) || '名称なし'}｜価値ドライバー: ${drivers || '登録なし'}｜生成時の根拠（AIの説明）: ${why}`);
    });
  }

  if (segments.length > 0) {
    add(`- 登録事業: ${segments.join('、')}`);
  }

  if (stats.omitted > 0) {
    lines.push(`（上限のため${stats.omitted}件を省略）`);
  }

  return { text: lines.join('\n'), stats };
}
