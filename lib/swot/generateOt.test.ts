import { APIConnectionError, APIConnectionTimeoutError } from 'openai';
import {
  OT_ANALYSIS_INSTRUCTIONS,
  OT_SEARCH_INSTRUCTIONS,
  OT_SEARCH_THEMES,
  OtRequestSchema,
  buildAnalysisInput,
  buildSearchInput,
  classifyFailure,
  extractSearchFindings,
  isLikelyErrorPage,
  isNearDuplicate,
  isWebSearchEnabled,
  mergeSearchExtractions,
  normalizeSourceUrl,
  parseAnalysis,
  readResponse,
  toCompanyContext,
  type WebResult,
  type CompanyContext,
} from './generateOt';

describe('isWebSearchEnabled', () => {
  it('厳密に "true" のときだけ有効（既定は無効）', () => {
    expect(isWebSearchEnabled(undefined)).toBe(false);
    expect(isWebSearchEnabled('')).toBe(false);
    expect(isWebSearchEnabled('false')).toBe(false);
    expect(isWebSearchEnabled('TRUE')).toBe(false);
    expect(isWebSearchEnabled('1')).toBe(false);
    expect(isWebSearchEnabled('true')).toBe(true);
  });
});

describe('classifyFailure（ログ・meta に出す安全な分類）', () => {
  it('HTTP ステータスを分類する', () => {
    expect(classifyFailure(Object.assign(new Error('x'), { status: 429 }))).toBe('rate_limited');
    expect(classifyFailure(Object.assign(new Error('x'), { status: 400 }))).toBe('bad_request');
    expect(classifyFailure(Object.assign(new Error('x'), { status: 401 }))).toBe('auth_error');
    expect(classifyFailure(Object.assign(new Error('x'), { status: 403 }))).toBe('auth_error');
    expect(classifyFailure(Object.assign(new Error('x'), { status: 503 }))).toBe('upstream_error');
  });

  it('タイムアウトと接続失敗を SDK のエラークラスで分類する', () => {
    expect(classifyFailure(new APIConnectionTimeoutError({ message: 'x' }))).toBe('timeout');
    expect(classifyFailure(new APIConnectionError({ message: 'Connection error.' }))).toBe('network_error');
    expect(classifyFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('timeout');
  });

  it('内部の失敗理由を分類する', () => {
    expect(classifyFailure(new Error('time_budget_exhausted'))).toBe('time_budget');
    expect(classifyFailure(new Error('ot_analysis_invalid'))).toBe('invalid_output');
    expect(classifyFailure(new Error('no_usable_findings'))).toBe('no_usable_findings');
  });

  it('分類できないものは unknown。メッセージは結果に含めない', () => {
    const code = classifyFailure(new Error('SECRET-DETAIL-123'));
    expect(code).toBe('unknown');
    expect(code).not.toContain('SECRET');
    expect(classifyFailure(undefined)).toBe('unknown');
  });
});

const five = (prefix: string) => Array.from({ length: 5 }, (_, i) => `${prefix}${i + 1}`);

function item(text: string, basis: string, evidence: string, sourceIndex: number | null) {
  return { text, basis, evidence, sourceIndex };
}

describe('parseAnalysis', () => {
  it('5件ずつの機会・脅威を正規化する', () => {
    const raw = JSON.stringify({
      opportunities: five('O').map((t) => item(t, 'hypothesis', '前提', null)),
      threats: five('T').map((t) => item(t, 'hypothesis', '前提', null)),
    });
    const out = parseAnalysis(raw, 0);
    expect(out.opportunities.map((i) => i.text)).toEqual(five('O'));
    expect(out.threats).toHaveLength(5);
  });

  it('根拠が無い fact は hypothesis に降格する', () => {
    const raw = JSON.stringify({
      opportunities: [item('機会', 'fact', '', null)],
      threats: [item('脅威', 'fact', '入力の強み', null)],
    });
    const out = parseAnalysis(raw, 0);
    expect(out.opportunities[0].basis).toBe('hypothesis');
    expect(out.threats[0].basis).toBe('fact');
  });

  it('範囲外の sourceIndex は捨てる', () => {
    const raw = JSON.stringify({
      opportunities: [item('機会', 'fact', 'Web', 9)],
      threats: [item('脅威', 'fact', 'Web', 1)],
    });
    const out = parseAnalysis(raw, 2);
    expect(out.opportunities[0]).toMatchObject({ basis: 'fact', sourceIndex: null, evidence: 'Web' });
    expect(out.threats[0].sourceIndex).toBe(1);
  });

  it('機会または脅威が空なら失敗させる（旧モデルへの fallback 判定に使う）', () => {
    const raw = JSON.stringify({ opportunities: [item('機会', 'hypothesis', '', null)], threats: [] });
    expect(() => parseAnalysis(raw, 0)).toThrow('ot_analysis_invalid');
  });

  it('JSON 以外の前置きがあっても中身を抽出する', () => {
    const body = JSON.stringify({
      opportunities: [item('機会', 'hypothesis', '', null)],
      threats: [item('脅威', 'hypothesis', '', null)],
    });
    expect(parseAnalysis(`結果です\n${body}`, 0).threats[0].text).toBe('脅威');
  });
});

/** 実 API の応答構造に合わせた検索応答。注釈は本文中の位置（at の出現位置）に付く */
function searchRes(
  text: string,
  cites: Array<{ at: string; url: string; title?: string }>,
  toolUrls: string[] = [],
  status = 'completed'
) {
  const annotations = cites.map((c) => {
    const start = text.indexOf(c.at);
    return { type: 'url_citation', url: c.url, title: c.title ?? '', start_index: start, end_index: start + c.at.length };
  });
  return {
    output: [
      {
        type: 'web_search_call',
        status,
        id: 'ws1',
        action: { type: 'search', query: 'q', sources: toolUrls.map((url) => ({ type: 'url', url })) },
      },
      { type: 'message', content: [{ type: 'output_text', text, annotations }] },
    ],
  };
}

const RETRIEVED = '2026-10-29T00:00:00.000Z';

describe('readResponse', () => {
  it('テキスト・url_citation（位置付き）・完了済み検索数・action.sources を取り出す', () => {
    const res = {
      output: [
        { type: 'web_search_call', status: 'completed', id: 'ws1', action: { type: 'search', sources: [{ type: 'url', url: 'https://example.com/s' }] } },
        { type: 'web_search_call', status: 'failed', id: 'ws2' },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'ABCDE',
              annotations: [{ type: 'url_citation', url: 'https://example.com/a', title: 'A', start_index: 1, end_index: 3 }],
            },
          ],
        },
      ],
    };
    expect(readResponse(res)).toEqual({
      text: 'ABCDE',
      citations: [{ url: 'https://example.com/a', title: 'A', startIndex: 1, endIndex: 3 }],
      webSearchCalls: 1,
      toolSources: [{ url: 'https://example.com/s' }],
    });
  });

  it('複数の output_text は連結後の位置に直して注釈を解釈する', () => {
    const res = {
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'XXXX', annotations: [] },
            {
              type: 'output_text',
              text: 'YYYY',
              annotations: [{ type: 'url_citation', url: 'https://example.com/b', title: 'B', start_index: 2, end_index: 4 }],
            },
          ],
        },
      ],
    };
    expect(readResponse(res).citations[0]).toMatchObject({ startIndex: 6, endIndex: 8 });
  });
});

describe('extractSearchFindings（検索結果の出典付き抽出）', () => {
  it('注釈の付いた行だけを事実として採用し、URL は注釈の URL を使う', () => {
    const text = '規制: 2027年に新制度が施行される。\n競合: 海外の新興メーカーが価格を下げている。';
    const out = extractSearchFindings(
      searchRes(text, [
        { at: '施行される。', url: 'https://example.com/reg', title: 'Reg Source' },
        { at: '下げている。', url: 'https://example.com/comp' },
      ]),
      RETRIEVED
    );
    expect(out.findings).toEqual([
      { theme: '規制', statement: '2027年に新制度が施行される。', sourceIndex: 1 },
      { theme: '競合', statement: '海外の新興メーカーが価格を下げている。', sourceIndex: 2 },
    ]);
    expect(out.sources).toEqual([
      { index: 1, url: 'https://example.com/reg', title: 'Reg Source', retrievedAt: RETRIEVED, contentVerified: false },
      { index: 2, url: 'https://example.com/comp', title: 'https://example.com/comp', retrievedAt: RETRIEVED, contentVerified: false },
    ]);
    expect(out.failureCode).toBeUndefined();
  });

  it('注釈の無い行は、事実として採用しない', () => {
    const text = '規制: 施行される。\n市場: 根拠のない推測。';
    const out = extractSearchFindings(searchRes(text, [{ at: '施行される。', url: 'https://example.com/r' }]), RETRIEVED);
    expect(out.findings.map((f) => f.statement)).toEqual(['施行される。']);
    expect(out.diagnostics).toMatchObject({ lines: 2, attributedLines: 1, findings: 1 });
  });

  it('本文中にモデルが書いた URL は採用しない（出典は注釈の URL だけ）', () => {
    const text = '規制: 施行される。\n出典: https://fake.example/x を参照。';
    const out = extractSearchFindings(searchRes(text, [{ at: '施行される。', url: 'https://example.com/real' }]), RETRIEVED);
    expect(out.sources.map((s) => s.url)).toEqual(['https://example.com/real']);
    expect(JSON.stringify(out)).not.toContain('fake.example');
  });

  it('同じ URL を指す行は同じ sourceIndex にまとめる', () => {
    const text = 'A: 一つ目。\nB: 二つ目。';
    const out = extractSearchFindings(
      searchRes(text, [
        { at: '一つ目。', url: 'https://example.com/same' },
        { at: '二つ目。', url: 'https://example.com/same' },
      ]),
      RETRIEVED
    );
    expect(out.sources).toHaveLength(1);
    expect(out.findings.map((f) => f.sourceIndex)).toEqual([1, 1]);
  });

  it('複数の output_text をまたいでも、注釈は正しい行に対応づく', () => {
    const res = {
      output: [
        { type: 'web_search_call', status: 'completed', id: 'ws1', action: { type: 'search' } },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'X: 一つ目。\n',
              annotations: [{ type: 'url_citation', url: 'https://example.com/x', title: 'X', start_index: 0, end_index: 3 }],
            },
            {
              type: 'output_text',
              text: 'Y: 二つ目。',
              annotations: [{ type: 'url_citation', url: 'https://example.com/y', title: 'Y', start_index: 0, end_index: 3 }],
            },
          ],
        },
      ],
    };
    const out = extractSearchFindings(res, RETRIEVED);
    expect(out.findings.map((f) => f.theme)).toEqual(['X', 'Y']);
    expect(out.sources.map((s) => s.url)).toEqual(['https://example.com/x', 'https://example.com/y']);
  });

  it('失敗段階を分類する: 本文なし / 注釈なし / 注釈が行に対応しない', () => {
    expect(extractSearchFindings(searchRes('', []), RETRIEVED).failureCode).toBe('search_output_empty');
    expect(extractSearchFindings(searchRes('規制: 施行される。', []), RETRIEVED).failureCode).toBe('no_citations');
    expect(
      extractSearchFindings(searchRes('規制: 施行される。', [{ at: '存在しない語', url: 'https://example.com/z' }]), RETRIEVED)
        .failureCode
    ).toBe('no_attributed_citation');
  });

  it('未完了の web_search_call は検索回数に数えない', () => {
    const out = extractSearchFindings(searchRes('規制: 施行される。', [{ at: '施行される。', url: 'https://example.com/r' }], [], 'in_progress'), RETRIEVED);
    expect(out.webSearchCalls).toBe(0);
  });

  it('診断は件数のみ（本文・URL・注釈の中身を含まない）', () => {
    const text = '規制: 施行される。\n市場: 推測。';
    const out = extractSearchFindings(
      searchRes(text, [{ at: '施行される。', url: 'https://example.com/r', title: 'R' }], ['https://example.com/r', 'https://example.com/other']),
      RETRIEVED
    );
    expect(out.diagnostics).toEqual({
      webSearchCalls: 1,
      toolSources: 2,
      annotations: 1,
      lines: 2,
      attributedLines: 1,
      rejectedLines: 0,
      unattributedLines: 1,
      duplicateLines: 0,
      droppedByLimit: 0,
      findings: 1,
      byCategory: { _general: { findings: 1, dropped: 0 } },
    });
    expect(JSON.stringify(out.diagnostics)).not.toContain('example.com');
  });
});

describe('検索・分析の指示文', () => {
  it('検索フェーズは JSON を求めず、URL を書かせない', () => {
    expect(OT_SEARCH_INSTRUCTIONS).not.toContain('JSONで');
    expect(OT_SEARCH_INSTRUCTIONS).toContain('情報源のURLは書かないでください');
  });

  it('O・T は外部環境の変化を中心にし、戦略案と内部の強み・弱みの転記を禁止する', () => {
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('外部環境の変化');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('具体的な事業戦略案');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('社内の強み・弱みをそのまま機会・脅威として書かない');
  });
});

describe('OtRequestSchema', () => {
  it('12問・深掘り回答を含めても受け取らない（SWOTより後の情報）', () => {
    const parsed = OtRequestSchema.parse({
      industry: 'manufacturing',
      answers12: [{ id: 'ch0-q1', answer: 'SECRET-ANSWER' }],
      deepDive: { answer: 'SECRET-DEEP' },
    });
    expect(JSON.stringify(parsed)).not.toContain('SECRET');
  });
});

describe('buildAnalysisInput', () => {
  const ctx: CompanyContext = {
    industryLabel: '製造業',
    location: '',
    employees: '',
    businessContent: '',
    mission: 'MISSION-XYZ',
    vision: '',
    value: '',
    ceoIntent: '',
    strength: '',
    weakness: '',
    segments: [
      {
        name: '装置事業',
        scope: '',
        summary: '',
        mainProductsServices: [],
        keyCustomers: [],
        revenue: 1200,
        profit: 150,
        overseasRegions: [],
      },
    ],
    financeRows: [{ year: 2025, '売上高(円)': 5_000_000_000 }],
  };

  it('Web 未取得の状態を明示し、社内情報の欄を未入力と区別して出す', () => {
    const web: WebResult = { status: 'disabled', findings: [], sources: [], searchCalls: 0 };
    const input = buildAnalysisInput(ctx, web);
    expect(input).toContain('MISSION-XYZ');
    expect(input).toContain('装置事業');
    expect(input).toContain('売上: 1200.0百万円');
    expect(input).toContain('2025年: 売上高 5000.0百万円');
    expect(input).toContain('【ビジョン】未入力');
    expect(input).toContain('取得できませんでした（状態: disabled）');
  });

  it('取得済みの Web 情報は番号付きの出典と取得日を含む', () => {
    const web: WebResult = {
      status: 'completed',
      findings: [{ theme: '規制', statement: '新制度が施行', sourceIndex: 1 }],
      sources: [{ index: 1, url: 'https://example.com/a', title: 'A', retrievedAt: '2026-10-29T00:00:00.000Z' }],
      searchCalls: 1,
    };
    const input = buildAnalysisInput(ctx, web);
    expect(input).toContain('[1] (規制) 新制度が施行');
    expect(input).toContain('https://example.com/a');
    expect(input).toContain('取得日: 2026-10-29T00:00:00.000Z');
  });
});

describe('企業基本情報の受け渡し（所在地・人数帯・財務由来の売上）', () => {
  const baseCtx: CompanyContext = {
    industryLabel: '情報通信・IT',
    location: '',
    employees: '',
    businessContent: '',
    mission: '',
    vision: '',
    value: '',
    ceoIntent: '',
    strength: '',
    weakness: '',
    segments: [],
    financeRows: [],
  };
  const noWeb: WebResult = { status: 'disabled', findings: [], sources: [], searchCalls: 0 };

  it('本社所在地は市場地域ではないと明記して渡し、人数帯は表示名にする', () => {
    const input = buildAnalysisInput({ ...baseCtx, location: '大阪府', employees: '20〜49' }, noWeb);
    expect(input).toContain('【本社所在地（市場地域ではない）】大阪府');
    expect(input).toContain('【従業員数】20〜49名');
  });

  it('売上規模は財務データの最新年の売上高から取り、無ければ未入力にする', () => {
    const withFinance = buildAnalysisInput(
      {
        ...baseCtx,
        financeRows: [
          { year: 2024, '売上高(円)': 4_000_000_000 },
          { year: 2025, '売上高(円)': 5_000_000_000 },
        ],
      },
      noWeb
    );
    expect(withFinance).toContain('【売上規模】5000.0百万円（2025年）');

    const noFinance = buildAnalysisInput(baseCtx, noWeb);
    expect(noFinance).toContain('【売上規模】未入力');
  });

  it('既存の人数値（例: 300名）は変換せず、そのまま渡す', () => {
    const input = buildAnalysisInput({ ...baseCtx, employees: '300名' }, noWeb);
    expect(input).toContain('【従業員数】300名');
  });

  it('旧 revenue の入力は受け付けず、所在地は受け付ける', () => {
    const parsed = OtRequestSchema.parse({ industry: 'it', location: '東京都', revenue: '100億円' });
    expect(parsed.location).toBe('東京都');
    expect(parsed).not.toHaveProperty('revenue');
  });
});

describe('現在の事業展開地域（参考）と探索方針', () => {
  const segmentsOf = (...segments: Array<Record<string, unknown>>) =>
    OtRequestSchema.parse({
      industry: 'manufacturing',
      businessContent: '産業用装置の製造（業務内容に地域名が書かれていても市場とみなさない）',
      location: '大阪府',
      businessSegments: segments,
    });

  it('現在の事業展開地域は事業ごとの3択だけから決まり、事業内容の文章からは推定しない', () => {
    const ctx = toCompanyContext(segmentsOf({ name: '国内事業' }), '製造業');
    expect(ctx.currentRegions).toEqual([]);
  });

  it('本社所在地は事業展開地域に使わない', () => {
    const ctx = toCompanyContext(segmentsOf({ name: '製造事業', expansionScope: 'domestic' }), '製造業');
    expect(ctx.currentRegions).toEqual(['日本国内']);
    expect(ctx.location).toBe('大阪府');
  });

  it('海外中心で国・地域が未指定なら、米国を補わない', () => {
    const ctx = toCompanyContext(segmentsOf({ name: '海外事業', expansionScope: 'overseas' }), '製造業');
    const input = buildSearchInput('製造業', ctx.currentRegions);
    expect(input).toContain('海外（国・地域は未指定）');
    expect(input).not.toContain('米国');
    expect(OT_SEARCH_INSTRUCTIONS).toContain('特定の国（例：米国）を既定の主市場としない');
  });

  it('検索入力は現在の事業展開地域を参考として渡し、事業名・概要・顧客は渡さない', () => {
    const ctx = toCompanyContext(
      segmentsOf({
        name: 'SEGMENT-SECRET-NAME',
        summary: 'SEGMENT-SECRET-SUMMARY',
        keyCustomers: ['SECRET-CUSTOMER'],
        expansionScope: 'both',
        overseasRegions: ['東南アジア', 'ベトナム1200'],
        overseasRegionsNote: 'SECRET-LEGACY-NOTE',
      }),
      '製造業'
    );
    const input = buildSearchInput('製造業', ctx.currentRegions);
    expect(input).toContain('現在の事業展開地域（参考。探索対象を限定しない）: 日本国内、海外（東南アジア）');
    expect(input).not.toContain('SEGMENT-SECRET');
    expect(input).not.toContain('SECRET-CUSTOMER');
    expect(input).not.toContain('SECRET-LEGACY-NOTE');
    expect(input).not.toContain('大阪府');
  });

  it('現在の事業展開地域は探索対象を限定するフィルターにせず、他地域・海外市場も探索対象に含める', () => {
    const input = buildSearchInput('製造業', ['日本国内']);
    expect(input).toContain('探索対象を限定しない');
    expect(input).toContain('他地域・国内未進出の市場・海外市場も含めてください');
    expect(input).not.toContain('優先');
    expect(OT_SEARCH_INSTRUCTIONS).toContain('現在の地域の外（他県、国内未進出の市場、海外市場）にある成長市場も探索してください');
    expect(OT_SEARCH_THEMES).toContain('現在の事業地域の外にある成長動向（他県・国内未進出の市場・海外市場）');
  });

  it('未入力の場合も、探索対象を限定せず、特定の国を主市場としないと明記する', () => {
    const input = buildSearchInput('製造業', []);
    expect(input).toContain('現在の事業展開地域: 未入力（探索対象を限定しない）');
    expect(OT_SEARCH_INSTRUCTIONS).toContain('特定の国（例：米国）を既定の主市場としない');
  });

  it('分析入力には事業ごとの現在の事業展開地域を出す（未入力と国内中心を区別）', () => {
    const ctx = toCompanyContext(
      segmentsOf({ name: '製造事業', expansionScope: 'domestic' }, { name: '新規事業' }),
      '製造業'
    );
    const input = buildAnalysisInput(ctx, { status: 'disabled', findings: [], sources: [], searchCalls: 0 });
    expect(input).toContain('現在の事業展開地域: 国内中心');
    expect(input).toContain('現在の事業展開地域: 未入力');
    expect(input).toContain('【現在の事業展開地域（参考）】日本国内');
  });

  it('不正な3択の値は受け付けず、未指定として扱う（リクエストは落とさない）', () => {
    const parsed = segmentsOf({ name: '旧事業', expansionScope: 'bogus' });
    expect(parsed.businessSegments[0].expansionScope).toBeUndefined();
  });
});

describe('出典URLの正規化と検証', () => {
  it('追跡パラメータを除去し、他のパラメータは残す', () => {
    expect(normalizeSourceUrl('https://example.com/a?utm_source=openai&id=7')).toBe('https://example.com/a?id=7');
    expect(normalizeSourceUrl('https://example.com/a?utm_source=openai')).toBe('https://example.com/a');
    expect(normalizeSourceUrl('https://example.com/a?gclid=abc')).toBe('https://example.com/a');
  });

  it('https 以外・解析できない・認証情報入りの URL は null', () => {
    expect(normalizeSourceUrl('http://example.com/a')).toBeNull();
    expect(normalizeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSourceUrl('not a url')).toBeNull();
    expect(normalizeSourceUrl('https://user:pw@example.com/a')).toBeNull();
  });

  it('エラーページの疑いをパスとタイトルで検出する', () => {
    expect(isLikelyErrorPage('https://example.com/404', '')).toBe(true);
    expect(isLikelyErrorPage('https://example.com/page-not-found', '')).toBe(true);
    expect(isLikelyErrorPage('https://example.com/a', 'Page Not Found')).toBe(true);
    expect(isLikelyErrorPage('https://example.com/a', 'お探しのページは見つかりません')).toBe(true);
    expect(isLikelyErrorPage('https://example.com/report', '製造業の需要動向レポート')).toBe(false);
  });

  it('同じ記事を追跡パラメータ違いで二重に出典にしない', () => {
    const text = 'A: 一つ目の事実です。\nB: 二つ目の事実です。';
    const cite = (at: string, url: string) => ({ at, url });
    const res = searchRes(text, [
      cite('一つ目の事実です。', 'https://example.com/r?utm_source=openai'),
      cite('二つ目の事実です。', 'https://example.com/r'),
    ]);
    const out = extractSearchFindings(res, RETRIEVED);
    expect(out.sources.map((s) => s.url)).toEqual(['https://example.com/r']);
    expect(out.findings.map((f) => f.sourceIndex)).toEqual([1, 1]);
  });

  it('エラーページの疑いがある出典に紐づく行は事実として採用せず、件数だけ記録する', () => {
    const text = '規制: 施行される。\n市場: 需要が増える。';
    const out = extractSearchFindings(
      searchRes(text, [
        { at: '施行される。', url: 'https://example.com/404', title: '404 Not Found' },
        { at: '需要が増える。', url: 'https://example.com/market' },
      ]),
      RETRIEVED
    );
    expect(out.findings.map((f) => f.statement)).toEqual(['需要が増える。']);
    expect(out.sources).toEqual([expect.objectContaining({ index: 1, url: 'https://example.com/market' })]);
    expect(out.diagnostics).toMatchObject({ attributedLines: 2, rejectedLines: 1, findings: 1 });
  });

  it('https でない出典に紐づく行は採用しない', () => {
    const out = extractSearchFindings(
      searchRes('規制: 施行される。', [{ at: '施行される。', url: 'http://example.com/plain' }]),
      RETRIEVED
    );
    expect(out.findings).toEqual([]);
    expect(out.failureCode).toBe('no_attributed_citation');
  });
});

describe('O・Tの重複排除', () => {
  it('言い換えだけの項目は除き、別の論点は残す', () => {
    expect(isNearDuplicate('シニア層の健康意識が高まり、予防サービスの需要が増える可能性がある。', 'シニア層の健康意識の高まりで、予防サービス需要が増える可能性がある。')).toBe(true);
    expect(isNearDuplicate('競合が低価格の新製品を投入する可能性がある。', '規制強化により輸入部材の調達コストが上がる可能性がある。')).toBe(false);
  });

  it('parseAnalysis は同じ市場変化の重複項目を1件にまとめる', () => {
    const dup = '人手不足により、設備の遠隔監視サービスへの需要が拡大する可能性がある。';
    const raw = JSON.stringify({
      opportunities: [
        item(dup, 'hypothesis', '前提', null),
        item('人手不足により、遠隔監視サービスへの需要が拡大する可能性がある。', 'hypothesis', '前提', null),
        item('AI診断の普及により、新たな点検需要が生まれる可能性がある。', 'hypothesis', '前提', null),
      ],
      threats: [item('脅威', 'hypothesis', '', null)],
    });
    const out = parseAnalysis(raw, 0);
    expect(out.opportunities.map((i) => i.text)).toEqual([
      dup,
      'AI診断の普及により、新たな点検需要が生まれる可能性がある。',
    ]);
  });

  it('短い別の事実は、似た語尾だけで重複扱いしない', () => {
    expect(isNearDuplicate('一つ目の事実です', '二つ目の事実です')).toBe(false);
    expect(isNearDuplicate('一つ目の事実です', '一つ目の事実です')).toBe(true);
  });

  it('検索の事実も、言い換えだけの重複は1件にまとめる', () => {
    const text = 'A: 規制が2027年に施行される。\nB: 規制が2027年に施行予定だ。';
    const out = extractSearchFindings(
      searchRes(text, [
        { at: '規制が2027年に施行される。', url: 'https://example.com/a' },
        { at: '規制が2027年に施行予定だ。', url: 'https://example.com/b' },
      ]),
      RETRIEVED
    );
    expect(out.findings).toHaveLength(1);
  });
});

describe('O・T の指示文（品質・仮説表現）', () => {
  it('影響は仮説として書き、戦略案・自社の弱みの脅威化を禁止する', () => {
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('する可能性がある');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('自社の弱みを外部の脅威として書かない');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('60〜90字');
  });

  it('現在の事業地域は分析対象を限定せず、他地域・海外市場の機会も候補にする', () => {
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('分析対象を限定しない');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('現在の事業地域以外に有望な成長市場があると判断した場合は、その市場を機会の候補として積極的に挙げる');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('注目する理由');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('根拠が不足する場合は basis を hypothesis にし');
  });

  it('国内中心・海外中心どちらの企業でも、他方の市場の機会を見逃さないよう指示する', () => {
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('国内中心の企業でも他県や海外市場の機会を、海外中心の企業でも国内市場の新たな機会を見逃さない');
  });

  it('海外進出を無条件に推奨せず、件数を地域ごとに配分しない', () => {
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('海外進出や他地域への展開を無条件に推奨しない');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('地域ごとに件数を配分しない');
  });

  it('脅威は海外競合・輸入品・国際的な技術変化も考慮する', () => {
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('海外競合の参入、輸入品、国際的な技術変化');
  });

  it('地域を特定できない場合は、特定の国・地域を前提にしない', () => {
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('特定の国・地域を前提にせず');
  });
});

describe('層ごとの検索結果の統合', () => {
  it('同じ出典は1件にまとめ、番号を振り直し、分類の層を各事実に残す', () => {
    const a = extractSearchFindings(
      searchRes('製品: 18L缶の出荷が増える。', [{ at: '18L缶の出荷が増える。', url: 'https://example.com/shared' }]),
      RETRIEVED,
      'product_customer'
    );
    const b = extractSearchFindings(
      searchRes('代替: 樹脂容器が普及する。', [{ at: '樹脂容器が普及する。', url: 'https://example.com/other' }]),
      RETRIEVED,
      'substitute'
    );
    const c = extractSearchFindings(
      searchRes('製品: 美術缶の需要が変わる。', [{ at: '美術缶の需要が変わる。', url: 'https://example.com/shared' }]),
      RETRIEVED,
      'product_customer'
    );
    const merged = mergeSearchExtractions([a, b, c]);

    expect(merged.sources.map((s) => s.url)).toEqual(['https://example.com/shared', 'https://example.com/other']);
    expect(merged.findings.map((f) => [f.layer, f.sourceIndex])).toEqual([
      ['product_customer', 1],
      ['substitute', 2],
      ['product_customer', 1],
    ]);
    expect(merged.webSearchCalls).toBe(3);
    expect(merged.diagnostics.findings).toBe(3);
  });

  it('すべての呼び出しが失敗したら、失敗の理由を引き継ぐ', () => {
    const empty = extractSearchFindings(searchRes('', []), RETRIEVED, 'product_customer');
    const merged = mergeSearchExtractions([empty]);
    expect(merged.findings).toEqual([]);
    expect(merged.failureCode).toBe('search_output_empty');
  });

  it('層の指定がなければ従来どおり（層の項目を付けない）', () => {
    const out = extractSearchFindings(
      searchRes('規制: 施行される。', [{ at: '施行される。', url: 'https://example.com/r' }]),
      RETRIEVED
    );
    expect(out.findings[0]).not.toHaveProperty('layer');
  });

  it('分析入力には層の表示を付ける（層がない従来の出典は従来の形式）', () => {
    const ctx = toCompanyContext(OtRequestSchema.parse({ industry: 'manufacturing' }), '製造業');
    const web: WebResult = {
      status: 'completed',
      findings: [
        { theme: '規制', statement: '新制度が施行', sourceIndex: 1, layer: 'product_customer' },
        { theme: '市場', statement: '需要が増加', sourceIndex: 1 },
      ],
      sources: [{ index: 1, url: 'https://example.com/a', title: 'A', retrievedAt: RETRIEVED }],
      searchCalls: 2,
    };
    const input = buildAnalysisInput(ctx, web);
    expect(input).toContain('[1] (製品・顧客市場・規制) 新制度が施行');
    expect(input).toContain('[1] (市場) 需要が増加');
  });
});

describe('出典に紐づく仮説と分析指示', () => {
  it('仮説にも、根拠となる出典番号を残す（範囲外の番号は捨てる）', () => {
    const raw = JSON.stringify({
      opportunities: [item('機会A', 'hypothesis', '前提', 1)],
      threats: [item('脅威B', 'hypothesis', '前提', 7)],
    });
    const out = parseAnalysis(raw, 2);
    expect(out.opportunities[0]).toMatchObject({ basis: 'hypothesis', sourceIndex: 1 });
    expect(out.threats[0]).toMatchObject({ basis: 'hypothesis', sourceIndex: null });
  });

  it('分析指示は、分析の順序と、一般論で埋めないことを明示する', () => {
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('【分析の順序】');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('一般的な社会動向だけでO・Tを埋めない');
    expect(OT_ANALYSIS_INSTRUCTIONS).toContain('出典がない推論は sourceIndex を null にする');
  });

  it('検索指示は、市場分類に直接関係する情報を優先し、一般論だけの事実を書かせない', () => {
    expect(OT_SEARCH_INSTRUCTIONS).toContain('指定された市場分類（製品・顧客・代替品）に直接関係する情報を優先');
  });
});
