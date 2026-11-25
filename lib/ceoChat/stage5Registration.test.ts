import { actionKeysFor } from '@/lib/stage5/actionProgress';
import { buildStage5RegistrationBlock, STAGE5_REGISTRATION_BUDGET } from './stage5Registration';

const NOW = new Date('2026-11-20T00:00:00Z');
const AI_DRAFT = { plan: { section2: { actions: [{ order: 1, title: '配送ルートの見直し' }, { order: 2, title: '拠点の統合案を作る' }] } } };
const START_AT = '2026-10-01T00:00:00.000Z';

function project(over: Record<string, unknown> = {}) {
  return { id: 'proj-1', title: '配送改善', okrsV2: [], ...over };
}

function dept(projects: unknown[]) {
  return [{ id: 'dept-1', name: '宅配事業', projects }];
}

describe('STAGE5の登録状況：取得結果を区別して集計する', () => {
  it('財務の計画がない施策は「参照対象外」、KRの実績がなければ「未登録」', () => {
    const r = buildStage5RegistrationBlock({
      departments: dept([project({ okrsV2: [{ id: 'kr-1', label: '配送件数', target: 100, unit: '件' }] })]),
      planRows: [],
      okrs: [],
      companyLogs: [],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(r.statuses.finance).toBe('NOT_APPLICABLE');
    expect(r.statuses.kr).toBe('UNREGISTERED');
    expect(r.statuses.action).toBe('NOT_APPLICABLE');
    expect(r.text).toContain('【概要】');
    expect(r.text).toContain('KR実績：未登録');
  });

  it('KRの実績の一部だけ登録されていれば「一部登録」、実績の値と日付を根拠として出す', () => {
    const r = buildStage5RegistrationBlock({
      departments: dept([
        project({
          okrsV2: [
            { id: 'kr-1', label: '配送件数', target: 100, unit: '件', actual: { value: 80, asOf: '2026-10-31' } },
            { id: 'kr-2', label: '遅延率', target: 2, unit: '%' },
          ],
        }),
      ]),
      planRows: [],
      okrs: [],
      companyLogs: [],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(r.statuses.kr).toBe('PARTIAL');
    expect(r.text).toContain('実績 80 件（目標 100 件、2026-10-31時点）');
    expect(r.text).toContain('遅延率：実績未登録');
  });

  it('計画書の読み込みに失敗したときは「取得失敗」とし、未登録とは判断しない', () => {
    const r = buildStage5RegistrationBlock({
      departments: dept([project()]),
      planRows: null,
      okrs: [],
      companyLogs: [],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(r.statuses.action).toBe('FAILED');
    expect(r.text).toContain('実施事項の進捗：取得失敗');
    expect(r.text).toContain('未登録とは判断しない');
  });

  it('開始済みの計画の実施事項は、進捗の記録がある分だけ「登録済み」（結果も出す）', () => {
    const keys = actionKeysFor(START_AT, AI_DRAFT);
    const r = buildStage5RegistrationBlock({
      departments: dept([
        project({
          executionProgress: {
            [keys[0].key]: { status: 'IN_PROGRESS', result: '試行を開始', issue: '', nextAction: '', krIds: [], updatedAt: '', updatedBy: '' },
          },
        }),
      ]),
      planRows: [{ project_id: 'proj-1', ai_draft: AI_DRAFT, started: true, start_info: { at: START_AT } }],
      okrs: [],
      companyLogs: [],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(r.statuses.action).toBe('PARTIAL');
    expect(r.text).toContain('配送ルートの見直し：進行中、結果：試行を開始');
    expect(r.text).toContain('拠点の統合案を作る：進捗未登録');
  });

  it('社内共有は、取得に失敗したら「取得失敗」、件数がなければ直近の期間の未登録として扱う', () => {
    const failed = buildStage5RegistrationBlock({
      departments: dept([project()]),
      planRows: [],
      okrs: [],
      companyLogs: [],
      companyLogsFailed: true,
      now: NOW,
    });
    expect(failed.statuses.share).toBe('FAILED');

    const none = buildStage5RegistrationBlock({
      departments: dept([project()]),
      planRows: [],
      okrs: [{ id: 'okr-1', project_id: 'proj-1' }],
      companyLogs: [],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(none.statuses.share).toBe('UNREGISTERED');
    expect(none.text).toContain('直近30日には記録がない');
  });

  it('社内共有の件数は、この戦略の案件に紐づく記録だけを数え、本文は出さない', () => {
    const r = buildStage5RegistrationBlock({
      departments: dept([project()]),
      planRows: [],
      okrs: [{ id: 'okr-1', project_id: 'proj-1' }, { id: 'okr-other', project_id: 'proj-other' }],
      companyLogs: [
        { okr_id: 'okr-1', created_at: '2026-11-10T01:00:00Z', content: 'ユニークな本文XYZ', score: 4, status: 'ON_TRACK' },
        { okr_id: 'okr-other', created_at: '2026-11-10T01:00:00Z', content: '別の戦略', score: 3, status: 'ON_TRACK' },
      ],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(r.statuses.share).toBe('REGISTERED');
    expect(r.text).toContain('宅配事業／配送改善：1件（最新 2026-11-10）');
    expect(r.text).not.toContain('ユニークな本文XYZ');
    expect(r.text).not.toContain('別の戦略');
  });

  it('上限を超えたら省略を明示し、全件を確認したとは言わせない', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `kr-${i}`,
      label: `長い名称の指標${i}`.repeat(3),
      target: 1,
      unit: '件',
    }));
    const r = buildStage5RegistrationBlock({
      departments: dept([project({ okrsV2: many })]),
      planRows: [],
      okrs: [],
      companyLogs: [],
      companyLogsFailed: false,
      now: NOW,
    });
    expect(r.text).toContain('ほか28件（省略）');
    expect(r.text.length).toBeLessThanOrEqual(STAGE5_REGISTRATION_BUDGET + 200);
  });
});
