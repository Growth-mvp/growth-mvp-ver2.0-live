import { DX_AI_DISCOVERY_RULE_STAGE3, DX_AI_DISCOVERY_RULES_STAGE2 } from './dxAiDiscovery';

describe('経営課題の解決手段の発見ルール', () => {
  it('STAGE2は、DX・AIに限らず手段を幅広く挙げ、人の業務の代替・高度化を探すよう求める', () => {
    for (const phrase of ['DX・AIに限らず', 'DX・AIを前提にしない', '業務改革・人材育成・組織連携', '人が行っている業務', 'AIやデジタル技術で代替・高度化', '期待される経営成果', '検証指標', '（未確認）', '作らない']) {
      expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain(phrase);
    }
  });

  it('STAGE2は、DX・AIを一律に採用・比較させない（根拠がない場合は無理に採らない）', () => {
    expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain('無理に採用せず');
    expect(DX_AI_DISCOVERY_RULES_STAGE2).toContain('判断に必要なときだけ');
  });

  it('STAGE3は、代替・高度化できる業務の変え方と検証指標を具体的に書かせ、DX・AIの導入そのものを成果にしない', () => {
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('人が行っている業務');
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('DX・AIの導入そのものを成果としない');
    expect(DX_AI_DISCOVERY_RULE_STAGE3).toContain('DX・AIを採らない場合の理由は要求しない');
  });
});
