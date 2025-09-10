// /app/api/generate-question/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText } from '@/app/api/_shared/utils';

/* =========================
 * 型
 * ========================= */
type Depth = 'board' | 'exec' | 'ops';
type DepthBias = 'abstract' | 'standard' | 'concrete';

// ★ 追加: 著名コンサルのレンズ
type ConsultantLens = 'drucker' | 'porter' | 'christensen' | 'collins' | 'charan' | 'design';

// ★ 追加: 任意のポートフォリオ型（UIから渡さなくてもOK）
type Portfolio = {
  businesses: Array<{
    name: string;
    revenueShare?: number;   // 売上構成比(%)
    margin?: number;         // 粗利率(%)
    growth?: number;         // 成長率(%)
    okr?: { objective?: string; keyResults?: string[]; owner?: string };
  }>;
  focus?: string;            // 注力事業（任意）
};

type ReqBodyA = {
  chapterIndex?: number;             // 0..3
  chapterTitle: string;
  chapterBody: string;
  stepNumber: number;                // 1..3
  previousAnswer?: string;
  answersSoFar?: Array<{ stepNumber: number; answer: string }>;
  csvFinanceData?: any[] | string;
};

type ReqBodyB = {
  strategyId?: string;
  chapterIndex?: number;
  afterStepIndex?: number; // 0-based（※既存互換: 今回は使わない）
  chapterTitle?: string;
  stepHint?: number;

  depthBias?: DepthBias;
  safety?: { requireConfirm?: boolean; confirmed?: boolean };
  lockStep?: boolean;

  // ★ 追加: レンズ明示（未指定なら自動選択）
  lensOverride?: ConsultantLens[];

  context?: {
    story?: Array<{ title: string; body: string }>;
    answers2?: Array<{
      chapterIndex: number;
      chapterTitle: string;
      steps: Array<{
        stepNumber: number;
        question: string;
        reason: string;
        answer: string;
        depth?: Depth;
      }>;
    }>;
    mission?: string;
    vision?: string;
    value?: string;
    strength?: string;
    weakness?: string;
    opportunity?: string;
    threat?: string;
    csvFinanceData?: any[] | string;

    // ★ 追加: 複数事業情報（任意）
    portfolio?: Portfolio;
  };
};

type ReqBody = Partial<ReqBodyA & ReqBodyB>;

type AnswerStep = {
  stepNumber: number;
  depth: Depth;
  question: string;
  reason: string;
  answer: string;
};

/* =========================
 * Utils
 * ========================= */
function clampStep(n: unknown, fallback: number): number {
  const x = typeof n === 'number' ? n : Number(n);
  const v = Number.isFinite(x) ? (x as number) : fallback;
  return Math.max(1, Math.min(3, v));
}

function tryParseJsonLocal<T = any>(text: string): T | null {
  try { return JSON.parse(text); } catch { return null; }
}

function coerceFinanceArray(src: unknown): any[] | undefined {
  if (Array.isArray(src)) return src as any[];
  if (typeof src !== 'string') return undefined;
  const j = tryParseJsonLocal(src);
  if (Array.isArray(j)) return j;
  const lines = src.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return undefined;
  const headers = lines[0].split(',').map((h) => h.trim()).filter(Boolean);
  if (!headers.length) return undefined;
  const rows = lines.slice(1).map((ln) => {
    const cols = ln.split(',');
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim(); });
    return obj;
  });
  return rows;
}

type FinanceRow = Record<string, any>;
type Trend = 'up' | 'flat' | 'down' | null;

function toNum(v: any): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[,\s％%]/g, '');
  if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function normKey(k: string) {
  return k.toLowerCase().replace(/\s+|[_\-（）()]/g, '');
}
function pickField(row: FinanceRow, keys: string[]): number | null {
  const map = new Map<string, string>();
  for (const kk of Object.keys(row)) map.set(normKey(kk), kk);
  for (const k of keys) {
    const found = map.get(normKey(k));
    if (found) {
      const n = toNum((row as any)[found]);
      if (n != null) return n;
    }
  }
  for (const k of keys) {
    const nk = normKey(k);
    const maybe = [...map.keys()].find((kk) => kk.startsWith(nk));
    if (maybe) {
      const n = toNum((row as any)[maybe as string]);
      if (n != null) return n;
    }
  }
  return null;
}
function getYear(row: FinanceRow): number | null {
  const directKeys = ['year', '年度', '決算年度', '会計年度', 'fiscalyear', '期'];
  for (const k of directKeys) {
    const m = Object.keys(row).find((kk) => normKey(kk) === normKey(k));
    if (m) {
      const val = (row as any)[m];
      const y = String(val).match(/(20\d{2}|19\d{2})/);
      if (y) return Number(y[1]);
      const n = toNum(val);
      if (n != null) return n;
    }
  }
  for (const v of Object.values(row)) {
    if (typeof v === 'string') {
      const y = v.match(/(20\d{2}|19\d{2})/);
      if (y) return Number(y[1]);
    }
  }
  return null;
}

type FinanceSummary = {
  latestYear?: number;
  latestSales?: number | null;
  latestOpMargin?: number | null;
  revCagrPct?: number | null;
  roe?: number | null;
  roa?: number | null;
  trend?: Trend;
};
function buildFinanceSummary(csvFinanceData?: any[] | string | null): FinanceSummary | null {
  const coerced = coerceFinanceArray(csvFinanceData as any) ?? (Array.isArray(csvFinanceData) ? csvFinanceData : undefined);
  if (!Array.isArray(coerced) || coerced.length === 0) return null;

  const rows = coerced
    .map((r) => {
      const year = getYear(r);
      const sales =
        pickField(r, ['sales', 'revenue', '売上', '売上高', '売上(百万円)', '売上高(百万円)']) ??
        (pickField(r, ['売上高(万円)', '売上(万円)']) != null
          ? (pickField(r, ['売上高(万円)', '売上(万円)']) as number) * 0.1
          : null);
      const opProfit = pickField(r, ['operatingprofit', '営業利益', '営業利益(百万円)']);
      const opMargin =
        sales && opProfit != null && sales !== 0
          ? (opProfit / sales) * 100
          : pickField(r, ['operatingmargin', '営業利益率']);
      const net = pickField(r, ['netincome', '純利益', '当期純利益']);
      const equity = pickField(r, ['equity', '自己資本']);
      const totalAssets = pickField(r, ['totalassets', '総資産']);
      const roe = net != null && equity ? (equity !== 0 ? (net / equity) * 100 : null) : null;
      const roa = net != null && totalAssets ? (totalAssets !== 0 ? (net / totalAssets) * 100 : null) : null;
      return { year, sales, opMargin, net, equity, totalAssets, roe, roa };
    })
    .filter((x) => x.year != null || x.sales != null);

  if (rows.length === 0) return null;

  rows.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const latest = rows[0];

  const points = rows
    .filter((r) => r.year != null && r.sales != null)
    .slice()
    .sort((a, b) => a.year! - b.year!);
  let revCagrPct: number | null = null;
  let trend: Trend = null;
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    const years = last.year! - first.year! || 1;
    if (first.sales! > 0 && years > 0) {
      const cagr = Math.pow((last.sales! as number) / (first.sales! as number), 1 / years) - 1;
      revCagrPct = cagr * 100;
    }
    const diffs = points.slice(1).map((p, i) => p.sales! - points[i].sales!);
    const up = diffs.every((d) => d >= 0);
    const down = diffs.every((d) => d <= 0);
    trend = up ? 'up' : down ? 'down' : 'flat';
  }

  return {
    latestYear: latest.year ?? undefined,
    latestSales: latest.sales ?? null,
    latestOpMargin: latest.opMargin ?? null,
    revCagrPct,
    roe: latest.roe ?? null,
    roa: latest.roa ?? null,
    trend,
  };
}
function fmtMilYen(n?: number | null) {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString()} 百万円`;
}
function fmtPct(n?: number | null) {
  if (n == null) return '—';
  return `${(Math.round((n as number) * 10) / 10).toLocaleString()}%`;
}

/* =========================
 * 章ゴール & 深掘りプローブ
 * ========================= */
// 単一事業モード（現状の既定）
const CHAPTER_GUIDE = [
  { label: '現状',   goal: '経営が感じる危機を全社員と共有し、「このままではまずい」を自分ごと化させる。', probes: [
    '直近の変化で最も深刻な1点は何ですか？いつから兆候が見え、どのKPI（例：受注単価・粗利・解約率等）にどの程度の変化が出ていますか？',
    'その事象が続くと今期〜来期にどのKPIにどの幅の悪化を及ぼしますか？数値幅（△◯%/△◯件）と期限（◯年◯Q）を1つで示してください。',
    '「放置できない臨界域」を1つ定義し、早期警戒トリガー（例：月次クレーム◯件）・発動時の即応アクション・責任者を示してください。',
  ]},
  { label: '戦略',   goal: '何に注力し何を捨てるかを定め、資源配分と優先順位を明確化する。', probes: [
    '最優先の市場/顧客/用途を1つだけ選び、その根拠を客単価・粗利・獲得難易度・参入障壁などの基準で簡潔に示してください。',
    // ★ 変更: 「北極星KPI」→「目指すゴール/OKR」表現
    'この戦略の**目指すゴール（Objective）**を1つに絞り、測る**Key Results**を2〜3個（数値と期限付き）で定義してください。',
    '当面やめる/縮小する施策を1つ特定し、KILL基準（◯Q時点で◯未達なら停止）・責任者・見直し時期（◯年◯Q）を明記してください。',
  ]},
  { label: '未来像', goal: '顧客の風景で未来を描写し、希望と判断の物差しを共有する。', probes: [
    '3年後の「顧客の現場」を1シーンだけ描写してください。誰がどこで何をし、当社の価値がどう見えるかを具体に。',
    'その未来像に近づいていることを示す最重要な外部シグナルを1つ挙げ、観測方法と頻度（例：月次レビュー）を定義してください。',
    '顧客のBefore→Afterを1行で表現してください（例：「検査に◯日→◯時間、手戻り率◯%→目安下限」など）。',
  ]},
  { label: '行動',   goal: '社員が戦略を自分ごと化し、行動に移せるようにする。', probes: [
    'どの役割（例：インサイドセールス/PM/現場SV）が、どの行動をいつから繰り返すべきかを1つだけ具体に示してください。',
    'その行動のチェックリストを3項目以内で定義し、頻度（毎日/毎週/毎商談）・使用ツール（CRM/BI等）・完了判定条件を明確にしてください。',
    'オーナー（役職名可）・モニタリングKPI（先行指標を1つ）・レビュー頻度（例：毎週/月次）・報酬/称賛の連動方法を簡潔に定義してください。',
  ]},
] as const;

// ★ 追加: 複数事業モード（context.portfolio が渡されたときに自動切替）
const CHAPTER_GUIDE_PORTFOLIO = [
  { label: '現状',   goal: '事業ポートフォリオの健康状態と波及リスクを把握する。', probes: [
    '直近の四半期で**悪化が最も大きい事業**を1つ挙げ、影響するKPI（例：解約率/案件単価/在庫回転）と変化幅・開始時期を具体に示してください。',
    '**最大の伸び事業**と**最大の減速事業**を各1つ挙げ、会社全体の売上/粗利に与える影響（目安%）を簡潔に述べてください。',
    '全社として「放置できない臨界域」を1つ定義し、早期警戒トリガー（例：旗艦事業の粗利率△1pt）と即応アクションを明記してください。',
  ]},
  { label: '戦略',   goal: '成長/収益/資本効率に照らして配分と撤退基準を決める。', probes: [
    '今期〜来期で**資源を最優先配分する事業**を1つ選び、根拠を売上構成比/粗利/成長率/参入障壁から1行ずつ示してください。',
    '選んだ事業の**目指すゴール（Objective）**を1つと、測る**Key Results**を2〜3個（数値と期限付き）で定義してください。',
    '**縮小/撤退候補**の事業を1つ挙げ、停止・縮小の基準（◯Qで◯未達）と、捻出リソースの再配分先を明記してください。',
  ]},
  { label: '未来像', goal: '旗艦/新規の各事業で顧客体験の変化を描く。', probes: [
    '旗艦事業の**3年後の顧客現場**を1シーンで描写してください（人物・場所・当社の価値を具体に）。',
    '新規/拡大型の事業で、進捗を示す**外部サイン**を1つ定義し（例：業界標準採用の打診）、観測方法と頻度を書いてください。',
    '旗艦と新規の**Before→After**を各1行で（例：「導入工数◯日→◯時間」「滞在単価◯円→◯円」）。',
  ]},
  { label: '行動',   goal: '事業別のOKR・責任体制・レビューを仕組み化する。', probes: [
    '注力事業で**誰が**どの行動を**いつから**繰り返すかを1つ（例：営業が「比較表提示」を**毎商談**）。',
    'その行動の**チェックリスト**を3項目以内、レビュー頻度（毎週/隔週/⽉次）と**先行KPI**を1つ定義してください。',
    '各事業の**Objective/Key Results/Owner**とレビューのリズム（例：隔週金曜）を簡潔に示してください。',
  ]},
] as const;

/* =========================
 * “汎用すぎる質問”/粒度違反チェック
 * ========================= */
const GENERIC_TOKENS_BY_CHAPTER: Record<number, string[]> = {
  0: ['外部環境','市場変化','競争激化','不確実性','リスク','課題'],
  1: ['戦略','差別化','資源配分','優先順位','選択と集中','ロードマップ','取り組み'],
  2: ['未来像','ビジョン','顧客の風景','スタンダード','標準化','導入現場'],
  3: ['行動変容','意識改革','巻き込み','実行力','エンゲージメント','コミュニケーション'],
};

const FORBIDDEN_BY_DEPTH: Record<Depth, RegExp | null> = {
  board: /(責任者|Owner|チェックリスト|毎(週|日)|CRM|BI|SFA|人月|工数|ツール)/i,
  exec:  /(チェックリスト|CRM|BI|SFA|人月|工数)/i,
  ops:   null,
};

function violatesDepth(q: string, depth: Depth) {
  const re = FORBIDDEN_BY_DEPTH[depth];
  if (!re) return false;
  return re.test(q);
}

function looksTooGeneric(q: string, chapterIndex: number, depth: Depth) {
  const genericList = GENERIC_TOKENS_BY_CHAPTER[chapterIndex] ?? [];
  const hasGeneric = genericList.some(w => q.includes(w));
  const hasNumDeadline = /[0-9０-９％%]/.test(q) && /(Q|Ｑ|年|月|週|日)/.test(q);
  const hasConcreteNoun =
    /[A-Za-z]{2,}/.test(q) || /(地域|都道府県|顧客|用途|ブランド|製品|SKU|事業|ライン|部門|チャネル|責任者|担当)/.test(q);
  const touchesChoice = /(選ぶ|捨てる|前提|仮説|比較|位置取り|ポジショニング|ベット|トレードオフ)/.test(q);
  const mentionsOwner = /(責任者|Owner|役割|担当|部門)/.test(q);

  if (depth === 'board') {
    return hasGeneric && !touchesChoice && !hasConcreteNoun;
  }
  if (depth === 'exec') {
    return hasGeneric && !(hasNumDeadline || hasConcreteNoun);
  }
  return hasGeneric && !(hasNumDeadline || mentionsOwner || hasConcreteNoun);
}

/* =========================
 * ガイド切替（単一/複数事業）
 * ========================= */
// ★ 追加: context に businesses があればポートフォリオ用ガイドを使う
function hasPortfolio(ctx?: ReqBodyB['context']) {
  return !!ctx?.portfolio?.businesses?.length;
}
function getChapterGuide(chapterIndex: number, ctx?: ReqBodyB['context']) {
  const base = hasPortfolio(ctx) ? CHAPTER_GUIDE_PORTFOLIO : CHAPTER_GUIDE;
  return base[Math.max(0, Math.min(3, chapterIndex))];
}

/* =========================
 * レンズ定義・選択
 * ========================= */
// ★ 追加: レンズ定義（原則・語彙・使いどころ）
const CONSULTING_LENSES: Record<ConsultantLens, {
  title: string;
  principles: string[];
  sampleAngles: string[];
  goodTerms?: string[];
  avoidTerms?: string[];
}> = {
  drucker: {
    title: 'ドラッカー（顧客・使命・強み）',
    principles: [
      '顧客は誰か／顧客にとっての価値は何かを明示する',
      '使命・存在意義の文脈で問う（製品や利益から始めない）',
      '強みに資源集中させるための選択を迫る'
    ],
    sampleAngles: [
      '誰のどの不便を解消するのか',
      '価値を測る顧客側の成果指標は何か'
    ],
    goodTerms: ['顧客','価値','強み','成果','貢献'],
    avoidTerms: ['抽象的価値','取り組み全般']
  },
  porter: {
    title: 'ポーター（競争戦略）',
    principles: [
      'どこで戦うか（市場/顧客/用途）を選ぶ',
      '独自ポジショニングとトレードオフを明確化する',
      '活動の一貫性を問う'
    ],
    sampleAngles: ['参入障壁','代替品','購買力','供給力','競争強度'],
    goodTerms: ['ポジショニング','参入障壁','代替','一貫性','選択と集中'],
    avoidTerms: ['とにかく差別化','全部やる']
  },
  christensen: {
    title: 'クリステンセン（ジョブ理論/破壊）',
    principles: [
      '顧客が製品を“雇うジョブ”に着目して問う',
      '非消費や過剰品質を探り、別解を示唆する',
      '既存強みが将来の障害になり得る前提を試す'
    ],
    sampleAngles: ['非消費者','十分に良い','別解の進路'],
    goodTerms: ['ジョブ','非消費','過剰品質','別解'],
    avoidTerms: ['既存顧客だけ','高機能化一辺倒']
  },
  collins: {
    title: 'ジム・コリンズ（偉大さ/人）',
    principles: [
      '情熱×世界一×経済エンジン（ハリネズミ）で絞る',
      'バスに乗せるべき人（適所適材）を問う',
      '厳しい現実の直視（ストックデールの逆説）'
    ],
    sampleAngles: ['人選','習慣化','規律'],
    goodTerms: ['情熱','世界一になれる','経済エンジン','規律'],
    avoidTerms: ['人依存の属人芸']
  },
  charan: {
    title: 'ラム・チャラン（Execution）',
    principles: [
      '誰が・いつまでに・何で測るかを詰める',
      '現場の数字と実態を一致させる',
      '最後の1マイル（仕組み化・レビュー）まで落とす'
    ],
    sampleAngles: ['責任者','レビュー頻度','早期警戒トリガー'],
    goodTerms: ['責任者','期限','KPI','レビュー','仕組み化'],
    avoidTerms: ['責任不在','期限未定']
  },
  design: {
    title: 'デザイン思考（体験）',
    principles: [
      'ユーザーの具体的な“つまずき”を描写する',
      '理想の体験から逆算してプロトタイプで検証する',
      '観察可能な手触り・感情・一場面を捉える'
    ],
    sampleAngles: ['1シーン描写','Before→After','観察指標'],
    goodTerms: ['観察','プロトタイプ','体験','一場面','前後比較'],
    avoidTerms: ['抽象ビジョンだけ']
  }
};

// ★ 追加: 章と入力文脈から有効レンズを優先順で返す
function pickConsultingLenses(params: {
  chapterIndex: number;
  stepNumber: number;
  context?: ReqBodyB['context'];
  previousAnswer?: string;
  lensOverride?: ConsultantLens[];
}): ConsultantLens[] {
  // 1) 明示指定があれば最優先
  if (params.lensOverride?.length) return params.lensOverride;

  const { chapterIndex, context, previousAnswer } = params;
  const lenses: ConsultantLens[] = [];

  const hasMVV = !!(context?.mission || context?.vision || context?.value);
  const hasSWOT = !!(context?.strength || context?.weakness || context?.opportunity || context?.threat);

  // 章ごとの基本順（現状→戦略→未来像→行動）
  if (chapterIndex === 0) {
    lenses.push('drucker','design','porter');
  } else if (chapterIndex === 1) {
    lenses.push('porter','collins','drucker');
  } else if (chapterIndex === 2) {
    lenses.push('design','christensen','drucker');
  } else {
    lenses.push('charan','collins','porter');
  }

  // 入力データに応じて重み付け（前に寄せる）
  if (hasMVV) {
    const i = lenses.indexOf('drucker'); if (i > 0) { lenses.splice(i,1); lenses.unshift('drucker'); }
  }
  if (hasSWOT) {
    const i = lenses.indexOf('porter'); if (i > 0) { lenses.splice(i,1); lenses.unshift('porter'); }
  }

  // 否定回答なら、検証/兆し系を前倒し
  if (isNegationJa(previousAnswer || '')) {
    const pri: ConsultantLens[] = chapterIndex === 0 ? ['design','porter'] : ['porter','christensen'];
    for (let k = pri.length - 1; k >= 0; k--) {
      const l = pri[k];
      const idx = lenses.indexOf(l);
      if (idx > 0) { lenses.splice(idx,1); lenses.unshift(l); }
    }
  }

  return Array.from(new Set(lenses)).slice(0, 3);
}

/* =========================
 * 深掘りシード選択（順番固定＋否定分岐＋重複回避）
 * ========================= */
function isNegationJa(s: string) {
  const t = (s || '').toLowerCase();
  return /(ない|ありません|不要|求めていない|求めない|変える必要はない|変革は不要|しなくていい|問題ない|問題はない|影響はない|危機ではない|方向性はない|課題はない)/.test(t);
}
const CONTRADICT_SEEDS = {
  0: [
    '強い変化が見当たらないとのことですが、弱いシグナルに該当し得る指標（受注単価・解約率・在庫回転など）で直近の微変化を1つ特定し、推移と解釈を述べてください。',
    '“危機はない”前提の検証用に、業界平均と比べた売上CAGR・営業利益率・ROEの閾値を設定し、現状とのギャップ評価を示してください。',
  ],
  1: [
    '現状維持の利点を顧客・社員・社会の視点から1〜2点具体に挙げ、短期と中期での副作用を併記してください。',
    '選択と集中の観点で、相対的に弱い領域を1つ挙げ、縮小の妥当性を示す基準を定義してください。',
  ],
  2: [
    '課題なし前提で、あえて「集中すれば更に伸ばせる」分野を1つだけ具体に挙げ、価値の顧客側の手触りを1文で示してください。',
    '未来像の検証として、現場で観測できる小さな兆し（例：標準採用の打診、NPSコメントの変化）を1つ定義してください。',
  ],
  3: [
    '変革不要の前提で、品質・納期・法令遵守の観点から最低限守るべき行動基準を3つ以内で定義してください。',
    '現状維持で問題が生じたと判断する早期警戒トリガーを1〜2個だけ決め（例：粗利率△1pt）、発動時の即応を示してください。',
  ],
} as const;

const SIMILARITY_THRESHOLD = 0.78;
function normalizeJa(s: string) {
  return (s || '')
    .toLowerCase()
    .replace(/[！!？?\s　、。,.;:：「」『』【】（）()［］\[\]…ー\-_/\\]+/g, '')
    .trim();
}
function ngrams(s: string, n = 3): string[] {
  if (!s) return [];
  const arr = Array.from(s);
  if (arr.length <= n) return [arr.join('')];
  const out: string[] = [];
  for (let i = 0; i <= arr.length - n; i++) out.push(arr.slice(i, i + n).join(''));
  return out;
}
function jaccard(a: string, b: string) {
  const A = new Set(ngrams(normalizeJa(a)));
  const B = new Set(ngrams(normalizeJa(b)));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}
function isTooSimilar(candidate: string, prev: string[]): { ok: boolean; maxSim: number; nearest?: string } {
  let maxSim = 0; let nearest = '';
  for (const p of prev) {
    const sim = jaccard(candidate, p);
    if (sim > maxSim) { maxSim = sim; nearest = p; }
  }
  return { ok: maxSim < SIMILARITY_THRESHOLD, maxSim, nearest };
}

/** ★ 修正：SEED（プローブ）選択ロジック：ガイドを単一/複数事業で切替 */
function pickSeedProbe(
  chapterIndex: number,
  stepNumber: number,
  previousQuestions: string[],
  previousAnswer?: string,
  context?: ReqBodyB['context'] // ★ 追加
): string | '' {
  const idx = Math.max(0, Math.min(3, chapterIndex));
  const stepIdx = Math.max(1, Math.min(3, stepNumber)) - 1;

  // 1) 否定的な回答のときは CONTRADICT_SEEDS を優先
  const neg = isNegationJa(previousAnswer || '');
  if (neg) {
    const pool = [...(CONTRADICT_SEEDS as any)[idx]] as string[];
    for (const cand of pool) {
      if (isTooSimilar(cand, previousQuestions).ok) return cand;
    }
    return '';
  }

  // 2) 章の固定プローブ（1..3）— 単一/複数事業を自動切替
  const guide = getChapterGuide(idx, context);
  const baseList: string[] = [...(guide?.probes ?? [])];
  const candidate = baseList[stepIdx];

  // 該当ステップのプローブが存在しない（使い切り）の場合
  if (!candidate) return '';

  // 3) 既出質問との類似回避
  if (isTooSimilar(candidate, previousQuestions).ok) return candidate;

  // 4) 同章内の他プローブから代替
  for (let i = 0; i < baseList.length; i++) {
    if (i === stepIdx) continue;
    const alt = baseList[i];
    if (alt && isTooSimilar(alt, previousQuestions).ok) return alt;
  }

  // 5) どうしても似る場合はフォールバック
  return '';
}

/* =========================
 * SYSTEM_PROMPT
 * ========================= */
const SYSTEM_PROMPT = `
あなたは経営者に伴走する戦略ファシリテーターです。
与えられる情報（SEEDテーマ / 直前回答 / Q&A履歴 / 財務サマリ / LENSヒント）を使い、
**重複せず、直前回答の具体語を必ず含める**次の問いを「1つだけ」提示してください。

【章別ステップの狙い】（GROWTH新構成）
- なぜ今（0）:
  - Step1: 具体事象の特定（時系列・どのKPIに芽が出ているか）
  - Step2: 影響の定量化（KPIギャップ×期限）
  - Step3: 臨界域と早期警戒トリガーの定義
- どう戦う（1）:
  - Step1: 最優先領域の特定（市場/顧客/用途）
  - Step2: 目指すゴール（Objective）とKey Resultsの定義（数値と期限を含む）
  - Step3: トレードオフ（やらないこと/中止基準/責任者）
- どんな未来像（2）:
  - Step1: 顧客の風景の描写（1シーン）
  - Step2: 外部シグナルと観測方法
  - Step3: 顧客のBefore→Afterの一行表現
- どう行動する（3）:
  - Step1: 対象行動の特定（誰が・何を・いつから）
  - Step2: 行動基準×頻度×道具
  - Step3: 仕組み化（Owner/KPI/Cadence/報酬連動）

【厳守ルール】
- 用語統一：「北極星KPI」という表現は使わず、「目指すゴール（Objective）」「OKR」「Key Results」を用いる
- questionはSEEDを“レンズ”にしつつ、**直前回答に出た固有名詞・数値・期間・顧客像のいずれか**を**明示名指し**で含める
- 「新興市場」「技術革新」「高付加価値化」「エコ製品」「戦略」「取り組み」「方向性」等の**抽象語の裸使用は禁止**
  （必ず具体名・数値・期限・顧客像・役割などと結び付ける）
- 既出の質問と主題が被らない（言い換え重複もNG）
- 口調は経営者に寄せた自然な日本語
- questionは50〜120字、単一トピック（多重質問禁止）
- reasonは40〜100字。「なぜ今それを問うか」「何を評価するか」を簡潔に
- **出力はJSONのみ** {"question":"...","reason":"..."}。説明やコードフェンスは禁止。
`.trim();

/* =========================
 * 入力整形
 * ========================= */
function buildFallbackBody(ctx: NonNullable<ReqBodyB['context']> | undefined, fin: ReturnType<typeof buildFinanceSummary>) {
  const parts: string[] = [];
  if (!ctx) return '';
  const push = (label: string, v?: string) => { if (v && v.trim()) parts.push(`- ${label}: ${v.trim()}`); };
  push('ミッション', ctx.mission);
  push('ビジョン', ctx.vision);
  push('バリュー', ctx.value);
  push('強み', ctx.strength);
  push('弱み', ctx.weakness);
  push('機会', ctx.opportunity);
  push('脅威', ctx.threat);

  // ★ 追加: 事業構成の概要（あれば）
  if (ctx?.portfolio?.businesses?.length) {
    parts.push(`- 事業構成:`);
    for (const b of ctx.portfolio.businesses) {
      const marginTxt = b.margin != null ? fmtPct(b.margin) : '—';
      parts.push(`  ・${b.name}（売上比 ${b.revenueShare ?? '—'}% / 粗利 ${marginTxt} / 成長 ${b.growth ?? '—'}%）`);
    }
    if (ctx.portfolio.focus) parts.push(`- 現在の注力事業: ${ctx.portfolio.focus}`);
  }

  if (fin) {
    parts.push(`- 財務KPI: 売上 ${fmtMilYen(fin.latestSales)} / CAGR ${fmtPct(fin.revCagrPct)} / 営利率 ${fmtPct(fin.latestOpMargin)} / ROE ${fmtPct(fin.roe)} / ROA ${fmtPct(fin.roa)}`);
  }
  return parts.join('\n');
}

function safeParseJson<T = any>(raw: string): T | null {
  try { return JSON.parse(raw); } catch {}
  const fence = raw?.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) { try { return JSON.parse(fence[1]); } catch {} }
  const m = raw?.match(/\{[\s\S]*\}$/m) || raw?.match(/\{[\s\S]*\}/m);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function resolveStepFixed(answers: Array<{ stepNumber: number; answer: string }>, hint?: number, explicit?: number) {
  if (typeof explicit === 'number') return clampStep(explicit, 1);
  if (Number.isFinite(hint)) return clampStep(Number(hint), 1);
  return 1;
}

function normalizeBody(body: ReqBody): {
  chapterIndex: number;
  chapterTitle: string;
  chapterBody: string;
  stepNumber: number;
  previousAnswer: string;
  answersSoFar: Array<{ stepNumber: number; answer: string }>;
  previousQuestions: string[];
  csvFinanceData?: any[] | string;
  context?: ReqBodyB['context'];
  depthBias?: DepthBias;
  safety?: ReqBodyB['safety'];
  lockStep: boolean;
  // ★ 追加: レンズ明示
  lensOverride?: ConsultantLens[];
} {
  const chapterIndex = typeof body.chapterIndex === 'number' ? body.chapterIndex : 0;

  const chapterTitle =
    (body as any).chapterTitle ||
    body.context?.story?.[chapterIndex]?.title ||
    `Chapter ${chapterIndex + 1}`;

  const chapterBody =
    (body as any).chapterBody ??
    body.context?.story?.[chapterIndex]?.body ??
    '';

  let answersSoFar: Array<{ stepNumber: number; answer: string }> =
    (body as any).answersSoFar || [];

  let previousQuestions: string[] = [];
  if (body.context?.answers2) {
    const ch = body.context.answers2.find((c) => c.chapterIndex === chapterIndex);
    if (ch?.steps?.length) {
      previousQuestions = ch.steps.map((s) => (s?.question || '').trim()).filter(Boolean);
      if (!answersSoFar?.length) {
        answersSoFar =
          ch.steps
            .map((s) => ({ stepNumber: s.stepNumber, answer: s.answer ?? '' }))
            .sort((a, b) => a.stepNumber - b.stepNumber);
      }
    }
  }

  const explicitStep = (body as any).stepNumber;
  const stepHint = typeof (body as any).stepHint === 'number' ? (body as any).stepHint : Number((body as any).stepHint);
  const stepNumber = resolveStepFixed(answersSoFar ?? [], stepHint, explicitStep);

  let previousAnswer = '';
  if (stepNumber > 1 && answersSoFar?.length) {
    const prev = answersSoFar.find(a => a.stepNumber === stepNumber - 1);
    previousAnswer = prev && String(prev.answer || '').trim() ? String(prev.answer).trim() : '';
  }

  const csvFinanceData = (body as any).csvFinanceData ?? body.context?.csvFinanceData;
  const depthBias: DepthBias | undefined = (body as any).depthBias;
  const safety = body.safety;
  const lockStep = (body.lockStep ?? true) === true;
  const lensOverride = (body as any).lensOverride as ConsultantLens[] | undefined;

  console.log('[generate-question] normalize', {
    chapterIndex, stepHint: (body as any).stepHint, resolvedStep: stepNumber,
    answersCount: answersSoFar?.length ?? 0, prevQ: previousQuestions.length,
    hasPrevA: !!previousAnswer, depthBias, lockStep,
  });

  return {
    chapterIndex,
    chapterTitle: String(chapterTitle || '').trim(),
    chapterBody: String(chapterBody ?? ''),
    stepNumber,
    previousAnswer,
    answersSoFar: answersSoFar ?? [],
    previousQuestions,
    csvFinanceData,
    context: body.context,
    depthBias,
    safety,
    lockStep,
    lensOverride,
  };
}

/* =========================
 * バイアス → 実行深度（フロント選択に100%一致）
 * ========================= */
function depthFromBias(b?: DepthBias): Depth {
  if (b === 'abstract') return 'board';   // 抽象的
  if (b === 'concrete') return 'ops';     // より具体的
  return 'exec';                          // standard/未指定 → 具体的
}

/* =========================
 * プロンプト
 * ========================= */
function buildUserPrompt(payload: {
  chapterIndex: number;
  chapterTitle: string;
  chapterBody: string;
  stepNumber: number;
  previousAnswer: string;
  answersSoFar: Array<{ stepNumber: number; answer: string }>;
  previousQuestions: string[];
  csvFinanceData?: any[] | string;
  context?: ReqBodyB['context'];
  depth: Depth;
  // ★ 追加: レンズ明示
  lensOverride?: ConsultantLens[];
}) {
  const { chapterIndex, chapterTitle, depth } = payload;
  const fin = buildFinanceSummary(payload.csvFinanceData);
  // ★ 変更: 単一/複数事業で章ガイドを自動切替
  const guide = getChapterGuide(Math.max(0, Math.min(3, chapterIndex)), payload.context);

  const chapterBodyRaw = payload.chapterBody && payload.chapterBody.trim().length > 0
    ? payload.chapterBody
    : buildFallbackBody(payload.context, fin);

  const chapterBody = sanitizeText(chapterBodyRaw || '', 4000);
  const stepNumber = payload.stepNumber;

  const qaHistoryBlock = (() => {
    const chFromCtx = payload.context?.answers2?.find((c) => c.chapterIndex === chapterIndex);
    const steps = Array.isArray(chFromCtx?.steps) ? chFromCtx!.steps : [];
    if (!steps.length) {
      const aOnly = (payload.answersSoFar || [])
        .map((a) => `  - Step ${a.stepNumber} A: ${sanitizeText(a.answer || '', 300) || '(no answer)'}`)
        .join('\n');
      return aOnly || '(none)';
    }
    return steps
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .map((s) => `  - Q${s.stepNumber}: ${sanitizeText(s.question || '', 140)}\n    A: ${sanitizeText(s.answer || '', 300) || '(no answer)'}`)
      .join('\n');
  })();

  const prev = payload.previousAnswer
    ? `直前の回答:\n${sanitizeText(payload.previousAnswer, 800)}\n`
    : '';

  // ★ 変更: pickSeedProbe に context を渡す
  const seed = pickSeedProbe(chapterIndex, stepNumber, payload.previousQuestions, payload.previousAnswer, payload.context);

  const financeBlock = fin
    ? `\n【財務KPIサマリ（参照のみ）】\n- 最新年度: ${fin.latestYear ?? '—'}\n- 売上: ${fmtMilYen(fin.latestSales)} ／ 売上CAGR: ${fmtPct(fin.revCagrPct)} ／ トレンド: ${
        fin.trend === 'up' ? '右肩上がり' : fin.trend === 'down' ? '低下' : '横ばい'
      }\n- 営業利益率: ${fmtPct(fin.latestOpMargin)} ／ ROE: ${fmtPct(fin.roe)} ／ ROA: ${fmtPct(fin.roa)}\n※ サマリに無い数値の創作は禁止。`
    : '';

  const askedTopics = payload.previousQuestions.length
    ? `\n【既出の質問（重複禁止）】\n- ${payload.previousQuestions.map((q) => sanitizeText(q, 120)).join('\n- ')}\n`
    : '';

  const negHint = isNegationJa(payload.previousAnswer)
    ? '\n【注意】直前回答が前提を否定しています。SEEDは「前提検証/弱いシグナル/維持基準/トリガー」等の観点に寄せてください。\n'
    : '';

  const seedLine = seed
    ? `SEEDテーマ（この主題の範囲内で具体化）:\n> ${seed}\n`
    : `SEEDテーマは使い切りました（1〜3）。既出と重複しない「補助的なまとめ質問」を1つだけ出してください。\n`;

  // ★ 追加: レンズ選択とLENSヒントの注入（上位から順適用）
  const lenses = pickConsultingLenses({
    chapterIndex,
    stepNumber,
    context: payload.context,
    previousAnswer: payload.previousAnswer,
    lensOverride: payload.lensOverride,
  });
  const lensBlock = lenses.length ? (
    '\n【LENSヒント（著名コンサルの問い方・優先順）】\n' +
    lenses.map((k, i) => {
      const L = CONSULTING_LENSES[k];
      const principles = `- 原則: ${L.principles.join(' / ')}`;
      const angles = L.sampleAngles.length ? `- 典型観点: ${L.sampleAngles.join(' / ')}` : '';
      const goods = L.goodTerms?.length ? `- 推奨語彙: ${L.goodTerms.join(' / ')}` : '';
      const avoids = L.avoidTerms?.length ? `- 回避語彙: ${L.avoidTerms.join(' / ')}` : '';
      return `${i+1}. ${L.title}\n${principles}\n${angles}\n${goods}\n${avoids}`;
    }).join('\n')
  ) : '';

  const depthHint =
    depth === 'board'
      ? '【粒度】Board：Owner/ツール/頻度などの語は避け、テーマ/選択/前提の確認に集中。'
      : depth === 'exec'
      ? '【粒度】Exec：KPIと期限までは具体化。Owner/ツール/チェックリストは出さない。'
      : '【粒度】Ops：Owner・頻度・ツールまで具体化。数値/期限/責任を必ず含める。';

  return `
対象章（index: ${chapterIndex} / ${guide.label}）
章ゴール: ${guide.goal}
タイトル: ${chapterTitle}
本文:
${chapterBody || '(本文未入力)'}
${financeBlock}

これまでのQ/A履歴:
${qaHistoryBlock}
${prev}
今回のステップ: ${stepNumber}
${askedTopics}
${seedLine}
${negHint}
${lensBlock}
${depthHint}
要件:
- JSONのみ: {"question":"...","reason":"..."}
- questionは1つ、50〜120字で具体的に（多重質問禁止）
- reasonは40〜100字で、狙いや評価軸を簡潔に
- 既出Qと同一主題・言い換えの繰り返しを避ける
`.trim();
}

/* =========================
 * Route
 * ========================= */
export async function POST(req: Request) {
  try {
    const rawBody = (await req.json()) as ReqBody;
    const norm = normalizeBody(rawBody);

    if (norm.safety?.requireConfirm && !norm.safety?.confirmed) {
      return NextResponse.json(
        { error: 'Confirmation required', needConfirm: true },
        { status: 412, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (!norm.chapterTitle) {
      return NextResponse.json({ error: 'chapterTitle が不足しています' }, { status: 400 });
    }

    const depth: Depth = depthFromBias(norm.depthBias);
    const userPrompt = buildUserPrompt({ ...norm, depth });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);

    const started = Date.now();
    const completion = await openai.chat.completions.create(
      {
        model: process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.35,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `以下の情報から「次の1問だけ」を生成。JSONのみを返却（{"question","reason"}）。コードフェンスや説明文は出力しないでください。\n\n${userPrompt}` },
        ],
      },
      { signal: controller.signal }
    ).finally(() => clearTimeout(timer));
    console.log('[generate-question] openai ms=', Date.now() - started);

    const raw = completion.choices?.[0]?.message?.content ?? '';
    let parsed = safeParseJson<any>(raw);

    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ error: 'LLM JSON parse error', raw }, { status: 502 });
    }

    let q = (parsed.step?.question ?? parsed.question ?? '').trim();
    let r = (parsed.step?.reason   ?? parsed.reason   ?? '').trim();

    // ---------- 重複チェック & リトライ ----------
    const dupCheck = isTooSimilar(q, norm.previousQuestions);
    if (!dupCheck.ok) {
      const revisePrompt = `
以下の制約に従い、**重複しない新しい1問**に修正してください。
- 既出Q（重複禁止）: ${norm.previousQuestions.map((x) => `「${x}」`).join('、')}
- もとの出力:
  - question: ${q}
  - reason: ${r}
- 必ずJSONのみ {"question":"...","reason":"..."} を返す
- question 50〜120字 / reason 40〜100字
- 観点をずらす（例：トレードオフ/期限/KPI/役割/顧客像/現場シーンなど）を優先
`.trim();

      const fix = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 220,
        messages: [
          { role: 'system', content: '日本語で、JSONのみを返答します。' },
          { role: 'user', content: revisePrompt },
        ],
      });
      const raw2 = fix.choices?.[0]?.message?.content ?? '';
      const parsed2 = safeParseJson<any>(raw2);
      const q2 = (parsed2?.question ?? parsed2?.step?.question ?? '').trim();
      const r2 = (parsed2?.reason   ?? parsed2?.step?.reason   ?? '').trim();
      if (q2 && r2) {
        const dup2 = isTooSimilar(q2, norm.previousQuestions);
        if (dup2.ok) { q = q2; r = r2; }
      }
    }

    // ---------- 汎用すぎ or 粒度違反を矯正 ----------
    if (violatesDepth(q, depth) || looksTooGeneric(q, norm.chapterIndex, depth)) {
      const directive =
        depth === 'board'
          ? 'テーマ/選択/前提に焦点を当て、Owner/ツール/頻度などの語は使わず、問いを上位意思決定に適した抽象度へ引き上げてください。'
          : depth === 'exec'
          ? 'KPIと期限は含め、Owner/ツール/チェックリストは出さず、経営実務に適した粒度へ整えてください。'
          : 'Owner/役割や頻度/ツールを含め、数値と期限も入れて実行設計レベルに具体化してください。';

      const rewrite = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.35,
        max_tokens: 220,
        messages: [
          { role: 'system', content: '日本語で、JSONのみを返答します。' },
          { role: 'user', content:
            `次のquestionを、指定の粒度ルールに合わせて修正。${directive}
- 粒度: ${depth}
- question: ${q}
- reason: ${r}
- 既出Q: ${norm.previousQuestions.map(x=>`「${x}」`).join('、')}
- 直前回答: ${sanitizeText(norm.previousAnswer, 300)}
必ず {"question":"...","reason":"..."} のJSONのみで返してください。`
          },
        ],
      });
      const rawX = rewrite.choices?.[0]?.message?.content ?? '';
      const parsedX = safeParseJson<any>(rawX);
      const qx = (parsedX?.question ?? parsedX?.step?.question ?? '').trim();
      const rx = (parsedX?.reason   ?? parsedX?.step?.reason   ?? '').trim();
      if (qx && rx && isTooSimilar(qx, norm.previousQuestions).ok) { q = qx; r = rx; }
    }

    if (!q || !r) {
      return NextResponse.json({ error: 'Invalid step payload', parsed }, { status: 502 });
    }

    const finalStepNo = clampStep(norm.stepNumber, 1);
    const step: AnswerStep = {
      stepNumber: finalStepNo,
      depth,
      question: q,
      reason: r,
      answer: '',
    };

    return NextResponse.json({ step }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('generate-question error:', e?.name, e?.message || e);
    const status = e?.name === 'AbortError' ? 504 : 500;
    return NextResponse.json({ error: 'Server error', detail: e?.message || String(e) }, { status });
  }
}
