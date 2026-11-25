import { buildStage3WorkingStateBlock } from './stage3WorkingState';
import { isStage3WorkspaceQuestion } from './contextSelection';

type State = Record<string, unknown>;
const base = (over: State = {}): State => ({
  status: 'draft',
  confirmed: null,
  drafts: [],
  selections: [],
  projectSelections: [],
  candidateDecisions: {},
  adjustmentProposals: [],
  ...over,
});
const asState = (s: State) => s as never;

describe('STAGE3の作業版：採否・調整・確定状態を保存値から要約する', () => {
  it('作業版だけで、未判断の候補があれば、確定できないと示す（決定は変えない）', () => {
    const text = buildStage3WorkingStateBlock({
      state: asState(
        base({
          drafts: [{ kind: 'regenerated', createdAt: '2026-11-24T00:00:00Z', departments: [{}, {}], newProjects: [{}, {}, {}, {}] }],
          selections: [{ item: 'mission', decision: 'applied' }],
          projectSelections: [
            { candidateId: 'c1', decision: 'pending' },
            { candidateId: 'c2', decision: 'applied' },
          ],
        }),
      ),
      failed: false,
    });
    expect(text).toContain('【概要】未確定（作業版のみ。確定版はまだない）');
    expect(text).toContain('草案：1件（最新 2026-11-24T00:00:00Z、部門2件、新規プロジェクト4件）');
    expect(text).toContain('- 基本方針の項目（採否）：採用 1件・保留 0件・不採用 0件・未判断 0件');
    expect(text).toContain('- プロジェクト候補（採否）：採用 1件・保留 0件・不採用 0件・未判断 1件');
    expect(text).toContain('未判断の候補が残っているため、確定できない');
  });

  it('部門間調整の候補は、採否（採用・保留・不採用）と未判断を分けて示す', () => {
    const text = buildStage3WorkingStateBlock({
      state: asState(
        base({
          adjustmentProposals: [
            { candidateId: 'adj-1', proposal: 'a', changes: [] },
            { candidateId: 'adj-2', proposal: 'b', changes: [] },
            { candidateId: 'adj-3', proposal: 'c', changes: [] },
          ],
          candidateDecisions: { 'adj-1': 'adopted', 'adj-2': 'rejected' },
        }),
      ),
      failed: false,
    });
    expect(text).toContain('- 部門間調整の候補（採否）：3件（採用 1件・保留 0件・不採用 1件・未判断 1件）');
  });

  it('確定版の後に作業版が新しくなったときは、再確定が必要と示す', () => {
    const text = buildStage3WorkingStateBlock({
      state: asState(
        base({
          status: 'confirmed',
          confirmed: { confirmedAt: '2026-11-01T00:00:00Z', appliedCount: 3 },
          drafts: [{ kind: 'regenerated', createdAt: '2026-11-20T00:00:00Z', departments: [], newProjects: [] }],
        }),
      ),
      failed: false,
    });
    expect(text).toContain('【概要】確定済み（確定日時 2026-11-01T00:00:00Z）');
    expect(text).toContain('確定版より新しい草案がある。内容を反映するには、再生成と再確定が必要');
  });

  it('確定版と作業版が同じ状態なら、そう示す', () => {
    const text = buildStage3WorkingStateBlock({
      state: asState(base({ status: 'confirmed', confirmed: { confirmedAt: '2026-11-01T00:00:00Z', appliedCount: 0 } })),
      failed: false,
    });
    expect(text).toContain('- 再生成・再確定の要否：確定版と作業版は同じ状態');
  });

  it('取得に失敗したときは、採否や確定状態を判断しない', () => {
    const text = buildStage3WorkingStateBlock({ state: null, failed: true });
    expect(text).toContain('取得失敗（作業版を読めなかったため、採否・確定状態は判断しない）');
  });

  it('作業版がなければ、なしと示す', () => {
    expect(buildStage3WorkingStateBlock({ state: null, failed: false })).toContain('作業版なし');
  });
});

describe('STAGE3の作業版を読む質問の検出', () => {
  it.each(['部門戦略の採否はどうなっていますか？', '部門間調整の候補はありますか', 'この戦略は確定していますか', '再確定が必要ですか？'])(
    '「%s」は作業版の質問',
    (q) => expect(isStage3WorkspaceQuestion(q)).toBe(true),
  );
  it('関係のない質問は含めない', () => {
    expect(isStage3WorkspaceQuestion('宅配事業の売上を教えて')).toBe(false);
  });
});
