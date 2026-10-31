import type { Finding, OtAnalysis, Source } from './generateOt';
import { inspectOtResult, sharesGroundingToken } from './qualityCheck';

const sources: Source[] = [
  { index: 1, url: 'https://example.com/s1', title: 'S1', retrievedAt: '2026-10-30T00:00:00.000Z', contentVerified: false },
];

const item = (text: string, basis: 'fact' | 'hypothesis', sourceIndex: number | null, evidence = '出典1') => ({
  text,
  basis,
  evidence,
  sourceIndex,
});

const analysis = (opp: ReturnType<typeof item>[], thr: ReturnType<typeof item>[] = []): OtAnalysis => ({
  opportunities: opp,
  threats: thr.length ? thr : [item('別の脅威の文です。', 'hypothesis', null, '')],
});

const finding = (statement: string, sourceIndex = 1): Finding => ({ theme: '市場', statement, sourceIndex });

describe('出典と主張の内容的な一致の検査', () => {
  it('出典の主張と共通の内容語が無い場合は、その出典を根拠にしない', () => {
    const out = inspectOtResult(
      analysis([item('顧客の脱炭素対応が進み、金属缶の受注が伸びた。', 'fact', 1)]),
      sources,
      [],
      [finding('日本の18リットル缶の出荷数量は前年割れの月が増えた。')]
    );
    expect(out.analysis.opportunities[0].sourceIndex).toBeNull();
    expect(out.report.unlinkedCitations).toBe(1);
  });

  it('出典と同じ市場の語を含む主張は、出典との対応を保つ', () => {
    const out = inspectOtResult(
      analysis([item('塗料需要は2025年度に前年度比3.9%減となり、18リットル缶の販売に影響する可能性がある。', 'hypothesis', 1)]),
      sources,
      [],
      [finding('2025年度の塗料需要は前年度比3.9%減だった。')]
    );
    expect(out.analysis.opportunities[0].sourceIndex).toBe(1);
    expect(out.report.unlinkedCitations).toBe(0);
  });

  it('企業の環境方針を市場需要の根拠にする例は、出典を外す（廃棄物の削減は社の方針で市場の需要ではない）', () => {
    const out = inspectOtResult(
      analysis([item('塗料・化学品メーカーで省資源化と産業廃棄物削減の需要が高まる可能性がある。', 'hypothesis', 1)]),
      sources,
      [],
      [finding('同社は廃棄物の削減・有価物化・再利用化を環境方針に掲げている。')]
    );
    expect(out.analysis.opportunities[0].sourceIndex).toBeNull();
  });

  it('共通の語が一般語だけの場合は、内容が一致しないとみなす', () => {
    const out = inspectOtResult(
      analysis([item('市場の需要が増える可能性がある。', 'hypothesis', 1)]),
      sources,
      [],
      [finding('市場の需要は前年比で減少した。')]
    );
    expect(out.analysis.opportunities[0].sourceIndex).toBeNull();
  });

  it('語が共通すれば通すため、内容の正しさは保証しない（この検査の限界として記録する）', () => {
    expect(
      sharesGroundingToken('プラスチック容器の設計で軽量化が競争条件になる。', ['プラスチック製容器包装の設計認定では軽量化が評価される。'])
    ).toBe(true);
  });
});

describe('実績と予測の区別', () => {
  it('予測・見通しだけを示す出典に基づく「事実」は、仮説に補正する', () => {
    const out = inspectOtResult(
      analysis([item('塗料の需要規模は2026年度に118万7千tとなる見通しである。', 'fact', 1)]),
      sources,
      [],
      [finding('2026年度の塗料需要は前年度比1.1%増の118万7千tになる見通しだ。')]
    );
    expect(out.analysis.opportunities[0].basis).toBe('hypothesis');
    expect(out.report.forecastFactCorrected).toBe(1);
  });

  it('実績として書かれた出典に基づく「事実」は、そのまま事実として残す', () => {
    const out = inspectOtResult(
      analysis([item('塗料需要は2025年度に前年度比3.9%減となった。', 'fact', 1)]),
      sources,
      [],
      [finding('2025年度の塗料需要の実績は前年度比3.9%減だった。')]
    );
    expect(out.analysis.opportunities[0].basis).toBe('fact');
    expect(out.report.forecastFactCorrected).toBe(0);
  });

  it('本文未確認の出典数を報告する（本文を確認したとは扱わない）', () => {
    const out = inspectOtResult(analysis([item('塗料需要の変化が続く。', 'hypothesis', null, '')]), sources, [], []);
    expect(out.report.unverifiedSources).toBe(1);
  });
});
