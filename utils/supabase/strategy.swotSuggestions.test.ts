import { normalizeStrategyData } from './normalize';
import { candidatePoolOf, composeSwotSuggestions, emptySelection, selectCandidate } from '@/lib/swot/candidatePool';
import { buildDbRowFromState, buildStateFromDbRow } from './strategy';

const sources = [
  {
    index: 1,
    url: 'https://example.com/report',
    title: 'Industry Report',
    retrievedAt: '2026-10-29T01:02:03.000Z',
  },
];
const insights = {
  opportunity: [{ text: '機会A', basis: 'fact', evidence: 'Web', sourceIndex: 1 }],
  threat: [{ text: '脅威A', basis: 'hypothesis', evidence: '前提', sourceIndex: null }],
};
const suggestions = {
  opportunity: ['機会A'],
  threat: ['脅威A'],
  generatedAt: '2026-10-29T01:02:03.000Z',
  sources,
  insights,
};

describe('swotSuggestions の保存・復元（既存形式との互換）', () => {
  it('保存時に sources / insights を落とさず swot_suggestions に入れる', () => {
    const row = buildDbRowFromState({ swotSuggestions: suggestions } as any);
    expect(row.swot_suggestions).toEqual(suggestions);
  });

  it('中計データのパック保存でも sources / insights は残る', () => {
    const row = buildDbRowFromState({
      swotSuggestions: suggestions,
      midtermStrategy: { horizon: '3y' },
    } as any);
    expect(row.swot_suggestions).toEqual({ ...suggestions, midtermStrategy: { horizon: '3y' } });
  });

  it('復元時に sources / insights を保持する', () => {
    const state = buildStateFromDbRow({ swot_suggestions: suggestions }) as any;
    expect(state.swotSuggestions).toEqual(suggestions);
  });

  it('旧データ（sources / insights なし）もそのまま復元でき、表示対象が無いだけになる', () => {
    const legacy = { opportunity: ['機会'], threat: ['脅威'], generatedAt: '2026-01-01T00:00:00.000Z' };
    const state = buildStateFromDbRow({ swot_suggestions: legacy }) as any;
    expect(state.swotSuggestions).toEqual(legacy);
    expect(state.swotSuggestions.sources).toBeUndefined();
  });

  it('候補を持たない行の復元結果には swotSuggestions が無い（会社切替時の消去は store 側で行う）', () => {
    const state = buildStateFromDbRow({ company_id: 'company-b' }) as any;
    expect(state.swotSuggestions).toBeUndefined();
  });

  it('会社Bの復元結果に会社Aの候補が混ざらない（行ごとに独立して復元される）', () => {
    const companyA = buildStateFromDbRow({
      company_id: 'company-a',
      swot_suggestions: { ...suggestions, opportunity: ['A社の機会'] },
    }) as any;
    const companyB = buildStateFromDbRow({
      company_id: 'company-b',
      swot_suggestions: { ...suggestions, opportunity: ['B社の機会'] },
    }) as any;
    expect(companyA.swotSuggestions.opportunity).toEqual(['A社の機会']);
    expect(companyB.swotSuggestions.opportunity).toEqual(['B社の機会']);
    expect(JSON.stringify(companyB)).not.toContain('A社の機会');
  });

  it('診断情報（diagnostics）は保存・復元で残り、旧データには無い', () => {
    const diagnostics = { version: 1, classification: 'matched', searchCalls: 2, segments: [] };
    const withDiag = { ...suggestions, diagnostics };
    const row = buildDbRowFromState({ swotSuggestions: withDiag } as any);
    expect(row.swot_suggestions).toEqual(withDiag);
    const state = buildStateFromDbRow({ swot_suggestions: withDiag }) as any;
    expect(state.swotSuggestions.diagnostics).toEqual(diagnostics);
    const legacy = buildStateFromDbRow({ swot_suggestions: suggestions }) as any;
    expect(legacy.swotSuggestions.diagnostics).toBeUndefined();
  });
});

describe('候補一覧と選択記録の保存・復元', () => {
  const NOW = '2026-10-30T00:00:00.000Z';
  const base = { opportunity: ['機会A', '機会B'], threat: ['脅威A'], generatedAt: NOW, sources, insights };
  const json = (v: unknown) => JSON.parse(JSON.stringify(v));

  it('新形式の候補一覧と選択記録を保存し、復元しても同じ内容に戻る', () => {
    const composed = composeSwotSuggestions(undefined, base);
    const selection = selectCandidate(emptySelection(), composed.candidatePool.candidates[0], NOW);
    const row = buildDbRowFromState({ swotSuggestions: { ...composed, selection } } as any);
    const state = buildStateFromDbRow({ swot_suggestions: json(row.swot_suggestions) }) as any;
    expect(state.swotSuggestions.candidatePool).toEqual(composed.candidatePool);
    expect(state.swotSuggestions.selection).toEqual(selection);
  });

  it('正規化の経路でも候補一覧と選択記録を落とさない', () => {
    const composed = composeSwotSuggestions(undefined, base);
    const selection = selectCandidate(emptySelection(), composed.candidatePool.candidates[1], NOW);
    const state = normalizeStrategyData({ swotSuggestions: json({ ...composed, selection }) }) as any;
    expect(state.swotSuggestions.candidatePool).toEqual(composed.candidatePool);
    expect(state.swotSuggestions.selection).toEqual(selection);
  });

  it('過去の保存形式は候補一覧を持たずに読め、一覧は機会・脅威から作れる', () => {
    const state = normalizeStrategyData({ swotSuggestions: json(base) }) as any;
    expect(state.swotSuggestions.candidatePool).toBeUndefined();
    expect(state.swotSuggestions.opportunity).toEqual(['機会A', '機会B']);
    expect(state.swotSuggestions.insights).toEqual(insights);
    expect(candidatePoolOf(state.swotSuggestions).candidates).toHaveLength(3);
  });

  it('中計データのパック保存と候補一覧は共存する', () => {
    const composed = composeSwotSuggestions(undefined, base);
    const row = buildDbRowFromState({
      swotSuggestions: composed,
      midtermStrategy: { horizon: '3y' },
    } as any);
    expect(row.swot_suggestions).toMatchObject({ midtermStrategy: { horizon: '3y' } });
    expect(row.swot_suggestions.candidatePool).toEqual(composed.candidatePool);
  });

  it('機会30件・脅威10件の候補と選択記録は、保存→復元→再保存で失われず、出典の対応も残る', () => {
    const opportunity = Array.from({ length: 32 }, (_, i) => (i === 0 ? '機会A' : `機会${i + 1}の本文です。`));
    const threat = Array.from({ length: 12 }, (_, i) => `脅威${i + 1}の本文です。`);
    const composed = composeSwotSuggestions(undefined, { ...base, opportunity, threat });
    const pool = composed.candidatePool;
    expect(pool.candidates.filter((c) => c.kind === 'opportunity')).toHaveLength(30);
    expect(pool.candidates.filter((c) => c.kind === 'threat')).toHaveLength(10);
    expect(pool.dropped).toEqual({ opportunity: 2, threat: 2 });

    const selection = selectCandidate(
      selectCandidate(emptySelection(), pool.candidates[29], NOW),
      pool.candidates[30],
      NOW
    );
    const restored = buildStateFromDbRow({ swot_suggestions: json({ ...composed, selection }) }) as any;
    const resaved = buildDbRowFromState({ swotSuggestions: restored.swotSuggestions } as any);
    const again = buildStateFromDbRow({ swot_suggestions: json(resaved.swot_suggestions) }) as any;

    expect(again.swotSuggestions.candidatePool).toEqual(pool);
    expect(again.swotSuggestions.selection).toEqual(selection);
    expect(again.swotSuggestions.candidatePool.candidates[0]).toMatchObject({
      id: pool.candidates[0].id,
      sourceIndex: 1,
      sourceUrl: 'https://example.com/report',
    });
  });

  it('Phase 0 の診断情報は、候補一覧と一緒に残る', () => {
    const diagnostics = { version: 2, searchRequests: 3, tokens: { input: 1, output: 2, reasoning: 0, reportedCalls: 1, llmCalls: 3 } };
    const composed = composeSwotSuggestions(undefined, { ...base, diagnostics });
    const state = buildStateFromDbRow({ swot_suggestions: json(composed) }) as any;
    expect(state.swotSuggestions.diagnostics).toEqual(diagnostics);
    expect(state.swotSuggestions.candidatePool.candidates).toHaveLength(3);
  });

  it('会社ごとの候補一覧は混ざらない', () => {
    const a = buildStateFromDbRow({
      company_id: 'company-a',
      swot_suggestions: json(composeSwotSuggestions(undefined, { ...base, opportunity: ['A社の機会'] })),
    }) as any;
    const b = buildStateFromDbRow({
      company_id: 'company-b',
      swot_suggestions: json(composeSwotSuggestions(undefined, { ...base, opportunity: ['B社の機会'] })),
    }) as any;
    expect(a.swotSuggestions.candidatePool.candidates.map((c: { text: string }) => c.text)).toEqual(['A社の機会', '脅威A']);
    expect(JSON.stringify(b)).not.toContain('A社の機会');
  });
});
