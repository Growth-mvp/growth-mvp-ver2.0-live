/* 実回答評価の実行本体。送信関数は外から渡す（テストでは偽物、本番評価では実 API）。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import type { QualityQuestion } from './fictionalCompany';
import { buildConditionAPayload, type EvalPayload } from './conditions';
import { BUDGET_USD, EvalCallGuard, type CallRecord } from './costGuard';
import { buildScoreSheet } from './scoring';

export type Callers = {
  /** 条件A：企業データなし。payload をそのまま送る。 */
  callA: (payload: EvalPayload) => Promise<{ content: string }>;
  /** 条件B：本番ルートを通す。回答文を返す。 */
  callB: (question: string) => Promise<{ content: string; resolvedMode?: string; stageUsed?: string }>;
};

export type RunSummary = {
  questions: number;
  calls: number;
  spentUsd: number;
  budgetUsd: number;
  records: CallRecord[];
};

export async function runEvaluation(args: {
  questions: QualityQuestion[];
  guard: EvalCallGuard;
  callers: Callers;
  outDir: string;
  /** 条件Bの送信内容（system）。補助検査の根拠に使う */
  groundingBOf: (question: string) => string;
}): Promise<RunSummary> {
  const { questions, guard, callers, outDir } = args;
  mkdirSync(outDir, { recursive: true });

  for (const q of questions) {
    guard.setTag(`A-q${q.id}`);
    const payloadA = buildConditionAPayload(q.text);
    const a = await callers.callA(payloadA);

    guard.setTag(`B-q${q.id}`);
    const b = await callers.callB(q.text);

    const groundingA = `${q.text}\n${payloadA.messages[0].content}`;
    const groundingB = `${q.text}\n${args.groundingBOf(q.text)}`;
    const sheet = buildScoreSheet(q, { A: a.content, B: b.content }, { A: groundingA, B: groundingB });

    const recordsOf = (tag: string) => guard.records.filter((r) => r.tag === tag);
    writeFileSync(
      path.join(outDir, `q${q.id}-A.json`),
      JSON.stringify(
        {
          condition: 'A',
          questionId: q.id,
          question: q.text,
          model: payloadA.model,
          reasoning_effort: payloadA.reasoning_effort,
          max_completion_tokens: payloadA.max_completion_tokens,
          answer: a.content,
          calls: recordsOf(`A-q${q.id}`),
          costUsd: recordsOf(`A-q${q.id}`).reduce((n, r) => n + r.costUsd, 0),
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      path.join(outDir, `q${q.id}-B.json`),
      JSON.stringify(
        {
          condition: 'B',
          questionId: q.id,
          question: q.text,
          model: payloadA.model,
          reasoning_effort: payloadA.reasoning_effort,
          max_completion_tokens: payloadA.max_completion_tokens,
          answer: b.content,
          route: { resolvedMode: b.resolvedMode ?? null, stageUsed: b.stageUsed ?? null },
          sentSystem: args.groundingBOf(q.text),
          calls: recordsOf(`B-q${q.id}`),
          costUsd: recordsOf(`B-q${q.id}`).reduce((n, r) => n + r.costUsd, 0),
        },
        null,
        2
      ),
      'utf8'
    );
    writeFileSync(
      path.join(outDir, `sheet-q${q.id}.json`),
      JSON.stringify(sheet, null, 2),
      'utf8'
    );
  }

  const summary: RunSummary = {
    questions: questions.length,
    calls: guard.callCount,
    spentUsd: guard.spentUsd,
    budgetUsd: BUDGET_USD,
    records: guard.records,
  };
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}
