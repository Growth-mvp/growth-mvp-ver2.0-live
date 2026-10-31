import { inspectOtResult, isHttpsUrl, PREDICTION_PATTERN } from './qualityCheck';
import type { OtAnalysis, Source } from './generateOt';

const RETRIEVED = '2026-10-30T00:00:00.000Z';
const sources: Source[] = [
  { index: 1, url: 'https://example.com/a', title: 'A', retrievedAt: RETRIEVED },
  { index: 2, url: 'http://insecure.example.com/b', title: 'B', retrievedAt: RETRIEVED },
];

const item = (text: string, basis: 'fact' | 'hypothesis', sourceIndex: number | null, evidence = 'e') => ({
  text,
  basis,
  evidence,
  sourceIndex,
});

describe('根拠と仮説の補正', () => {
  it('将来の影響を述べる文は、出典があっても「事実」にしない（仮説に補正し、出典番号は残す）', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('塗料の需要が拡大する可能性がある。', 'fact', 1)],
      threats: [item('x', 'hypothesis', null)],
    };
    const { analysis: out, report } = inspectOtResult(analysis, sources, []);
    expect(out.opportunities[0]).toMatchObject({ basis: 'hypothesis', sourceIndex: 1 });
    expect(report.basisCorrected).toBe(1);
    expect(report.sourceLinkedHypotheses).toBe(1);
    expect(report.issues).toContain('fact_with_prediction_corrected');
  });

  it('予測を含まない事実は、出典があれば「事実」のまま残す', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('18リットル缶の出荷は前年同期比で1.6%増えた。', 'fact', 1)],
      threats: [item('x', 'hypothesis', null)],
    };
    const { analysis: out, report } = inspectOtResult(analysis, sources, []);
    expect(out.opportunities[0]).toMatchObject({ basis: 'fact', sourceIndex: 1 });
    expect(report.basisCorrected).toBe(0);
  });

  it('根拠も出典もない「事実」は仮説にする', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('内容', 'fact', null, '')],
      threats: [item('x', 'hypothesis', null)],
    };
    const { analysis: out, report } = inspectOtResult(analysis, sources, []);
    expect(out.opportunities[0].basis).toBe('hypothesis');
    expect(report.issues).toContain('fact_without_grounds');
  });

  it('予測表現の判定は、将来の影響の典型的な言い回しを拾う', () => {
    expect(PREDICTION_PATTERN.test('需要が拡大する可能性がある')).toBe(true);
    expect(PREDICTION_PATTERN.test('出荷量は前年同期比で増加した')).toBe(true);
    expect(PREDICTION_PATTERN.test('出荷量の数値')).toBe(false);
  });
});

describe('出典と URL の整合性', () => {
  it('存在しない出典番号は根拠にしない（sourceIndex を null にする）', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('x', 'hypothesis', 9)],
      threats: [item('y', 'hypothesis', null)],
    };
    const { analysis: out, report } = inspectOtResult(analysis, sources, []);
    expect(out.opportunities[0].sourceIndex).toBeNull();
    expect(report.sourceIndexInvalid).toBe(1);
    expect(report.issues).toContain('source_index_unresolved');
  });

  it('https でない出典を指す番号は根拠にせず、不正な URL を報告する', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('x', 'hypothesis', 2)],
      threats: [item('y', 'hypothesis', null)],
    };
    const { analysis: out, report } = inspectOtResult(analysis, sources, []);
    expect(out.opportunities[0].sourceIndex).toBeNull();
    expect(report.invalidSourceUrls).toBe(1);
    expect(report.issues).toContain('invalid_source_url');
  });

  it('URL の判定は https と認証情報なしだけを正しとする', () => {
    expect(isHttpsUrl('https://example.com/a')).toBe(true);
    expect(isHttpsUrl('http://example.com/a')).toBe(false);
    expect(isHttpsUrl('https://user:pw@example.com/a')).toBe(false);
    expect(isHttpsUrl('not a url')).toBe(false);
  });
});

describe('分類IDと出力形式', () => {
  it('未知の分類 ID を報告する（推測で補わない）', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('x', 'hypothesis', null)],
      threats: [item('y', 'hypothesis', null)],
    };
    const { report } = inspectOtResult(analysis, sources, ['p_metal_can', 'made_up_id']);
    expect(report.unknownCategoryIds).toBe(1);
    expect(report.issues).toContain('unknown_category_id');
  });

  it('機会・脅威の件数が 1〜5 件の範囲外なら報告する', () => {
    const six = Array.from({ length: 6 }, (_, i) => item(`項目${i}`, 'hypothesis', null));
    const { report } = inspectOtResult({ opportunities: six, threats: [item('y', 'hypothesis', null)] }, sources, []);
    expect(report.issues).toContain('format_count');
    expect(report.opportunityCount).toBe(6);
  });

  it('機会と脅威で同じ内容が重複していれば報告する（件数の変更はしない）', () => {
    const same = '需要が拡大する可能性がある。';
    const analysis: OtAnalysis = {
      opportunities: [item(same, 'hypothesis', null)],
      threats: [item(same, 'hypothesis', null)],
    };
    const { analysis: out, report } = inspectOtResult(analysis, sources, []);
    expect(report.crossListDuplicates).toBe(1);
    expect(out.threats).toHaveLength(1);
  });

  it('報告には本文を含めない（件数と種類だけ）', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('SECRET-BODY-3301 可能性がある', 'fact', 9)],
      threats: [item('y', 'hypothesis', null)],
    };
    const { report } = inspectOtResult(analysis, sources, []);
    expect(JSON.stringify(report)).not.toContain('SECRET-BODY-3301');
  });
});

describe('事実の数値・年度の検査', () => {
  const finding = (statement: string) => ({ theme: '市場', statement, sourceIndex: 1 });

  it('出典に無い年度を含む「事実」は、仮説に補正する', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('塗料需要は2027年度に出荷が確認された。', 'fact', 1)],
      threats: [item('y', 'hypothesis', null)],
    };
    const { analysis: out, report } = inspectOtResult(analysis, sources, [], [finding('2025年度の塗料需要は前年度比3.9%減だった。')]);
    expect(out.opportunities[0]).toMatchObject({ basis: 'hypothesis', sourceIndex: 1 });
    expect(report.numberNotInSourceCorrected).toBe(1);
  });

  it('出典と同じ数値・年度を含む「事実」は、そのまま事実として残す', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('塗料需要は2025年度に前年度比3.9%減となった。', 'fact', 1)],
      threats: [item('y', 'hypothesis', null)],
    };
    const { analysis: out, report } = inspectOtResult(analysis, sources, [], [finding('2025年度の塗料需要の実績は前年度比3.9%減だった。')]);
    expect(out.opportunities[0].basis).toBe('fact');
    expect(report.numberNotInSourceCorrected).toBe(0);
  });

  it('1桁の数字（「3〜5年後」など）だけでは補正しない', () => {
    const analysis: OtAnalysis = {
      opportunities: [item('塗料の需要が3〜5年後に変わる。', 'fact', 1)],
      threats: [item('y', 'hypothesis', null)],
    };
    const { analysis: out } = inspectOtResult(analysis, sources, [], [finding('塗料の需要が変わる。')]);
    expect(out.opportunities[0].basis).toBe('fact');
  });
});
