/**
 * 公開可能な市場分類マスタ。
 * - label と theme だけが Web 検索に送られる。keywords・requires は照合専用でサーバー内に留め、外部へ送らない。
 * - 企業の自由記述は照合にだけ使い、マッチしたマスタの ID とラベルだけを検索に渡す。
 * - 事業区分ごとに独立して照合し、売上の大きい事業から検索対象を選ぶ。
 * - 分類できない場合は推測せず、呼び出し側が業種レベルの検索に切り替える。
 */

export type MarketKind = 'product' | 'customer' | 'substitute' | 'criteria';

export type MarketCategory = {
  id: string;
  kind: MarketKind;
  label: string;
  /** 公開可能な検索テーマ（業種を限定しない汎用の文）。市場ごとに調べる内容を指定する */
  theme: string;
  keywords: readonly string[];
  /** 各グループから1語以上が、企業の製品・顧客テキスト全体に含まれること（汎用語の単独一致を防ぐ） */
  requires?: readonly (readonly string[])[];
  /** 一致した製品・顧客市場に関連づける分類 */
  related?: readonly string[];
  /** 関連づけだけでは追加せず、自身の語が直接一致した場合のみ使う */
  directOnly?: boolean;
};

const IT_CONTEXT = ['SaaS', '業務システム', 'システム開発', '業務用ソフトウェア', 'クラウド', 'IT'];

export const MARKET_TAXONOMY: readonly MarketCategory[] = [
  {
    id: 'p_metal_can', kind: 'product', label: '金属缶・金属容器',
    theme: '金属缶・金属容器の出荷数量と用途別の需要変化',
    keywords: ['金属缶', '金属容器', 'スチール缶', 'アルミ缶', 'ブリキ'],
    related: ['s_plastic_container', 's_paper_container', 'k_environment'],
  },
  {
    id: 'p_can_18l', kind: 'product', label: '18リットル缶（一斗缶）',
    theme: '18リットル缶の出荷動向と、塗料・化学品・食品などの用途別の需要変化',
    keywords: ['18L', '18リットル', '一斗缶'],
    related: ['s_plastic_container'],
  },
  {
    id: 'p_art_can', kind: 'product', label: '美術缶（装飾缶）',
    theme: '美術缶（装飾缶）の用途（菓子・ギフト・記念品など）と、その顧客の需要・販売動向',
    keywords: ['美術缶', '装飾缶'],
    related: ['s_paper_container'],
  },
  {
    id: 'p_construction_work', kind: 'product', label: '建設工事・設備工事',
    theme: '建設工事・設備工事の受注・施工需要の動向',
    keywords: ['建設工事', '設備工事', '空調工事', '施工会社', '施工業', '施工管理', 'リフォーム'],
    related: ['s_prefab'],
  },
  {
    id: 'p_software_saas', kind: 'product', label: '業務用ソフトウェア・SaaS',
    theme: '業務用ソフトウェア・SaaSの導入需要と競争の動向',
    keywords: ['SaaS', '業務システム', 'システム開発', '業務用ソフトウェア'],
    related: ['s_inhouse_dev'],
  },
  {
    id: 'p_retail_store', kind: 'product', label: '小売店舗・ECによる販売',
    theme: '小売店舗・EC販売の需要と販路の変化',
    keywords: ['小売', '店舗運営', '店舗販売', '直営店', 'EC', '通販', 'ネットショップ'],
    related: ['s_online_sales'],
  },
  {
    id: 'p_logistics', kind: 'product', label: '運輸・物流サービス',
    theme: '運輸・物流サービスの需要と、人手・コストの動向',
    keywords: ['物流', '運送業', '配送業', '倉庫業'],
    related: ['s_inhouse_logistics'],
  },
  {
    id: 'p_real_estate_leasing', kind: 'product', label: '不動産賃貸（オフィス・住宅・店舗の賃貸）',
    theme: '不動産賃貸（オフィス・住宅・店舗）の需要、空室率と賃料の動向',
    keywords: ['不動産賃貸', '賃貸物件', '賃貸オフィス', '賃貸住宅'],
  },

  {
    id: 'c_paint_chemical', kind: 'customer', label: '塗料・化学品メーカー',
    theme: '塗料・化学品メーカーの容器調達と需要の変化',
    keywords: ['塗料', '化学品', '化学メーカー', '接着剤', 'インキ'],
  },
  {
    id: 'c_food_maker', kind: 'customer', label: '食品・飲料メーカー',
    theme: '食品・飲料メーカーの容器調達と需要の変化',
    keywords: ['食品メーカー', '飲料メーカー', '食品会社'],
    related: ['k_environment'],
  },
  {
    id: 'c_manufacturer', kind: 'customer', label: '製造業（各種メーカー）',
    theme: '製造業の調達・設備投資の変化',
    keywords: ['製造業', '工場向け'],
  },
  {
    id: 'c_construction_owner', kind: 'customer', label: '建設会社・不動産オーナー',
    theme: '建設会社・不動産オーナーの投資と調達の変化',
    keywords: ['建設会社', 'ゼネコン', '不動産オーナー', '不動産会社', 'ビルオーナー'],
  },
  {
    id: 'c_enterprise', kind: 'customer', label: '法人（企業の情報システム部門など）',
    theme: '法人（企業の情報システム部門）のIT導入判断の変化',
    keywords: ['法人', '企業向け', '情報システム部門'],
    requires: [IT_CONTEXT],
  },
  {
    id: 'c_consumer', kind: 'customer', label: '一般消費者',
    theme: '一般消費者の購買行動と、商品・容器に対する選好の変化',
    keywords: ['一般消費者', '個人向け', '家庭向け', '個人のお客様'],
  },
  {
    id: 'c_tenant', kind: 'customer', label: 'テナント・入居者',
    theme: 'テナント・入居者の賃借需要と、契約条件の変化',
    keywords: ['賃借人', '入居者', '入居企業'],
  },

  {
    id: 's_plastic_container', kind: 'substitute', label: '樹脂容器・プラスチック容器',
    theme: '樹脂容器・プラスチック容器による代替の普及と、金属容器との競争',
    keywords: ['樹脂容器', 'プラスチック容器'],
  },
  {
    id: 's_paper_container', kind: 'substitute', label: '紙容器・紙製包装',
    theme: '紙容器・紙製包装による代替の普及と、競争条件の変化',
    keywords: ['紙容器', '紙パック', '紙箱'],
    directOnly: true,
  },
  {
    id: 's_prefab', kind: 'substitute', label: '工場生産・モジュール化による施工',
    theme: '工場生産・モジュール化による施工の普及と、現場施工との競争',
    keywords: ['プレハブ', 'モジュール工法'],
  },
  {
    id: 's_inhouse_dev', kind: 'substitute', label: '内製化・自社開発',
    theme: '内製化・自社開発による代替の広がり',
    keywords: ['内製化', '自社開発'],
  },
  {
    id: 's_online_sales', kind: 'substitute', label: 'ネット通販・デジタル販売',
    theme: 'ネット通販・デジタル販売への販路の移行',
    keywords: ['ネット通販', 'デジタル販売', 'オンライン販売'],
  },
  {
    id: 's_inhouse_logistics', kind: 'substitute', label: '自社配送・物流の内製化',
    theme: '自社配送・物流の内製化の動向',
    keywords: ['自社配送'],
  },

  {
    id: 'k_environment', kind: 'criteria', label: '環境性能・リサイクル性（購買基準の変化）',
    theme: '環境性能・リサイクル性（再資源化・軽量化）に関する顧客の購買基準の変化',
    keywords: ['リサイクル', '再資源化', '軽量化', '環境対応', '脱炭素'],
  },
];

export const MARKET_CATEGORY_IDS: ReadonlySet<string> = new Set(MARKET_TAXONOMY.map((c) => c.id));

const SEGMENT_CAP = { product: 3, customer: 3 };
const COMPANY_CAP = { product: 6, customer: 6, substitute: 2, criteria: 1 };

/** 製品・顧客検索で市場ごとのテーマ行を立てる上限。超えた市場はラベルだけを渡し、汎用テーマ1行にまとめる */
export const THEME_LINE_LIMIT = 6;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ASCII の語は前後が英数字でないことを確認する（"EC" が "ECO" に当たらないように） */
export function keywordHit(text: string, keyword: string): boolean {
  if (/^[\x21-\x7e]+$/.test(keyword)) {
    return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(keyword)}(?![A-Za-z0-9])`, 'i').test(text);
  }
  return text.includes(keyword);
}

export type SegmentInput = {
  revenue?: number;
  productTexts: readonly string[];
  customerTexts: readonly string[];
};

export type CompanyInput = {
  businessContent?: string;
  segments: readonly SegmentInput[];
};

export type SegmentMatch = {
  rank: number;
  product: MarketCategory[];
  customer: MarketCategory[];
};

export type CompanyMatch = {
  segments: SegmentMatch[];
  product: MarketCategory[];
  customer: MarketCategory[];
  substitute: MarketCategory[];
  criteria: MarketCategory[];
  unmatchedSegments: number;
  droppedCategories: number;
};

type Evidence = { product: string; customer: string };

const joinTexts = (texts: readonly string[]) => texts.map((t) => t.trim()).filter(Boolean).join('\n');
const allText = (ev: Evidence) => `${ev.product}\n${ev.customer}`;

function categoryHits(c: MarketCategory, ev: Evidence): boolean {
  const own = c.kind === 'customer' ? ev.customer : c.kind === 'criteria' ? allText(ev) : ev.product;
  if (!c.keywords.some((k) => keywordHit(own, k))) return false;
  return (c.requires ?? []).every((group) => group.some((k) => keywordHit(allText(ev), k)));
}

function matchEvidence(ev: Evidence) {
  const product = MARKET_TAXONOMY.filter((c) => c.kind === 'product' && categoryHits(c, ev)).slice(0, SEGMENT_CAP.product);
  const customer = MARKET_TAXONOMY.filter((c) => c.kind === 'customer' && categoryHits(c, ev)).slice(0, SEGMENT_CAP.customer);
  const linked = new Set([...product, ...customer].flatMap((c) => c.related ?? []));
  const secondary = (kind: 'substitute' | 'criteria') =>
    MARKET_TAXONOMY.filter((c) => c.kind === kind && ((linked.has(c.id) && !c.directOnly) || categoryHits(c, ev)))
      .sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)));
  return { product, customer, substitute: secondary('substitute'), criteria: secondary('criteria') };
}

function takeUnique(list: MarketCategory[], seen: Set<string>, left: number): MarketCategory[] {
  const out: MarketCategory[] = [];
  for (const c of list) {
    if (out.length >= left) break;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function takeUniqueAcross(lists: MarketCategory[][], max: number): MarketCategory[] {
  return takeUnique(lists.flat(), new Set(), max);
}

/**
 * 事業区分ごとに照合する。売上の大きい事業を先に採用し、全社の上限を超えた分は外す。
 * 事業区分に一致が無く事業概要がある場合のみ、会社全体の事業概要で照合する。
 */
export function matchCompanyMarkets(input: CompanyInput): CompanyMatch {
  const ordered = input.segments
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.revenue ?? 0) - (a.s.revenue ?? 0) || a.i - b.i)
    .map(({ s }) => ({ product: joinTexts(s.productTexts), customer: joinTexts(s.customerTexts) }));
  const perSegment = ordered.map((ev) => matchEvidence(ev));
  const anyPrimary = perSegment.some((m) => m.product.length > 0 || m.customer.length > 0);
  const businessContent = input.businessContent?.trim() ?? '';
  const sources = !anyPrimary && businessContent ? [matchEvidence({ product: businessContent, customer: '' })] : perSegment;

  const products = allocate(sources.map((m) => m.product), COMPANY_CAP.product);
  const customers = allocate(sources.map((m) => m.customer), COMPANY_CAP.customer);
  const segments: SegmentMatch[] = sources.map((_, i) => ({
    rank: i + 1,
    product: products.picked[i],
    customer: customers.picked[i],
  }));

  return {
    segments,
    product: segments.flatMap((s) => s.product),
    customer: segments.flatMap((s) => s.customer),
    substitute: takeUniqueAcross(sources.map((m) => m.substitute), COMPANY_CAP.substitute),
    criteria: takeUniqueAcross(sources.map((m) => m.criteria), COMPANY_CAP.criteria),
    unmatchedSegments: segments.filter((s) => s.product.length === 0 && s.customer.length === 0).length,
    droppedCategories: products.dropped + customers.dropped,
  };
}

/** 各事業に最低1件を先に確保し、残りを売上順に配分する（小規模事業の市場が上限で消えないように） */
function allocate(lists: MarketCategory[][], max: number): { picked: MarketCategory[][]; dropped: number } {
  const seen = new Set<string>();
  const picked: MarketCategory[][] = lists.map(() => []);
  let total = 0;
  const take = (i: number, c: MarketCategory) => {
    seen.add(c.id);
    picked[i].push(c);
    total++;
  };
  lists.forEach((list, i) => {
    const first = list.find((c) => !seen.has(c.id));
    if (first && total < max) take(i, first);
  });
  lists.forEach((list, i) => {
    for (const c of list) {
      if (total >= max) break;
      if (!seen.has(c.id)) take(i, c);
    }
  });
  const available = new Set(lists.flat().map((c) => c.id)).size;
  return { picked, dropped: available - total };
}

/**
 * テーマ行を立てる市場の順序。事業ごとの先頭の市場を先に並べ、小規模事業の市場が後方に回らないようにする。
 */
export function themeCandidates(match: CompanyMatch): MarketCategory[] {
  const depth = Math.max(0, ...match.segments.map((s) => Math.max(s.product.length, s.customer.length)));
  const out: MarketCategory[] = [];
  const seen = new Set<string>();
  for (let d = 0; d < depth; d++) {
    for (const s of match.segments) {
      for (const c of [s.product[d], s.customer[d]]) {
        if (c && !seen.has(c.id)) {
          seen.add(c.id);
          out.push(c);
        }
      }
    }
  }
  return out;
}

export const MACRO_THEME = '規制・GX・技術革新が、上記の市場や顧客に具体的に与える影響（関係が示せる場合のみ）';
const GENERAL_THEME = '上記以外の分類（一覧の市場）について、需要・用途・競争の動向';

export type SearchPlan = {
  id: 'product_customer' | 'substitute' | 'customer_need';
  categoryIds: string[];
  categoryLabels: string[];
  /** 検索結果の市場ラベルを分類 ID に戻すための対応（公開ラベルとテーマだけ） */
  categories: Array<{ id: string; label: string; theme: string }>;
  layers: MarketKind[];
  input: string;
};

export const regionReference = (regions: readonly string[]) =>
  regions.length
    ? `現在の事業展開地域（参考。探索対象を限定しない）: ${regions.join('、')}`
    : '現在の事業展開地域: 未入力（探索対象を限定しない）';

/** 検索入力に入れてよいのは、業種ラベル・公開分類のラベル・公開テーマ・許可済みの地域名だけ */
export function buildPlanInput(args: {
  industryLabel: string;
  regions: readonly string[];
  groups: Array<{ title: string; categories: readonly MarketCategory[] }>;
  themeLines: readonly string[];
  macro?: boolean;
}): string {
  const lines = [...(args.industryLabel ? [`業界: ${args.industryLabel}`] : []), regionReference(args.regions)];
  for (const g of args.groups) {
    if (g.categories.length) lines.push(`${g.title}: ${g.categories.map((c) => c.label).join('、')}`);
  }
  lines.push(
    '',
    '次の市場ごとに、上の市場分類に直接関係する公開情報を調べてください。各行は「市場ラベル: 事実を1文」で書き、市場ラベルは下の一覧の名前をそのまま使ってください。',
    ...args.themeLines.map((t) => `- ${t}`),
    ...(args.macro ? [`- ${MACRO_THEME}`] : []),
    '',
    '1市場につき1件以上、事実を1文で書いてください。数値には、実績か予測か、年度・暦年・月次のどれか、対象地域を明記してください。同じ事実を複数の市場に書かないでください。'
  );
  return lines.join('\n');
}

const themeLine = (c: MarketCategory) => `${c.label}: ${c.theme}`;

/**
 * 分類に一致した内容から検索の呼び出しを作る。
 * - 製品・顧客市場は1回の検索にまとめ、市場ごとのテーマ行を立てる（上限を超えた市場は汎用テーマ1行にまとめる）
 * - 代替品・購買基準の変化は必要な場合だけ2回目に回す（検索回数を最小にする）
 * - 一致が無ければ空を返し、呼び出し側が業種レベルの検索を使う（推測はしない）
 */
export function planSearchCalls(args: { industryLabel: string; regions: readonly string[]; match: CompanyMatch }): SearchPlan[] {
  const plans: SearchPlan[] = [];
  const { match } = args;
  const multi = match.segments.length > 1;
  const prefix = (rank: number) => (multi ? `事業${rank}の` : '');

  const primaryGroups = match.segments.flatMap((s) => [
    { title: `${prefix(s.rank)}製品市場（公開分類）`, categories: s.product },
    { title: `${prefix(s.rank)}顧客業界（公開分類）`, categories: s.customer },
  ]);
  const primary = primaryGroups.flatMap((g) => g.categories);
  if (primary.length) {
    const ordered = themeCandidates(match);
    const themed = ordered.slice(0, THEME_LINE_LIMIT);
    const themeLines = [
      ...themed.map(themeLine),
      ...(ordered.length > THEME_LINE_LIMIT ? [`上記以外の分類: ${GENERAL_THEME}`] : []),
    ];
    plans.push({
      id: 'product_customer',
      categoryIds: primary.map((c) => c.id),
      categoryLabels: primary.map((c) => c.label),
      categories: primary.map((c) => ({ id: c.id, label: c.label, theme: c.theme })),
      layers: [
        ...(match.segments.some((s) => s.product.length > 0) ? (['product'] as const) : []),
        ...(match.segments.some((s) => s.customer.length > 0) ? (['customer'] as const) : []),
      ],
      input: buildPlanInput({
        industryLabel: args.industryLabel,
        regions: args.regions,
        groups: primaryGroups,
        themeLines,
      }),
    });
  }

  const secondary = [...match.substitute, ...match.criteria];
  if (secondary.length) {
    plans.push({
      id: 'substitute',
      categoryIds: secondary.map((c) => c.id),
      categoryLabels: secondary.map((c) => c.label),
      categories: secondary.map((c) => ({ id: c.id, label: c.label, theme: c.theme })),
      layers: [
        ...(match.substitute.length ? (['substitute'] as const) : []),
        ...(match.criteria.length ? (['criteria'] as const) : []),
      ],
      input: buildPlanInput({
        industryLabel: args.industryLabel,
        regions: args.regions,
        groups: [
          { title: '代替品・新用途（公開分類）', categories: match.substitute },
          { title: '購買基準の変化（公開分類）', categories: match.criteria },
        ],
        themeLines: secondary.map(themeLine),
        macro: true,
      }),
    });
  }

  return plans;
}
