import { buildDbRowFromState, buildStateFromDbRow } from './strategy';

/** 実際の保存は JSON 化されるため、undefined のキーは消えた状態で復元される */
const throughJson = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('事業セグメントの現在の事業展開地域の保存・復元', () => {
  const segments = [
    { id: 'seg-1', name: '製造事業', expansionScope: 'domestic' },
    { id: 'seg-2', name: '海外事業', expansionScope: 'overseas', overseasRegions: ['東南アジア', '中国'] },
    { id: 'seg-3', name: 'サービス事業', expansionScope: 'both', overseasRegions: ['北米'] },
    { id: 'seg-4', name: '新規事業' },
  ];

  it('3択・未入力・選択された国・地域を保存・復元で区別する（未入力はキーなし）', () => {
    const row = buildDbRowFromState({ businessSegments: segments } as any);
    const restored = buildStateFromDbRow(throughJson({ ...row, company_id: 'company-a' })) as any;
    const byId = Object.fromEntries(restored.businessSegments.map((s: any) => [s.id, s]));

    expect(byId['seg-1'].expansionScope).toBe('domestic');
    expect(byId['seg-2']).toMatchObject({ expansionScope: 'overseas', overseasRegions: ['東南アジア', '中国'] });
    expect(byId['seg-3']).toMatchObject({ expansionScope: 'both', overseasRegions: ['北米'] });
    expect('expansionScope' in byId['seg-4']).toBe(false);
  });

  it('旧版の自由入力は、読み込みと再保存で消えず、そのまま残る（勝手に消去しない）', () => {
    const legacy = [
      { id: 'seg-x', name: '旧事業', expansionScope: 'overseas', overseasRegionsNote: 'ベトナム、タイ' },
    ];
    const row = buildDbRowFromState({ businessSegments: legacy } as any);
    const restored = buildStateFromDbRow(throughJson({ ...row, company_id: 'company-a' })) as any;
    expect(restored.businessSegments[0]).toMatchObject({ overseasRegionsNote: 'ベトナム、タイ' });

    const resaved = buildStateFromDbRow(throughJson({ ...buildDbRowFromState(restored), company_id: 'company-a' })) as any;
    expect(resaved.businessSegments[0].overseasRegionsNote).toBe('ベトナム、タイ');
  });

  it('保存された事業セグメントは既存の scope・概要・顧客を消さない', () => {
    const legacy = [
      { id: 'seg-x', name: '旧事業', scope: '国内工場・製品製造', summary: '概要', keyCustomers: ['A社'] },
    ];
    const row = buildDbRowFromState({ businessSegments: legacy } as any);
    const restored = buildStateFromDbRow(throughJson({ ...row, company_id: 'company-a' })) as any;
    expect(restored.businessSegments[0]).toMatchObject({
      scope: '国内工場・製品製造',
      summary: '概要',
      keyCustomers: ['A社'],
    });
    expect(restored.businessSegments[0].expansionScope).toBeUndefined();
  });

  it('再保存しても地域設定は変わらない（自動保存の full replacement で消えない）', () => {
    const first = buildStateFromDbRow(
      throughJson({ ...buildDbRowFromState({ businessSegments: segments } as any), company_id: 'company-a' })
    ) as any;
    const resaved = buildDbRowFromState(first as any);
    const second = buildStateFromDbRow(throughJson({ ...resaved, company_id: 'company-a' })) as any;
    expect(second.businessSegments).toEqual(first.businessSegments);
  });

  it('会社Aの事業展開地域を会社Bの復元結果に混ぜない', () => {
    const companyA = buildStateFromDbRow({
      company_id: 'company-a',
      business_segments: [{ id: 'a1', name: 'A事業', expansionScope: 'overseas', overseasRegions: ['中国'] }],
    }) as any;
    const companyB = buildStateFromDbRow({
      company_id: 'company-b',
      business_segments: [{ id: 'b1', name: 'B事業', expansionScope: 'domestic' }],
    }) as any;
    expect(companyA.businessSegments[0].overseasRegions).toEqual(['中国']);
    expect(companyB.businessSegments[0].expansionScope).toBe('domestic');
    expect(JSON.stringify(companyB)).not.toContain('中国');
  });
});
