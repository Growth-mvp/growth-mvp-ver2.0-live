import { DRAFT_CHAPTER_HEADINGS, extractStrategyConclusion, parseStrategyChapter } from './draftStoryView';

const CHAPTER2_NEW = `戦略結論：制御設計を成長の中核に据え、低採算の受託を見直す仮説を検証する。
事業ポートフォリオ判断：制御設計は成長候補、既存受託は見直し対象とする。
1) 勝ち筋：EV向け制御設計の受託拡大
   重要課題・機会：自動車部品メーカーの制御ソフト人材不足
   戦略の方向性：設計初期から制御設計を受託する
   成功する根拠：設計開発力と長期関係（仮説）
   克服すべき障害・リスク：人材不足が制約になる
   狙う価値ドライバー：売上CAGR・営業利益率
   経営判断：制御設計への投資配分を増やし、低採算の受託を縮小する
   主要戦略：
   - 重点顧客を3社に絞る
   - 設計初期の関与範囲を決める
   90日アクション：
   - 投資配分案を経営会議に提出する
   根拠キーワード：EV化 / 設計開発力 / 人材不足
   トレードオフ：小口受託を縮小する
2) 勝ち筋：既存受託の採算改善
   重要課題・機会：価格競争による採算悪化
   戦略の方向性：仕様確定前に原価を提示する
   成功する根拠：長期関係（仮説）
   克服すべき障害・リスク：値上げで失注する可能性
   狙う価値ドライバー：営業利益率
   経営判断：価格基準を改定し、採算割れの案件から撤退する
   主要戦略：
   - 案件別の採算表を導入する
   90日アクション：
   - 撤退候補の案件リストを作る
   根拠キーワード：価格競争 / 長期関係 / 営業利益率
   トレードオフ：売上の一部を失う`;

const LEGACY_INLINE = `戦略結論：A事業を成長牽引軸、B事業を収益改善軸として扱う。 事業ポートフォリオ判断：成長牽引軸：A｜収益改善軸：B｜再構築軸：C 1) 勝ち筋：食品向け冷凍配送の高付加価値化 狙う価値ドライバー：営業利益率 SWOT判断：S×O：強みの配送網で機会を取る 経営判断：重点顧客を3社に絞る 主要戦略： - 冷凍配送の重点顧客を選定 90日アクション： - 投資配分案を作る 根拠キーワード：配送網 / 冷凍 / 機会 トレードオフ：小口顧客を縮小 2) 勝ち筋：既存配送の再構築 狙う価値ドライバー：ROIC SWOT判断：W×T：弱みと脅威が重なる領域を縮小 経営判断：撤退基準を決める 主要戦略： - 赤字ルートを見直す 90日アクション： - 撤退候補を選ぶ 根拠キーワード：人材不足 / 価格競争 トレードオフ：売上減`;

const FIELD_LABELS = [
  '重要課題・機会',
  '戦略の方向性',
  '成功する根拠',
  '克服すべき障害・リスク',
  '狙う価値ドライバー',
  '経営判断',
  '主要戦略',
  '90日アクション',
  '根拠キーワード',
  'トレードオフ',
];

describe('parseStrategyChapter', () => {
  it('新形式の戦略結論・事業判断・勝ち筋を分解し、戦略結論を先頭から取り除く', () => {
    const parsed = parseStrategyChapter(CHAPTER2_NEW);

    expect(parsed.conclusion).toBe('制御設計を成長の中核に据え、低採算の受託を見直す仮説を検証する。');
    expect(parsed.preamble.map((f) => f.label)).toEqual(['事業ポートフォリオ判断']);
    expect(parsed.patterns).toHaveLength(2);
    expect(parsed.patterns[0].title).toBe('EV向け制御設計の受託拡大');
    expect(parsed.patterns[0].fields.map((f) => f.label)).toEqual(FIELD_LABELS);
  });

  it('主要戦略と90日アクションを箇条書きとして保持する', () => {
    const [first] = parseStrategyChapter(CHAPTER2_NEW).patterns;
    const strategy = first.fields.find((f) => f.label === '主要戦略');
    const action = first.fields.find((f) => f.label === '90日アクション');

    expect(strategy?.items).toEqual(['重点顧客を3社に絞る', '設計初期の関与範囲を決める']);
    expect(action?.items).toEqual(['投資配分案を経営会議に提出する']);
  });

  it('新ラベルが1行に連結されていても項目ごとに分解する', () => {
    const inline =
      '戦略結論：テスト。 1) 勝ち筋：新規受注 重要課題・機会：需要の拡大 戦略の方向性：投資を集中 成功する根拠：技術力 克服すべき障害・リスク：人材不足 経営判断：投資配分を決める';
    const [pattern] = parseStrategyChapter(inline).patterns;

    expect(pattern.title).toBe('新規受注');
    expect(pattern.fields.map((f) => f.label)).toEqual([
      '重要課題・機会',
      '戦略の方向性',
      '成功する根拠',
      '克服すべき障害・リスク',
      '経営判断',
    ]);
  });

  it('旧形式（1行に連結されたSWOT判断・事業ポートフォリオ判断）も欠落なく分解する', () => {
    const parsed = parseStrategyChapter(LEGACY_INLINE);

    expect(parsed.conclusion).toBe('A事業を成長牽引軸、B事業を収益改善軸として扱う。');
    expect(parsed.preamble.map((f) => f.label)).toEqual(['事業ポートフォリオ判断']);
    expect(parsed.patterns.map((p) => p.title)).toEqual(['食品向け冷凍配送の高付加価値化', '既存配送の再構築']);
    expect(parsed.patterns[0].fields.map((f) => f.label)).toContain('SWOT判断');
    expect(parsed.patterns[1].fields.find((f) => f.label === '根拠キーワード')?.text).toBe('人材不足 / 価格競争');
  });

  it('勝ち筋を含まない本文は patterns が空になり、本文は preamble に残る', () => {
    const parsed = parseStrategyChapter('戦略結論：一般的な方針を示す。\n補足：詳細は未入力。');

    expect(parsed.patterns).toEqual([]);
    expect(parsed.conclusion).toBe('一般的な方針を示す。');
    expect(parsed.preamble.map((f) => f.label)).toEqual(['補足']);
  });

  it.each([
    ['新形式', CHAPTER2_NEW],
    ['旧形式', LEGACY_INLINE],
  ])('%s では本文の各行の内容がいずれかの項目に残る（情報の欠落がない）', (_name, body) => {
    const parsed = parseStrategyChapter(body);
    const rendered = [
      parsed.conclusion ?? '',
      ...parsed.preamble.flatMap((f) => [f.label, f.text, ...f.items]),
      ...parsed.patterns.flatMap((p) => [p.title, ...p.fields.flatMap((f) => [f.label, f.text, ...f.items])]),
    ].join('\n');

    const sourceLines = body
      .replace(/([^\d)）\s])\s+(?=(?:\d+\)\s*)?(?:勝ち筋|狙う|経営判断|主要戦略|90日|根拠|トレードオフ|SWOT|事業ポートフォリオ|戦略結論))/g, '$1\n')
      .split('\n')
      .map((line) => line.trim().replace(/^[-・]\s*/, '').replace(/^\d+\)\s*/, ''))
      .filter(Boolean);

    for (const line of sourceLines) {
      const value = line.replace(/^[^:：]{1,24}[:：]\s*/, '').replace(/^[-・]\s*/, '');
      expect(rendered).toContain(value);
    }
  });
});

describe('extractStrategyConclusion', () => {
  it('第2章の戦略結論を省略せず返す', () => {
    const long = `${'制御設計の受託を拡大する。'.repeat(20)}`;
    const conclusion = extractStrategyConclusion([
      { body: '要点：現状の論点' },
      { body: `戦略結論：${long}\n1) 勝ち筋：テスト` },
    ]);

    expect(conclusion).toBe(long);
  });

  it('戦略結論がない旧データは第1章の要点を使い、180字で切る', () => {
    const lead = 'あ'.repeat(200);
    const conclusion = extractStrategyConclusion([{ body: `要点：${lead}` }, { body: '第2章の本文' }]);

    expect(conclusion).toBe(`${'あ'.repeat(180)}…`);
  });

  it('本文がすべて空なら null を返す', () => {
    expect(extractStrategyConclusion([{ body: '' }, { body: '' }])).toBeNull();
  });
});

describe('DRAFT_CHAPTER_HEADINGS', () => {
  it('4章の表示見出しを順序通りに持つ', () => {
    expect(DRAFT_CHAPTER_HEADINGS).toHaveLength(4);
    expect(DRAFT_CHAPTER_HEADINGS[1]).toBe('第2章：どう戦うのか');
  });
});
