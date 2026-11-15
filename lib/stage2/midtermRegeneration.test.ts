import { buildDbRowFromState, buildStateFromDbRow } from '@/utils/supabase/strategy';
import { buildPlanData } from '@/utils/export/buildPlanData';
import { applyMidtermPatch, mergeMidtermStrategyIntoDocumentEdits, withMidtermSnapshot } from './finalDocument';
import type { StoryChapter } from '@/types/strategy';

const chapters = (body: string): StoryChapter[] => [
  { title: '第1章：なぜ今', body },
  { title: '第2章：どこで', body: '2章' },
  { title: '第3章：どんな未来', body: '3章' },
  { title: '第4章：どう行動', body: '4章' },
];

const confirmedRecord = {
  confirmed: {
    conclusion: '確定結論',
    assumptions: { external: [], internal: [], implications: [] },
    confirmedAt: '2026-11-11T00:00:00.000Z',
  },
};

// 新コードの読み方
const newReaderView = (edits: any, top: any) => mergeMidtermStrategyIntoDocumentEdits(edits, top)?.midtermStrategy;
// 旧コードの読み方（編集値の中計があればそれを、無ければトップレベルを表示する）
const oldReaderView = (edits: any, top: any) => edits?.midtermStrategy ?? top;

// 保存して再読込する（DBの行の往復）
const persist = (state: any) => {
  const row = buildDbRowFromState(state);
  return buildStateFromDbRow({ ...row, id: 'strategy-1', company_id: 'company-1', revision: 1 }) as any;
};

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

describe('再生成時の中計の編集値保護（①編集済み・②空欄・③未編集）', () => {
  // 利用者がコンセプトを編集し、成長戦略と重点テーマを空欄にした状態
  const userEdits = () => {
    const once = applyMidtermPatch(undefined, { midtermConcept: '利用者のコンセプト' });
    return applyMidtermPatch(once, { growthStrategy: '', priorityStrategicThemes: [] });
  };

  it('保存・再読込・再生成の後も、編集値と空欄は保持され、未編集の項目は新しい生成値になる（新コード）', () => {
    const saved = persist({
      finalStoryFinal: chapters('確定本文'),
      midtermStrategy: generation1,
      stage2FinalDocumentEdits: { ...confirmedRecord, ...withMidtermSnapshot(userEdits(), generation1) },
    });
    expect(newReaderView(saved.stage2FinalDocumentEdits, saved.midtermStrategy)).toEqual({
      midtermConcept: '利用者のコンセプト',
      growthStrategy: '',
      portfolioPolicy: 'G1方針',
      priorityStrategicThemes: [],
    });

    // 再生成：生成結果を反映した後に保存する
    const regenerated = persist({
      finalStoryFinal: chapters('確定本文'),
      midtermStrategy: generation2,
      stage2FinalDocumentEdits: withMidtermSnapshot(saved.stage2FinalDocumentEdits, generation2),
    });
    expect(newReaderView(regenerated.stage2FinalDocumentEdits, regenerated.midtermStrategy)).toEqual({
      midtermConcept: '利用者のコンセプト',
      growthStrategy: '',
      portfolioPolicy: 'G2方針',
      priorityStrategicThemes: [],
    });
  });

  it('旧コードが読んでも、未編集の項目が空にならず、編集と空欄は保たれる（後方互換）', () => {
    const saved = persist({
      finalStoryFinal: chapters('確定本文'),
      midtermStrategy: generation1,
      stage2FinalDocumentEdits: { ...confirmedRecord, ...withMidtermSnapshot(userEdits(), generation1) },
    });
    const regenerated = persist({
      finalStoryFinal: chapters('確定本文'),
      midtermStrategy: generation2,
      stage2FinalDocumentEdits: withMidtermSnapshot(saved.stage2FinalDocumentEdits, generation2),
    });

    expect(oldReaderView(regenerated.stage2FinalDocumentEdits, regenerated.midtermStrategy)).toEqual({
      midtermConcept: '利用者のコンセプト',
      growthStrategy: '',
      portfolioPolicy: 'G2方針',
      priorityStrategicThemes: [],
    });
  });

  it('経営計画書の出力も、編集・空欄を保持し、未編集の項目は再生成後の値になる', () => {
    const state = persist({
      finalStoryFinal: chapters('確定本文'),
      midtermStrategy: generation2,
      stage2FinalDocumentEdits: { ...confirmedRecord, ...withMidtermSnapshot(userEdits(), generation1) },
    });

    const planData = buildPlanData(state, 'bank');

    expect(planData.stage2?.midtermConcept).toBe('利用者のコンセプト');
    expect(planData.stage2?.growthStrategy).toBeFalsy();
    expect(planData.stage2?.portfolioPolicy).toBe('G2方針');
  });

  it('編集した項目の記録が無い古いデータ（中計全体が固定された編集値）は、再生成で上書きされない', () => {
    const legacyEdits = {
      ...confirmedRecord,
      midtermStrategy: { ...generation1, midtermConcept: '旧の利用者コンセプト' },
    };
    const state = persist({
      finalStoryFinal: chapters('確定本文'),
      midtermStrategy: generation2,
      stage2FinalDocumentEdits: withMidtermSnapshot(legacyEdits, generation2),
    });

    expect(newReaderView(state.stage2FinalDocumentEdits, state.midtermStrategy)).toEqual({
      ...generation1,
      midtermConcept: '旧の利用者コンセプト',
    });
    expect(state.stage2FinalDocumentEdits.midtermEditedKeys).toBeUndefined();
  });
});
