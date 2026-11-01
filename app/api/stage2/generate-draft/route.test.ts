import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
  assertMinRole: jest.fn(),
}));
jest.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { company_id: 'company-1' }, error: null }),
        }),
      }),
    }),
  }),
}));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => undefined),
  extractAuditMetadata: jest.fn(() => ({})),
}));
jest.mock('@/lib/inputGuardLogger', () => ({
  logInputGuard: jest.fn(),
  checkSuspiciousKeywords: jest.fn(() => []),
}));

const mockChatCreate = jest.fn();
jest.mock('@/lib/openai', () => ({
  openai: {
    chat: { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } },
  },
}));

import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import { POST } from './route';

const CHAPTER_TITLES = [
  '第1章：なぜ今（現状）',
  '第2章：どう戦う（戦略）',
  '第3章：どんな未来像（会社の未来像）',
  '第4章：どう実行に落とすか（実行）',
];

const CEO_INTENT = '自動車向けから成長市場へ軸足を移す';
const MISSION = '人の移動を安全にする';
const VISION = '設計初期から関与する';
const VALUE = '現場起点で判断する';

const CHAPTER2_VALID = `戦略結論：制御設計を成長の中核に据え、低採算の受託を見直す仮説を検証する。
1) 勝ち筋：EV向け制御設計の受託拡大
   重要課題・機会：自動車部品メーカーの制御ソフト人材不足
   戦略の方向性：設計初期から制御設計を受託し、小口受託を縮小する
   成功する根拠：設計開発力と長期関係（仮説）
   克服すべき障害・リスク：人材不足が制約になる
   狙う価値ドライバー：売上CAGR・営業利益率
   経営判断：制御設計への投資配分を増やし、低採算の受託を縮小する
   主要戦略：
   - 重点顧客を3社に絞る
   90日アクション：
   - 投資配分案を経営会議に提出する
   根拠キーワード：EV化 / 設計開発力 / 人材不足
   トレードオフ：小口受託を縮小する
2) 勝ち筋：既存受託の採算改善
   重要課題・機会：価格競争による既存受託の採算悪化
   戦略の方向性：仕様確定前に原価を提示し、採算割れの案件を見直す
   成功する根拠：長期関係（仮説）
   克服すべき障害・リスク：値上げで失注する可能性
   狙う価値ドライバー：営業利益率
   経営判断：価格基準を改定し、採算割れの案件から撤退する
   主要戦略：
   - 案件別の採算表を導入する
   90日アクション：
   - 撤退候補の案件リストを作る
   根拠キーワード：価格競争 / 長期関係 / 営業利益率
   トレードオフ：売上の一部を失う
3) 勝ち筋：制御設計人材の内製化
   重要課題・機会：外部委託の品質ばらつき
   戦略の方向性：設計標準を整備し、内製できる工程から社内に移す
   成功する根拠：設計開発力（仮説）
   克服すべき障害・リスク：採用の遅れ
   狙う価値ドライバー：ROIC
   経営判断：内製比率の目標を決め、外注先を絞る
   主要戦略：
   - 設計標準を整備する
   90日アクション：
   - 内製化の対象工程を選ぶ
   根拠キーワード：人材不足 / 設計開発力
   トレードオフ：短期の外注コスト増`;

function validStory(chapter2 = CHAPTER2_VALID) {
  return [
    {
      title: CHAPTER_TITLES[0],
      body: `要点：${CEO_INTENT}ことが必要な局面にある。
論点サマリ：
- 論点1：国内受注の伸び悩み（スコープ：全社）｜根拠指標：売上CAGR 1.2%｜要約：主力顧客の更新需要が鈍化
当社の事業と顧客
制御設計は自動車部品メーカーを主要顧客とする。
Mission：${MISSION}。
CEO意図から見た危機・必然性：${CEO_INTENT}。`,
    },
    { title: CHAPTER_TITLES[1], body: chapter2 },
    {
      title: CHAPTER_TITLES[2],
      body: `要点：制御設計が主力になる会社の姿。
Vision：${VISION}ことで、EV向けの制御需要を取り込む。
利用シーン：自動車部品メーカーが駆動制御の設計を必要とする場面で関与する。`,
    },
    {
      title: CHAPTER_TITLES[3],
      body: `要点：最初の90日で重点顧客と投資配分を決める。
Value：${VALUE}ことを行動原則にする。`,
    },
  ];
}

const VALID_WIN_PATTERNS = [
  {
    id: 'wp_1',
    name: 'EV向け制御設計の受託拡大',
    valueDrivers: ['売上CAGR'],
    rationale: '自動車部品メーカーの制御ソフト人材不足に応える',
    tradeoffs: '小口受託を縮小する',
    scope: 'company',
  },
];

function completion(content: string) {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

function draftResponse(story = validStory(), winPatterns = VALID_WIN_PATTERNS) {
  return completion(JSON.stringify({ storyDraft: story, winPatternsCandidate: winPatterns }));
}

const PAYLOAD = {
  strategyDataId: 'sd-1',
  issueBlocks: [{ title: '国内受注の伸び悩み', summary: '主力顧客の更新需要が鈍化' }],
  metricsSummary: { revenueCagrPct: 1.2, operatingMarginPctLatest: 4.5, roic: 6.1, wacc: 5.0 },
  ceoIntent: CEO_INTENT,
  mvv: { mission: MISSION, vision: VISION, value: VALUE },
  swot: {
    strength: '設計開発力\n顧客との長期関係',
    weakness: '人材不足',
    opportunity: 'EV化による制御需要',
    threat: '価格競争の激化',
  },
  swotSuggestions: { opportunity: ['提案機会A'], threat: [] },
  companyTargets: [],
  businessSegments: [{ name: '制御設計', summary: '制御ソフト受託', keyCustomers: ['自動車部品メーカー'] }],
};

function request(body: unknown = PAYLOAD) {
  return new NextRequest('http://localhost/api/stage2/generate-draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function messageOf(callIndex: number, role: 'system' | 'user'): string {
  const args = mockChatCreate.mock.calls[callIndex][0] as { messages: { role: string; content: string }[] };
  return args.messages.find((m) => m.role === role)?.content ?? '';
}

describe('POST /api/stage2/generate-draft', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let consoleSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    mockChatCreate.mockReset();
    jest.clearAllMocks();
    consoleSpies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')].map((spy) =>
      spy.mockImplementation(() => undefined)
    );
    process.env.OPENAI_API_KEY = 'test-key';
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue('user-1');
    (requireMembership as jest.Mock).mockResolvedValue({ role: 'manager' });
    (assertMinRole as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpies.forEach((spy) => spy.mockRestore());
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('認証されていない場合は 401 を返し、OpenAI を呼ばない', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValueOnce(null);

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('要件を満たす出力は再生成せず、4章と勝ち筋候補をそのまま返す', async () => {
    mockChatCreate.mockResolvedValueOnce(draftResponse());

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
    expect(json.storyDraft.map((c: { title: string }) => c.title)).toEqual(CHAPTER_TITLES);
    expect(json.storyDraft[1].body).toContain('戦略結論：制御設計を成長の中核に据え');
    expect(json.winPatternsCandidate).toEqual(VALID_WIN_PATTERNS);
  });

  it('SWOT判断・事業ポートフォリオ判断がなくても再生成しない（類型への当てはめは必須ではない）', async () => {
    mockChatCreate.mockResolvedValueOnce(draftResponse());

    await POST(request());

    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it('プロンプトは固定の思考順序・成長／収益改善／再構築の固定分類・SWOT類型の強制を含まない', async () => {
    mockChatCreate.mockResolvedValueOnce(draftResponse());

    await POST(request());

    const system = messageOf(0, 'system');
    const user = messageOf(0, 'user');

    expect(system).toContain('戦略結論：');
    expect(system).toContain('成功する根拠：');
    expect(system).toContain('戦略仮説');
    expect(system).toContain('財務・事業の現状');
    expect(system).not.toContain('顧客の未充足課題と市場変化を読み取る');
    expect(system).not.toContain('自社が選ばれる理由：');
    for (const text of [system, user]) {
      expect(text).not.toContain('成長牽引軸');
      expect(text).not.toContain('収益改善軸');
      expect(text).not.toContain('再構築軸');
      expect(text).not.toContain('SWOT判断');
      expect(text).not.toContain('S×O / W×T');
    }
  });

  it('プロンプトは優先順位の根拠・同時実行の不要・顧客課題から業績までの因果確認を指示する', async () => {
    mockChatCreate.mockResolvedValueOnce(draftResponse());

    await POST(request());

    const system = messageOf(0, 'system');
    expect(system).toContain('未確認事項');
    expect(system).toContain('3案すべてを同時に実行する前提にしない');
    expect(system).toContain('事業ごとに必ず1案ずつ戦略を割り当てない');
    expect(system).toContain('顧客課題の存在だけでは');
    expect(system).toContain('根拠のない資源配分比率や投資金額は書かない');
    expect(system).not.toContain('自社が選ばれる理由：');
  });

  it('第2章の戦略結論がない場合は修正パスで補い、修正結果を採用する', async () => {
    const withoutConclusion = CHAPTER2_VALID.replace(/^戦略結論：.*\n/, '');
    mockChatCreate
      .mockResolvedValueOnce(draftResponse(validStory(withoutConclusion)))
      .mockResolvedValueOnce(draftResponse());

    const res = await POST(request());
    const json = await res.json();

    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    expect(json.storyDraft[1].body).toContain('戦略結論：');
  });

  it('一般論の勝ち筋名（収益性の改善）は修正パスの対象になる', async () => {
    const generic = CHAPTER2_VALID.replace('1) 勝ち筋：EV向け制御設計の受託拡大', '1) 勝ち筋：収益性の改善');
    mockChatCreate
      .mockResolvedValueOnce(draftResponse(validStory(generic)))
      .mockResolvedValueOnce(draftResponse());

    await POST(request());

    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    expect(messageOf(1, 'system')).toContain('一般語だけの勝ち筋名');
  });

  it('「自社が選ばれる理由」「狙う顧客と未解決課題」がない戦略は、それだけで修正パスの対象にならない', async () => {
    expect(CHAPTER2_VALID).not.toContain('自社が選ばれる理由');
    expect(CHAPTER2_VALID).not.toContain('狙う顧客と未解決課題');
    mockChatCreate.mockResolvedValueOnce(draftResponse());

    await POST(request());

    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it.each(['重要課題・機会', '戦略の方向性', '成功する根拠', '克服すべき障害・リスク', '経営判断'])(
    '共通書式の「%s」が欠けると修正パスで補う',
    async (label) => {
      const missingLabel = CHAPTER2_VALID.replace(new RegExp(`^\\s*${label}：.*\\n`, 'gm'), '');
      expect(missingLabel).not.toContain(`${label}：`);
      mockChatCreate
        .mockResolvedValueOnce(draftResponse(validStory(missingLabel)))
        .mockResolvedValueOnce(draftResponse());

      await POST(request());

      expect(mockChatCreate).toHaveBeenCalledTimes(2);
      expect(messageOf(1, 'user')).toContain(label);
    }
  );

  it('修正パスのプロンプトは内部改革戦略を顧客価値創出型に書き換えないよう指示する', async () => {
    const generic = CHAPTER2_VALID.replace('1) 勝ち筋：EV向け制御設計の受託拡大', '1) 勝ち筋：収益性の改善');
    mockChatCreate
      .mockResolvedValueOnce(draftResponse(validStory(generic)))
      .mockResolvedValueOnce(draftResponse());

    await POST(request());

    const repairSystem = messageOf(1, 'system');
    expect(repairSystem).toContain('内部改革戦略');
    expect(repairSystem).toContain('顧客価値の新規創出戦略へ書き換えない');
    expect(repairSystem).toContain('全戦略へ機械的に追加しない');
    expect(repairSystem).toContain('既存の戦略の方向性・経営判断を変えず');
  });
});

type CaseSpec = {
  name: string;
  ceo: string;
  mission: string;
  vision: string;
  value: string;
  issue: string;
  swot: { strength: string; weakness: string; opportunity: string; threat: string };
  metrics: { revenueCagrPct: number; operatingMarginPctLatest: number; roic: number; wacc: number };
  conclusionKeyword: string;
  chapter2: string;
};

function caseBody(c: CaseSpec) {
  return {
    ...PAYLOAD,
    ceoIntent: c.ceo,
    mvv: { mission: c.mission, vision: c.vision, value: c.value },
    issueBlocks: [{ title: c.issue, summary: c.issue }],
    swot: c.swot,
    metricsSummary: c.metrics,
    businessSegments: [],
  };
}

function caseStory(c: CaseSpec) {
  return [
    {
      title: CHAPTER_TITLES[0],
      body: `要点：${c.ceo}必要がある。
論点サマリ：
- 論点1：${c.issue}（スコープ：全社）｜根拠指標：営業利益率｜要約：${c.issue}
当社の事業と顧客
Mission：${c.mission}。
CEO意図から見た危機・必然性：${c.ceo}。`,
    },
    { title: CHAPTER_TITLES[1], body: c.chapter2 },
    {
      title: CHAPTER_TITLES[2],
      body: `要点：${c.conclusionKeyword}を両立させた会社の姿。
Vision：${c.vision}。
利用シーン：既存の顧客が新たな価値を受け取る場面を描く。`,
    },
    {
      title: CHAPTER_TITLES[3],
      body: `要点：最初の90日で判断事項を決める。
Value：${c.value}ことを行動原則にする。`,
    },
  ];
}

const CASE_A: CaseSpec = {
  name: 'A: W中心（生産性・品質・組織が業績を阻害）',
  ceo: '生産性と品質の立て直しを最優先する',
  mission: '安定した品質で顧客の信頼に応える',
  vision: '工場の生産性で業界をリードする',
  value: '現場の改善を積み重ねる',
  issue: '生産性の低下と不良率の上昇',
  swot: {
    strength: '長年の製造ノウハウ',
    weakness: '生産性の低下\n品質不良の増加\n組織の縦割り',
    opportunity: '特になし',
    threat: '人件費の上昇',
  },
  metrics: { revenueCagrPct: -2.0, operatingMarginPctLatest: 1.8, roic: 2.1, wacc: 5.0 },
  conclusionKeyword: '収益性',
  chapter2: `戦略結論：生産性と品質の改善を先行させ、収益性を回復する仮説を検証する。
1) 勝ち筋：製造ラインの生産性改善による収益回復
   重要課題・機会：ライン稼働率の低下と不良率の上昇
   戦略の方向性：工程別の生産性と不良を全社共通の指標で計測し、改善を優先順に実施する
   成功する根拠：長年の製造ノウハウ（仮説）
   克服すべき障害・リスク：現場の改善余力と人手の制約
   狙う価値ドライバー：営業利益率
   経営判断：改善投資の配分を先行させ、低採算ラインの生産計画を見直す
   主要戦略：
   - 工程別の不良分析を全ラインに展開する
   90日アクション：
   - 改善対象ラインの優先順位を経営会議で決める
   根拠キーワード：製造ノウハウ / 生産性 / 不良率
   トレードオフ：短期の設備投資負担
2) 勝ち筋：部門横断の組織改革による意思決定の迅速化
   重要課題・機会：縦割り組織による意思決定の遅れ
   戦略の方向性：製造と営業の判断権限を統合し、部門間の評価指標を揃える
   成功する根拠：現場起点の判断（仮説）
   克服すべき障害・リスク：既存部門の抵抗
   狙う価値ドライバー：ROIC
   経営判断：部門間の評価指標を統一し、権限規程を改定する
   主要戦略：
   - 部門横断の改善会議を設ける
   90日アクション：
   - 権限規程の改定案を作る
   根拠キーワード：組織の縦割り / 品質
   トレードオフ：部門間の調整負荷`,
};

const CASE_B: CaseSpec = {
  name: 'B: O中心（財務健全・競争力があり成長機会が大きい）',
  ceo: '成長市場の新規需要を先取りする',
  mission: '人の移動を安全にする',
  vision: '新たな移動需要を取り込む',
  value: '機会を先に捉える',
  issue: '新規需要の取り込み遅れ',
  swot: {
    strength: '高い技術力\n財務余力',
    weakness: '海外営業網の未整備',
    opportunity: 'EV向け制御需要の拡大\n海外需要の増加',
    threat: '価格競争',
  },
  metrics: { revenueCagrPct: 9.5, operatingMarginPctLatest: 12.0, roic: 11.0, wacc: 5.0 },
  conclusionKeyword: '成長投資',
  chapter2: `戦略結論：新規の制御需要を先取りし、成長投資を優先する仮説を検証する。
1) 勝ち筋：EV向け制御ソフトの新規受注拡大
   重要課題・機会：EV向け制御需要の拡大
   戦略の方向性：既存の技術力を活かし、新規のEV向け案件に投資を集中する
   成功する根拠：高い技術力と財務余力（仮説）
   克服すべき障害・リスク：開発人員の確保が追いつかない
   狙う価値ドライバー：売上CAGR・ROIC
   経営判断：EV向けの開発投資枠を増やし、既存案件の人員を再配置する
   主要戦略：
   - EV向け案件の受注目標を設定する
   90日アクション：
   - 開発投資の配分案を経営会議に提出する
   根拠キーワード：EV化 / 技術力 / 財務余力
   トレードオフ：既存案件の納期余裕を減らす
2) 勝ち筋：海外向け制御ソフトの展開
   重要課題・機会：海外需要の増加と海外営業網の未整備
   戦略の方向性：現地パートナーを通じて海外案件の受注窓口を作る
   成功する根拠：財務余力を現地展開の初期投資に充てられる（仮説）
   克服すべき障害・リスク：海外営業の立ち上げ遅れ
   狙う価値ドライバー：売上CAGR
   経営判断：海外展開の投資上限と撤退基準を決める
   主要戦略：
   - 現地パートナーの候補を選定する
   90日アクション：
   - 海外展開の投資上限案を作る
   根拠キーワード：海外需要 / 財務余力
   トレードオフ：短期の利益率低下`,
};

const CASE_C: CaseSpec = {
  name: 'C: 複合型（成長機会と収益・能力上の制約が併存）',
  ceo: '成長需要を取り込みつつ収益性を守る',
  mission: '人の移動を安全にする',
  vision: '設計初期から関与する',
  value: '現場起点で判断する',
  issue: '成長機会と原価率の高さが併存',
  swot: {
    strength: '技術力',
    weakness: '人材不足\n原価率の高さ',
    opportunity: 'EV向け需要',
    threat: '価格競争',
  },
  metrics: { revenueCagrPct: 4.0, operatingMarginPctLatest: 5.5, roic: 6.0, wacc: 5.0 },
  conclusionKeyword: '両立',
  chapter2: `戦略結論：成長機会を取りつつ、原価率と人材の制約を解消する両立の仮説を検証する。
1) 勝ち筋：EV向け制御設計の受託拡大
   重要課題・機会：EV向け需要の取り込み
   戦略の方向性：技術力を活かした設計受託を、採算の合う案件に限定して拡大する
   成功する根拠：技術力（仮説）
   克服すべき障害・リスク：人材不足が受注の上限になる
   狙う価値ドライバー：売上CAGR
   経営判断：受注を採算基準で選別し、人員配置を重点案件へ寄せる
   主要戦略：
   - 採算基準を満たす案件を重点的に受注する
   90日アクション：
   - 受注基準の案を経営会議に提出する
   根拠キーワード：EV化 / 技術力 / 人材不足
   トレードオフ：受注件数の一時的な減少
2) 勝ち筋：既存受託の原価率改善
   重要課題・機会：原価率の高さと価格競争
   戦略の方向性：案件別の原価を把握し、低採算の受託条件を見直す
   成功する根拠：既存顧客との長期関係（仮説）
   克服すべき障害・リスク：値上げによる失注
   狙う価値ドライバー：営業利益率
   経営判断：原価の高い案件の価格基準を改定する
   主要戦略：
   - 案件別の原価表を導入する
   90日アクション：
   - 低採算案件の一覧を作る
   根拠キーワード：原価率 / 価格競争
   トレードオフ：一部の売上を失う
3) 勝ち筋：制御設計人材の内製化
   重要課題・機会：人材不足による外部委託への依存
   戦略の方向性：設計標準を整備し、社内で担える工程を増やす
   成功する根拠：技術力を社内に移転できる（仮説）
   克服すべき障害・リスク：採用と育成の遅れ
   狙う価値ドライバー：ROIC
   経営判断：内製比率の目標を決め、外注先を絞る
   主要戦略：
   - 設計標準を整備する
   90日アクション：
   - 内製化の対象工程を選ぶ
   根拠キーワード：人材不足 / 技術力
   トレードオフ：短期の外注コスト増`,
};

describe('3ケースの静的検証（モック出力）', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let consoleSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    mockChatCreate.mockReset();
    jest.clearAllMocks();
    consoleSpies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')].map((spy) =>
      spy.mockImplementation(() => undefined)
    );
    process.env.OPENAI_API_KEY = 'test-key';
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue('user-1');
    (requireMembership as jest.Mock).mockResolvedValue({ role: 'manager' });
    (assertMinRole as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpies.forEach((spy) => spy.mockRestore());
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it.each([CASE_A, CASE_B, CASE_C])('$name：入力が設計どおりプロンプトに入り、修正パスなしで判断を返す', async (c) => {
    mockChatCreate.mockResolvedValueOnce(draftResponse(caseStory(c), VALID_WIN_PATTERNS));

    const res = await POST(request(caseBody(c)));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockChatCreate).toHaveBeenCalledTimes(1);

    const user = messageOf(0, 'user');
    expect(user).toContain(c.ceo);
    expect(user).toContain(c.swot.weakness.split('\n')[0]);
    expect(user).toContain(c.metrics.operatingMarginPctLatest.toFixed(1));

    const chapter2: string = json.storyDraft[1].body;
    expect(chapter2).toBe(c.chapter2);
    expect(chapter2.split('\n')[0]).toContain('戦略結論：');
    expect(chapter2.split('\n')[0]).toContain(c.conclusionKeyword);
    expect(json.storyDraft[1].title).toBe(CHAPTER_TITLES[1]);
    expect(json.storyDraft).toHaveLength(4);
  });

  it('A（W中心）の内部改革戦略は、修正パスで顧客価値創出型に書き換えられない前提の指示が出る', async () => {
    const generic = CASE_A.chapter2.replace('1) 勝ち筋：製造ラインの生産性改善による収益回復', '1) 勝ち筋：収益性の改善');
    mockChatCreate
      .mockResolvedValueOnce(draftResponse(caseStory({ ...CASE_A, chapter2: generic }), VALID_WIN_PATTERNS))
      .mockResolvedValueOnce(draftResponse(caseStory(CASE_A), VALID_WIN_PATTERNS));

    await POST(request(caseBody(CASE_A)));

    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    const repairSystem = messageOf(1, 'system');
    expect(repairSystem).toContain('組織改革・生産性・品質・収益改善などの内部改革戦略');
  });

  it('B（O中心）は必須ラベルと根拠キーワードが揃っていれば修正パスを発生させない', async () => {
    mockChatCreate.mockResolvedValueOnce(draftResponse(caseStory(CASE_B), VALID_WIN_PATTERNS));

    await POST(request(caseBody(CASE_B)));

    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it('C（複合型）で根拠キーワードが全ブロック同一なら修正パスの対象になる', async () => {
    const sameEvidence = CASE_C.chapter2.replace(/根拠キーワード：.*\n/g, '根拠キーワード：技術力 / 人材不足\n');
    mockChatCreate
      .mockResolvedValueOnce(draftResponse(caseStory({ ...CASE_C, chapter2: sameEvidence }), VALID_WIN_PATTERNS))
      .mockResolvedValueOnce(draftResponse(caseStory(CASE_C), VALID_WIN_PATTERNS));

    await POST(request(caseBody(CASE_C)));

    expect(mockChatCreate).toHaveBeenCalledTimes(2);
    expect(messageOf(1, 'user')).toContain('根拠キーワードが同一');
  });
});
