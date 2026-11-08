import { followUpQuestionsOf, nextFollowUp } from './followUpQuestions';

/* 実OpenAIの生成結果（前回の評価で得た確認事項をそのまま使用） */
const DELIVERY_ITEMS = [
  '中規模製造業の候補企業リストと、実際に提案可能な社数',
  '新規法人提案の過去受注率、または初期提案での受注率',
  '新規契約の平均売上額、契約期間、最低料金の決定根拠',
  '新規契約1件あたりの運行・配車等の追加費用と限界利益',
  '繁忙期の追加配送の対象件数、現状の請求件数、有料化率の分母定義',
  '追加配送の料金案、顧客への事前提示方法、追加費用との採算',
  '配車部が確認した繁忙期の受け入れ可能枠',
  '施策に必要な営業工数やその他の投資額',
];
const FITNESS_ITEMS = [
  '直近12か月の月別期首・期末会員数、退会者数、月間退会率、および退会率の分母定義',
  '直近12か月の月別体験参加者数・入会者数、体験からの入会率、および入会率の分母定義',
  '会員区分別の月額単価と法人契約の対象範囲・売上計上方法',
  '体験参加から入会までの経過日数、連絡実施率、未入会理由',
  '退会相談者数、面談実施数、面談後の継続数と退会理由',
  'トレーナーの対応可能枠、シフト調整の可否、施策に必要な費用',
  '月間退会率2.5%・体験からの入会率40%という2027年5月の仮目標が、実績と事業条件に照らして妥当か',
];
const MANUFACTURING_ITEMS = [
  '医療機器部品などの顧客候補数、候補企業の加工ニーズと利用意向',
  '候補企業ごとの要求精度・品質・納期・価格条件と自社の対応可否',
  '新用途の試作を受けられる件数、設計部との優先順位、見積もり対応に必要な期間',
  '見積もりから受注への転換率、平均受注額、案件ごとの粗利・採算条件',
  '主力部品の原価率の基準値、対象部品の売上・原価と算出期間',
  '主力部品の原価上昇要因、改善策ごとの削減見込みと実測削減額',
  '新用途の試作・原価改善に必要な設備、人員、外部費用などの投資額',
];

const questionsFor = (items: string[], projectText: string) =>
  followUpQuestionsOf({ reasoning: { verificationItems: items }, projectText, hasCausalWhyUs: true });

describe('AIの確認事項から質問を作る：事業ごとに質問が変わる', () => {
  it('配送：候補社数・受注率・単価・追加費用・受け入れ枠を、影響の大きい順に出す', () => {
    const ids = questionsFor(DELIVERY_ITEMS, '法人顧客の新規獲得と採算改善').map((q) => q.id);
    expect(ids).toEqual(['candidates', 'conversion', 'deal_value', 'reason_for_us', 'selection_condition', 'capacity', 'extra_cost', 'surcharge_base']);
  });

  it('フィットネス：会員数・退会率・月額会費・入会率を出し、仮目標の妥当性は質問にしない（KPIの採用で扱う）', () => {
    const qs = questionsFor(FITNESS_ITEMS, '会員獲得・退会抑制・継続率改善');
    expect(qs.map((q) => q.id)).toEqual(['member_count', 'churn', 'monthly_fee', 'conversion_member', 'reason_for_us', 'capacity', 'churn_reason']);
    expect(qs.some((q) => q.source.includes('仮目標'))).toBe(false);
    expect(qs.find((q) => q.id === 'monthly_fee')!.unit).toBe('円');
  });

  it('製造業：候補数・転換率・平均受注額・認証/技術条件・原価の基準値を出し、投資額は出さない', () => {
    const qs = questionsFor(MANUFACTURING_ITEMS, '新用途開拓と既存事業の採算改善');
    expect(qs.map((q) => q.id)).toEqual(['candidates', 'conversion', 'deal_value', 'compliance', 'reason_for_us', 'capacity', 'extra_cost', 'cost_base']);
    expect(qs.some((q) => /投資/.test(q.text))).toBe(false);
  });

  it('同じ種類の質問は1問にまとめ、事業ごとの質問文が混ざらない', () => {
    const d = questionsFor(DELIVERY_ITEMS, '').map((q) => q.text).join(' ');
    const f = questionsFor(FITNESS_ITEMS, '').map((q) => q.text).join(' ');
    expect(d).not.toContain('会員数');
    expect(f).not.toContain('営業候補');
  });

  it('認証・規制の確認は、製造の新用途など施策の内容に応じて補い、業界の規制を断定しない', () => {
    const qs = followUpQuestionsOf({ reasoning: { verificationItems: ['既存品の原価'] }, projectText: '新用途（医療機器部品）への展開' });
    const c = qs.find((q) => q.id === 'compliance')!;
    expect(c.text).toContain('分からなければ保留');
    expect(c.source).toContain('施策の内容から補完');
  });

  it('対応する質問パターンが無い確認事項も、回答できる形で残す', () => {
    const qs = followUpQuestionsOf({ reasoning: { verificationItems: ['社内の承認スケジュールの見通し'] } });
    expect(qs[0].text).toBe('「社内の承認スケジュールの見通し」を確認できますか？');
    expect(qs[0].answerType).toBe('text');
  });

  it('AIの確認事項が無ければ、質問は出さない', () => {
    expect(followUpQuestionsOf({ reasoning: undefined })).toEqual([]);
  });
});

describe('今出す質問（1問ずつ）：既存情報・回答・保留を除く', () => {
  const qs = questionsFor(DELIVERY_ITEMS, '法人顧客の新規獲得');

  it('先頭の1問だけを出す（影響の大きいもの＝候補社数）', () => {
    const n = nextFollowUp(qs, undefined, {});
    expect(n.current?.id).toBe('candidates');
  });

  it('既に構造化項目に値がある質問は省略する（例：候補社数が入っていれば次へ）', () => {
    const n = nextFollowUp(qs, undefined, { targetCustomers: 30 });
    expect(n.known.map((q) => q.id)).toContain('candidates');
    expect(n.current?.id).toBe('conversion');
  });

  it('AIが仮に入れた値は既存情報とみなさず、利用者が確認するまで質問に残す', () => {
    const prov = { targetCustomers: { source: 'AI_DRAFT' as const, basis: 'HYPOTHESIS' as const } };
    expect(nextFollowUp(qs, undefined, { targetCustomers: 30 }, prov).current?.id).toBe('candidates');
    const confirmed = { targetCustomers: { source: 'AI_DRAFT' as const, basis: 'HYPOTHESIS' as const, userConfirmed: true } };
    expect(nextFollowUp(qs, undefined, { targetCustomers: 30 }, confirmed).known.map((q) => q.id)).toContain('candidates');
  });

  it('回答済み・保留の質問は次の質問に進め、保留は別に残す', () => {
    const records = {
      candidates: { status: 'answered' as const, value: 10 },
      conversion: { status: 'skipped' as const },
    };
    const n = nextFollowUp(qs, records, {});
    expect(n.answered.map((q) => q.id)).toEqual(['candidates']);
    expect(n.skipped.map((q) => q.id)).toEqual(['conversion']);
    expect(n.current?.id).toBe('deal_value');
  });

  it('全部に回答・保留しても、質問が無い状態になる（必須にしない）', () => {
    const records = Object.fromEntries(qs.map((q) => [q.id, { status: 'skipped' as const }]));
    expect(nextFollowUp(qs, records, {}).current).toBeNull();
  });
});
