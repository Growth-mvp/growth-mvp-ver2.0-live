export type RefState = 'out_of_scope' | 'ok' | 'partial' | 'empty' | 'failed' | 'unknown';

export type RefStatusLine = { source: string; state: RefState; detail?: string };

export const TRUNCATION_MARK = '上限のため省略';

const STAGE6_MARK = {
  computeFailed: '入力データの整合を確認できませんでした',
  storeInvalid: '保存済みの資金計画を読めませんでした',
  storeDifferentCompany: 'この会社のものとして確認できませんでした',
  storeNone: '保存済みの資金計画はありません',
  storeUnknown: '保存済みの資金計画は今回参照した情報では確認できません',
} as const;

const QA_RECENT_LIMIT = 2;

const STATE_TEXT: Record<RefState, string> = {
  out_of_scope: '今回の回答では参照していない（登録の有無は判断できない）',
  ok: '参照済み（全件）',
  partial: '一部のみ参照（全件として扱わない）',
  empty: '登録なし（取得成功を確認済み）',
  failed: '取得失敗（登録の有無は判断できない）',
  unknown: '状態不明（登録なしと断定しない）',
};

export type Stage6Text = {
  truncated: boolean;
  computeFailed: boolean;
  storeFailed: boolean;
  storeNone: boolean;
  storeUnknown: boolean;
};

export function classifyStage6Text(text: string): Stage6Text {
  return {
    truncated: text.includes(TRUNCATION_MARK),
    computeFailed: text.includes(STAGE6_MARK.computeFailed),
    storeFailed:
      text.includes(STAGE6_MARK.storeInvalid) || text.includes(STAGE6_MARK.storeDifferentCompany),
    storeNone: text.includes(STAGE6_MARK.storeNone),
    storeUnknown: text.includes(STAGE6_MARK.storeUnknown),
  };
}

export type ReferenceFacts = {
  stage1: { financeSummaryCount: number; metricsFailed: boolean };
  stage2Qa: { chapterSteps: number[] };
  stage2Story: { chapterCount: number };
  stage2Targets: null | { rows: number; total: number; absenceConfirmed: boolean };
  stage3Bridge: null | { absenceConfirmed: boolean; state: 'absent' | 'present'; omitted: number };
  stage4: { departmentsTotal: number; shownDepartments: number; complete: boolean; absenceConfirmed: boolean };
  progressLog: { failed: boolean; count: number; limit: number };
  stage5: null | { failed: boolean; truncated: boolean };
  stage6: null | ({ scope: 'plan' | 'cash'; financeEmpty: boolean } & Stage6Text);
};

export function buildReferenceStatusLines(f: ReferenceFacts): RefStatusLine[] {
  const lines: RefStatusLine[] = [];

  if (f.stage1.metricsFailed) {
    lines.push(
      f.stage1.financeSummaryCount > 0
        ? { source: 'STAGE1 財務・5指標', state: 'partial', detail: '5指標は計算できなかった' }
        : { source: 'STAGE1 財務・5指標', state: 'failed', detail: '5指標の計算に失敗' }
    );
  } else if (f.stage1.financeSummaryCount > 0) {
    lines.push({ source: 'STAGE1 財務・5指標', state: 'ok' });
  } else {
    lines.push({ source: 'STAGE1 財務・5指標', state: 'unknown', detail: '正規化後に空。登録の有無は確認できない' });
  }

  const steps = f.stage2Qa.chapterSteps;
  if (steps.length === 0) {
    lines.push({ source: 'STAGE2 掘り下げQA', state: 'unknown' });
  } else if (steps.some((n) => n > QA_RECENT_LIMIT)) {
    lines.push({ source: 'STAGE2 掘り下げQA', state: 'partial', detail: `各章の直近${QA_RECENT_LIMIT}件のみ` });
  } else {
    lines.push({ source: 'STAGE2 掘り下げQA', state: 'ok' });
  }

  lines.push({
    source: 'STAGE2 完成ストーリー',
    state: f.stage2Story.chapterCount > 0 ? 'ok' : 'unknown',
  });

  if (!f.stage2Targets) {
    lines.push({ source: 'STAGE2 業績目標', state: 'out_of_scope' });
  } else if (f.stage2Targets.rows === 0) {
    lines.push({ source: 'STAGE2 業績目標', state: f.stage2Targets.absenceConfirmed ? 'empty' : 'unknown' });
  } else if (f.stage2Targets.total > f.stage2Targets.rows) {
    lines.push({
      source: 'STAGE2 業績目標',
      state: 'partial',
      detail: `${f.stage2Targets.rows}件/全${f.stage2Targets.total}件`,
    });
  } else {
    lines.push({ source: 'STAGE2 業績目標', state: 'ok' });
  }

  if (!f.stage3Bridge) {
    lines.push({ source: 'STAGE3 戦略展開ブリッジ', state: 'out_of_scope' });
  } else if (f.stage3Bridge.state === 'absent') {
    lines.push({
      source: 'STAGE3 戦略展開ブリッジ',
      state: f.stage3Bridge.absenceConfirmed ? 'empty' : 'unknown',
    });
  } else if (f.stage3Bridge.omitted > 0) {
    lines.push({ source: 'STAGE3 戦略展開ブリッジ', state: 'partial', detail: `${f.stage3Bridge.omitted}件省略` });
  } else {
    lines.push({ source: 'STAGE3 戦略展開ブリッジ', state: 'ok' });
  }

  const s4 = f.stage4;
  if (s4.departmentsTotal === 0) {
    lines.push({ source: 'STAGE4 部門・施策', state: s4.absenceConfirmed ? 'empty' : 'unknown' });
  } else if (!s4.complete) {
    lines.push({
      source: 'STAGE4 部門・施策',
      state: 'partial',
      detail: `部門 全${s4.departmentsTotal}件中${s4.shownDepartments}件`,
    });
  } else {
    lines.push({ source: 'STAGE4 部門・施策', state: 'ok' });
  }

  const pl = f.progressLog;
  if (pl.failed) {
    lines.push({ source: '直近進捗ログ（本人分）', state: 'failed' });
  } else if (pl.count === 0) {
    lines.push({ source: '直近進捗ログ（本人分）', state: 'empty' });
  } else if (pl.count >= pl.limit) {
    lines.push({ source: '直近進捗ログ（本人分）', state: 'partial', detail: `直近${pl.limit}件まで` });
  } else {
    lines.push({ source: '直近進捗ログ（本人分）', state: 'ok' });
  }

  if (!f.stage5) {
    lines.push({ source: 'STAGE5 会社全体の進捗', state: 'out_of_scope' });
  } else if (f.stage5.failed) {
    lines.push({ source: 'STAGE5 会社全体の進捗', state: 'failed' });
  } else if (f.stage5.truncated) {
    lines.push({ source: 'STAGE5 会社全体の進捗', state: 'partial' });
  } else {
    lines.push({ source: 'STAGE5 会社全体の進捗', state: 'ok' });
  }

  lines.push(stage6Line(f.stage6));

  return lines;
}

function stage6Line(s: ReferenceFacts['stage6']): RefStatusLine {
  const source = 'STAGE6 財務計画';
  if (!s) return { source, state: 'out_of_scope' };
  if (s.computeFailed) return { source, state: 'failed', detail: '財務計画を計算できなかった。数値は出していない' };
  if (s.storeFailed) return { source, state: 'failed', detail: '保存済みの前提を読めない、または別会社のもの' };
  if (s.storeUnknown) return { source, state: 'unknown', detail: '保存済みの資金計画の有無を確認できない' };
  if (s.storeNone) return { source, state: 'empty', detail: '保存済みの資金計画なし' };
  if (s.financeEmpty) return { source, state: 'empty', detail: '損益データなし' };
  if (s.truncated) return { source, state: 'partial' };
  if (s.scope === 'cash') return { source, state: 'partial', detail: '現預金の実績のみ参照、財務計画は未参照' };
  return { source, state: 'ok' };
}

export function buildReferenceStatusBlock(lines: RefStatusLine[]): string {
  const body = lines.map(
    (l) => `- ${l.source}: ${STATE_TEXT[l.state]}${l.detail ? `（${l.detail}）` : ''}`
  );
  return [
    '【参照状況（内部情報）】',
    ...body,
    '- 参照していないことは、登録情報が存在しない・失われたことを意味しない。',
    '- この状況は回答の判断に使う。ユーザーが該当STAGEについて尋ねた場合や判断に影響する場合以外は、言及しない。',
  ].join('\n');
}
