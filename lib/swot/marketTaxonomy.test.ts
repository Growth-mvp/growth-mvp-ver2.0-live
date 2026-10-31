import {
  MARKET_CATEGORY_IDS,
  MARKET_TAXONOMY,
  THEME_LINE_LIMIT,
  buildPlanInput,
  keywordHit,
  matchCompanyMarkets,
  planSearchCalls,
  type SegmentInput,
} from './marketTaxonomy';

const seg = (productTexts: string[], customerTexts: string[] = [], revenue?: number): SegmentInput => ({
  productTexts,
  customerTexts,
  revenue,
});

const ids = (list: { id: string }[]) => list.map((c) => c.id);

const NIHON_METAL = seg(
  ['金属缶の製造・販売', '金属缶製造販売事業', '18L缶と美術缶を製造', '18L缶', '美術缶'],
  ['塗料メーカー', '化学品メーカー', '食品メーカー'],
  11278
);
const NIHON_REALESTATE = seg(['不動産賃貸事業', '賃貸物件の運営'], ['入居者'], 3000);

const CONSTRUCTION_CO = seg(['電気設備工事・空調設備の施工', '設備工事事業', '空調設備の施工'], ['ゼネコン', '不動産オーナー']);
const SAAS_CO = seg(['中小企業向けの業務用SaaS', 'SaaS事業', '勤怠管理のクラウドサービス'], ['企業向けの人事部門']);
const RETAIL_CO = seg(['食品の小売店舗', '店舗事業', 'ネット通販も運営'], ['一般消費者']);
const SERVICE_CO = seg(['地域の相談窓口を運営', '相談事業', '相談サービス'], ['地域住民']);

describe('市場分類マスタの整合性', () => {
  it('ID は重複せず、すべてのカテゴリに公開用のラベルと照合語がある', () => {
    const ids = MARKET_TAXONOMY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MARKET_CATEGORY_IDS.size).toBe(ids.length);
    for (const c of MARKET_TAXONOMY) {
      expect(c.label.trim().length).toBeGreaterThan(0);
      expect(c.keywords.length).toBeGreaterThan(0);
    }
  });

  it('関連づけの参照先はすべてマスタ内に存在する', () => {
    for (const c of MARKET_TAXONOMY) {
      for (const rid of c.related ?? []) expect(MARKET_CATEGORY_IDS.has(rid)).toBe(true);
    }
  });

  it('ASCII の語は前後が英数字でない場合だけ一致する（"EC" が "ECO" に当たらない）', () => {
    expect(keywordHit('ECサイトを運営', 'EC')).toBe(true);
    expect(keywordHit('ECO活動', 'EC')).toBe(false);
    expect(keywordHit('18L缶', '18L')).toBe(true);
  });
});

describe('企業ごとの市場分類（汎用の照合）', () => {
  it('日本製罐: 製品・顧客に一致し、樹脂容器と環境対応の購買基準を関連として加える', () => {
    const m = matchCompanyMarkets({ segments: [NIHON_METAL] });
    expect(ids(m.product)).toEqual(['p_metal_can', 'p_can_18l', 'p_art_can']);
    expect(ids(m.customer)).toEqual(['c_paint_chemical', 'c_food_maker']);
    expect(ids(m.substitute)).toEqual(['s_plastic_container']);
    expect(ids(m.criteria)).toEqual(['k_environment']);
  });

  it('建設業・IT・小売でも、それぞれの製品と顧客に対応する分類になる', () => {
    const construction = matchCompanyMarkets({ segments: [CONSTRUCTION_CO] });
    expect(ids(construction.product)).toEqual(['p_construction_work']);
    expect(ids(construction.customer)).toEqual(['c_construction_owner']);
    const saas = matchCompanyMarkets({ segments: [SAAS_CO] });
    expect(ids(saas.product)).toEqual(['p_software_saas']);
    expect(ids(saas.customer)).toEqual(['c_enterprise']);
    const retail = matchCompanyMarkets({ segments: [RETAIL_CO] });
    expect(ids(retail.product)).toEqual(['p_retail_store']);
    expect(ids(retail.customer)).toEqual(['c_consumer']);
  });

  it('一致しない企業は推測せず、分類なしにする', () => {
    const m = matchCompanyMarkets({ segments: [SERVICE_CO] });
    expect(m.product).toEqual([]);
    expect(m.customer).toEqual([]);
    expect(m.substitute).toEqual([]);
    expect(m.criteria).toEqual([]);
    expect(planSearchCalls({ industryLabel: 'その他サービス業', regions: [], match: m })).toEqual([]);
  });
});

describe('汎用語の誤一致防止', () => {
  it('「法人」単独ではIT関連顧客市場に一致しない（日本製罐の顧客欄の再現）', () => {
    const m = matchCompanyMarkets({ segments: [seg(['金属缶の製造'], ['法人のお客様'])] });
    expect(ids(m.customer)).not.toContain('c_enterprise');
  });

  it('「法人」「企業向け」でも、IT文脈が無ければ IT 市場に一致しない', () => {
    const m = matchCompanyMarkets({ segments: [seg(['工場用の設備を製造'], ['企業向けの購買部門', '法人向けの販売'])] });
    expect(ids(m.customer)).not.toContain('c_enterprise');
  });

  it('IT文脈（SaaS等）があれば、法人向けのIT市場に一致する', () => {
    const m = matchCompanyMarkets({ segments: [seg(['業務用SaaSの提供'], ['法人のお客様'])] });
    expect(ids(m.customer)).toEqual(['c_enterprise']);
  });

  it('建設業: 「施工」を含む製造業の製品では、建設工事の分類に一致しない', () => {
    const m = matchCompanyMarkets({ segments: [seg(['施工不要の省力化装置を製造'], ['製造業の工場'])] });
    expect(ids(m.product)).not.toContain('p_construction_work');
  });

  it('小売業: 「店舗」を含む製造業の製品（什器など）では、小売の分類に一致しない', () => {
    const m = matchCompanyMarkets({ segments: [seg(['店舗向けの什器を製造'], ['製造業の工場'])] });
    expect(ids(m.product)).not.toContain('p_retail_store');
  });

  it('「個人」「企業」「倉庫」「ソフトウェア」の単独語では、対応する分類に一致しない', () => {
    const m = matchCompanyMarkets({
      segments: [seg(['組込ソフトウェアを搭載した機器', '自社倉庫で部品を保管'], ['個人情報保護の担当部門', '企業の購買部'])],
    });
    expect(ids(m.product)).not.toContain('p_software_saas');
    expect(ids(m.product)).not.toContain('p_logistics');
    expect(ids(m.customer)).not.toContain('c_consumer');
    expect(ids(m.customer)).not.toContain('c_enterprise');
  });
});

describe('代替品と購買基準の変化', () => {
  it('紙容器は、代替品の関連づけだけでは追加しない（用途依存のため直接一致が必要）', () => {
    const m = matchCompanyMarkets({ segments: [NIHON_METAL] });
    expect(ids(m.substitute)).not.toContain('s_paper_container');
  });

  it('紙容器は、事業の説明に紙容器・紙箱などの直接の語がある場合だけ追加する', () => {
    const m = matchCompanyMarkets({ segments: [seg(['紙箱入りの美術缶を製造'], ['食品メーカー'])] });
    expect(ids(m.substitute)).toContain('s_paper_container');
  });

  it('環境対応ニーズは、関係のある製品（金属缶）から購買基準の変化として追加する', () => {
    const m = matchCompanyMarkets({ segments: [NIHON_METAL] });
    expect(ids(m.criteria)).toEqual(['k_environment']);
    expect(ids(m.substitute)).not.toContain('k_environment');
  });

  it('関係の薄い企業（建設業）には、環境対応の購買基準を機械的に追加しない', () => {
    const m = matchCompanyMarkets({ segments: [CONSTRUCTION_CO] });
    expect(m.criteria).toEqual([]);
    expect(ids(m.substitute)).toEqual(['s_prefab']);
  });

  it('代替品は会社全体で2件、購買基準は1件までに抑える', () => {
    const m = matchCompanyMarkets({
      segments: [
        seg(['金属缶', '18L缶', '美術缶', 'ペットボトル'], ['食品メーカー', '塗料メーカー']),
        seg(['プラスチック容器の製造', '紙箱の製造', 'リサイクル事業'], ['化学品メーカー']),
      ],
    });
    expect(m.substitute.length).toBeLessThanOrEqual(2);
    expect(m.criteria.length).toBeLessThanOrEqual(1);
  });
});

describe('複数事業への対応', () => {
  it('各事業区分を独立に照合し、不動産賃貸事業を別の製品市場として認識する', () => {
    const m = matchCompanyMarkets({ segments: [NIHON_METAL, NIHON_REALESTATE] });
    expect(m.segments.map((s) => s.rank)).toEqual([1, 2]);
    expect(ids(m.segments[0].product)).toEqual(['p_metal_can', 'p_can_18l', 'p_art_can']);
    expect(ids(m.segments[1].product)).toEqual(['p_real_estate_leasing']);
    expect(ids(m.segments[1].customer)).toEqual(['c_tenant']);
    expect(m.unmatchedSegments).toBe(0);
  });

  it('売上の大きい事業を先に並べる（入力順に依存しない）', () => {
    const m = matchCompanyMarkets({ segments: [NIHON_REALESTATE, NIHON_METAL] });
    expect(ids(m.segments[0].product)).toEqual(['p_metal_can', 'p_can_18l', 'p_art_can']);
    expect(ids(m.segments[1].product)).toEqual(['p_real_estate_leasing']);
  });

  it('分類できない事業があれば、未対応の件数を数える', () => {
    const m = matchCompanyMarkets({ segments: [NIHON_METAL, seg(['地域の相談窓口'], ['地域住民'])] });
    expect(m.unmatchedSegments).toBe(1);
  });

  it('製品・顧客市場は全社で合計の上限を超えない', () => {
    const many = (n: number) => seg(['金属缶', '18L缶', '美術缶'], ['塗料メーカー', '化学品メーカー', '食品メーカー'], n);
    const m = matchCompanyMarkets({ segments: [many(3), many(2), many(1)] });
    expect(m.product.length).toBeLessThanOrEqual(6);
    expect(m.customer.length).toBeLessThanOrEqual(6);
  });

  it('売上の大きい事業が上限を使い切っても、小規模な別市場の事業には少なくとも1件を残す', () => {
    const big = seg(['金属缶', '18L缶', '美術缶'], [], 9000);
    const mid = seg(['設備工事', '店舗販売', '物流'], [], 5000);
    const small = seg(['不動産賃貸'], [], 100);
    const m = matchCompanyMarkets({ segments: [small, big, mid] });
    expect(ids(m.segments[2].product)).toEqual(['p_real_estate_leasing']);
    expect(m.product.length).toBe(6);
    expect(m.droppedCategories).toBe(1);
  });

  it('事業区分に一致が無い場合だけ、会社全体の事業内容で照合する', () => {
    const m = matchCompanyMarkets({ businessContent: '金属缶の製造・販売', segments: [seg(['相談窓口'], ['地域住民'])] });
    expect(ids(m.product)).toEqual(['p_metal_can']);
  });

  it('事業区分が一致している場合、会社全体の事業内容は照合に使わない', () => {
    const m = matchCompanyMarkets({ businessContent: '金属缶の製造・販売', segments: [NIHON_REALESTATE] });
    expect(ids(m.product)).toEqual(['p_real_estate_leasing']);
  });
});

describe('検索の組み立て（層ごとの呼び出し）', () => {
  it('日本製罐: 製品・顧客を1回目、代替品・購買基準の変化を2回目に分け、検索回数を2回に抑える', () => {
    const plans = planSearchCalls({
      industryLabel: '製造業',
      regions: ['日本国内'],
      match: matchCompanyMarkets({ segments: [NIHON_METAL] }),
    });
    expect(plans.map((p) => p.id)).toEqual(['product_customer', 'substitute']);
    expect(plans[0].categoryIds).toEqual(['p_metal_can', 'p_can_18l', 'p_art_can', 'c_paint_chemical', 'c_food_maker']);
    expect(plans[0].layers).toEqual(['product', 'customer']);
    expect(plans[1].layers).toEqual(['substitute', 'criteria']);
    expect(plans[0].input).toContain('製品市場（公開分類）: 金属缶・金属容器、18リットル缶（一斗缶）、美術缶（装飾缶）');
    expect(plans[1].input).toContain('購買基準の変化（公開分類）: 環境性能・リサイクル性（購買基準の変化）');
    expect(plans[1].input).toContain('- 環境性能・リサイクル性（購買基準の変化）: 環境性能・リサイクル性（再資源化・軽量化）に関する顧客の購買基準の変化');
  });

  it('美術缶と18L缶は、市場ごとに別のテーマ行として検索される（金属容器に吸収しない）', () => {
    const [product] = planSearchCalls({
      industryLabel: '製造業',
      regions: [],
      match: matchCompanyMarkets({ segments: [NIHON_METAL] }),
    });
    const art = product.input.split('\n').find((l) => l.startsWith('- 美術缶（装飾缶）:'));
    const can18 = product.input.split('\n').find((l) => l.startsWith('- 18リットル缶（一斗缶）:'));
    expect(art).toBeDefined();
    expect(can18).toBeDefined();
    expect(art).not.toBe(can18);
    expect(art).toContain('菓子・ギフト');
    expect(can18).toContain('塗料・化学品・食品');
  });

  it('不動産賃貸は、金属缶とは別の市場テーマとして検索対象に入る', () => {
    const [product] = planSearchCalls({
      industryLabel: '製造業',
      regions: [],
      match: matchCompanyMarkets({ segments: [NIHON_METAL, NIHON_REALESTATE] }),
    });
    expect(product.input).toContain('- 不動産賃貸（オフィス・住宅・店舗の賃貸）: 不動産賃貸（オフィス・住宅・店舗）の需要、空室率と賃料の動向');
  });

  it('テーマ行は上限で打ち切り、残りは汎用の1行にまとめる（検索テーマの肥大化を防ぐ）', () => {
    const many = matchCompanyMarkets({
      segments: [
        seg(['金属缶', '18L缶', '美術缶'], ['塗料メーカー', '化学品メーカー', '食品メーカー']),
        seg(['建設工事の施工会社', '店舗販売', '物流'], ['ゼネコン']),
      ],
    });
    const [product] = planSearchCalls({ industryLabel: '製造業', regions: [], match: many });
    const themeLines = product.input.split('\n').filter((l) => l.startsWith('- ') && l.includes(': ') && !l.startsWith('- 規制'));
    expect(themeLines.length).toBeLessThanOrEqual(THEME_LINE_LIMIT + 1);
    expect(product.input).toContain('上記以外の分類:');
  });

  it('複数事業: 事業ごとの見出しで製品市場を分け、検索は引き続き2回のまま', () => {
    const plans = planSearchCalls({
      industryLabel: '製造業',
      regions: [],
      match: matchCompanyMarkets({ segments: [NIHON_METAL, NIHON_REALESTATE] }),
    });
    expect(plans.map((p) => p.id)).toEqual(['product_customer', 'substitute']);
    expect(plans[0].input).toContain('事業1の製品市場（公開分類）: 金属缶・金属容器');
    expect(plans[0].input).toContain('事業2の製品市場（公開分類）: 不動産賃貸（オフィス・住宅・店舗の賃貸）');
    expect(plans[0].input).toContain('事業2の顧客業界（公開分類）: テナント・入居者');
  });

  it('検索入力には、業種名・公開ラベル・許可済みの地域・テーマだけが入る（自由記述は入らない）', () => {
    const secret = 'UNIQ-SECRET-7731';
    const match = matchCompanyMarkets({
      segments: [seg([`金属缶の製造 ${secret}`, '18L缶'], [`塗料メーカー ${secret}`, '法人 ' + secret], 11000), seg([`不動産賃貸 ${secret}`], [`入居者 ${secret}`], 3000)],
    });
    const plans = planSearchCalls({ industryLabel: '製造業', regions: ['海外（東南アジア）'], match });
    for (const p of plans) {
      expect(p.input).not.toContain(secret);
      expect(p.input).not.toContain('塗料メーカー');
      expect(p.input).toContain('業界: 製造業');
    }
  });

  it('入力の組み立ては、ラベルとテーマだけを使う', () => {
    const input = buildPlanInput({
      industryLabel: 'サービス業',
      regions: [],
      groups: [{ title: '製品市場（公開分類）', categories: [MARKET_TAXONOMY[0]] }],
      themeLines: ['金属缶・金属容器: 金属缶・金属容器の出荷数量と用途別の需要変化'],
    });
    expect(input).toContain('現在の事業展開地域: 未入力（探索対象を限定しない）');
    expect(input).toContain('- 金属缶・金属容器: 金属缶・金属容器の出荷数量と用途別の需要変化');
    expect(input).toContain('金属缶・金属容器');
    expect(input).not.toContain('金属缶製造販売事業');
  });
});
