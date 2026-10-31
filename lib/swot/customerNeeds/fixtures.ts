import type { Stage1CustomerInput } from './roles';

/**
 * オフラインのモック用の架空の STAGE1 入力。実企業の情報ではない。
 * 特定企業の専用ルールにしないため、同じ検索・変換の経路を全ケースで使う。
 */
export const FIXTURES: Record<'canMaker' | 'storeInterior' | 'saas' | 'unconfirmed', Stage1CustomerInput> = {
  canMaker: {
    businessContent: '金属缶の製造・販売',
    segments: [
      {
        name: '金属缶製造販売事業',
        summary: '18L缶と美術缶を製造',
        mainProductsServices: ['18L缶', '美術缶'],
        keyCustomers: ['塗料メーカー', '化学品メーカー', '食品メーカー'],
      },
    ],
  },
  storeInterior: {
    businessContent: '店舗の内装工事・改装',
    segments: [
      {
        name: '店舗内装事業',
        summary: '飲食店・小売店の内装工事',
        mainProductsServices: ['店舗内装工事', '什器設置'],
        keyCustomers: ['店舗経営者'],
      },
    ],
  },
  saas: {
    businessContent: '中小企業向けの業務用SaaS',
    segments: [
      {
        name: 'SaaS事業',
        summary: '勤怠管理のクラウドサービス',
        mainProductsServices: ['勤怠管理SaaS'],
        keyCustomers: ['企業の人事部門'],
      },
    ],
  },
  unconfirmed: {
    businessContent: '地域の相談窓口の運営',
    segments: [{ name: '相談事業', summary: '相談サービス', mainProductsServices: ['相談サービス'], keyCustomers: [] }],
  },
};
