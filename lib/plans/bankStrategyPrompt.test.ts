import { buildPlanData } from '@/utils/export/buildPlanData';
import {
  STAGE2_STORY_CHAR_LIMIT,
  STAGE3_DEPARTMENT_DISPLAY_LIMIT,
  STAGE4_PROJECT_DISPLAY_LIMIT,
  bankStage2Block,
  bankStage34Block,
} from './bankStrategyPrompt';

const revenueEffect = (mjpy: number) => ({
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  directAmountYen: mjpy * 1_000_000,
  amountBasis: 'ANNUAL',
  startYm: '2026-04',
  sourceNote: '架空',
  source: 'USER_INPUT',
  confirmed: true,
});

const chapter = (title: string, body: string) => ({ title, body });
const base = (extra: Record<string, unknown> = {}) => ({ companyName: 'テスト株式会社', departments: [], ...extra });

describe('STAGE2 確定戦略の取り込み', () => {
  it('確定版ストーリーを最優先で使い、版の区別を示す', () => {
    const plan = buildPlanData(
      base({
        finalStoryFinal: [chapter('確定章', '確定本文')],
        finalStoryEdited: [chapter('編集章', '編集本文')],
        finalStory: [chapter('旧章', '旧本文')],
      }),
      'bank',
    );
    expect(plan.stage2.confirmed!.storySource).toBe('FINAL');
    expect(plan.stage2.confirmed!.chapters[0]).toEqual({ title: '確定章', body: '確定本文' });
    expect(bankStage2Block(plan.stage2)).toContain('戦略ストーリーの版：確定版');
  });

  it('確定版がない場合は編集版を使い、確定とは扱わない表示にする', () => {
    const plan = buildPlanData(base({ finalStoryEdited: [chapter('編集章', '編集本文')] }), 'bank');
    expect(plan.stage2.confirmed!.storySource).toBe('EDITED');
    expect(bankStage2Block(plan.stage2)).toContain('確定版なし（編集版を参照。確定とは扱わない）');
  });

  it('全社戦略の結論は補助編集の結論を生成結果より優先する', () => {
    const plan = buildPlanData(
      base({
        stage2FinalDocumentEdits: { conclusion: '編集した結論' },
        stage2FinalGeneratedConclusion: '生成された結論',
      }),
      'bank',
    );
    expect(plan.stage2.confirmed!.conclusion).toBe('編集した結論');
  });

  it('顧客が選ぶ理由・成長戦略・利益戦略・判断基準を中計データから取り込む', () => {
    const plan = buildPlanData(
      base({
        finalStoryFinal: [chapter('章', '本文')],
        midtermStrategy: {
          growthStrategy: '成長戦略A',
          profitImprovementStrategy: '利益戦略B',
          managementMeetingIssues: ['経営会議の論点E'],
          companyWideDecisionCriteria: ['全社の判断基準F'],
          strategicCore: { customerValue: '顧客が選ぶ理由C', primaryShift: '既存からの転換D' },
        },
      }),
      'bank',
    );
    const block = bankStage2Block(plan.stage2);
    expect(block).toContain('顧客が当社を選ぶ理由・提供価値：顧客が選ぶ理由C');
    expect(block).toContain('既存事業からの転換の方向：既存からの転換D');
    expect(block).toContain('成長戦略：成長戦略A');
    expect(block).toContain('利益戦略：利益戦略B');
    expect(block).toContain('- 経営会議の論点E');
    expect(block).toContain('- 全社の判断基準F');
  });

  it('確定ストーリーはあるが個別項目が空の場合は、個別項目の未入力として区別する', () => {
    const plan = buildPlanData(base({ finalStoryFinal: [chapter('章', '本文')] }), 'bank');
    const block = bankStage2Block(plan.stage2);
    expect(block).toContain('全社戦略の結論：個別項目は未入力（確定ストーリー本文を参照）');
    expect(block).toContain('顧客が当社を選ぶ理由・提供価値：個別項目は未入力（確定ストーリー本文を参照）');
    expect(block).toContain('成長戦略：個別項目は未入力（確定ストーリー本文を参照）');
    expect(block).toContain('利益戦略：個別項目は未入力（確定ストーリー本文を参照）');
    expect(block).toContain('本文にも無い内容は記載しないこと');
  });

  it('確定版ストーリーも無い場合は、項目が未入力かつストーリー未作成であることを示す', () => {
    const plan = buildPlanData(base(), 'bank');
    const block = bankStage2Block(plan.stage2);
    expect(block).toContain('成長戦略：未入力（確定版の戦略ストーリーも未作成）');
    expect(block).toContain('戦略ストーリーが未作成のため、戦略の内容は確認できません');
  });

  it('戦略ストーリーが無い場合は未作成と示し、ストーリーを創作しない', () => {
    const plan = buildPlanData(base(), 'bank');
    const block = bankStage2Block(plan.stage2);
    expect(block).toContain('戦略ストーリーの版：未作成');
    expect(block).toContain('最終ストーリー：\n未入力');
  });

  it('長い最終ストーリーは上限で切り、省略を明示する', () => {
    const plan = buildPlanData(base({ finalStoryFinal: [chapter('章', 'あ'.repeat(STAGE2_STORY_CHAR_LIMIT + 500))] }), 'bank');
    const block = bankStage2Block(plan.stage2);
    expect(block).toContain('（ここから先は省略しています）');
    expect(block).not.toContain('あ'.repeat(STAGE2_STORY_CHAR_LIMIT + 1));
  });
});

describe('STAGE3・4 の件数表示と掲載範囲', () => {
  const departments = Array.from({ length: 12 }, (_, i) => ({
    name: `部門${i + 1}`,
    projects: [{ title: `部門${i + 1}の施策`, financeEffect: revenueEffect(1)}],
  }));
  const projects = Array.from({ length: 25 }, (_, i) => ({
    title: `施策${i + 1}`,
    financeEffect: revenueEffect(i + 1),
  }));

  it('部門は上限まで掲載し、全件数と掲載件数を明示する', () => {
    const block = bankStage34Block(buildPlanData(base({ departments }), 'bank'));
    expect(block).toContain(`部門：全12件のうち${STAGE3_DEPARTMENT_DISPLAY_LIMIT}件を掲載`);
    expect(block).toContain('- 部門10：');
    expect(block).not.toContain('- 部門11：');
  });

  it('施策は売上寄与の大きい順に上限まで掲載し、掲載範囲外を示す', () => {
    const block = bankStage34Block(buildPlanData(base({ departments: [{ name: '営業', projects }] }), 'bank'));
    expect(block).toContain(`施策：全25件のうち${STAGE4_PROJECT_DISPLAY_LIMIT}件を掲載`);
    expect(block.indexOf('- 施策25：')).toBeLessThan(block.indexOf('- 施策24：'));
    expect(block).not.toContain('- 施策1：');
    expect(block).toContain('掲載範囲外の部門・施策があります');
  });

  it('施策も部門も無い場合は未入力と書く', () => {
    const block = bankStage34Block(buildPlanData(base(), 'bank'));
    expect(block).toContain('部門：未入力');
    expect(block).toContain('施策：未入力');
  });
});
