import { buildStage5ProgressBlock, formatOwnProgressLines, stripProgressMeta, STAGE5_CHAR_BUDGET } from './stage5Progress';

const NOW = new Date('2026-11-03T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

const DEPARTMENTS = [
  { id: 'd1', name: '営業部', projects: [{ id: 'p1', title: '新規顧客開拓' }] },
  { id: 'd2', name: '製造部', projects: [{ id: 'p2', title: '工程の標準化' }] },
];
const OKRS = [
  { id: 'o1', department_id: 'd1', project_id: 'p1', objective: '新規', is_deleted: false },
  { id: 'o2', department_id: 'd2', project_id: 'p2', objective: '工程', is_deleted: false },
];

describe('会社全体の確認状況は、確認日時の集計だけを出す', () => {
  it('7日以内の確認があるプロジェクトと、ないプロジェクトを分ける', () => {
    const text = buildStage5ProgressBlock({
      departments: DEPARTMENTS,
      okrs: OKRS,
      companyLogs: [{ okr_id: 'o1', created_at: daysAgo(2), content: '確認しました', score: null, status: null }],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(text).toContain('直近7日に確認があったプロジェクト: 1/2件');
    expect(text).not.toContain('営業部 / 新規顧客開拓');
    expect(text).toContain('製造部 / 工程の標準化（最終確認: 30日以内の記録なし）');
  });

  it('本文（content）は集計に含めない', () => {
    const text = buildStage5ProgressBlock({
      departments: DEPARTMENTS,
      okrs: OKRS,
      companyLogs: [{ okr_id: 'o1', created_at: daysAgo(1), content: '他人の機密本文' }],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(text).not.toContain('他人の機密本文');
  });

  it('空の記録（本文・評価・ステータスがすべて空）は確認済みと数えない', () => {
    const text = buildStage5ProgressBlock({
      departments: DEPARTMENTS,
      okrs: OKRS,
      companyLogs: [
        { okr_id: 'o1', created_at: daysAgo(1), content: '', score: null, status: '' },
        { okr_id: 'o2', created_at: daysAgo(1), content: '   ', score: null, status: null },
      ],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(text).toContain('直近7日に確認があったプロジェクト: 0/2件');
  });

  it('評価だけの記録は確認ありとして数える', () => {
    const text = buildStage5ProgressBlock({
      departments: DEPARTMENTS,
      okrs: OKRS,
      companyLogs: [{ okr_id: 'o1', created_at: daysAgo(1), content: null, score: 3, status: null }],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(text).toContain('直近7日に確認があったプロジェクト: 1/2件');
  });

  it('確認がないことを、遅れ・遅延の断定として書かない', () => {
    const text = buildStage5ProgressBlock({
      departments: DEPARTMENTS,
      okrs: OKRS,
      companyLogs: [],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(text).toContain('確認がないプロジェクト');
    expect(text).toContain('遅延と断定しない');
    expect(text).not.toMatch(/遅れている|遅延している|未達です/);
  });

  it('OKRの対応がない確認は数えない（他社の進捗を混ぜない）', () => {
    const text = buildStage5ProgressBlock({
      departments: DEPARTMENTS,
      okrs: OKRS,
      companyLogs: [{ okr_id: 'other-company-okr', created_at: daysAgo(1) }],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(text).toContain('直近7日に確認があったプロジェクト: 0/2件');
  });

  it('プロジェクト名が解決できないときは名称未登録と書く', () => {
    const text = buildStage5ProgressBlock({
      departments: [],
      okrs: [{ id: 'o3', department_id: 'dx', project_id: 'px' }],
      companyLogs: [],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(text).toContain('名称未登録 / 名称未登録（最終確認: 30日以内の記録なし）');
  });

  it('取得に失敗したときは、全社の状況を断定しない', () => {
    const text = buildStage5ProgressBlock({
      departments: DEPARTMENTS,
      okrs: OKRS,
      companyLogs: [],
      companyLogsFailed: true,
      now: NOW,
    });
    expect(text).toContain('会社全体の進捗は取得できませんでした');
    expect(text).not.toContain('直近7日');
  });

  it('確認なしの一覧は10件で打ち切り、残りの件数を示す', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `q${i}`, department_id: 'd1', project_id: `pp${i}` }));
    const text = buildStage5ProgressBlock({
      departments: DEPARTMENTS,
      okrs: many,
      companyLogs: [],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(text).toContain('（ほか390件）');
    expect(text.length).toBeLessThanOrEqual(STAGE5_CHAR_BUDGET);
  });
});

describe('本人の実行記録', () => {
  it('__META__ の行を除き、本文だけを出す', () => {
    expect(stripProgressMeta('__META__{"a":1}\n本文です')).toBe('本文です');
    const lines = formatOwnProgressLines([
      { okr_id: 'o1', created_at: '2026-11-02T01:00:00Z', content: '__META__{"x":1}\n点検を前倒しした', score: 4, status: '進行中' },
    ]);
    expect(lines[0]).toContain('点検を前倒しした');
    expect(lines[0]).not.toContain('__META__');
    expect(lines[0]).toContain('評価 4');
    expect(lines[0]).toContain('登録ステータス 進行中');
  });

  it('評価・ステータスが無い場合は未登録と書く', () => {
    const [line] = formatOwnProgressLines([{ created_at: '2026-11-02T01:00:00Z', content: '本文' }]);
    expect(line).toContain('評価 未登録');
    expect(line).toContain('登録ステータス 未登録');
  });

  it('日付が無い場合は推測せず、日付未登録と書く', () => {
    const [line] = formatOwnProgressLines([{ content: '本文' }]);
    expect(line).toContain('日付未登録');
  });

  it('プロジェクト名は解決できたときだけ付ける', () => {
    const [line] = formatOwnProgressLines(
      [{ okr_id: 'o1', created_at: '2026-11-02T01:00:00Z', content: '本文' }],
      (id) => (id === 'o1' ? '新規顧客開拓' : null)
    );
    expect(line).toContain('新規顧客開拓');
  });
});
