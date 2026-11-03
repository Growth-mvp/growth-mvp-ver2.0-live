import { isProgressLogCheckin } from './progressLogCheckin';

describe('確認ありの判定（本文・評価・ステータスのいずれかに有効な値）', () => {
  it.each([
    ['本文がある', { content: '点検を前倒しした' }],
    ['評価だけがある（0も有効）', { content: null, score: 0 }],
    ['ステータスだけがある', { content: null, score: null, status: '進行中' }],
  ])('%s → 確認あり', (_label, log) => {
    expect(isProgressLogCheckin(log)).toBe(true);
  });

  it.each([
    ['本文が空文字', { content: '' }],
    ['本文が空白だけ', { content: '   \n ' }],
    ['ステータスが空文字', { content: null, score: null, status: '' }],
    ['ステータスが空白だけ', { content: null, score: null, status: '  ' }],
    ['評価が NaN', { content: null, score: Number.NaN }],
    ['値が何もない', { content: null, score: null, status: null }],
    ['項目が無い', {}],
  ])('%s → 確認なし', (_label, log) => {
    expect(isProgressLogCheckin(log)).toBe(false);
  });

  it('記録そのものが無い（null / undefined）→ 確認なし', () => {
    expect(isProgressLogCheckin(null)).toBe(false);
    expect(isProgressLogCheckin(undefined)).toBe(false);
  });
});
