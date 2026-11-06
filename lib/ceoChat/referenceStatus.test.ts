import {
  buildReferenceStatusBlock,
  buildReferenceStatusLines,
  classifyStage6Text,
  TRUNCATION_MARK,
  type ReferenceFacts,
} from './referenceStatus';

const stage6Flags = {
  truncated: false,
  computeFailed: false,
  storeFailed: false,
  storeNone: false,
  storeUnknown: false,
};

const baseFacts = (over: Partial<ReferenceFacts> = {}): ReferenceFacts => ({
  stage1: { financeSummaryCount: 3, metricsFailed: false },
  stage2Qa: { chapterSteps: [1, 2] },
  stage2Story: { chapterCount: 4 },
  stage2Targets: null,
  stage3Bridge: null,
  stage4: { departmentsTotal: 2, shownDepartments: 2, complete: true, absenceConfirmed: false },
  progressLog: { failed: false, count: 5, limit: 200 },
  stage5: null,
  stage6: null,
  ...over,
});

const find = (lines: ReturnType<typeof buildReferenceStatusLines>, source: string) =>
  lines.find((l) => l.source === source);

describe('参照状況の判定（取得の状態を区別する）', () => {
  it('取得失敗は登録なしと区別される（回帰2）', () => {
    const lines = buildReferenceStatusLines(baseFacts({ progressLog: { failed: true, count: 0, limit: 200 } }));
    expect(find(lines, '直近進捗ログ（本人分）')?.state).toBe('failed');
  });

  it('空配列の答えは取得成功を確認できない場合に登録なしと断定しない（回帰2）', () => {
    const lines = buildReferenceStatusLines(
      baseFacts({ stage2Qa: { chapterSteps: [] }, stage2Story: { chapterCount: 0 } })
    );
    expect(find(lines, 'STAGE2 掘り下げQA')?.state).toBe('unknown');
    expect(find(lines, 'STAGE2 完成ストーリー')?.state).toBe('unknown');
  });

  it('対象外の STAGE は、登録の有無ではなく参照していないことを示す（回帰1）', () => {
    const lines = buildReferenceStatusLines(baseFacts({ stage5: null, stage6: null, stage3Bridge: null }));
    expect(find(lines, 'STAGE5 会社全体の進捗')?.state).toBe('out_of_scope');
    expect(find(lines, 'STAGE6 財務計画')?.state).toBe('out_of_scope');
    expect(find(lines, 'STAGE3 戦略展開ブリッジ')?.state).toBe('out_of_scope');
  });

  it('一部取得は全件として扱わない状態になる（回帰3）', () => {
    const lines = buildReferenceStatusLines(
      baseFacts({
        stage2Qa: { chapterSteps: [5, 1] },
        stage4: { departmentsTotal: 8, shownDepartments: 3, complete: false, absenceConfirmed: false },
        progressLog: { failed: false, count: 200, limit: 200 },
      })
    );
    expect(find(lines, 'STAGE2 掘り下げQA')?.state).toBe('partial');
    expect(find(lines, 'STAGE4 部門・施策')?.state).toBe('partial');
    expect(find(lines, '直近進捗ログ（本人分）')?.state).toBe('partial');
  });

  it('STAGE1 の指標計算だけ失敗した場合は指標を全件扱いしない', () => {
    const failedMetrics = buildReferenceStatusLines(baseFacts({ stage1: { financeSummaryCount: 3, metricsFailed: true } }));
    expect(find(failedMetrics, 'STAGE1 財務・5指標')?.state).toBe('partial');
    const noFinance = buildReferenceStatusLines(baseFacts({ stage1: { financeSummaryCount: 0, metricsFailed: true } }));
    expect(find(noFinance, 'STAGE1 財務・5指標')?.state).toBe('failed');
  });

  it('STAGE6 で現預金だけを参照した場合は財務計画を全件として扱わない', () => {
    const lines = buildReferenceStatusLines(
      baseFacts({ stage6: { scope: 'cash', financeEmpty: false, ...stage6Flags } })
    );
    expect(find(lines, 'STAGE6 財務計画')?.state).toBe('partial');
  });

  it('STAGE2 目標は件数が省略された場合に partial になる', () => {
    const lines = buildReferenceStatusLines(
      baseFacts({ stage2Targets: { rows: 6, total: 8, absenceConfirmed: false } })
    );
    expect(find(lines, 'STAGE2 業績目標')?.state).toBe('partial');
  });
});

describe('登録なしは、正常取得で空と確認できる場合だけ（本文と同じ判定を使う）', () => {
  it('STAGE1 は財務サマリが正規化後に空なら状態不明（financePL 由来の導出や復元を経由するため）', () => {
    const lines = buildReferenceStatusLines(baseFacts({ stage1: { financeSummaryCount: 0, metricsFailed: false } }));
    expect(find(lines, 'STAGE1 財務・5指標')?.state).toBe('unknown');
  });

  it('STAGE2 目標：正常取得で空と確認できれば登録なし、確認できなければ状態不明', () => {
    const confirmed = buildReferenceStatusLines(
      baseFacts({ stage2Targets: { rows: 0, total: 0, absenceConfirmed: true } })
    );
    expect(find(confirmed, 'STAGE2 業績目標')?.state).toBe('empty');
    const unconfirmed = buildReferenceStatusLines(
      baseFacts({ stage2Targets: { rows: 0, total: 0, absenceConfirmed: false } })
    );
    expect(find(unconfirmed, 'STAGE2 業績目標')?.state).toBe('unknown');
  });

  it('STAGE3 ブリッジ：未設定かつ確認できれば登録なし、確認できなければ状態不明', () => {
    const confirmed = buildReferenceStatusLines(
      baseFacts({ stage3Bridge: { state: 'absent', absenceConfirmed: true, omitted: 0 } })
    );
    expect(find(confirmed, 'STAGE3 戦略展開ブリッジ')?.state).toBe('empty');
    const unconfirmed = buildReferenceStatusLines(
      baseFacts({ stage3Bridge: { state: 'absent', absenceConfirmed: false, omitted: 0 } })
    );
    expect(find(unconfirmed, 'STAGE3 戦略展開ブリッジ')?.state).toBe('unknown');
  });

  it('STAGE4 部門が空でも、正常取得で空と確認できなければ状態不明', () => {
    const lines = buildReferenceStatusLines(
      baseFacts({ stage4: { departmentsTotal: 0, shownDepartments: 0, complete: true, absenceConfirmed: false } })
    );
    expect(find(lines, 'STAGE4 部門・施策')?.state).toBe('unknown');
  });

  it('STAGE4 部門が正常取得で空と確認できれば登録なし', () => {
    const lines = buildReferenceStatusLines(
      baseFacts({ stage4: { departmentsTotal: 0, shownDepartments: 0, complete: true, absenceConfirmed: true } })
    );
    expect(find(lines, 'STAGE4 部門・施策')?.state).toBe('empty');
  });

  it('進捗ログは取得が成功して0件だった場合だけ登録なしとする（明示クエリの結果）', () => {
    const lines = buildReferenceStatusLines(baseFacts({ progressLog: { failed: false, count: 0, limit: 200 } }));
    expect(find(lines, '直近進捗ログ（本人分）')?.state).toBe('empty');
  });
});

describe('STAGE6 の内部結果は取得成功として扱わない', () => {
  it('計算失敗は failed になり、ok として出ない', () => {
    const lines = buildReferenceStatusLines(
      baseFacts({ stage6: { scope: 'plan', financeEmpty: false, ...stage6Flags, computeFailed: true } })
    );
    expect(find(lines, 'STAGE6 財務計画')?.state).toBe('failed');
  });

  it('保存前提の読取失敗・別会社は failed になる', () => {
    const lines = buildReferenceStatusLines(
      baseFacts({ stage6: { scope: 'plan', financeEmpty: false, ...stage6Flags, storeFailed: true } })
    );
    expect(find(lines, 'STAGE6 財務計画')?.state).toBe('failed');
  });

  it('保存済み資金計画が確認できない場合は状態不明、確認できた未保存は登録なし', () => {
    const unknown = buildReferenceStatusLines(
      baseFacts({ stage6: { scope: 'plan', financeEmpty: false, ...stage6Flags, storeUnknown: true } })
    );
    expect(find(unknown, 'STAGE6 財務計画')?.state).toBe('unknown');
    const none = buildReferenceStatusLines(
      baseFacts({ stage6: { scope: 'plan', financeEmpty: false, ...stage6Flags, storeNone: true } })
    );
    expect(find(none, 'STAGE6 財務計画')?.state).toBe('empty');
  });

  it('損益データが正規化後に空と確認できる場合は登録なし', () => {
    const lines = buildReferenceStatusLines(
      baseFacts({ stage6: { scope: 'plan', financeEmpty: true, ...stage6Flags } })
    );
    expect(find(lines, 'STAGE6 財務計画')?.state).toBe('empty');
  });

  it('計算失敗・読取失敗の文言を検出し、未保存（確認済み）と未確認を区別する', () => {
    expect(classifyStage6Text('- 入力データの整合を確認できませんでした（数値は出しません）。').computeFailed).toBe(true);
    expect(classifyStage6Text('- 保存済みの資金計画はありません。').storeNone).toBe(true);
    expect(classifyStage6Text('- 保存済みの資金計画は今回参照した情報では確認できません。').storeUnknown).toBe(true);
    expect(classifyStage6Text('- 保存済みの資金計画を読めませんでした（x）。').storeFailed).toBe(true);
    expect(classifyStage6Text('- 保存済みの資金計画は、この会社のものとして確認できませんでした。').storeFailed).toBe(true);
    expect(classifyStage6Text(`abc${TRUNCATION_MARK}`).truncated).toBe(true);
    expect(classifyStage6Text('通常の本文')).toEqual(stage6Flags);
  });
});

describe('参照状況ブロック（内部情報としての文言）', () => {
  it('各状態を区別する文言を含み、取得失敗を登録なしの文言にしない', () => {
    const block = buildReferenceStatusBlock(
      buildReferenceStatusLines(baseFacts({ progressLog: { failed: true, count: 0, limit: 200 } }))
    );
    expect(block).toContain('【参照状況（内部情報）】');
    expect(block).toContain('- 直近進捗ログ（本人分）: 取得失敗');
    expect(block).not.toContain('- 直近進捗ログ（本人分）: 登録なし');
  });

  it('参照していないことを登録情報の喪失と混同しない旨を含む', () => {
    const block = buildReferenceStatusBlock(buildReferenceStatusLines(baseFacts()));
    expect(block).toContain('参照していないことは、登録情報が存在しない・失われたことを意味しない');
    expect(block).toContain('ユーザーが該当STAGEについて尋ねた場合や判断に影響する場合以外は、言及しない');
  });

  it('一部取得の行は全件ではないことを明示する', () => {
    const block = buildReferenceStatusBlock(
      buildReferenceStatusLines(baseFacts({ stage2Qa: { chapterSteps: [4] } }))
    );
    expect(block).toContain('- STAGE2 掘り下げQA: 一部のみ参照（全件として扱わない）（各章の直近2件のみ）');
  });
});
