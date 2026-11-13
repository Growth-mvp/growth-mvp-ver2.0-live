import {
  buildConfirmedDocumentEdits,
  buildStrategicAssumptions,
  findUnconfirmedChanges,
  mergeMidtermStrategyIntoDocumentEdits,
  pickFinancialTargets,
  resolveConclusion,
  resolveStrategicAssumptions,
  toConfirmedEdits,
  withStoredConfirmedRecord,
} from './finalDocument';
import type { CompanyTarget, Stage2FinalDocumentEdits, StoryChapter } from '@/types/strategy';

const chapters = (body: string): StoryChapter[] => [
  { title: '第1章：なぜ今', body },
  { title: '第2章：どこで戦うか', body: '2章' },
  { title: '第3章：どんな未来か', body: '3章' },
  { title: '第4章：どう行動するか', body: '4章' },
];

const topMidterm = {
  midtermConcept: '生成されたコンセプト',
  targetVisionForMidterm: '生成された目指す姿',
  priorityStrategicThemes: ['生成テーマ'],
  growthStrategy: '生成成長戦略',
};

describe('mergeMidtermStrategyIntoDocumentEdits', () => {
  it('利用者の編集値を、同じキーのトップレベル生成値より優先する', () => {
    const edits: Stage2FinalDocumentEdits = {
      midtermStrategy: { midtermConcept: '編集したコンセプト' },
    };
    const merged = mergeMidtermStrategyIntoDocumentEdits(edits, topMidterm);

    expect(merged?.midtermStrategy?.midtermConcept).toBe('編集したコンセプト');
    expect(merged?.midtermStrategy?.targetVisionForMidterm).toBe('生成された目指す姿');
    expect(merged?.midtermStrategy?.priorityStrategicThemes).toEqual(['生成テーマ']);
  });

  it('編集値がなければトップレベルの中計を使い、中計が無ければ編集値をそのまま返す', () => {
    expect(mergeMidtermStrategyIntoDocumentEdits(undefined, topMidterm)?.midtermStrategy).toEqual(topMidterm);
    const edits: Stage2FinalDocumentEdits = { conclusion: '結論' };
    expect(mergeMidtermStrategyIntoDocumentEdits(edits, undefined)).toBe(edits);
    expect(mergeMidtermStrategyIntoDocumentEdits(undefined, undefined)).toBeUndefined();
  });
});

describe('withStoredConfirmedRecord', () => {
  const confirmed = { conclusion: '確定した結論', assumptions: {}, confirmedAt: '2026-11-01T00:00:00.000Z' };

  it('編集内容に確定記録が無ければ、保存済みの確定記録を引き継ぐ', () => {
    const edits: Stage2FinalDocumentEdits = { conclusion: '編集中の結論' };
    const result = withStoredConfirmedRecord(edits, { confirmed });
    expect(result?.confirmed).toEqual(confirmed);
    expect(result?.conclusion).toBe('編集中の結論');
  });

  it('保存済みの確定記録が無ければ、編集内容をそのまま返す', () => {
    const edits: Stage2FinalDocumentEdits = { draftChangedAt: '2026-11-12T00:00:00.000Z' };
    expect(withStoredConfirmedRecord(edits, undefined)).toBe(edits);
    expect(withStoredConfirmedRecord(undefined, { draftChangedAt: '2026-11-12T00:00:00.000Z' })).toBeUndefined();
  });

  it('編集内容に確定記録があれば、それを優先する', () => {
    const own = { ...confirmed, conclusion: '新しく確定した結論' };
    expect(withStoredConfirmedRecord({ confirmed: own }, { confirmed })?.confirmed).toEqual(own);
  });
});

describe('resolveConclusion', () => {
  it('編集値 > AI生成 の順で返し、どちらも無ければ空文字を返す（固定文は補完しない）', () => {
    expect(resolveConclusion('編集', 'AI')).toBe('編集');
    expect(resolveConclusion('  ', 'AI')).toBe('AI');
    expect(resolveConclusion(undefined, undefined)).toBe('');
  });
});

describe('buildStrategicAssumptions', () => {
  it('SWOTと成長戦略だけから作り、汎用の補完文は入れない', () => {
    const result = buildStrategicAssumptions({
      swotSuggestions: { opportunity: ['海外需要の拡大'], threat: [] },
      swotData: { strengths: ['独自の製造技術'], weaknesses: [] },
      midtermStrategy: { growthStrategy: '国内既存顧客の深耕' },
    });

    expect(result.external).toEqual(['海外需要の拡大']);
    expect(result.internal).toEqual(['独自の製造技術']);
    expect(result.implications).toEqual(['国内既存顧客の深耕']);
  });

  it('根拠が無い場合は空配列にする', () => {
    expect(buildStrategicAssumptions({})).toEqual({ external: [], internal: [], implications: [] });
  });
});

describe('resolveStrategicAssumptions', () => {
  const computed = { external: ['計算値'], internal: [], implications: [] };

  it('編集値があれば編集値を使い、無ければ計算値を使う', () => {
    expect(resolveStrategicAssumptions({ external: ['編集'] }, computed).external).toEqual(['編集']);
    expect(resolveStrategicAssumptions(undefined, computed)).toBe(computed);
  });
});

describe('確定版スナップショット', () => {
  const edits: Stage2FinalDocumentEdits = {
    conclusion: '下書きの結論',
    assumptions: { external: ['下書きの外部環境'] },
    midtermStrategy: { midtermConcept: '下書きのコンセプト' },
  };

  it('確定時点の結論と前提を保存し、下流は確定版だけを読む', () => {
    const confirmed = buildConfirmedDocumentEdits({
      edits,
      aiGeneratedConclusion: 'AIの結論',
      assumptions: { external: ['確定の外部環境'], internal: [], implications: [] },
      confirmedAt: '2026-11-11T00:00:00.000Z',
    });

    expect(toConfirmedEdits(confirmed)).toEqual({
      conclusion: '下書きの結論',
      assumptions: { external: ['確定の外部環境'], internal: [], implications: [] },
    });
  });

  it('確定版が無い従来データは、編集値をそのまま返す（互換）', () => {
    expect(toConfirmedEdits(edits)).toBe(edits);
    expect(toConfirmedEdits(undefined)).toBeUndefined();
  });

  it('確定後に下書きを変えても、下流の確定版は変わらない', () => {
    const confirmed = buildConfirmedDocumentEdits({
      edits,
      assumptions: { external: [], internal: [], implications: [] },
      confirmedAt: '2026-11-11T00:00:00.000Z',
    });
    const afterDraft: Stage2FinalDocumentEdits = { ...confirmed, conclusion: '未確定の変更' };

    expect(toConfirmedEdits(afterDraft)?.conclusion).toBe('下書きの結論');
  });
});

describe('findUnconfirmedChanges', () => {
  const confirmedChapters = chapters('確定本文');
  const confirmedEdits = buildConfirmedDocumentEdits({
    edits: { conclusion: '確定結論', midtermStrategy: { ...topMidterm } },
    assumptions: { external: ['確定'], internal: [], implications: [] },
    confirmedAt: '2026-11-11T00:00:00.000Z',
  });

  it('確定版が無ければ差分判定の対象外', () => {
    expect(
      findUnconfirmedChanges({ finalStoryFinal: [], finalStoryEdited: chapters('x'), edits: { conclusion: 'y' } }),
    ).toEqual({ chapters: false, document: false, midtermStrategy: false });
  });

  it('差分が無ければすべて false', () => {
    expect(
      findUnconfirmedChanges({
        finalStoryFinal: confirmedChapters,
        finalStoryEdited: confirmedChapters,
        edits: confirmedEdits,
        midtermStrategy: topMidterm,
      }),
    ).toEqual({ chapters: false, document: false, midtermStrategy: false });
  });

  it('確定後の本文編集を未確定として検出する', () => {
    expect(
      findUnconfirmedChanges({
        finalStoryFinal: confirmedChapters,
        finalStoryEdited: chapters('編集した本文'),
        edits: confirmedEdits,
        midtermStrategy: topMidterm,
      }).chapters,
    ).toBe(true);
  });

  it('確定後の結論編集を未確定として検出する', () => {
    expect(
      findUnconfirmedChanges({
        finalStoryFinal: confirmedChapters,
        finalStoryEdited: confirmedChapters,
        edits: { ...confirmedEdits, conclusion: '編集した結論' },
        midtermStrategy: topMidterm,
      }).document,
    ).toBe(true);
  });

  it('確定後の中計編集を未確定として検出する', () => {
    expect(
      findUnconfirmedChanges({
        finalStoryFinal: confirmedChapters,
        finalStoryEdited: confirmedChapters,
        edits: { ...confirmedEdits, midtermStrategy: { ...topMidterm, midtermConcept: '編集' } },
        midtermStrategy: topMidterm,
      }).midtermStrategy,
    ).toBe(true);
  });
});

describe('pickFinancialTargets', () => {
  const target = (overrides: Partial<CompanyTarget>): CompanyTarget => ({
    id: 'id',
    label: '売上',
    unit: '百万円',
    base: 1000,
    dueYear: 2029,
    ...overrides,
  } as CompanyTarget);

  it('売上と営業利益を、保存された単位と年度のまま返す', () => {
    const result = pickFinancialTargets([
      target({ label: '売上', base: 12000, unit: '百万円', dueYear: 2029 }),
      target({ label: '営業利益', base: 1.5, unit: '億円', dueYear: 2029 }),
    ]);

    expect(result.revenue).toEqual({ label: '売上', base: 12000, unit: '百万円', dueYear: 2029 });
    expect(result.operatingProfit).toEqual({ label: '営業利益', base: 1.5, unit: '億円', dueYear: 2029 });
  });

  it('営業利益率は営業利益として扱わず、単位や数値が無い目標は除外する', () => {
    const result = pickFinancialTargets([
      target({ label: '営業利益率', base: 8, unit: '%' }),
      target({ label: '営業利益', base: 5, unit: '' }),
    ]);

    expect(result.operatingProfit).toBeUndefined();
    expect(result.revenue).toBeUndefined();
  });
});
