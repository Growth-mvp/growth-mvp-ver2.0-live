import { buildScoreSheet, DIMENSIONS } from './scoring';
import { QUALITY_QUESTIONS } from './fictionalCompany';

const Q1 = QUALITY_QUESTIONS[0];

describe('採点シート：人の採点は未採点のまま、自動の結果で優劣を決めない', () => {
  it('採点欄はすべて null（未採点）で、採点者も空', () => {
    const sheet = buildScoreSheet(Q1, { A: '回答A', B: '回答B' }, { A: 'g', B: 'g' });
    for (const d of sheet.dimensions) {
      expect(d.humanScore).toEqual({ A: null, B: null, scorer: null, comment: '' });
    }
  });

  it('指示の6観点（＋補足）がそろっている', () => {
    const names = DIMENSIONS.map((d) => d.key);
    for (const n of [
      '自社固有の理解',
      '経営課題の洞察',
      '判断の根拠',
      '実行可能な提案',
      'GROWTH SHIFTの基本思想との整合',
      '一般論との違い',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('優劣や勝敗を示すキーがない', () => {
    const sheet = buildScoreSheet(Q1, { A: 'a', B: 'b' }, { A: 'g', B: 'g' });
    const json = JSON.stringify(sheet);
    expect(json).not.toMatch(/winner|勝者|優位|better|score_total/i);
  });

  it('自動検査は補助として分けて記録し、条件Bの必須事実の欠落を検出する', () => {
    const sheet = buildScoreSheet(Q1, { A: '一般的な回答です', B: '価格競争の影響を受けている' }, { A: 'q 1', B: 'q 1' });
    expect(sheet.autoAssist.B.missingFacts).toContain('保守人材');
    expect(sheet.autoAssist.A.missingFacts).toEqual([]);
  });

  it('禁止語（他社の本文など）が出たら検出する', () => {
    const sheet = buildScoreSheet(Q1, { A: '別会社の本文が含まれる', B: 'ok' }, { A: 'g', B: 'g' });
    expect(sheet.autoAssist.A.leakedFacts).toContain('別会社の本文');
  });

  it('根拠にない数値を候補として挙げる（誤りとは断定しない）', () => {
    const sheet = buildScoreSheet(Q1, { A: 'ok', B: '売上は 777 百万円' }, { A: '1', B: '1 2' });
    expect(sheet.autoAssist.B.ungroundedNumbers).toContain('777');
    expect(sheet.note).toMatch(/自動検査.*補助/);
  });
});
