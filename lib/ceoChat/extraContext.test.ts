import { composeExtraBlock, isExecutionQuestion } from './extraContext';

const PARTS = { execution: 'EXEC', stage4Plan: 'PLAN', progress: 'PROG' };

describe('実行計画・施策・KPI・進捗を渡す質問の判定', () => {
  it.each([
    ['実行計画の進め方を見直したい', true],
    ['KPIの達成状況は？', true],
    ['2030年度の業績目標について、数値・施策・実行計画を詳しく分析して', true],
    ['うちの会社、どうやったら業績上がるの？', false],
    ['顧客別採算はまだ把握できていません', false],
  ])('「%s」→ %s', (query, expected) => {
    expect(isExecutionQuestion(query, ['営業部', '新規開拓'])).toBe(expected);
  });

  it('登録済みの部門名・案件名を含む質問は、語が無くても関連する', () => {
    expect(isExecutionQuestion('営業部はどうなっている？', ['営業部', '新規開拓'])).toBe(true);
    expect(isExecutionQuestion('新規開拓の状況は？', ['営業部', '新規開拓'])).toBe(true);
  });

  it('1文字の名称では一致とみなさない（一般語の誤一致を防ぐ）', () => {
    expect(isExecutionQuestion('値段を上げたい', ['値'])).toBe(false);
  });
});

describe('extraBlock の組み立て', () => {
  it('両方含む場合は、従来の形式と同じ文字列になる', () => {
    expect(composeExtraBlock(PARTS, { execution: true, progress: true })).toBe(
      '\n\n---\nEXEC\nPLAN\n\n# 直近進捗ログ\nPROG\n---\n'
    );
  });

  it('実行情報だけ、または進捗だけを含められる', () => {
    expect(composeExtraBlock(PARTS, { execution: true, progress: false })).toBe('\n\n---\nEXEC\nPLAN\n---\n');
    expect(composeExtraBlock(PARTS, { execution: false, progress: true })).toBe('\n\n---\n\n# 直近進捗ログ\nPROG\n---\n');
  });

  it('どちらも含めない場合は空文字（一般的な経営相談）', () => {
    expect(composeExtraBlock(PARTS, { execution: false, progress: false })).toBe('');
  });
});
