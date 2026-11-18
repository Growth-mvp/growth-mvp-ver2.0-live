import { DX_AI_DISCOVERY_RULE_STAGE3, DX_AI_DISCOVERY_RULES_STAGE2 } from './dxAiDiscovery';

describe('DX・AI活用の発見ルール', () => {
  it('STAGE2は、DX・AIを前提にせず他の手段と比べ、6つの項目と未確認の扱いを求める', () => {
    for (const phrase of ['前提にせず', '人材育成・業務改革・組織連携', '解決する課題', '期待成果', '検証指標', '必要な経営資源', '実現条件', '（未確認）', '作らない']) {
      expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain(phrase);
    }
  });

  it('STAGE3は、DX・AIの導入そのものを成果にせず、比較の理由と検証指標を求める', () => {
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('他の手段と比べて採った理由');
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('DX・AIの導入そのものを成果としない');
  });
});
