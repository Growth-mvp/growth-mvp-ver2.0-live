import { resolveCeoIntentApply } from './ceoIntent';

const PENDING = { target: { companyId: 'c1', strategyId: 's1' }, text: '地域に頼られる会社でありたい。' };
const SCREEN = { companyId: 'c1', strategyId: 's1' };

describe('反映の適用（会社・戦略の一致と既存文章の保護）', () => {
  it('同じ会社・戦略の画面では、空の欄に入る', () => {
    expect(resolveCeoIntentApply({ pending: PENDING, screen: SCREEN, current: '' })).toBe('地域に頼られる会社でありたい。');
  });

  it('同じ会社・戦略でも、既存の文章は消さず、末尾に追記する', () => {
    expect(resolveCeoIntentApply({ pending: PENDING, screen: SCREEN, current: '既存の思い' })).toBe(
      '既存の思い\n\n地域に頼られる会社でありたい。',
    );
  });

  it('会社が違う画面では、適用しない（別会社へ持ち越さない）', () => {
    expect(resolveCeoIntentApply({ pending: PENDING, screen: { ...SCREEN, companyId: 'c2' }, current: '' })).toBeNull();
  });

  it('戦略が違う画面では、適用しない', () => {
    expect(resolveCeoIntentApply({ pending: PENDING, screen: { ...SCREEN, strategyId: 's2' }, current: '' })).toBeNull();
  });
});
