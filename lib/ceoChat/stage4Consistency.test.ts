import { buildStage4PlanBlock } from './stage4PlanBlock';
import { buildExecutionSummaryBlock } from './stage4Projection';
import { isStage4StatusQuestion } from './contextSelection';

describe('STAGE4の実行中・中止の施策を尋ねる質問の検出', () => {
  it.each(['今実行中の施策と、中止した施策を教えて', '実行計画の状態はどうなっていますか？'])('「%s」は状態の質問', (q) =>
    expect(isStage4StatusQuestion(q)).toBe(true),
  );
  it('施策を作る・変える指示は、状態の質問として扱わない', () => {
    expect(isStage4StatusQuestion('新しい施策を作って')).toBe(false);
  });
});

const DEPARTMENTS = [
  {
    id: 'dept-1',
    name: '宅配事業',
    projects: [
      { id: 'p-stop', title: '旧ルートの廃止', lifecycle: { status: 'STOPPED', stoppedAt: '2026-10-01T00:00:00.000Z' }, okrsV2: [{ id: 'kr-1', label: '旧ルート件数', target: 0, unit: '件' }] },
      { id: 'p-live', title: '拠点統合と配送の効率化', okrsV2: [{ id: 'kr-2', label: '一台あたり配送件数', target: 120, unit: '件' }] },
    ],
  },
];

describe('STAGE4：中止・除外済みの施策を、現在実行する施策として案内しない', () => {
  it('施策一覧では、中止の施策に中止と明示し、KRと期待成果を出さない', () => {
    const r = buildExecutionSummaryBlock(DEPARTMENTS as never, '実行中の施策を教えて', undefined, false);
    expect(r.text).toContain('【中止】旧ルートの廃止');
    expect(r.text).toContain('中止・除外（現在実行する施策ではない）');
    expect(r.text).not.toContain('旧ルート件数');
    expect(r.text).toContain('一台あたり配送件数');
  });

  it('計画書の一覧では、中止の計画の施策・KPIを出さず、対象外と示す', () => {
    const text = buildStage4PlanBlock({
      rows: [{ project_id: 'p-stop', ai_draft: {}, user_edits: {}, started: true, adopted: true }],
      departments: DEPARTMENTS,
      question: '実行計画を教えて',
    });
    expect(text).toContain('状態：中止');
    expect(text).toContain('中止・除外された施策のため、実行中の施策として案内しない（施策・KPIは対象外）');
  });
});
