import { detectAutoMode } from './autoModeRouter';

const mode = (text: string) => detectAutoMode({ lastUserText: text }).mode;

describe('経営相談は advisor へ（評価の10問）', () => {
  it.each([
    'なぜ当社の利益は伸びないのか？',
    '今の経営戦略で3年後に成長できるか？',
    '新規事業に参入すべきか？',
    '営業部門の活動は全社戦略と整合しているか？',
    '営業部と製造部の対立をどう解消すべきか？',
    '人材採用と設備投資のどちらを優先すべきか？',
    '資金繰りが厳しくなったらどうすべきか？',
    'この事業から撤退すべきか？',
    '来月から何を変えれば業績が改善するか？',
    '社長が今、最も優先すべきことは何か？',
  ])('%s', (q) => {
    expect(mode(q)).toBe('advisor');
  });
});

describe('STAGE4 の問い合わせは advisor へ', () => {
  it.each([
    '営業部門は来月何をする予定か？',
    '誰がこのプロジェクトを担当しているか？',
    'この施策はいつまでに完了するのか？',
    '営業部門のOKRは全社戦略と整合しているか？',
    '現在の実行計画で売上目標を達成できるか？',
  ])('%s', (q) => {
    expect(mode(q)).toBe('advisor');
  });

  it.each(['担当者の入力欄はどこ？', 'STAGE4の予定はどこで確認できる？'])('画面の場所を聞く質問は help: %s', (q) => {
    expect(mode(q)).toBe('help');
  });
});

describe('help 固定の誤判定を解消する', () => {
  it.each([
    'STAGE3の部門の役割は全社戦略と整合しているか？',
    'STAGE3で決めた内容は、今の戦略と矛盾していないか？',
    'この戦略を画面で見直すべきか判断したい',
    'GROWTH SHIFTで、わが社の売上をどう伸ばすべきか？',
    '権限の違う社員の意見を、経営判断にどう反映すべきか？',
  ])('相談は advisor: %s', (q) => {
    expect(mode(q)).toBe('advisor');
  });
});

describe('施策・方針の妥当性を尋ねる人事・組織の相談は advisor へ', () => {
  it.each([
    '人事部として、各部門の社員に必要なスキルを洗い出し、研修計画を作ろうと考えています。この進め方でよいでしょうか？',
    '人事部として研修計画を作ろうと思う。どうか？',
    '部門間連携を改善するため、経営企画部が共通KPIと定例会議の仕組みを設計しようと考えています。これで部門間の協力関係は改善するでしょうか？',
  ])('%s', (q) => {
    expect(mode(q)).toBe('advisor');
  });
});

describe('操作案内は help へ（既存の操作案内の精度を維持）', () => {
  it.each([
    'STAGE4の入力の進め方を教えて',
    'STAGE4の入力の進め方はこれでよいか？',
    'この画面では何をすればいい？',
    'そんなボタンが見当たらないけど？',
    '初めて使うんだけど、何から始めたらいい？',
    'STAGE3の部門戦略を部門に反映するにはどうすればいい？',
    '経営計画書を作りたい',
    'SWOTの入力欄はどこ？',
  ])('%s', (q) => {
    expect(mode(q)).toBe('help');
  });
});

describe('製品説明とトラブル対応は help へ', () => {
  it.each([
    'GROWTH SHIFTとは何ですか？',
    'STAGE2とは何をする場所？',
    '保存できないのですが',
    '画面が表示されない',
  ])('%s', (q) => {
    expect(mode(q)).toBe('help');
  });
});

describe('入力が空', () => {
  it('advisor を既定にする', () => {
    expect(detectAutoMode({ lastUserText: '   ' })).toEqual({
      mode: 'advisor',
      confidence: 0.55,
      reasons: ['empty text, default to advisor'],
    });
  });
});
