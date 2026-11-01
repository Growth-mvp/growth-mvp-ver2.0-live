/**
 * 再現テスト（SWOT 候補の位置対応・出典表示・初回と追加の差）。
 * - it（修正済み）: 第2段階で修正した不具合の回帰テスト（旧データへの追加の属性ずれ、本文確認の表示）。
 * - it（現行）: 仕様上の差、または現行の挙動を記録するテスト。判断が必要な項目はここに置く。
 */
import { buildCandidatePool, candidateIdOf, withoutCandidateState, type CandidatePool, type SelectionEntry } from './candidatePool';
import { appendOpportunitySuggestions, mergeOpportunities } from './opportunityAppend';
import { parseAnalysis } from './generateOt';
import { parseExpansionItems } from './opportunityPool';
import { evidenceViewOf } from './candidateView';

const poolOf = (s: object): CandidatePool => (s as { candidatePool: CandidatePool }).candidatePool;
const byText = (pool: CandidatePool, text: string) => {
  const c = pool.candidates.find((x) => x.text === text);
  if (!c) throw new Error(`candidate not found: ${text}`);
  return c;
};

const SRC_URL = 'https://example.com/industry-report';
const SOURCES = [{ index: 1, url: SRC_URL, title: '業界レポート', retrievedAt: '2026-01-01T00:00:00Z' }];
const NOW = '2026-01-01T00:00:00Z';

describe('再現1: 未選択の候補が草案生成に渡る経路（仕様の確認）', () => {
  it('現行仕様: 草案の生成へは、選択記録を除いた AI 提案の全件（未選択を含む）が渡る', () => {
    const A = '需要Aが拡大する可能性がある。';
    const B = '需要Bが拡大する可能性がある。';
    const base = { opportunity: [A, B], threat: ['脅威Tが強まる可能性がある。'], generatedAt: NOW };
    const selection = {
      version: 1 as const,
      entries: {
        [candidateIdOf('opportunity', A)]: {
          candidateId: candidateIdOf('opportunity', A),
          kind: 'opportunity',
          status: 'added',
          text: A,
          sourceText: A,
          edited: false,
          updatedAt: NOW,
        } satisfies SelectionEntry,
      },
    };
    const s = { ...base, candidatePool: buildCandidatePool(base), selection };
    const out = withoutCandidateState(s) as { opportunity: string[]; selection?: unknown; candidatePool?: unknown };
    expect(out.opportunity).toEqual([A, B]);
    expect(out).not.toHaveProperty('selection');
    expect(out).not.toHaveProperty('candidatePool');
  });
});

describe('再現2: 旧データ（insights の無い候補）へ追加探索した場合', () => {
  const LEGACY = '既存の機会Aが拡大する可能性がある。';
  const NEW = '新しい地域の機会が広がる可能性がある。';
  const legacyPrev = () => ({ opportunity: [LEGACY], threat: [], generatedAt: NOW, sources: SOURCES });
  const extension = {
    text: NEW,
    group: 'new_region' as const,
    viewpoint: 'world_change' as const,
    basis: 'hypothesis' as const,
    evidence: '市場の成長性という根拠',
    sourceIndex: 1,
    origin: 'extension' as const,
  };

  it('既存の旧候補に、追加分の属性（origin・group・根拠・出典）は付かない', () => {
    const next = appendOpportunitySuggestions(legacyPrev(), [extension]);
    const old = byText(poolOf(next), LEGACY);
    expect(old.origin).toBeUndefined();
    expect(old.group).toBeUndefined();
    expect(old.sourceUrl).toBeNull();
    expect(old.evidence).toBe('');
  });

  it('追加した候補は、自分の属性（origin・group・根拠・出典）を保つ', () => {
    const next = appendOpportunitySuggestions(legacyPrev(), [extension]);
    const added = byText(poolOf(next), NEW);
    expect(added.origin).toBe('extension');
    expect(added.group).toBe('new_region');
    expect(added.evidence).toBe('市場の成長性という根拠');
    expect(added.sourceUrl).toBe(SRC_URL);
  });

  it('現行: insights が揃っていれば、追加しても既存候補の属性は変わらない', () => {
    const prev = {
      ...legacyPrev(),
      insights: {
        opportunity: [{ text: LEGACY, group: 'existing_market', viewpoint: 'customer_need', basis: 'hypothesis', evidence: '既存の根拠', sourceIndex: null }],
        threat: [],
      },
    };
    const next = appendOpportunitySuggestions(prev, [extension]);
    const old = byText(poolOf(next), LEGACY);
    expect(old.group).toBe('existing_market');
    expect(old.evidence).toBe('既存の根拠');
    expect(old.origin).toBeUndefined();
  });
});

describe('再現3: 候補の並べ替え・追加・削除による本文と根拠の位置ずれ', () => {
  const X = '需要Xが拡大する可能性がある。';
  const Y = '需要Yが拡大する可能性がある。';
  const insX = { text: X, group: 'existing_market', viewpoint: 'world_change', basis: 'hypothesis', evidence: 'Xの根拠', sourceIndex: null };
  const insY = { text: Y, group: 'new_region', viewpoint: 'customer_need', basis: 'hypothesis', evidence: 'Yの根拠', sourceIndex: null };

  it('現行: 候補 ID は文の内容から決まり、同じ文なら並べ替えても同じ ID になる', () => {
    const a = buildCandidatePool({ opportunity: [X, Y], insights: { opportunity: [insX, insY], threat: [] } });
    const b = buildCandidatePool({ opportunity: [Y, X], insights: { opportunity: [insY, insX], threat: [] } });
    expect(a.candidates.map((c) => c.id).sort()).toEqual(b.candidates.map((c) => c.id).sort());
    expect(byText(b, X).evidence).toBe('Xの根拠');
    expect(byText(b, Y).group).toBe('new_region');
  });

  it('本文の順序だけを並べ替えても、属性は本文の一致で対応する（位置では対応づけない）', () => {
    const shuffled = buildCandidatePool({ opportunity: [Y, X], insights: { opportunity: [insX, insY], threat: [] } });
    expect(byText(shuffled, Y).evidence).toBe('Yの根拠');
    expect(byText(shuffled, X).evidence).toBe('Xの根拠');
  });

  it('現行: 候補の一覧から外しても、残りの候補の属性は変わらない（ID で引く）', () => {
    const full = buildCandidatePool({ opportunity: [X, Y], insights: { opportunity: [insX, insY], threat: [] } });
    const without = buildCandidatePool({ opportunity: [Y], insights: { opportunity: [insX, insY], threat: [] } });
    expect(byText(without, Y).id).toBe(byText(full, Y).id);
  });
});

describe('再現4: 本文確認済みの出典が「未確認」と表示されるケース', () => {
  const MARKET = '市場の需要が拡大する可能性がある。';
  const VERIFIED_SOURCES = [{ ...SOURCES[0], contentVerified: true, bodyCheck: 'matched' }];

  it('本文確認済み（contentVerified）の出典を使う市場の候補は「本文は未確認」にならない', () => {
    const pool = buildCandidatePool({
      opportunity: [MARKET],
      threat: [],
      sources: VERIFIED_SOURCES,
      insights: {
        opportunity: [{ text: MARKET, group: 'existing_market', viewpoint: 'world_change', basis: 'fact', evidence: '[1] 業界レポートの数値', sourceIndex: 1 }],
        threat: [],
      },
    });
    expect(byText(pool, MARKET).unverified).not.toContain('source_body_not_checked');
  });

  const NEED = '美術缶の購入者が包装の訴求に困っている。';
  const needInsight = {
    text: NEED,
    group: 'existing_market',
    viewpoint: 'customer_need',
    basis: 'hypothesis',
    evidence: '社内情報からの推論',
    sourceIndex: 1,
    need: {
      discoveryPath: 'customer_need',
      segmentName: '美術缶事業',
      who: 'direct_customer',
      whoLabel: '直接顧客',
      evidenceUse: 'fact',
      unverified: [],
      grade: 'verified_public',
      gradeReasons: [],
    },
  };

  it('出典で確認済みの顧客課題は、本文の未確認を残さず、機会の文が仮説であることを表示に残す', () => {
    const pool = buildCandidatePool({ opportunity: [NEED], threat: [], sources: VERIFIED_SOURCES, insights: { opportunity: [needInsight], threat: [] } });
    const c = byText(pool, NEED);
    const view = evidenceViewOf(c);
    expect(view.kind).toBe('confirmed');
    expect(view.label).toContain('機会の文は将来の仮説');
    expect(c.unverified).not.toContain('source_body_not_checked');
    expect(c.unverified).toContain('inference_only');
  });
});

describe('再現5: 初回生成と追加探索の重複・根拠・検証基準の違い（現行の差）', () => {
  const A = '中小製造業の設備保全を遠隔で支援するサービスへの需要が広がる可能性がある。';
  const B = '中小製造業の設備保全を遠隔で支える仕組みへの需要が広がる可能性がある。';
  const item = (text: string, over: Record<string, unknown> = {}) => ({
    text,
    group: 'existing_market',
    viewpoint: 'world_change',
    basis: 'hypothesis',
    evidence: '根拠',
    sourceIndex: null,
    ...over,
  });

  it('現行: 類似度 0.66 の2文は、初回では1件に、追加探索では2件として残る（閾値 0.6 と 0.85）', () => {
    const raw = JSON.stringify({ opportunities: [item(A), item(B)], threats: [item('脅威Tが強まる可能性がある。')] });
    expect(parseAnalysis(raw, 1).opportunities).toHaveLength(1);
    const { added, duplicates } = mergeOpportunities(
      [{ text: A, basis: 'hypothesis', evidence: '', sourceIndex: null }],
      [{ text: B, basis: 'hypothesis', evidence: '', sourceIndex: null }]
    );
    expect(added).toBe(1);
    expect(duplicates).toBe(0);
  });

  it('現行: 初回は出典付きの事実を fact として残すが、追加探索は出典があっても hypothesis にする', () => {
    const fact = item('需要Zが拡大する可能性がある。', { basis: 'fact', evidence: '[1] 数値', sourceIndex: 1 });
    const initial = parseAnalysis(JSON.stringify({ opportunities: [fact], threats: [item('脅威Tが強まる可能性がある。')] }), 1);
    expect(initial.opportunities[0]).toMatchObject({ basis: 'fact', sourceIndex: 1 });
    const extension = parseExpansionItems({ opportunities: [fact] }, 1);
    expect(extension[0]).toMatchObject({ basis: 'hypothesis', sourceIndex: 1 });
  });

  it('現行: 不正な group は、初回では既定値に補正して残し、追加探索では項目ごと捨てる', () => {
    const bad = item('需要Qが拡大する可能性がある。', { group: 'bogus' });
    const initial = parseAnalysis(JSON.stringify({ opportunities: [bad], threats: [item('脅威Tが強まる可能性がある。')] }), 0);
    expect(initial.opportunities).toHaveLength(1);
    expect(initial.opportunities[0].group).toBe('existing_market');
    expect(parseExpansionItems({ opportunities: [bad] }, 0)).toHaveLength(0);
  });
});
