import { DX_AI_DISCOVERY_RULE_STAGE3, DX_AI_DISCOVERY_RULES_STAGE2 } from './dxAiDiscovery';

describe('解決手段の思考プロセス（STAGE2・3の生成ルール）', () => {
  it('STAGE2は、課題の特定から手段の反映までの6段階を順に示す', () => {
    for (const step of ['① 経営課題を特定する', '② 変えるべき業務を特定する', '③ 現在、人が行っている作業を洗い出す', '④ デジタル技術やAIによる代替・自動化・高度化の可能性を検討する', '⑤ 費用対効果・実現可能性を判断する', '⑥ 有効な手段を戦略に反映する']) {
      expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain(step);
    }
  });

  it('STAGE2は、DX・AIを強制せず、業務改革でも人が行うことを前提にしない', () => {
    expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain('DX・AIの提案は強制しない');
    expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain('人がその業務を行うことを当然の前提にしない');
    expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain('DX・AIが有効でなければ、業務改革・人材育成・組織連携');
  });

  it('STAGE2は、入力にない数値を作らず、書けない項目は未確認とする', () => {
    expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain('入力にない金額・効果率・導入件数・期間を作らない');
    expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain('「（未確認）」');
  });

  it('STAGE3は、計画の前に同じ順で確かめ、代替が有効な場合だけ変え方と検証指標を書く', () => {
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('計画を作る前に、次の順で確かめる');
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('代替・高度化が有効だと入力から言える場合');
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('DX・AIの導入そのものを成果としない');
  });

  it('業種や部門を限定する語を含まない（汎用のルール）', () => {
    const all = `${DX_AI_DISCOVERY_RULES_STAGE2}\n${DX_AI_DISCOVERY_RULE_STAGE3}`;
    for (const word of ['配送', '宅配', '新聞', 'ジャーナル']) {
      expect(all).not.toContain(word);
    }
  });
});
