import { DX_AI_DISCOVERY_RULE_STAGE3 } from './dxAiDiscovery';

describe('解決手段の思考プロセス（STAGE3の生成ルール）', () => {
  it('計画は戦略と既存の計画の要件を主とし、その補助として次の順で確かめる', () => {
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('計画を作る前に、戦略と既存の計画の要件を主とし、その実現を補うために次の順で確かめる');
    for (const step of ['①経営課題', '②変えるべき業務', '③その業務で人が行っている作業', '④その作業をデジタル技術やAIで代替・自動化・高度化できるか', '⑤費用対効果と実現可能性', '⑥有効な手段を計画に反映する']) {
      expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain(step);
    }
  });

  it('代替・高度化が有効だと入力から言える場合だけ、変え方と検証指標を書く', () => {
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('代替・高度化が有効だと入力から言える場合');
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('DX・AIの導入そのものを成果としない');
  });

  it('有効でなければ業務改革・人材育成・組織連携を書き、業務改革でも人が行うことを前提にしない', () => {
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('有効でなければ、業務改革・人材育成・組織連携');
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('人が行うことを前提にしない');
  });

  it('入力にない効果・金額・導入件数を作らない', () => {
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('入力に根拠がない効果・金額・導入件数は作らない');
  });

  it('業種や部門を限定する語を含まない（汎用のルール）', () => {
    for (const word of ['配送', '宅配', '新聞', 'ジャーナル']) {
      expect(DX_AI_DISCOVERY_RULE_STAGE3).not.toContain(word);
    }
  });
});
