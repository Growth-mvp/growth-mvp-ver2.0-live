import { buildDbRowFromState, buildStateFromDbRow } from '@/utils/supabase/strategy';
import { buildConfirmedDocumentEdits, mergeMidtermStrategyIntoDocumentEdits, toConfirmedEdits } from './finalDocument';
import type { StoryChapter } from '@/types/strategy';

const chapters = (body: string): StoryChapter[] => [
  { title: '第1章：なぜ今', body },
  { title: '第2章：どこで', body: '2章' },
  { title: '第3章：どんな未来', body: '3章' },
  { title: '第4章：どう行動', body: '4章' },
];

describe('確定版と中計編集値の保存・復元', () => {
  it('確定版スナップショット・中計の編集値・3段階の本文を保存して復元できる', () => {
    const topMidterm = { midtermConcept: '生成コンセプト', priorityStrategicThemes: ['生成テーマ'] };
    const draftEdits = mergeMidtermStrategyIntoDocumentEdits(
      { conclusion: '下書き結論', midtermStrategy: { midtermConcept: '編集コンセプト' } },
      topMidterm,
    );
    const confirmedEdits = buildConfirmedDocumentEdits({
      edits: draftEdits,
      aiGeneratedConclusion: 'AI結論',
      assumptions: { external: ['確定の前提'], internal: [], implications: [] },
      confirmedAt: '2026-11-11T00:00:00.000Z',
    });
    const state: any = {
      finalStoryDraft: chapters('AIたたき台'),
      finalStoryEdited: chapters('編集本文'),
      finalStoryFinal: chapters('確定本文'),
      finalStory: chapters('確定本文'),
      stage2FinalDocumentEdits: confirmedEdits,
      midtermStrategy: { ...topMidterm, midtermConcept: '編集コンセプト' },
    };

    const row = buildDbRowFromState(state);
    const reloaded: any = buildStateFromDbRow({ ...row, id: 'strategy-1', company_id: 'company-1', revision: 3 });

    expect(reloaded.finalStoryDraft).toEqual(chapters('AIたたき台'));
    expect(reloaded.finalStoryEdited).toEqual(chapters('編集本文'));
    expect(reloaded.finalStoryFinal).toEqual(chapters('確定本文'));
    expect(reloaded.stage2FinalDocumentEdits.confirmed).toEqual({
      conclusion: '下書き結論',
      assumptions: { external: ['確定の前提'], internal: [], implications: [] },
      confirmedAt: '2026-11-11T00:00:00.000Z',
    });
    expect(reloaded.stage2FinalDocumentEdits.midtermStrategy.midtermConcept).toBe('編集コンセプト');
    expect(reloaded.midtermStrategy.midtermConcept).toBe('編集コンセプト');
    expect(toConfirmedEdits(reloaded.stage2FinalDocumentEdits)?.conclusion).toBe('下書き結論');
  });
});
