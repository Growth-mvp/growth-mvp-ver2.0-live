import { selectNeedThemesForRoles, selectedNeedThemes } from './catalog';
import { buildSegmentNeedPlans, inferSegmentRoles, type SegmentInfo } from './runner';
import {
  capNeedItemsPerSegment,
  parseNeedOpportunities,
  toNeedItems,
  type NeedItem,
  type NeedOpportunityRaw,
} from './opportunities';
import { buildRoleAnalysisInput, buildRoleAnalysisSchema, parseRoleAnalysis, renderRolesBlock, type CustomerRole } from './roles';
import { gradeNeedHypothesis, type NeedHypothesis } from './hypothesis';
import { MARKET_TAXONOMY, matchCompanyMarkets, type MarketCategory } from '../marketTaxonomy';
import { buildCandidatePool, parseCandidatePool } from '../candidatePool';
import {
  assertPublicHttpsUrl,
  bodySupportsStatement,
  checkSourceBodies,
  extractBodyText,
  fetchBodyText,
  isPrivateAddress,
} from '../sourceBody';
import {
  OT_ANALYSIS_NEED_INSTRUCTIONS,
  OT_ANALYSIS_NEED_SCHEMA,
  OT_ANALYSIS_INSTRUCTIONS,
  buildAnalysisInput,
  parseNeedAnalysis,
  type WebResult,
} from '../generateOt';

const cat = (id: string): MarketCategory => {
  const c = MARKET_TAXONOMY.find((x) => x.id === id);
  if (!c) throw new Error(`unknown category ${id}`);
  return c;
};

const role = (r: CustomerRole['role'], basis: CustomerRole['basis'] = 'input', categoryIds: string[] = []): CustomerRole => ({
  role: r,
  basis,
  label: `${r}のラベル`,
  evidence: basis === 'estimated' ? null : '根拠の語',
  categoryIds,
});

const ids = (themes: { id: string }[]) => themes.map((t) => t.id);

const info = (rank: number, name: string, products: string[], customers: string[]): SegmentInfo => ({
  rank,
  name,
  summary: `社内だけの概要 ${name}`,
  scope: '',
  mainProductsServices: [],
  keyCustomers: [],
  productCategories: products.map(cat),
  customerCategories: customers.map(cat),
});

describe('探索テーマの選択（事業の役割に応じて）', () => {
  it('役割が無い事業は、固定の既定テーマを使う', () => {
    expect(ids(selectNeedThemesForRoles([]))).toEqual(ids(selectedNeedThemes()));
  });

  it('直接顧客がいる事業は、直接顧客の課題と非購入理由を探し、否定的な証拠を必ず含める', () => {
    const themes = ids(selectNeedThemesForRoles([role('direct_customer')]));
    expect(themes).toEqual(expect.arrayContaining(['direct_customer_pain', 'non_purchase', 'existing_gap', 'cross_industry']));
    expect(themes).toEqual(expect.arrayContaining(['user_pain_disconfirm', 'existing_gap_disconfirm']));
    expect(themes).not.toContain('desired_outcome');
  });

  it('利用者・最終受益者がいる事業は、利用者の不満と実現したい成果を探す', () => {
    const themes = ids(selectNeedThemesForRoles([role('user'), role('end_beneficiary', 'estimated')]));
    expect(themes).toEqual(expect.arrayContaining(['user_pain', 'desired_outcome']));
    expect(themes).not.toContain('direct_customer_pain');
  });

  it('テーマは上限を超えず、同じテーマを重ねない', () => {
    const themes = ids(selectNeedThemesForRoles([role('direct_customer'), role('user'), role('buying_decision_maker'), role('end_beneficiary')]));
    expect(themes.length).toBeLessThanOrEqual(8);
    expect(new Set(themes).size).toBe(themes.length);
  });
});

describe('役割の推定（事業の分類の範囲に限る）', () => {
  it('入力には、その事業に一致した顧客業界の候補だけを入れ、候補外は書かせない', () => {
    const text = buildRoleAnalysisInput(
      { segments: [{ name: 'A', summary: '概要' }] },
      [{ id: 'c_food_maker', label: '食品・飲料メーカー' }]
    );
    expect(text).toContain('- c_food_maker: 食品・飲料メーカー');
    expect(text).toContain('一覧に無い業界は書かない');
    expect(text).toContain('製品・サービスごとに顧客が違う場合');
  });

  it('出力スキーマは、顧客業界の ID を候補に限定する', () => {
    const schema = buildRoleAnalysisSchema(['c_food_maker']);
    expect(schema.properties.roles.items.properties.categoryIds.items).toEqual({ type: 'string', enum: ['c_food_maker'] });
    expect(schema.properties.roles.items.properties.role.enum).toEqual(['direct_customer', 'user', 'end_beneficiary', 'buying_decision_maker']);
  });

  it('候補外の顧客業界は捨て、根拠の無い役割は推定に降格する', () => {
    const roles = parseRoleAnalysis(
      {
        roles: [
          { role: 'direct_customer', basis: 'input', label: '食品メーカー', evidence: '主要顧客', categoryIds: ['c_food_maker', 'c_paint_chemical'] },
          { role: 'user', basis: 'public', label: '利用者', evidence: null, categoryIds: [] },
        ],
      },
      ['c_food_maker']
    );
    expect(roles[0].categoryIds).toEqual(['c_food_maker']);
    expect(roles[1]).toMatchObject({ basis: 'estimated', categoryIds: [] });
  });

  it('内部分析は事業ごとに1回ずつ、Web検索を使わず、役割の JSON を読む', async () => {
    const invoke = jest.fn(async (_params: unknown) => JSON.stringify({ roles: [{ role: 'user', basis: 'estimated', label: '利用者', evidence: null, categoryIds: [] }] }));
    const out = await inferSegmentRoles({
      segments: [info(1, '事業A', ['p_art_can'], ['c_food_maker'])],
      businessContent: '事業内容',
      params: { model: 'm', max_output_tokens: 100 },
      invoke,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    const params = invoke.mock.calls[0][0] as unknown as { tools?: unknown; text: { format: { name: string; schema: { properties: { roles: { items: { properties: { categoryIds: { items: unknown } } } } } } } } };
    expect(params.tools).toBeUndefined();
    expect(params.text.format.name).toBe('customer_roles');
    expect(params.text.format.schema.properties.roles.items.properties.categoryIds.items).toEqual({ type: 'string', enum: ['c_food_maker'] });
    expect(out[0].roles).toEqual([expect.objectContaining({ role: 'user', basis: 'estimated' })]);
  });

  it('推定の呼び出しが失敗しても、その事業は役割なしとして続行する', async () => {
    const out = await inferSegmentRoles({
      segments: [info(1, '事業A', ['p_art_can'], [])],
      businessContent: '',
      params: { model: 'm', max_output_tokens: 100 },
      invoke: async () => {
        throw new Error('timeout');
      },
    });
    expect(out[0].roles).toEqual([]);
  });

  it('役割の描画は根拠の区分と関係する顧客業界を明記し、役割が無い事業は推測で埋めない', () => {
    const text = renderRolesBlock(
      [
        { segment: 'A', roles: [role('direct_customer', 'input', ['c_food_maker'])] },
        { segment: 'B', roles: [] },
      ],
      (id) => cat(id).label
    );
    expect(text).toContain('入力から確認');
    expect(text).toContain('顧客業界: 食品・飲料メーカー');
    expect(text).toContain('確認できた役割なし');
  });
});

describe('事業ごとの検索計画（事業の分類と役割の顧客業界だけを使う）', () => {
  it('美術缶の事業では、役割が確認した顧客業界だけを使い、同じ事業の別の顧客（塗料・化学品）を混ぜない', () => {
    const segment = info(1, '美術缶事業', ['p_art_can'], ['c_paint_chemical', 'c_food_maker']);
    const { plans, reports } = buildSegmentNeedPlans({
      industryLabel: '製造業',
      regions: [],
      segments: [segment],
      segmentRoles: [{ rank: 1, name: '美術缶事業', roles: [role('direct_customer', 'input', ['c_food_maker'])] }],
    });
    expect(plans[0].categoryIds).toEqual(['p_art_can', 'c_food_maker']);
    expect(plans[0].categoryIds).not.toContain('c_paint_chemical');
    expect(plans[0].segment).toBe('美術缶事業');
    expect(reports[0]).toMatchObject({ planKind: 'categories', customerConfirmed: true, reason: null });
  });

  it('顧客業界を役割から確認できない場合は、製品の分類だけで探し、理由を残す', () => {
    const { plans, reports } = buildSegmentNeedPlans({
      industryLabel: '',
      regions: [],
      segments: [info(1, '美術缶事業', ['p_art_can'], ['c_paint_chemical'])],
      segmentRoles: [{ rank: 1, name: '美術缶事業', roles: [role('direct_customer')] }],
    });
    expect(plans[0].categoryIds).toEqual(['p_art_can']);
    expect(reports[0]).toMatchObject({ customerConfirmed: false, reason: 'customer_unconfirmed' });
  });

  it('事業の分類が無ければ、許可された業種だけを使う業種レベルの計画にし、理由を残す', () => {
    const { plans, reports } = buildSegmentNeedPlans({
      industryLabel: 'その他サービス業',
      regions: [],
      segments: [info(1, '相談事業', [], [])],
      segmentRoles: [{ rank: 1, name: '相談事業', roles: [role('user')] }],
    });
    expect(plans[0].input).toContain('業界: その他サービス業');
    expect(plans[0].categoryIds).toEqual([]);
    expect(reports[0]).toMatchObject({ planKind: 'industry', reason: 'no_public_category' });
  });

  it('分類も業種も無ければ計画を作らず、その理由を残す', () => {
    const { plans, reports } = buildSegmentNeedPlans({
      industryLabel: '',
      regions: [],
      segments: [info(1, '相談事業', [], [])],
      segmentRoles: [],
    });
    expect(plans).toEqual([]);
    expect(reports[0]).toMatchObject({ planKind: 'none', reason: 'no_industry' });
  });

  it('社内の概要・自由記述は検索入力に入らない', () => {
    const { plans } = buildSegmentNeedPlans({
      industryLabel: '',
      regions: [],
      segments: [info(1, '金属缶事業', ['p_metal_can'], ['c_food_maker'])],
      segmentRoles: [],
    });
    expect(plans.map((p) => p.input).join('\n')).not.toContain('社内だけの概要');
  });

  it('店舗内装・展示施設の事業は、分類表で一致し、店舗経営者などの顧客を探せる', () => {
    const m = matchCompanyMarkets({
      businessContent: '',
      segments: [
        {
          revenue: 1000,
          productTexts: ['商業施設全般の企画・デザイン・設計・制作・施工。百貨店、大型商業施設'],
          customerTexts: ['商業施設事業者、ホテル・不動産事業者'],
        },
        {
          revenue: 500,
          productTexts: ['チェーン店舗の企画・設計・施工・改装・メンテナンス'],
          customerTexts: ['外食チェーン、小売チェーン'],
        },
        {
          revenue: 300,
          productTexts: ['博物館・美術館の展示設計・制作・施工'],
          customerTexts: ['国・地方自治体、博物館・美術館等の運営主体'],
        },
      ],
    });
    const products = m.segments.flatMap((s) => s.product.map((c) => c.id));
    const customers = m.segments.flatMap((s) => s.customer.map((c) => c.id));
    expect(products).toEqual(expect.arrayContaining(['p_store_interior', 'p_exhibition_culture']));
    expect(customers).toEqual(expect.arrayContaining(['c_store_operator', 'c_cultural_operator']));
  });
});

describe('課題から機会への変換（根拠・対象一致・事業の対応）', () => {
  const raw = (over: Partial<NeedOpportunityRaw> = {}): NeedOpportunityRaw => ({
    segmentName: '美術缶事業',
    who: 'direct_customer',
    problem: '食品メーカーで、限定品の包装がブランド訴求に十分ではない',
    desiredOutcome: '限定性を包装で伝えること',
    whyCurrentFails: '標準的な包装では装飾性を出しにくい',
    payer: 'direct_customer',
    companyLink: '美術缶の装飾技術',
    valueShift: '価格から限定性・体験へ',
    purchaseImpact: '包装仕様の採用判断',
    breadth: 'public_observed',
    opportunity: '限定品向けの装飾容器の需要が拡大する可能性がある。',
    basis: 'fact',
    evidence: '[1] 食品メーカーの包装調査',
    sourceIndex: 1,
    evidenceTarget: '食品メーカーのブランド担当者 2025年 全国',
    evidenceRelation: 'same_customer',
    ...over,
  });
  const findings = [{ statement: '食品メーカーの約6割が包装でブランドを伝えたいと回答した。', sourceIndex: 1, segment: '美術缶事業' }];
  const convert = (items: NeedOpportunityRaw[], verified = true, sourceUrl = 'https://example.com/a') =>
    toNeedItems({
      items,
      roles: [role('direct_customer', 'input', ['c_food_maker'])],
      findings,
      sources: [{ index: 1, url: sourceUrl, contentVerified: verified }],
      segments: ['美術缶事業', '不動産賃貸事業'],
      labelOf: () => '直接顧客',
      categoryLabelOf: (id) => cat(id).label,
    });

  it('出典の本文が確認でき、対象が顧客と一致すれば、課題の事実として残る（機会の文は仮説のまま）', () => {
    const { items } = convert([raw()]);
    expect(items[0]).toMatchObject({ basis: 'hypothesis', sourceIndex: 1 });
    expect(items[0].need).toMatchObject({ evidenceUse: 'fact', segmentName: '美術缶事業' });
  });

  it('課題の事実は、支払う相手や自社との接点が無くても、出典から確認済みとして残る', () => {
    const { items } = convert([raw({ payer: null, companyLink: null, valueShift: null, purchaseImpact: null, breadth: 'unknown' })]);
    expect(items[0].need.evidenceUse).toBe('fact');
    expect(items[0].sourceIndex).toBe(1);
    expect(items[0].need.grade).toBe('hypothesis');
    expect(items[0].basis).toBe('hypothesis');
  });

  it('同じ顧客と判定された出典でも、役割の顧客業界の語が出典の文に無ければ、参考どまりにする（別の業界の調査を根拠にしない）', () => {
    const { items } = toNeedItems({
      items: [raw({ opportunity: '塗料メーカー向けの供給安定性の需要が拡大する可能性がある。' })],
      roles: [role('direct_customer', 'input', ['c_paint_chemical'])],
      findings: [{ statement: 'シンナー取扱事業所の多くが欠品や納期遅延を経験した。', sourceIndex: 1, segment: '美術缶事業' }],
      sources: [{ index: 1, url: 'https://example.com/a', contentVerified: true }],
      segments: ['美術缶事業'],
      labelOf: () => '直接顧客',
      categoryLabelOf: (id) => cat(id).label,
    });
    expect(items[0].need.evidenceUse).toBe('reference');
    expect(items[0].sourceIndex).toBe(1);
    expect(items[0].need.unverified).toContain('customer_match_unconfirmed');
    expect(items[0].basis).toBe('hypothesis');
  });

  it('顧客業界が役割に無い場合は、同じ顧客と判定されても事実にしない', () => {
    const { items } = toNeedItems({
      items: [raw()],
      roles: [role('direct_customer')],
      findings,
      sources: [{ index: 1, url: 'https://example.com/a', contentVerified: true }],
      segments: ['美術缶事業'],
      labelOf: () => '直接顧客',
    });
    expect(items[0].need.evidenceUse).toBe('reference');
  });

  it('本文を確認できない出典は、参考どまりで事実にしない（探索仮説として残す）', () => {
    const { items, evidenceUse } = convert([raw()], false);
    expect(items[0].basis).toBe('hypothesis');
    expect(items[0].need.evidenceUse).toBe('reference');
    expect(items[0].sourceIndex).toBe(1);
    expect(items[0].need.unverified).toContain('evidence_not_fact');
    expect(evidenceUse.reference).toBe(1);
  });

  it('調査対象が顧客と異なる出典は、根拠として使わない（鈑金塗装店の調査を美術缶の購入者に当てはめない）', () => {
    const { items, evidenceUse } = convert([raw({ evidenceRelation: 'different', evidenceTarget: '鈑金塗装店 2024年' })]);
    expect(items[0].sourceIndex).toBeNull();
    expect(items[0].basis).toBe('hypothesis');
    expect(items[0].need.evidenceUse).toBe('mismatch');
    expect(items[0].need.gradeReasons).toContain('出典の調査対象が顧客と異なる（使わない）');
    expect(evidenceUse.mismatch).toBe(1);
  });

  it('別の事業の検索で得た出典は、この事業の根拠にしない', () => {
    const { items } = toNeedItems({
      items: [raw({ segmentName: '不動産賃貸事業' })],
      roles: [role('direct_customer')],
      findings: [{ statement: '食品メーカーの約6割が包装で伝えたい。', sourceIndex: 1, segment: '美術缶事業' }],
      sources: [{ index: 1, url: 'https://example.com/a', contentVerified: true }],
      segments: ['美術缶事業', '不動産賃貸事業'],
      labelOf: () => '直接顧客',
    });
    expect(items[0].sourceIndex).toBeNull();
    expect(items[0].need.evidenceUse).toBe('mismatch');
  });

  it('事業名が一覧に無ければ、事業は特定せず未確認に残す', () => {
    const { items } = convert([raw({ segmentName: '存在しない事業' })]);
    expect(items[0].need.segmentName).toBeNull();
    expect(items[0].need.unverified).toContain('segment');
  });

  it('従来の顧客価値の違い・購買判断への影響が無い項目は、公開情報で確認済みにしない', () => {
    const { items } = convert([raw({ valueShift: null, purchaseImpact: null })]);
    expect(items[0].basis).toBe('hypothesis');
    expect(items[0].need.gradeReasons).toEqual(
      expect.arrayContaining(['従来の顧客価値との違いが未記述', '購買判断への影響が未記述'])
    );
  });

  it('出典が参考どまりなら、他の条件がそろっていても公開情報で確認済みにしない', () => {
    const { items } = convert([raw({ evidenceRelation: 'adjacent' })]);
    expect(items[0].need.evidenceUse).toBe('reference');
    expect(items[0].need.grade).toBe('hypothesis');
    expect(items[0].need.gradeReasons).toContain('出典は参考どまり（対象の一致か本文確認が未了）');
  });

  it('別の事業の検索で得た出典は、対象不一致と区別して理由を残す', () => {
    const { items } = toNeedItems({
      items: [raw({ segmentName: '不動産賃貸事業' })],
      roles: [role('direct_customer', 'input', ['c_food_maker'])],
      findings: [{ statement: '食品メーカーの約6割が包装で伝えたい。', sourceIndex: 1, segment: '美術缶事業' }],
      sources: [{ index: 1, url: 'https://example.com/a', contentVerified: true }],
      segments: ['美術缶事業', '不動産賃貸事業'],
      labelOf: () => '直接顧客',
      categoryLabelOf: (id) => cat(id).label,
    });
    expect(items[0].need.unverified).toContain('source_other_segment');
    expect(items[0].need.gradeReasons).toContain('出典は別の事業または対象不一致のため根拠にしない');
  });

  it('役割に無い主体の項目は作らない', () => {
    const { items, dropped } = convert([raw({ who: 'end_beneficiary' })]);
    expect(items).toHaveLength(0);
    expect(dropped.who_unsupported).toBe(1);
  });

  it('AI の出力は件数を変換の段階で掛ける。形式が不正な項目だけを捨て、矛盾しない値は残す', () => {
    const parsed = parseNeedOpportunities({
      customerNeedOpportunities: [
        { who: 'x', problem: 'bad' },
        raw(),
        raw({ opportunity: '2件目の機会が拡大する可能性がある。' }),
        raw({ opportunity: '3件目の機会が拡大する可能性がある。' }),
      ],
    });
    expect(parsed).toHaveLength(3);
    expect(parsed[0].evidenceRelation).toBe('same_customer');
  });

  it('対象一致の値が不明な場合は unknown として扱う', () => {
    const parsed = parseNeedOpportunities({ customerNeedOpportunities: [{ ...raw(), evidenceRelation: '別物' }] });
    expect(parsed[0].evidenceRelation).toBe('unknown');
  });
});

describe('事業ごとの上限（特定の事業だけが優先されない）', () => {
  const item = (segment: string | null, n: number): NeedItem => ({
    text: `${segment ?? '未特定'}の機会${n}が拡大する可能性がある。`,
    basis: 'hypothesis',
    evidence: '',
    sourceIndex: null,
    need: {
      discoveryPath: 'customer_need',
      segmentName: segment,
      who: 'direct_customer',
      whoLabel: '直接顧客',
      problem: '課題',
      desiredOutcome: null,
      whyCurrentFails: null,
      payer: null,
      companyLink: null,
      valueShift: null,
      purchaseImpact: null,
      breadth: 'unknown',
      evidenceTarget: null,
      evidenceRelation: 'unknown',
      evidenceUse: 'none',
      unverified: [],
      grade: 'hypothesis',
      gradeReasons: [],
    },
  });

  it('事業ごとに2件、全体で6件まで。事業の順に採り、余った枠を1つの事業に使い切らない', () => {
    const items = [item('A', 1), item('A', 2), item('A', 3), item('B', 1), item('B', 2), item('C', 1), item('C', 2), item('C', 3)];
    const { items: kept, dropped } = capNeedItemsPerSegment(items, ['A', 'B', 'C']);
    expect(kept.map((i) => i.need.segmentName)).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
    expect(dropped).toEqual({ segment_cap: 2, total_cap: 0 });
  });

  it('根拠の無い事業を埋めるための項目は作らない（件数が少なければそのまま）', () => {
    const { items: kept } = capNeedItemsPerSegment([item('B', 1)], ['A', 'B']);
    expect(kept).toHaveLength(1);
  });
});

describe('顧客課題の判定（根拠の規則）', () => {
  const base: NeedHypothesis = {
    id: 'x',
    who: 'direct_customer',
    whoLabel: '直接顧客',
    roleBasis: 'input',
    problem: '課題の文が十分な長さを持つ',
    desiredOutcome: '成果',
    whyCurrentFails: '不足',
    breadth: 'public_observed',
    payer: 'direct_customer',
    companyLink: '接点',
    opportunity: '機会',
    facts: [{ text: '事実', sourceUrl: 'https://example.com', bodyChecked: true }],
    hypotheses: [],
    unverified: [],
    discoveryPath: 'customer_need',
    valueShift: '価値の変化',
    purchaseImpact: '購買判断',
    evidenceRelation: 'same_customer',
  };

  it('すべてそろえば確認済みになる', () => {
    expect(gradeNeedHypothesis(base).grade).toBe('verified_public');
  });

  it('対象が顧客と一致しない・未確認なら確認済みにしない', () => {
    expect(gradeNeedHypothesis({ ...base, evidenceRelation: 'adjacent' }).grade).toBe('hypothesis');
    expect(gradeNeedHypothesis({ ...base, evidenceRelation: 'unknown' }).grade).toBe('hypothesis');
  });
});

describe('候補プールへの接続（発見経路・事業・根拠の使われ方）', () => {
  it('顧客課題起点の候補は、事業・課題・成果・支払う相手・価値の変化・購買判断・根拠の使われ方を持つ', () => {
    const pool = buildCandidatePool({
      opportunity: ['限定品向けの装飾容器の需要が拡大する可能性がある。'],
      insights: {
        opportunity: [
          {
            text: '限定品向けの装飾容器の需要が拡大する可能性がある。',
            basis: 'hypothesis',
            evidence: '',
            sourceIndex: null,
            need: {
              discoveryPath: 'customer_need',
              segmentName: '美術缶事業',
              problem: '限定品の包装が訴求に十分でない',
              desiredOutcome: '限定性を伝える',
              payer: 'direct_customer',
              companyLink: '装飾技術',
              valueShift: '価格から体験へ',
              purchaseImpact: '包装仕様',
              evidenceUse: 'reference',
              unverified: ['breadth', 'evidence_not_fact'],
            },
          },
        ],
        threat: [],
      },
      sources: [],
    });
    const c = pool.candidates[0];
    expect(c).toMatchObject({
      discoveryPath: 'customer_need',
      segmentName: '美術缶事業',
      targetNeed: '限定品の包装が訴求に十分でない',
      desiredOutcome: '限定性を伝える',
      payer: 'direct_customer',
      valueShift: '価格から体験へ',
      purchaseImpact: '包装仕様',
      evidenceUse: 'reference',
    });
    expect(c.unverified).toEqual(expect.arrayContaining(['breadth', 'evidence_not_fact']));
    const round = parseCandidatePool(JSON.parse(JSON.stringify(pool)));
    expect(round?.candidates[0]).toMatchObject({ segmentName: '美術缶事業', evidenceUse: 'reference', valueShift: '価格から体験へ' });
  });

  it('市場由来の候補は、ON のときに付ける発見経路（market）を保持する。付いていなければ従来どおり', () => {
    const pool = buildCandidatePool({
      opportunity: ['市場の機会です。', '別の市場の機会です。'],
      insights: {
        opportunity: [
          { text: '市場の機会です。', basis: 'hypothesis', evidence: '', sourceIndex: null, discoveryPath: 'market' },
          { text: '別の市場の機会です。', basis: 'hypothesis', evidence: '', sourceIndex: null },
        ],
        threat: [],
      },
      sources: [],
    });
    expect(pool.candidates[0].discoveryPath).toBe('market');
    expect(pool.candidates[1].discoveryPath).toBeUndefined();
  });
});

describe('出典の本文確認（安全な取得と照合）', () => {
  it('プライベート・ループバック・リンクローカルのアドレスを拒否する', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.5', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.1.1.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
  });

  it('https 以外・認証情報つき・非標準ポート・内部ホスト名を拒否する', async () => {
    const resolve = async () => ['93.184.216.34'];
    await expect(assertPublicHttpsUrl('http://example.com/a', resolve)).rejects.toThrow('unsafe_url');
    await expect(assertPublicHttpsUrl('https://u:p@example.com/a', resolve)).rejects.toThrow('unsafe_url');
    await expect(assertPublicHttpsUrl('https://example.com:8443/a', resolve)).rejects.toThrow('unsafe_url');
    await expect(assertPublicHttpsUrl('https://localhost/a', resolve)).rejects.toThrow('unsafe_url');
    await expect(assertPublicHttpsUrl('https://intranet.internal/a', resolve)).rejects.toThrow('unsafe_url');
    await expect(assertPublicHttpsUrl('https://10.0.0.5/a', resolve)).rejects.toThrow('unsafe_url');
  });

  it('名前解決の結果に非公開アドレスが1つでもあれば拒否する', async () => {
    await expect(assertPublicHttpsUrl('https://example.com/a', async () => ['93.184.216.34', '10.0.0.7'])).rejects.toThrow('unsafe_url');
    await expect(assertPublicHttpsUrl('https://example.com/a', async () => ['93.184.216.34'])).resolves.toBeUndefined();
  });

  it('HTML から本文だけを取り出す（スクリプト・スタイル・タグを除く）', () => {
    const text = extractBodyText('<html><style>a{}</style><script>x=1</script><p>市場&nbsp;規模は 1,200 億円</p></html>');
    expect(text).toBe('市場 規模は 1,200 億円');
  });

  it('本文の取得は、テキスト以外・リダイレクト・失敗を確認できなかった扱いにする', async () => {
    const resolve = async () => ['93.184.216.34'];
    const long = '<p>' + '市場の動向を示す本文です。'.repeat(20) + '</p>';
    const ok = await fetchBodyText('https://example.com/a', {
      resolve,
      fetchImpl: async () => new Response(long, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    });
    expect(ok).toContain('市場の動向を示す本文です');
    expect(
      await fetchBodyText('https://example.com/a', {
        resolve,
        fetchImpl: async () => new Response(long, { status: 200, headers: { 'content-type': 'application/pdf' } }),
      })
    ).toBeNull();
    expect(
      await fetchBodyText('https://example.com/a', {
        resolve,
        fetchImpl: async () => new Response('', { status: 301, headers: { location: 'https://evil.example/x' } }),
      })
    ).toBeNull();
    expect(
      await fetchBodyText('https://example.com/a', {
        resolve,
        fetchImpl: async () => {
          throw new Error('network');
        },
      })
    ).toBeNull();
  });

  it('数値は本文に同じ表記で含まれ、内容語も2つ以上の一致が必要', () => {
    const body = '国内の缶の出荷は2025年に 1,250 万箱となり、前年を上回った。';
    expect(bodySupportsStatement('国内の缶の出荷は2025年に1250万箱', body)).toBe(true);
    expect(bodySupportsStatement('国内の缶の出荷は2025年に9999万箱', body)).toBe(false);
    expect(bodySupportsStatement('海外の電池需要が伸びる。', body)).toBe(false);
  });

  it('出典ごとに、取得できた・主張が一致した・取得できなかったを区別する', async () => {
    const sources = [
      { index: 1, url: 'https://a.example/x' },
      { index: 2, url: 'https://b.example/y' },
      { index: 3, url: 'https://c.example/z' },
    ];
    const findings = [
      { statement: '国内の缶の出荷は2025年に1250万箱となった。', sourceIndex: 1 },
      { statement: '海外の電池需要が伸びた。', sourceIndex: 2 },
    ];
    const { sources: checked, stats } = await checkSourceBodies({
      sources,
      findings,
      deadlineMs: Date.now() + 10_000,
      fetchBody: async (url) =>
        url.includes('a.example')
          ? '国内の缶の出荷は2025年に 1,250 万箱となり、前年を上回った。'
          : url.includes('b.example')
            ? '別の話題の本文です。'
            : null,
    });
    expect(checked.map((s) => s.bodyCheck)).toEqual(['matched', 'not_matched', 'unavailable']);
    expect(checked[0].contentVerified).toBe(true);
    expect(checked[2].contentVerified).toBe(false);
    expect(stats).toEqual({ attempted: 3, matched: 1, notMatched: 1, unavailable: 1 });
  });
});

describe('分析の指示と出力（顧客課題つき）', () => {
  it('顧客課題つきの指示は、事業の対応・対象一致・価値の変化の確認を含み、既存の指示は変えない', () => {
    expect(OT_ANALYSIS_NEED_INSTRUCTIONS).toContain('顧客課題起点の機会');
    expect(OT_ANALYSIS_NEED_INSTRUCTIONS).toContain('segmentName');
    expect(OT_ANALYSIS_NEED_INSTRUCTIONS).toContain('evidenceRelation');
    expect(OT_ANALYSIS_NEED_INSTRUCTIONS).toContain('different');
    expect(OT_ANALYSIS_NEED_INSTRUCTIONS).toContain('valueShift');
    expect(OT_ANALYSIS_INSTRUCTIONS).not.toContain('顧客課題起点の機会');
  });

  it('顧客課題つきの出力スキーマは、事業・価値の変化・出典の対象一致を持つ', () => {
    expect(OT_ANALYSIS_NEED_SCHEMA.required).toEqual(['opportunities', 'threats', 'customerNeedOpportunities']);
    expect(OT_ANALYSIS_NEED_SCHEMA.properties.customerNeedOpportunities.maxItems).toBe(6);
    expect(OT_ANALYSIS_NEED_SCHEMA.properties.customerNeedOpportunities.items.properties).toHaveProperty('evidenceRelation');
  });

  it('役割のブロックは、入力の役割欄に分けて入る', () => {
    const web: WebResult = { status: 'completed', findings: [], sources: [], searchCalls: 0 };
    const ctx = {
      industryLabel: '製造業', location: '', employees: '', businessContent: '', mission: '', vision: '', value: '',
      ceoIntent: '', strength: '', weakness: '', segments: [], financeRows: [],
    };
    const input = buildAnalysisInput(ctx, web, '- 事業区分「A」\n  - 利用者');
    expect(input.indexOf('<customer_roles>')).toBeLessThan(input.indexOf('<external_findings>'));
    expect(buildAnalysisInput(ctx, web)).not.toContain('<customer_roles>');
  });

  it('顧客課題つきの分析の出力は、既存の機会・脅威と顧客課題を分けて読む', () => {
    const five = (p: string) => Array.from({ length: 5 }, (_, i) => ({ text: `${p}${i + 1}`, basis: 'hypothesis', evidence: '', sourceIndex: null }));
    const raw = JSON.stringify({ opportunities: five('機会'), threats: five('脅威'), customerNeedOpportunities: [{ who: 'user' }] });
    const parsed = parseNeedAnalysis(raw, 0);
    expect(parsed.analysis.opportunities).toHaveLength(5);
    expect(parsed.customerNeeds).toHaveLength(0);
  });
});
