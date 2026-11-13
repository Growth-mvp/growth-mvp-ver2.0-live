/* 検証用の架空の企業・利用者（eval/db/testEnv.ts の IDS と同じ値。ブラウザ側のスタブが使う） */
export const IDS = {
  companyA: '00000000-0000-4000-8000-00000000c0de',
  strategyA: '00000000-0000-4000-8000-0000000057a1',
  alice: '00000000-0000-4000-8000-00000000a11c',
} as const;

export const RENEWAL_TITLE = '既存顧客の保守契約更新';
