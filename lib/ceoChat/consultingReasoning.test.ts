import { buildConsultingReasoningBlock, consultingEffort, selectConsultingPlan } from './consultingReasoning';

describe('重要な経営相談の推論方針', () => {
  it.each([
    ['なぜ当社の利益は伸びないのか？', 'diagnosis', 'medium'],
    ['新規事業に参入すべきか？', 'investment', 'high'],
    ['この事業から撤退すべきか？', 'investment', 'high'],
    ['営業部と製造部の対立をどう解消すべきか？', 'organization', 'medium'],
    ['今の経営戦略は妥当か？', 'strategy', 'medium'],
    ['今の経営戦略で3年後に成長できるか？', 'strategy', 'medium'],
    ['社長が今、最も優先すべきことは何か？', 'strategy', 'medium'],
    ['資金繰りが厳しくなったらどうすべきか？', 'finance', 'high'],
    ['進捗が未達の場合は何を優先すべきか？', 'execution', 'medium'],
  ])('%s', (question, focus, effort) => {
    const plan = selectConsultingPlan(question, true);
    expect(plan).toMatchObject({ focus, effort });
    expect(buildConsultingReasoningBlock(plan!)).toContain('反する根拠');
  });
  it.each(['こんにちは', '売上高を教えて', 'ROICとは？', '新規事業とは？', '資料を保存する方法は？'])('通常の質問は対象外：%s', question => {
    expect(selectConsultingPlan(question, true)).toBeNull();
  });
  it('操作・ファシリテーション・自律伴走等の対象外ルートは変えない', () => {
    expect(selectConsultingPlan('新規事業に参入すべきか？', false)).toBeNull();
  });
  it('参入判断には財務、戦略、部門、実績と計画の情報が必要', () => {
    expect(selectConsultingPlan('新規事業に参入すべきか？', true)?.sources).toEqual({
      finance: true, rationale: true, alignment: true, progress: true, plan: true,
    });
  });
  it('推論強化は明示的に有効化した場合のみ', () => {
    const plan = selectConsultingPlan('新規事業に参入すべきか？', true);
    expect(consultingEffort(plan, false)).toBe('low');
    expect(consultingEffort(plan, true)).toBe('high');
    expect(consultingEffort(null, true)).toBe('low');
  });
});
