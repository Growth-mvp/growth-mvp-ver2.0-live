import { buildCategoryKeys, EXTRACTION_LIMITS, extractSearchFindings, mergeSearchExtractions } from './generateOt';

const RETRIEVED = '2026-10-30T00:00:00.000Z';

type Line = { text: string; url?: string };

function res(lines: Line[]) {
  const text = lines.map((l) => l.text).join('\n');
  const annotations: Array<Record<string, unknown>> = [];
  let pos = 0;
  for (const l of lines) {
    if (l.url) {
      annotations.push({ type: 'url_citation', url: l.url, title: '', start_index: pos, end_index: pos + l.text.length });
    }
    pos += l.text.length + 1;
  }
  return {
    output: [
      { type: 'web_search_call', status: 'completed', id: 'ws', action: { type: 'search', sources: [] } },
      { type: 'message', content: [{ type: 'output_text', text, annotations }] },
    ],
  };
}

const CATS = [
  { id: 'p_metal_can', label: '金属缶・金属容器', theme: '金属缶・金属容器の出荷数量と用途別の需要変化' },
  { id: 'p_can_18l', label: '18リットル缶（一斗缶）', theme: '18リットル缶の出荷動向' },
  { id: 'p_art_can', label: '美術缶（装飾缶）', theme: '美術缶（装飾缶）の用途と需要の動向' },
  { id: 'c_paint_chemical', label: '塗料・化学品メーカー', theme: '塗料・化学品メーカーの容器調達の変化' },
  { id: 'c_food_maker', label: '食品・飲料メーカー', theme: '食品・飲料メーカーの容器調達の変化' },
  { id: 'p_real_estate_leasing', label: '不動産賃貸（オフィス・住宅・店舗の賃貸）', theme: '不動産賃貸の需要と空室・賃料の動向' },
];
const KEYS = buildCategoryKeys(CATS);

/** 互いに似ない文（重複判定に掛からないように、内容の異なる語を使う） */
const DISTINCT = [
  '出荷数量は2025年度に前年度を下回った',
  '塗料向けの販売は地域ごとに減少している',
  '食品向けの受注が一部で増えたと報告された',
  '化学品向けの需要は横ばいが続いている',
  '輸出向けの数量は増加傾向にあるとされる',
  '新規設備の稼働で生産能力が拡大した',
  '賃貸物件の空室率は都心部で低下した',
  '装飾缶の菓子用途で受注が伸びている',
  '一斗缶の回収制度が見直しの対象になった',
  '国内の工場数は5年間で二割減少した',
  '中小の事業者が共同配送を始めた',
  '地方の空き店舗を活用する動きが広がる',
  '再生材を使った容器の採用が進んでいる',
  '保管倉庫の賃料は前年比で上昇している',
  '輸入品との価格差が縮まってきた',
  '人手不足を背景に自動化の投資が増えた',
  '大型案件の受注は四半期ごとに偏っている',
  '原材料の調達先を分散する企業が増えた',
];

describe('分類ごとの枠と抽出の記録', () => {
  it('行頭の市場名を分類 ID に対応づけ、findings に categoryId を付ける', () => {
    const out = extractSearchFindings(
      res([
        { text: '18リットル缶（一斗缶）: 出荷数量は2025年度に前年度を下回った。', url: 'https://example.com/a' },
        { text: '美術缶（装飾缶）: 装飾缶の菓子用途で受注が伸びている。', url: 'https://example.com/b' },
      ]),
      RETRIEVED,
      'product_customer',
      { categoryKeys: KEYS }
    );
    expect(out.findings.map((f) => f.categoryId)).toEqual(['p_can_18l', 'p_art_can']);
    expect(out.diagnostics.byCategory).toEqual({
      p_can_18l: { findings: 1, dropped: 0 },
      p_art_can: { findings: 1, dropped: 0 },
    });
  });

  it('同じ市場の事実は上限を超えた分を黙って捨てず、件数を dropped に記録する', () => {
    const lines = DISTINCT.slice(0, 5).map((t, i) => ({ text: `18リットル缶: ${t}。`, url: `https://example.com/${i}` }));
    const out = extractSearchFindings(res(lines), RETRIEVED, 'product_customer', { categoryKeys: KEYS });
    expect(out.findings.filter((f) => f.categoryId === 'p_can_18l')).toHaveLength(EXTRACTION_LIMITS.perCategory);
    expect(out.diagnostics.byCategory?.p_can_18l).toEqual({ findings: EXTRACTION_LIMITS.perCategory, dropped: 2 });
    expect(out.diagnostics.droppedByLimit).toBe(2);
  });

  it('ある市場が上限に達しても、後から来た別の市場（小規模事業の市場）は落ちない', () => {
    const lines: Line[] = [
      ...DISTINCT.slice(0, 4).map((t, i) => ({ text: `18リットル缶: ${t}。`, url: `https://example.com/${i}` })),
      { text: '不動産賃貸（オフィス・住宅・店舗の賃貸）: 賃貸物件の空室率は都心部で低下した。', url: 'https://example.com/re' },
    ];
    const out = extractSearchFindings(res(lines), RETRIEVED, 'product_customer', { categoryKeys: KEYS });
    expect(out.findings.some((f) => f.categoryId === 'p_real_estate_leasing')).toBe(true);
    expect(out.diagnostics.byCategory?.p_real_estate_leasing).toEqual({ findings: 1, dropped: 0 });
  });

  it('分類に対応しない市場名の行は _other にまとめ、上限は小さく抑える', () => {
    const lines = DISTINCT.slice(0, 4).map((t, i) => ({ text: `その他の市場: ${t}。`, url: `https://example.com/o${i}` }));
    const out = extractSearchFindings(res(lines), RETRIEVED, 'product_customer', { categoryKeys: KEYS });
    expect(out.findings.every((f) => f.categoryId === undefined)).toBe(true);
    expect(out.diagnostics.byCategory?._other).toEqual({ findings: EXTRACTION_LIMITS.other, dropped: 2 });
  });

  it('分類を指定しない検索（業界全体）は _general の枠を使う', () => {
    const lines = DISTINCT.slice(0, 9).map((t, i) => ({ text: `規制: ${t}。`, url: `https://example.com/g${i}` }));
    const out = extractSearchFindings(res(lines), RETRIEVED, 'industry');
    expect(out.findings).toHaveLength(EXTRACTION_LIMITS.general);
    expect(out.diagnostics.byCategory?._general).toEqual({ findings: EXTRACTION_LIMITS.general, dropped: 1 });
  });

  it('全体の上限（1回の検索）に達した分も件数に残す', () => {
    const cats = CATS.slice(0, 6);
    const keys = buildCategoryKeys(cats);
    const lines: Line[] = [];
    let i = 0;
    for (const c of cats) {
      for (let k = 0; k < 3; k++) {
        lines.push({ text: `${c.label}: ${DISTINCT[i++]}。`, url: `https://example.com/t${i}` });
      }
    }
    const out = extractSearchFindings(res(lines), RETRIEVED, 'product_customer', { categoryKeys: keys });
    expect(out.findings).toHaveLength(EXTRACTION_LIMITS.perCall);
    expect(out.diagnostics.droppedByLimit).toBe(lines.length - EXTRACTION_LIMITS.perCall);
  });

  it('重複・引用なしの行を件数として数える（本文は含めない）', () => {
    const out = extractSearchFindings(
      res([
        { text: '18リットル缶: 出荷数量は2025年度に前年度を下回った。', url: 'https://example.com/a' },
        { text: '18リットル缶: 出荷数量は2025年度に前年度を下回った。', url: 'https://example.com/b' },
        { text: '18リットル缶: 引用の無い文です。' },
      ]),
      RETRIEVED,
      'product_customer',
      { categoryKeys: KEYS }
    );
    expect(out.diagnostics).toMatchObject({ duplicateLines: 1, unattributedLines: 1, findings: 1 });
    expect(JSON.stringify(out.diagnostics)).not.toContain('引用');
  });

  it('複数の検索の結果を統合しても、市場別の件数と分類 ID を保つ', () => {
    const a = extractSearchFindings(
      res([{ text: '18リットル缶: 出荷数量は2025年度に前年度を下回った。', url: 'https://example.com/a' }]),
      RETRIEVED,
      'product_customer',
      { categoryKeys: KEYS }
    );
    const b = extractSearchFindings(
      res([{ text: '美術缶（装飾缶）: 装飾缶の菓子用途で受注が伸びている。', url: 'https://example.com/b' }]),
      RETRIEVED,
      'product_customer',
      { categoryKeys: KEYS }
    );
    const merged = mergeSearchExtractions([a, b]);
    expect(merged.findings.map((f) => f.categoryId)).toEqual(['p_can_18l', 'p_art_can']);
    expect(merged.diagnostics.byCategory).toEqual({
      p_can_18l: { findings: 1, dropped: 0 },
      p_art_can: { findings: 1, dropped: 0 },
    });
  });

  it('出典は本文を確認していないことを示す（contentVerified は false）', () => {
    const out = extractSearchFindings(
      res([{ text: '18リットル缶: 出荷数量は2025年度に前年度を下回った。', url: 'https://example.com/a' }]),
      RETRIEVED,
      'product_customer',
      { categoryKeys: KEYS }
    );
    expect(out.sources).toEqual([expect.objectContaining({ index: 1, contentVerified: false })]);
  });
});
