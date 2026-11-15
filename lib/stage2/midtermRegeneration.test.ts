import { buildDbRowFromState, buildStateFromDbRow } from '@/utils/supabase/strategy';
import { buildPlanData } from '@/utils/export/buildPlanData';
import { applyMidtermPatch, mergeMidtermStrategyIntoDocumentEdits } from './finalDocument';
import type { StoryChapter } from '@/types/strategy';

const chapters = (body: string): StoryChapter[] => [
  { title: '第1章：なぜ今', body },
  { title: '第2章：どこで', body: '2章' },
  { title: '第3章：どんな未来', body: '3章' },
  { title: '第4章：どう行動', body: '4章' },
];

const view = (edits: any, top: any) => mergeMidtermStrategyIntoDocumentEdits(edits, top)?.midtermStrategy;

const persist = (state: any) => {
  const row = buildDbRowFromState(state);
  return buildStateFromDbRow({ ...row, id: 'strategy-1', company_id: 'company-1', revision: 1 }) as any;
};

const confirmedRecord = {
  confirmed: {
    conclusion: '確定結論',
    assumptions: { external: [], internal: [], implications: [] },
    confirmedAt: '2026-11-11T00:00:00.000Z',
  },
};

describe('再生成時の中計の編集値保護（①編集済み・②空欄・③未編集）', () => {
  const generation1 = {
    midtermConcept: 'G1コンセプト',
    growthStrategy: 'G1成長戦略',
    portfolioPolicy: 'G1方針',
    priorityStrategicThemes: ['G1テーマ'],
  };
  const generation2 = {
    midtermConcept: 'G2コンセプト',
    growthStrategy: 'G2成長戦略',
    portfolioPolicy: 'G2方針',
    priorityStrategicThemes: ['G2テーマ'],
  };

  it('編集値は利用者の変更だけを保持し、生成値の差し替えは未編集の項目に反映される', () => {
    let edits: any = applyMidtermPatch(undefined, { midtermConcept: '利用者のコンセプト' });
    edits = applyMidtermPatch(edits, { growthStrategy: '', priorityStrategicThemes: [] });
    expect(Object.keys(edits.midtermStrategy).sort()).toEqual(['growthStrategy', 'midtermConcept', 'priorityStrategicThemes']);

    const saved = persist({ finalStoryFinal: chapters('確定本文'), midtermStrategy: generation1, stage2FinalDocumentEdits: { ...confirmedRecord, ...edits } });
    expect(view(saved.stage2FinalDocumentEdits, saved.midtermStrategy)).toEqual({
      midtermConcept: '利用者のコンセプト',
      growthStrategy: '',
      portfolioPolicy: 'G1方針',
      priorityStrategicThemes: [],
    });

    const regenerated = persist({
      finalStoryFinal: chapters('確定本文'),
      midtermStrategy: generation2,
      stage2FinalDocumentEdits: saved.stage2FinalDocumentEdits,
    });
    expect(Object.keys(regenerated.stage2FinalDocumentEdits.midtermStrategy).sort()).toEqual([
      'growthStrategy',
      'midtermConcept',
      'priorityStrategicThemes',
    ]);
    expect(view(regenerated.stage2FinalDocumentEdits, regenerated.midtermStrategy)).toEqual({
      midtermConcept: '利用者のコンセプト',
      growthStrategy: '',
      portfolioPolicy: 'G2方針',
      priorityStrategicThemes: [],
    });
  });

  it('経営計画書の出力も、利用者の編集・空欄を保持し、未編集の項目は再生成後の値になる', () => {
    const edits = applyMidtermPatch(
      applyMidtermPatch(undefined, { midtermConcept: '利用者のコンセプト' }),
      { growthStrategy: '' },
    );
    const state = persist({
      finalStoryFinal: chapters('確定本文'),
      midtermStrategy: generation2,
      stage2FinalDocumentEdits: { ...confirmedRecord, midtermStrategy: edits.midtermStrategy },
    });

    const planData = buildPlanData(state, 'bank');

    expect(planData.stage2?.midtermConcept).toBe('利用者のコンセプト');
    expect(planData.stage2?.growthStrategy).toBeFalsy();
    expect(planData.stage2?.portfolioPolicy).toBe('G2方針');
  });

  it('編集済みか判定できない古いデータ（中計全体が固定された編集値）は再生成で上書きされない', () => {
    const legacyEdits = {
      ...confirmedRecord,
      midtermStrategy: { ...generation1, midtermConcept: '旧の利用者コンセプト' },
    };
    const state = persist({
      finalStoryFinal: chapters('確定本文'),
      midtermStrategy: generation2,
      stage2FinalDocumentEdits: legacyEdits,
    });

    expect(view(state.stage2FinalDocumentEdits, state.midtermStrategy)).toEqual({
      ...generation1,
      midtermConcept: '旧の利用者コンセプト',
    });
  });
});
