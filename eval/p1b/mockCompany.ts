// P1-B 評価用のモック企業（実顧客データではない）
export const MOCK_COMPANY_ROW: Record<string, any> = {
  id: 'strategy-a',
  departments: [],
  answers2: [],
  companyName: 'モック株式会社',
  ceoIntent: '既存顧客の業務効率を上げ、地域での信頼を次の成長の土台にしたい。',
  answers12: [
    { id: 'ch0-q1', answer: '既存の製造業顧客で受注が減り、価格競争が激化している。' },
    { id: 'ch0-q2', answer: '放置すると、顧客の信頼と若手社員の機会を失う。' },
    { id: 'ch1-q1', answer: '3〜5年後、中小製造業では設備の保守人材が不足し、点検の遅れが困りごとになる。' },
    {
      id: 'ch1-q2',
      answer:
        '点検の確実さと速さが選ばれる理由になる。\n\n【AI深掘りで追加した考え】\n現場の点検記録の入力をタブレット化し、報告を当日中にする。',
      deepDive: {
        question: 'その速さは、どの作業の短縮で実現しますか？',
        answer: '現場の点検記録の入力をタブレット化し、報告を当日中にする。',
        appliedAnswer: '現場の点検記録の入力をタブレット化し、報告を当日中にする。',
        appliedBlock: '\n\n【AI深掘りで追加した考え】\n現場の点検記録の入力をタブレット化し、報告を当日中にする。',
      },
    },
    { id: 'ch1-q3', answer: '保守記録を蓄積してきた社内のノウハウ。' },
    {
      id: 'ch1-q4',
      answer: '若手への技術の引き継ぎに時間がかかる。',
      deepDive: {
        question: '引き継ぎの遅れは、どの工程で起きていますか？',
        answer: '点検の判断基準が人に依存している。',
      },
    },
    { id: 'ch1-q5', answer: '' },
    { id: 'ch1-q6', answer: '' },
    { id: 'ch2-q1', answer: '地域の中小製造業向けに点検サービスを提供する。' },
    { id: 'ch2-q2', answer: '' },
    { id: 'ch3-q1', answer: '1〜2年で点検の標準化を完了する。' },
    { id: 'ch3-q2', answer: '' },
  ],
  finalStoryFinal: [
    { title: '危機', body: '価格競争で受注が減り、顧客の信頼を失う危機にある。' },
    { title: '提供価値', body: '点検の確実さと速さを、地域の中小製造業に届ける。' },
    { title: '強みと課題', body: '保守記録のノウハウを、点検の標準化で社内に広げる。' },
    { title: '実行', body: '1〜2年で点検の標準化を完了する。' },
  ],
  finalStory: [{ title: '旧版', body: '古い生成結果。確定版と食い違う内容。' }],
  winPatternsCandidate: [
    {
      id: 'wp-1',
      name: '保守の標準化で選ばれる点検サービス',
      valueDrivers: ['成長性', '収益性'],
      rationale: '点検の遅れが顧客の困りごとであり、標準化で解決できるため。',
      tradeoffs: '受注件数を一時的に減らす可能性。',
    },
    {
      id: 'wp-2',
      name: '部品販売の拡大',
      valueDrivers: ['市場評価'],
      rationale: '',
      tradeoffs: '',
    },
  ],
  winPatternPrimary: null,
  businessSegments: [{ name: '点検サービス' }, { name: '部品販売' }],
  financePL: [
    { year: 2021, revenue: 1_000_000_000, operatingIncome: 50_000_000 },
    { year: 2022, revenue: 1_100_000_000, operatingIncome: 66_000_000 },
    { year: 2023, revenue: 1_210_000_000, operatingIncome: 84_700_000 },
    { year: 2024, revenue: 1_331_000_000, operatingIncome: 106_480_000 },
  ],
  financeBS: [{ year: 2024, netAssets: 500_000_000, interestBearingDebt: 200_000_000 }],
  pbrManual: '1.5',
  stage1Benchmarks: { waccManual: 8 },
};

export const MOCK_EMPTY_ROW: Record<string, any> = {
  id: 'strategy-b',
  departments: [],
  answers2: [],
  finalStory: [],
};
