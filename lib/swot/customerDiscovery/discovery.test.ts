import { buildCandidatePool } from '../candidatePool';
import { extractBuyers } from './buyers';
import { DISCOVERY_PER_BUYER_MAX, DISCOVERY_SCHEMA, DISCOVERY_TOTAL_MAX, buildDiscoveryInput, DISCOVERY_INSTRUCTIONS } from './prompt';
import { resolveNeedRoute, isCustomerDiscoveryV2Enabled } from './flags';
import { validateDiscoveryProblems } from './validate';
import { toDiscoveryInsight } from './toInsight';

const BUYERS = [
  { ref: 1, label: '商業施設事業者', segments: ['商業その他施設事業'] },
  { ref: 2, label: '外食チェーン', segments: ['チェーンストア事業'] },
];

const item = (over: Record<string, unknown> = {}) => ({
  buyer_ref: 1,
  subject: 'buyer',
  text: '商業施設を運営する経営者が、テナントの売上低下に気づくのが遅れ、対策の判断に迷っている。',
  why_unsolved: '不明',
  ...over,
});

describe('課題生成の指示とスキーマ', () => {
  it('会社の製品・強みを渡さず、購入者の番号と名称だけを入力にする', () => {
    const input = buildDiscoveryInput(BUYERS);
    expect(input).toBe('# 購入者（番号付き）\n1. 商業施設事業者\n2. 外食チェーン');
    expect(input).not.toMatch(/強み|製品|サービス|施工/);
  });

  it('課題の出力は、機会の欄や能力の欄を持たない', () => {
    const props = Object.keys((DISCOVERY_SCHEMA.properties.problems.items as { properties: object }).properties);
    expect(props).toEqual(['buyer_ref', 'subject', 'text', 'why_unsolved']);
    expect(DISCOVERY_SCHEMA.properties.problems.maxItems).toBe(DISCOVERY_TOTAL_MAX);
  });

  it('指示は、事業機会・施策・会社の能力を書かせない', () => {
    expect(DISCOVERY_INSTRUCTIONS).toContain('事業機会・施策・提供形態・特定の企業の能力を書かないでください');
    expect(DISCOVERY_INSTRUCTIONS).toContain('入力に示された購入者以外の購入者を作らないでください');
  });

  it('指示は、諦めている問題・表面化しにくい問題と、関係者の課題を含め、購入者ごとの最低1件と主題の重複抑制を求める', () => {
    expect(DISCOVERY_INSTRUCTIONS).toContain('本人が仕方がないと諦めていること');
    expect(DISCOVERY_INSTRUCTIONS).toContain('顧客や現場の声として表面化しにくい問題');
    expect(DISCOVERY_INSTRUCTIONS).toContain('購入者の成果に影響する関係者');
    expect(DISCOVERY_INSTRUCTIONS).toContain('根拠を説明できる課題がある購入者には、必ず1件以上');
    expect(DISCOVERY_INSTRUCTIONS).toContain('同じ主題（同じ種類の困りごと）を、複数の購入者に書かないでください');
  });
});

describe('形式の検査（空欄・長さ・購入者番号・重複・件数）', () => {
  it('形式が正しい課題は、そのまま残す（中身では除外しない）', () => {
    const r = validateDiscoveryProblems({ problems: [item(), item({ buyer_ref: 2, text: '別の困りごと。', subject: 'stakeholder' })] }, 2);
    expect(r.items).toHaveLength(2);
    expect(r.items[1]).toMatchObject({ buyerRef: 2, subject: 'stakeholder' });
    expect(Object.values(r.dropped).every((v) => v === 0)).toBe(true);
  });

  it('空欄・長すぎる文・存在しない購入者番号・形式の誤りを、それぞれ数えて捨てる', () => {
    const r = validateDiscoveryProblems(
      {
        problems: [
          item({ text: '   ' }),
          item({ text: 'あ'.repeat(201) }),
          item({ buyer_ref: 9 }),
          item({ buyer_ref: 0 }),
          { buyer_ref: 1, subject: 'other', text: 'x', why_unsolved: '' },
          item(),
        ],
      },
      2
    );
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toMatchObject({ blank: 1, tooLong: 1, badBuyerRef: 2, malformed: 1, duplicate: 0 });
  });

  it('同じ文は重複として1件にする（空白の違いは同じとみなす）', () => {
    const r = validateDiscoveryProblems({ problems: [item(), item({ text: '  ' + item().text.replace(/。$/, '') + '。 ' })] }, 1);
    expect(r.items).toHaveLength(1);
    expect(r.dropped.duplicate).toBe(1);
  });

  it('購入者ごとの上限と、全体の上限を超える分を数える', () => {
    const many = Array.from({ length: 6 }, (_, i) => item({ text: `課題${i}の具体的な一文です。` }));
    const r = validateDiscoveryProblems({ problems: many }, 1);
    expect(r.items).toHaveLength(DISCOVERY_PER_BUYER_MAX);
    expect(r.dropped.perBuyerCap).toBe(6 - DISCOVERY_PER_BUYER_MAX);

    const spread = Array.from({ length: 20 }, (_, i) => item({ buyer_ref: (i % 10) + 1, text: `課題${i}の具体的な一文です。` }));
    const r2 = validateDiscoveryProblems({ problems: spread }, 10);
    expect(r2.items.length).toBeLessThanOrEqual(DISCOVERY_TOTAL_MAX);
  });

  it('全体の上限があっても、購入者ごとに1件は先に残す（後ろの購入者が0件にならない）', () => {
    const problems = [
      ...Array.from({ length: 8 }, (_, i) => [
        item({ buyer_ref: i + 1, text: `購入者${i + 1}の一件目の具体的な一文です。` }),
        item({ buyer_ref: i + 1, text: `購入者${i + 1}の二件目の具体的な一文です。` }),
      ]).flat(),
      ...Array.from({ length: 4 }, (_, i) => item({ buyer_ref: i + 9, text: `購入者${i + 9}の一件目の具体的な一文です。` })),
    ];
    const r = validateDiscoveryProblems({ problems }, 12);
    expect(r.items).toHaveLength(DISCOVERY_TOTAL_MAX);
    expect(new Set(r.items.map((p) => p.buyerRef))).toEqual(new Set(Array.from({ length: 12 }, (_, i) => i + 1)));
    expect(r.dropped.totalCap).toBe(4);
  });

  it('残す課題は、モデルが出力した順番を保つ', () => {
    const r = validateDiscoveryProblems(
      { problems: [item({ buyer_ref: 2, text: '外食の課題の具体的な一文です。' }), item({ buyer_ref: 1, text: '商業の課題の具体的な一文です。' })] },
      2
    );
    expect(r.items.map((p) => p.buyerRef)).toEqual([2, 1]);
  });

  it('出力の形が壊れていても例外にせず、0件として扱う', () => {
    expect(validateDiscoveryProblems(undefined, 2).items).toEqual([]);
    expect(validateDiscoveryProblems({ problems: 'x' }, 2).items).toEqual([]);
  });
});

describe('既存の機会②の形式への変換（候補プールを通して確認）', () => {
  it('課題の文はそのまま候補の本文になり、仮説・根拠なし・②の視点・発見経路として扱われる', () => {
    const r = validateDiscoveryProblems({ problems: [item({ why_unsolved: '既存の仕組みでは気づけない' })] }, 2);
    const ins = toDiscoveryInsight(r.items[0], BUYERS);
    const pool = buildCandidatePool({ opportunity: [ins.text], threat: [], insights: { opportunity: [ins], threat: [] } });
    const c = pool.candidates[0];
    expect(c.text).toBe(r.items[0].text);
    expect(c.viewpoint).toBe('customer_need');
    expect(c.discoveryPath).toBe('customer_need');
    expect(c.basis).toBe('hypothesis');
    expect(c.sourceIndex).toBeNull();
    expect(c.grounding).toBe('needs_research');
    expect(c.unverified).toContain('needs_research');
    expect(c.whoLabel).toBe('商業施設事業者');
    expect(c.segmentName).toBe('商業その他施設事業');
    expect(c.targetNeed).toBe(r.items[0].text);
  });

  it('購入者の関係者は「購入者の名前の関係者」として示す（購入者本人と区別する）', () => {
    const ins = toDiscoveryInsight(
      { buyerRef: 2, subject: 'stakeholder', text: '店長が本部の指示に追われている。', whyUnsolved: '不明' },
      BUYERS
    );
    expect(ins.need.whoLabel).toBe('外食チェーンの関係者');
    expect(ins.need.whyCurrentFails).toBeNull();
  });

  it('存在しない購入者への変換は作らない', () => {
    expect(() =>
      toDiscoveryInsight({ buyerRef: 5, subject: 'buyer', text: '何か。', whyUnsolved: '' }, BUYERS)
    ).toThrow();
  });
});

describe('フラグの組み合わせ（旧方式ON/OFF × 新方式ON/OFF）', () => {
  it('新方式の既定は OFF。値は厳密に "true" のときだけ ON', () => {
    expect(isCustomerDiscoveryV2Enabled(undefined)).toBe(false);
    expect(isCustomerDiscoveryV2Enabled('TRUE')).toBe(false);
    expect(isCustomerDiscoveryV2Enabled('true')).toBe(true);
  });

  it('4通りの組み合わせで、探索Aの本文確認・発見経路の表示は旧方式フラグの値だけで決まる', () => {
    const cases = [
      { legacyOn: false, v2On: false, expect: { marketFlagOn: false, legacyNeedOn: false, discoveryOn: false } },
      { legacyOn: true, v2On: false, expect: { marketFlagOn: true, legacyNeedOn: true, discoveryOn: false } },
      { legacyOn: false, v2On: true, expect: { marketFlagOn: false, legacyNeedOn: false, discoveryOn: true } },
      { legacyOn: true, v2On: true, expect: { marketFlagOn: true, legacyNeedOn: false, discoveryOn: true } },
    ];
    for (const c of cases) {
      expect(resolveNeedRoute({ legacyOn: c.legacyOn, v2On: c.v2On })).toEqual(c.expect);
    }
  });
});
