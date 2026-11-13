import { buildDbRowFromState, buildStateFromDbRow } from '@/utils/supabase/strategy';
import { buildPlanData } from '@/utils/export/buildPlanData';
import {
  buildConfirmedDocumentEdits,
  buildStrategicAssumptions,
  findUnconfirmedChanges,
  markDraftChanged,
  mergeMidtermStrategyIntoDocumentEdits,
  pickDisplayedStory,
  resolveStrategicAssumptions,
  toConfirmedEdits,
} from './finalDocument';
import { runDocumentChecks } from './documentChecks';
import type { StoryChapter } from '@/types/strategy';

const chapters = (body: string): StoryChapter[] => [
  { title: '第1章：なぜ今', body },
  { title: '第2章：どこで', body: `${body}-2` },
  { title: '第3章：どんな未来', body: `${body}-3` },
  { title: '第4章：どう行動', body: `${body}-4` },
];

const companyTargets = [
  { id: 'rev', label: '売上', unit: '百万円', base: 12000, dueYear: 2029 },
  { id: 'op', label: '営業利益', unit: '百万円', base: 1500, dueYear: 2029 },
];

const topMidterm = { midtermConcept: '生成コンセプト', priorityStrategicThemes: ['旧テーマ'] };

/** 保存→再読み込み（DB行の往復）。AI結論は別の列（final_story_conclusion）で保存されるため、別経路で渡す */
function persistAndReload(state: any): any {
  const row = buildDbRowFromState(state);
  const reloaded = buildStateFromDbRow({ ...row, id: 'strategy-1', company_id: 'company-1', revision: 1 }) as any;
  return { ...reloaded, stage2FinalGeneratedConclusion: state.stage2FinalGeneratedConclusion };
}

/** 旧データ：確定スナップショット・下書きの印が無い、従来の確定済み戦略 */
function legacyConfirmedState(): any {
  return persistAndReload({
    companyTargets,
    finalStoryDraft: chapters('AIたたき台'),
    finalStoryEdited: chapters('旧の編集'),
    finalStoryFinal: chapters('旧確定本文'),
    finalStory: chapters('旧確定本文'),
    stage2FinalGeneratedConclusion: 'AI結論',
    stage2FinalDocumentEdits: {
      conclusion: '旧の編集結論',
      midtermStrategy: { ...topMidterm, priorityStrategicThemes: ['旧テーマ'] },
    },
    midtermStrategy: topMidterm,
  });
}

describe('旧データ（確定スナップショットなし）', () => {
  it('確定状態を維持し、未確定扱いにしない。保存済みの結論を使い、固定文で補完しない', () => {
    const legacy = legacyConfirmedState();

    expect(legacy.finalStoryFinal).toEqual(chapters('旧確定本文'));
    expect(
      findUnconfirmedChanges({
        finalStoryFinal: legacy.finalStoryFinal,
        finalStoryEdited: legacy.finalStoryEdited,
        edits: legacy.stage2FinalDocumentEdits,
        midtermStrategy: legacy.midtermStrategy,
        aiGeneratedConclusion: legacy.stage2FinalGeneratedConclusion,
      }),
    ).toEqual({ chapters: false, document: false, midtermStrategy: false });
    expect(toConfirmedEdits(legacy.stage2FinalDocumentEdits)?.conclusion).toBe('旧の編集結論');
  });

  it('確定後に下書きを保存すると、確定版は変わらず、編集内容は再読み込み後も表示される', () => {
    const legacy = legacyConfirmedState();
    const saved = persistAndReload({
      ...legacy,
      finalStoryEdited: chapters('下書き本文'),
      stage2FinalDocumentEdits: markDraftChanged(
        mergeMidtermStrategyIntoDocumentEdits(
          {
            ...legacy.stage2FinalDocumentEdits,
            conclusion: '下書きの結論',
            assumptions: { external: ['下書きの前提'] },
            midtermStrategy: { ...topMidterm, midtermConcept: '下書きコンセプト' },
          },
          legacy.midtermStrategy,
        ),
        '2026-11-11T01:00:00.000Z',
      ),
      finalStory: legacy.finalStory,
    });

    expect(saved.finalStoryFinal).toEqual(chapters('旧確定本文'));
    expect(saved.finalStory[0].body).toBe('旧確定本文');
    const unconfirmed = findUnconfirmedChanges({
      finalStoryFinal: saved.finalStoryFinal,
      finalStoryEdited: saved.finalStoryEdited,
      edits: saved.stage2FinalDocumentEdits,
      midtermStrategy: saved.midtermStrategy,
      aiGeneratedConclusion: saved.stage2FinalGeneratedConclusion,
    });
    expect(unconfirmed).toEqual({ chapters: true, document: true, midtermStrategy: true });
    expect(pickDisplayedStory(saved, unconfirmed)).toEqual(chapters('下書き本文'));

    const plan = buildPlanData({ ...saved, stage2FinalGeneratedConclusion: 'AI結論' }, 'bank');
    expect(plan.stage2?.confirmed?.conclusion).toBe('AI結論');
    expect(plan.stage2?.confirmed?.growthStrategy).toBeUndefined();
    expect(toConfirmedEdits(saved.stage2FinalDocumentEdits)).toEqual({});
  });
});

describe('確定版の再確定（旧データ→下書き→再確定）', () => {
  it('再確定で編集内容が確定版・確定スナップショット・STAGE3入力・計画書に揃い、STAGE4・STAGE6の値は変わらない', () => {
    const legacy = legacyConfirmedState();
    const saved = persistAndReload({
      ...legacy,
      finalStoryEdited: chapters('下書き本文'),
      stage2FinalDocumentEdits: markDraftChanged(
        mergeMidtermStrategyIntoDocumentEdits(
          { conclusion: '下書きの結論', midtermStrategy: { ...topMidterm, priorityStrategicThemes: ['下書きテーマ'] } },
          legacy.midtermStrategy,
        ),
        '2026-11-11T01:00:00.000Z',
      ),
    });

    // 再確定：表示中の内容（未確定の編集を含む）を確定し、確定時点の値を保存する
    const toConfirm = pickDisplayedStory(saved, findUnconfirmedChanges({
      finalStoryFinal: saved.finalStoryFinal,
      finalStoryEdited: saved.finalStoryEdited,
      edits: saved.stage2FinalDocumentEdits,
      midtermStrategy: saved.midtermStrategy,
    }));
    const draftEdits = mergeMidtermStrategyIntoDocumentEdits(saved.stage2FinalDocumentEdits, saved.midtermStrategy);
    const assumptions = resolveStrategicAssumptions(
      draftEdits?.assumptions,
      buildStrategicAssumptions({ midtermStrategy: draftEdits?.midtermStrategy }),
    );
    const confirmedEdits = buildConfirmedDocumentEdits({
      edits: draftEdits,
      aiGeneratedConclusion: 'AI結論',
      assumptions,
      confirmedAt: '2026-11-11T02:00:00.000Z',
    });
    const reconfirmed = persistAndReload({
      ...saved,
      finalStoryFinal: toConfirm,
      finalStoryEdited: toConfirm,
      finalStory: toConfirm,
      stage2FinalDocumentEdits: confirmedEdits,
      midtermStrategy: confirmedEdits.midtermStrategy ?? saved.midtermStrategy,
    });

    expect(reconfirmed.finalStoryFinal).toEqual(chapters('下書き本文'));
    expect(reconfirmed.stage2FinalDocumentEdits.confirmed?.conclusion).toBe('下書きの結論');
    expect(reconfirmed.stage2FinalDocumentEdits.draftChangedAt).toBeUndefined();
    expect(
      findUnconfirmedChanges({
        finalStoryFinal: reconfirmed.finalStoryFinal,
        finalStoryEdited: reconfirmed.finalStoryEdited,
        edits: reconfirmed.stage2FinalDocumentEdits,
        midtermStrategy: reconfirmed.midtermStrategy,
        aiGeneratedConclusion: 'AI結論',
      }),
    ).toEqual({ chapters: false, document: false, midtermStrategy: false });

    // STAGE3ブリッジ（再確定の入力）と計画書は、再確定内容を参照する
    expect(toConfirmedEdits(reconfirmed.stage2FinalDocumentEdits)?.conclusion).toBe('下書きの結論');
    expect(reconfirmed.midtermStrategy.priorityStrategicThemes).toEqual(['下書きテーマ']);
    const plan = buildPlanData({ ...reconfirmed, stage2FinalGeneratedConclusion: 'AI結論' }, 'bank');
    expect(plan.stage2?.confirmed?.conclusion).toBe('下書きの結論');
    expect(plan.stage2?.confirmed?.decisionCriteria).toBeUndefined();

    // STAGE4の確定本文と、STAGE6・KPIの元データは書き換わらない
    expect(reconfirmed.finalStory[0].body).toBe('下書き本文');
    expect(reconfirmed.companyTargets).toEqual(companyTargets.map((t) => ({ ...t, rationale: '', linkedIssueIds: [] })));
  });
});

describe('初回確定前のドラフト', () => {
  it('確定版として扱わず、計画書では確定版なしの参照（storySource=DRAFT）として区別する', () => {
    const draftOnly = persistAndReload({
      finalStoryDraft: chapters('AIたたき台'),
      finalStoryFinal: [],
      stage2FinalGeneratedConclusion: 'AI結論',
      stage2FinalDocumentEdits: { conclusion: '未確定の下書き結論' },
      midtermStrategy: topMidterm,
    });

    expect(
      findUnconfirmedChanges({ finalStoryFinal: draftOnly.finalStoryFinal, edits: draftOnly.stage2FinalDocumentEdits }),
    ).toEqual({ chapters: false, document: false, midtermStrategy: false });
    expect(pickDisplayedStory(draftOnly, { chapters: false, document: false, midtermStrategy: false })).toEqual(
      chapters('AIたたき台'),
    );
    const plan = buildPlanData({ ...draftOnly }, 'bank');
    expect(plan.stage2?.confirmed?.storySource).toBe('DRAFT');
    expect(plan.stage2?.confirmed?.conclusion).toBe('未確定の下書き結論');
  });
});

describe('生成直後の未確定案（リロード前後で同じ案・同じ検査結果）', () => {
  const oldFinal = (): StoryChapter[] => [
    { title: '第1章：なぜ今', body: '旧確定本文。2030年度に売上130億円、営業利益5億円を実現する。STAGE3では事業別の役割を定義する。' },
    { title: '第2章：どこで', body: '旧確定本文2' },
    { title: '第3章：どんな未来', body: '旧確定本文3' },
    { title: '第4章：どう行動', body: '旧確定本文4' },
  ];
  const newDraft = (): StoryChapter[] => [
    { title: '第1章：なぜ今', body: '新しい案。2030年度に売上120億円、営業利益0.5億円を実現する。' },
    { title: '第2章：どこで', body: '新しい案2' },
    { title: '第3章：どんな未来', body: '新しい案3' },
    { title: '第4章：どう行動', body: '新しい案4' },
  ];
  const companyTargetsForCheck = [
    { id: 'rev', label: '売上', unit: '百万円', base: 12000, dueYear: 2030 },
    { id: 'op', label: '営業利益', unit: '百万円', base: 50, dueYear: 2030 },
  ] as any;

  it('確定版がある状態で生成した未確定案は、リロード後も同じ案を表示し、検査結果も変わらない', () => {
    // 生成・保存直後の状態（未確定案は現在の版として保存され、確定版は変わらない）
    const afterGenerate = {
      finalStoryFinal: oldFinal(),
      finalStoryDraft: newDraft(),
      finalStoryEdited: newDraft(),
      stage2FinalDocumentEdits: { draftChangedAt: '2026-11-11T03:00:00.000Z' },
      midtermStrategy: undefined,
    };
    const beforeReload = pickDisplayedStory(afterGenerate, findUnconfirmedChanges({ finalStoryFinal: afterGenerate.finalStoryFinal, finalStoryEdited: afterGenerate.finalStoryEdited, edits: afterGenerate.stage2FinalDocumentEdits }));
    const reloaded = persistAndReload(afterGenerate);
    const afterReload = pickDisplayedStory(reloaded, findUnconfirmedChanges({ finalStoryFinal: reloaded.finalStoryFinal, finalStoryEdited: reloaded.finalStoryEdited, edits: reloaded.stage2FinalDocumentEdits }));

    expect(afterReload.map((c) => c.body)).toEqual(beforeReload.map((c) => c.body));
    expect(afterReload[0].body).toContain('新しい案');

    const checks = (chapters: StoryChapter[]) =>
      runDocumentChecks({ chapters, conclusion: '', midtermStrategy: undefined, companyTargets: companyTargetsForCheck });
    expect(checks(afterReload)).toEqual(checks(beforeReload));
    expect(checks(afterReload).filter((i) => i.kind === 'target_mismatch' || i.kind === 'internal_term')).toEqual([]);

    expect(reloaded.finalStoryFinal.map((c: StoryChapter) => c.body)).toEqual(oldFinal().map((c) => c.body));
  });
});
