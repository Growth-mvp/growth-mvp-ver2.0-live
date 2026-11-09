import { migrateV1ToV2 } from './migrate';

const base = () => ({
  provisionalPeriod: null,
  section1: { customerProblem: { text: 'a', basis: 'HYPOTHESIS', sourceRefs: [] } },
  section2: { actions: [{ order: 1, title: 't', ownerRole: 'r', dueYm: '2027-01', dependsOn: [], basis: 'PROPOSAL', sourceRefs: [], supportsKpiKeys: [] }] },
  section4: {
    financeItems: [
      {
        key: 'F1',
        inputs: {
          winRatePct: { value: null, basis: 'UNCONFIRMED', sourceRefs: [] },
          recoveryPeriod: { value: null, basis: 'UNCONFIRMED', sourceRefs: ['S2-DEC-1'] },
        },
      },
    ],
  },
  section5: { responsible: { name: null, basis: '担当者は未確認。' } },
  verificationItems: [
    'テキスト確認',
    { item: 'オブジェクト確認', confirmBy: '2026-12', sourceRefs: ['S3-ISSUE-1'] },
  ],
});

describe('migrateV1ToV2（保存済みの旧形式から、情報を消さずに移す）', () => {
  it('確認事項の文字列とオブジェクトを、同じ形式に統一し、本文と根拠を残す', () => {
    const { json } = migrateV1ToV2(base());
    expect(json.verificationItems[0]).toMatchObject({ item: 'テキスト確認', confirmBy: null, sourceRefs: [] });
    expect(json.verificationItems[1]).toMatchObject({ item: 'オブジェクト確認', confirmBy: '2026-12', sourceRefs: ['S3-ISSUE-1'] });
  });

  it('期限の早い3件を実行前の確認にし、それ以外は詳細にする（移行規則はログに残る）', () => {
    const v = base();
    v.verificationItems = ['a', 'b', 'c', 'd'].map((item, i) => ({ item, confirmBy: `2027-0${4 - i}`, sourceRefs: [] })) as any;
    const { json, log } = migrateV1ToV2(v);
    const prio = json.verificationItems.map((x: any) => x.priority);
    expect(prio).toEqual(['DETAIL', 'BEFORE_START', 'BEFORE_START', 'BEFORE_START']);
    expect(log.some((n) => n.action.includes('移行規則'))).toBe(true);
  });

  it('仮期間の文字列は終了年月を取り出し、原文を理由欄に残す', () => {
    const v = base();
    v.provisionalPeriod = '2026-12〜2027-09' as any;
    const { json } = migrateV1ToV2(v);
    expect(json.provisionalPeriod).toEqual({ endYm: '2027-09', reason: '（移行）2026-12〜2027-09' });
  });

  it('仮期間の余分な開始年月は、捨てずに理由欄へ移す', () => {
    const v = base();
    v.provisionalPeriod = { startYm: '2026-12', endYm: '2027-02', reason: '3か月' } as any;
    const { json } = migrateV1ToV2(v);
    expect(json.provisionalPeriod.endYm).toBe('2027-02');
    expect(json.provisionalPeriod.reason).toContain('2026-12');
    expect(json.provisionalPeriod.startYm).toBeUndefined();
  });

  it('財務の固定キーは、役割・ラベル・単位・根拠を持つ配列へ変換し、未知の入力も保持する', () => {
    const { json } = migrateV1ToV2(base());
    const inputs = json.section4.financeItems[0].inputs;
    expect(inputs).toEqual([
      expect.objectContaining({ role: 'WIN_RATE', label: '受注率', unit: '%', value: null, basis: 'UNCONFIRMED', confirmState: 'UNCONFIRMED' }),
      expect.objectContaining({ role: 'OTHER', label: '回収期間', unit: 'ヶ月', sourceRefs: ['S2-DEC-1'] }),
    ]);
  });

  it('自由記述の責任者の根拠は、note に移し、根拠区分は UNCONFIRMED にする', () => {
    const { json } = migrateV1ToV2(base());
    expect(json.section5.responsible).toEqual({ name: null, basis: 'UNCONFIRMED', note: '担当者は未確認。' });
  });

  it('v1 に無い障害と行動の因果は、補わず空（null）として残す', () => {
    const { json, log } = migrateV1ToV2(base());
    expect(json.section1.obstacles).toEqual([]);
    expect(json.section2.actions[0].mechanism).toBeNull();
    expect(log.map((n) => n.path)).toEqual(expect.arrayContaining(['section1.obstacles', 'section2.actions[0].mechanism']));
  });

  it('移行は元のオブジェクトを変更しない', () => {
    const v = base();
    const before = JSON.stringify(v);
    migrateV1ToV2(v);
    expect(JSON.stringify(v)).toBe(before);
  });
});
