import {
  buildCandidatePool,
  candidateIdOf,
  candidatePoolOf,
  composeSwotSuggestions,
  editSelectedCandidate,
  emptySelection,
  parseCandidatePool,
  parseCandidateSelection,
  reconcileWithConfirmed,
  removeSelectedCandidate,
  selectCandidate,
  selectionOf,
  withoutCandidateState,
  CANDIDATE_LIMITS,
  type PoolCandidate,
} from './candidatePool';

const NOW = '2026-10-30T12:00:00.000Z';
const URL_1 = 'https://example.com/metal';
const URL_3 = 'https://example.com/office';

const legacy = () => ({
  opportunity: ['金属容器需要が収益改善につながる可能性がある。', '東京のオフィス賃料が上昇し収益が伸びる可能性がある。'],
  threat: ['18リットル缶の出荷が縮小する可能性がある。'],
  generatedAt: NOW,
  sources: [
    { index: 1, url: URL_1, title: 'Metal', retrievedAt: NOW },
    { index: 3, url: URL_3, title: 'Office', retrievedAt: NOW },
  ],
  insights: {
    opportunity: [
      {
        text: '金属容器需要が収益改善につながる可能性がある。',
        basis: 'fact',
        evidence: '[1]は出荷金額の増加を示している。',
        sourceIndex: 1,
      },
      {
        text: '東京のオフィス賃料が上昇し収益が伸びる可能性がある。',
        basis: 'hypothesis',
        evidence: '[3]は空室率の低下を示している。',
        sourceIndex: null,
      },
    ],
    threat: [{ text: '18リットル缶の出荷が縮小する可能性がある。', basis: 'hypothesis', evidence: '前提', sourceIndex: null }],
  },
});

const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}候補${String(i + 1).padStart(2, '0')}の内容`);

describe('過去の SWOT 候補の読み込み', () => {
  it('既存の機会・脅威から候補一覧を作り、basis・evidence・sourceIndex の対応を保つ', () => {
    const pool = buildCandidatePool(legacy());
    expect(pool.candidates).toHaveLength(3);
    const [first, second, threat] = pool.candidates;
    expect(first).toMatchObject({ kind: 'opportunity', basis: 'fact', sourceIndex: 1, sourceUrl: URL_1, sourceLink: 'linked' });
    expect(first.evidence).toBe('[1]は出荷金額の増加を示している。');
    expect(second).toMatchObject({ kind: 'opportunity', basis: 'hypothesis', sourceIndex: null });
    expect(threat).toMatchObject({ kind: 'threat', basis: 'hypothesis' });
  });

  it('出典番号を示す根拠が紐づけを外れていれば cited_but_unlinked とし、確認済みとは扱わない', () => {
    const [, second] = buildCandidatePool(legacy()).candidates;
    expect(second.sourceLink).toBe('cited_but_unlinked');
    expect(second.grounding).toBe('hypothesis_with_rationale');
    expect(second.unverified).toEqual(expect.arrayContaining(['citation_not_linked', 'inference_only']));
    expect(second.unverified).not.toContain('verified');
  });

  it('紐づいた出典は本文未確認として扱う', () => {
    const [first] = buildCandidatePool(legacy()).candidates;
    expect(first.grounding).toBe('source_unverified');
    expect(first.unverified).toContain('source_body_not_checked');
  });

  it('過去形式（candidatePool が無い）でも candidatePoolOf で一覧を得られ、保存データには何も追加しない', () => {
    const old = legacy();
    const pool = candidatePoolOf(old);
    expect(pool.candidates).toHaveLength(3);
    expect(old).not.toHaveProperty('candidatePool');
  });

  it('http の出典 URL は出典として扱わない', () => {
    const src = { ...legacy(), sources: [{ index: 1, url: 'http://example.com/x', title: 'X', retrievedAt: NOW }] };
    expect(buildCandidatePool(src).candidates[0]).toMatchObject({ sourceIndex: null, sourceUrl: null });
  });
});

describe('候補 ID', () => {
  it('同じ内容は同じ ID になり、配列の並びに依存しない', () => {
    const a = buildCandidatePool(legacy());
    const reversed = legacy();
    reversed.opportunity = [...reversed.opportunity].reverse();
    const b = buildCandidatePool({ ...reversed, insights: { ...reversed.insights, opportunity: [...reversed.insights.opportunity].reverse() } });
    const idsA = a.candidates.map((c) => c.id).sort();
    const idsB = b.candidates.map((c) => c.id).sort();
    expect(idsA).toEqual(idsB);
    expect(candidateIdOf('opportunity', ' 金属 容器 ')).toBe(candidateIdOf('opportunity', '金属容器'));
  });

  it('機会と脅威で同じ文でも ID は別になる', () => {
    expect(candidateIdOf('opportunity', '同じ文')).not.toBe(candidateIdOf('threat', '同じ文'));
  });
});

describe('最大件数と重複', () => {
  it('機会30件・脅威10件を保持し、超過分は件数だけ数える', () => {
    const src = { opportunity: many('機会', 32), threat: many('脅威', 11), generatedAt: NOW };
    const pool = buildCandidatePool(src);
    expect(pool.candidates.filter((c) => c.kind === 'opportunity')).toHaveLength(CANDIDATE_LIMITS.opportunity);
    expect(pool.candidates.filter((c) => c.kind === 'threat')).toHaveLength(CANDIDATE_LIMITS.threat);
    expect(pool.dropped).toEqual({ opportunity: 2, threat: 1 });
  });

  it('同じ文は1件にまとめ、重複として数える', () => {
    const pool = buildCandidatePool({ opportunity: ['同じ機会の文です。', '同じ機会の文です。'], threat: [], generatedAt: NOW });
    expect(pool.candidates).toHaveLength(1);
    expect(pool.dropped.opportunity).toBe(1);
  });
});

describe('保存と復元', () => {
  it('新形式の候補一覧を JSON で往復させても同じ内容に戻る', () => {
    const pool = buildCandidatePool(legacy());
    const restored = parseCandidatePool(JSON.parse(JSON.stringify(pool)));
    expect(restored).toEqual(pool);
  });

  it('形式が不正な候補は読み飛ばし、件数だけ残す', () => {
    const pool = buildCandidatePool(legacy());
    const raw = JSON.parse(JSON.stringify(pool));
    raw.candidates.push({ id: 'x', kind: 'opportunity', text: '', basis: 'fact' }, { ...raw.candidates[0], sourceIndex: 'bad' });
    const restored = parseCandidatePool(raw);
    expect(restored?.candidates).toHaveLength(pool.candidates.length);
    expect(restored?.invalid).toBe(2);
  });

  it('版が違う、または候補一覧が無いものは読まない', () => {
    expect(parseCandidatePool({ version: 2, candidates: [] })).toBeUndefined();
    expect(parseCandidatePool(undefined)).toBeUndefined();
  });

  it('保存済みの一覧が壊れていたら、機会・脅威から作り直して読む', () => {
    const s = { ...legacy(), candidatePool: { version: 99 } };
    expect(candidatePoolOf(s).candidates).toHaveLength(3);
  });
});

describe('選択状態（候補 ID 単位）', () => {
  const pool = buildCandidatePool(legacy());
  const [first, second] = pool.candidates as PoolCandidate[];

  it('追加・編集・削除・再追加の状態を追跡し、編集の有無を記録する', () => {
    let sel = selectCandidate(emptySelection(), first, NOW);
    expect(sel.entries[first.id]).toMatchObject({ status: 'added', edited: false, text: first.text, sourceText: first.text });

    sel = editSelectedCandidate(sel, first.id, '金属容器需要の拡大が収益を押し上げる可能性がある。', NOW);
    expect(sel.entries[first.id]).toMatchObject({ status: 'added', edited: true, sourceText: first.text });

    sel = removeSelectedCandidate(sel, first.id, NOW);
    expect(sel.entries[first.id].status).toBe('removed');

    sel = selectCandidate(sel, first, NOW);
    expect(sel.entries[first.id].status).toBe('added');
    expect(sel.entries[first.id].text).toBe(first.text);
  });

  it('未選択の候補には記録が無い。追加していない候補の編集・削除は無視する', () => {
    const sel = selectCandidate(emptySelection(), first, NOW);
    expect(sel.entries[second.id]).toBeUndefined();
    expect(editSelectedCandidate(sel, second.id, '勝手な編集', NOW)).toBe(sel);
    expect(removeSelectedCandidate(sel, second.id, NOW)).toBe(sel);
  });

  it('候補の並べ替えや再表示をしても、選択記録と出典の対応はずれない', () => {
    const sel = selectCandidate(emptySelection(), second, NOW);
    const reordered = { ...pool, candidates: [...pool.candidates].reverse() };
    const again = reordered.candidates.find((c) => c.id === second.id);
    expect(again).toMatchObject({ text: second.text, sourceLink: 'cited_but_unlinked', evidence: second.evidence });
    expect(sel.entries[second.id].text).toBe(second.text);
  });

  it('確定 SWOT の行と照合し、消えた候補は削除と記録し、行だけの文は手入力として返す', () => {
    const sel = selectCandidate(emptySelection(), first, NOW);
    const { selection, manualLines } = reconcileWithConfirmed(sel, 'opportunity', ['自社で書いた機会'], NOW);
    expect(selection.entries[first.id].status).toBe('removed');
    expect(manualLines).toEqual(['自社で書いた機会']);
  });

  it('選択記録は、形式が不正なものや鍵と候補 ID が一致しないものを読まない', () => {
    const parsed = parseCandidateSelection({
      version: 1,
      entries: {
        opp_a: { candidateId: 'opp_b', kind: 'opportunity', status: 'added', text: '文', sourceText: '文', edited: false, updatedAt: NOW },
        opp_c: { candidateId: 'opp_c', kind: 'opportunity', status: 'added', text: '文', sourceText: '文', edited: false, updatedAt: NOW },
      },
    });
    expect(Object.keys(parsed?.entries ?? {})).toEqual(['opp_c']);
  });
});

describe('再生成時の合成', () => {
  it('新しい候補で置き換えても、選択記録は引き継ぐ', () => {
    const prev = { ...legacy(), candidatePool: buildCandidatePool(legacy()) };
    const sel = selectCandidate(emptySelection(), prev.candidatePool.candidates[0], NOW);
    const next = composeSwotSuggestions({ ...prev, selection: sel }, { ...legacy(), opportunity: ['別の新しい機会の文です。'], insights: undefined });
    expect(next.candidatePool.candidates.map((c) => c.text)).toEqual([
      '別の新しい機会の文です。',
      '18リットル缶の出荷が縮小する可能性がある。',
    ]);
    expect(next.selection?.entries[prev.candidatePool.candidates[0].id]).toMatchObject({ status: 'added' });
  });

  it('空の候補で、既存の候補・選択記録を上書きしない', () => {
    const prev = { ...legacy(), selection: selectCandidate(emptySelection(), buildCandidatePool(legacy()).candidates[0], NOW) };
    const kept = composeSwotSuggestions(prev, { opportunity: [], threat: [], generatedAt: NOW });
    expect(kept).toBe(prev);
  });

  it('引き継ぐ選択記録が壊れていれば、空の記録として扱う', () => {
    const next = composeSwotSuggestions({ ...legacy(), selection: { version: 9 } }, legacy());
    expect(next.selection).toBeUndefined();
    expect(selectionOf(next)).toEqual(emptySelection());
  });
});

describe('ペイロード', () => {
  it('候補の一覧と選択記録を取り除き、AI提案の文だけを残す。元のオブジェクトは変えない', () => {
    const src = composeSwotSuggestions(undefined, legacy());
    const payload = withoutCandidateState(src)!;
    expect(payload).not.toHaveProperty('candidatePool');
    expect(payload).not.toHaveProperty('selection');
    expect(payload.opportunity).toEqual(src.opportunity);
    expect(src).toHaveProperty('candidatePool');
  });
});
