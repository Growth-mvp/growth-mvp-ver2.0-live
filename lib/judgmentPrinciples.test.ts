import { CONSULTANT_PRINCIPLES, PLAN_ENGINE_PRINCIPLES, PLAN_ONLY_PRINCIPLES, renderConsultantPrincipleBlock } from './judgmentPrinciples';

describe('判断原則の共通化', () => {
  it('コンサルの原則は10件で、キーは重複しない', () => {
    expect(CONSULTANT_PRINCIPLES).toHaveLength(10);
    expect(new Set(CONSULTANT_PRINCIPLES.map((p) => p.key)).size).toBe(10);
  });

  it('計画エンジンは、再利用する原則と計画専用の原則を合わせて持つ', () => {
    const keys = PLAN_ENGINE_PRINCIPLES.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['企業価値', '全体最適', '目的と手段', '実行と成果', '認識のズレ', '組織の協働', '資金繰り']));
    expect(keys).toEqual(expect.arrayContaining(PLAN_ONLY_PRINCIPLES.map((p) => p.key)));
    expect(PLAN_ENGINE_PRINCIPLES).toHaveLength(10);
  });

  it('計画専用の原則は、コンサル側の原則に含まれない（新規に追加したもの）', () => {
    const consultantKeys = CONSULTANT_PRINCIPLES.map((p) => p.key);
    for (const p of PLAN_ONLY_PRINCIPLES) expect(consultantKeys).not.toContain(p.key);
  });

  it('コンサルの原則ブロックは、見出しと箇条書きを含む', () => {
    const block = renderConsultantPrincipleBlock();
    expect(block.startsWith('【経営判断の原則')).toBe(true);
    expect(block).toContain('\n- 資金繰りや財務の相談は、根拠なく組織変革の話にしない。');
  });
});
