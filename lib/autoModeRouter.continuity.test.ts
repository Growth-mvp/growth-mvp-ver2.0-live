import { detectAutoMode } from './autoModeRouter';

describe('継続的な経営相談は help に誤判定されない（回帰6）', () => {
  it.each([
    'それで利益目標は妥当ですか',
    '前の話の施策は何件でしたか',
    '当社のSTAGE1の数字をもう一度確認したい',
    '当社の売上の推移を教えて',
    '当社のKRは何件登録されていますか',
    'その進捗はどうなっていますか',
    '当社の優先課題はどれだと思いますか',
    '当社の戦略を次の3年でどう変えるべきか',
  ])('%s → advisor', (q) => {
    expect(detectAutoMode({ lastUserText: q }).mode).toBe('advisor');
  });
});
