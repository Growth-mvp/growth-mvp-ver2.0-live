// /app/api/generate-question/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText } from '@/app/api/_shared/utils';

/* ========== 型 ========== */
type Depth = 'board' | 'exec' | 'ops';
type DepthBias = 'abstract' | 'standard' | 'concrete' | 'expert'; // ★ expert 追加
type ConsultantLens = 'drucker' | 'porter' | 'christensen' | 'collins' | 'charan' | 'design';
type Portfolio = {
  businesses: Array<{
    name: string;
    revenueShare?: number;
    margin?: number;
    growth?: number;
    okr?: { objective?: string; keyResults?: string[]; owner?: string };
  }>;
  focus?: string;
};

type ReqBodyA = {
  chapterIndex?: number; // 0..3
  chapterTitle: string;
  chapterBody: string;
  stepNumber: number; // 1..可変（章により上限）
  previousAnswer?: string;
  answersSoFar?: Array<{ stepNumber: number; answer: string }>;
  csvFinanceData?: any[] | string;
};

type ReqBodyB = {
  strategyId?: string;
  chapterIndex?: number;
  afterStepIndex?: number;
  chapterTitle?: string;
  stepHint?: number;
  depthBias?: DepthBias;
  safety?: { requireConfirm?: boolean; confirmed?: boolean };
  lockStep?: boolean;
  lensOverride?: ConsultantLens[];
  context?: {
    story?: Array<{ title: string; body: string }>;
    answers2?: Array<{
      chapterIndex: number;
      chapterTitle: string;
      steps: Array<{ stepNumber: number; question: string; reason: string; answer: string; depth?: Depth }>;
    }>;
    mission?: string;
    vision?: string;
    value?: string;
    strength?: string;
    weakness?: string;
    opportunity?: string;
    threat?: string;
    csvFinanceData?: any[] | string;
    portfolio?: Portfolio;
    // 任意で顧客課題を注入可能（将来拡張）
    customerInsights?: { pains?: string[]; latents?: string[]; jobs?: string[] };
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

/* ========== Utils（軽量） ========== */
function tryParseJsonLocal<T = any>(text: string): T | null {
  try { return JSON.parse(text); } catch { return null; }
}
function coerceFinanceArray(src: unknown): any[] | undefined {
  if (Array.isArray(src)) return src;
  if (typeof src !== 'string') return undefined;
  const j = tryParseJsonLocal(src);
  if (Array.isArray(j)) return j;
  const lines = src.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return undefined;
  const headers = lines[0].split(',').map((h) => h.trim()).filter(Boolean);
  if (!headers.length) return undefined;
  return lines.slice(1).map((ln) => {
    const cols = ln.split(',');
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim(); });
    return obj;
  });
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
function normKey(k: string) { return k.toLowerCase().replace(/\s+|[_\-（）()]/g, ''); }
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
function fmtMilYen(n?: number | null) { return n == null ? '—' : `${Math.round(n).toLocaleString()} 百万円`; }
function fmtPct(n?: number | null) { return n == null ? '—' : `${(Math.round((n as number) * 10) / 10).toLocaleString()}%`; }

/* ========== 章ごとの最大ステップ（Ver4） ========== */
// 0:現状=2問, 1:戦略=6問, 2:未来像=2問, 3:行動=2問
const MAX_STEPS_BY_CHAPTER: Record<number, number> = { 0: 2, 1: 6, 2: 2, 3: 2 };
function maxStepsForChapter(chapterIndex: number) {
  const idx = Math.max(0, Math.min(3, Number.isFinite(chapterIndex) ? (chapterIndex as number) : 0));
  return MAX_STEPS_BY_CHAPTER[idx] ?? 2;
}
function clampStepDyn(chapterIndex: number, n: unknown, fallback: number): number {
  const x = typeof n === 'number' ? n : Number(n);
  const v = Number.isFinite(x) ? (x as number) : fallback;
  const hi = maxStepsForChapter(chapterIndex);
  return Math.max(1, Math.min(hi, v));
}

/* ========== 汎用すぎ・粒度違反チェック（既存） ========== */
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
  return re ? re.test(q) : false;
}
function looksTooGeneric(q: string, chapterIndex: number, depth: Depth) {
  const genericList = GENERIC_TOKENS_BY_CHAPTER[chapterIndex] ?? [];
  const hasGeneric = genericList.some(w => q.includes(w));
  const hasNumDeadline = /[0-9０-９％%]/.test(q) && /(Q|Ｑ|年|月|週|日)/.test(q);
  const hasConcreteNoun =
    /[A-Za-z]{2,}/.test(q) || /(地域|都道府県|顧客|用途|ブランド|製品|SKU|事業|ライン|部門|チャネル|責任者|担当)/.test(q);
  const touchesChoice = /(選ぶ|捨てる|前提|仮説|比較|位置取り|ポジショニング|ベット|トレードオフ)/.test(q);
  const mentionsOwner = /(責任者|Owner|役割|担当|部門)/.test(q);

  if (depth === 'board') return hasGeneric && !touchesChoice && !hasConcreteNoun;
  if (depth === 'exec')  return hasGeneric && !(hasNumDeadline || hasConcreteNoun);
  return hasGeneric && !(hasNumDeadline || mentionsOwner || hasConcreteNoun);
}

/* ========== ガイド（Ver4：standard / expert） ========== */
type ChapterGuide = { label: string; goal: string; probes: string[] };

const CHAPTER_GUIDE_V4_STANDARD: ChapterGuide[] = [
  { label: '現状', goal: '変化と危機感を共有し、「なぜ今やるのか」を腹落ちさせる。', probes: [
    'ここ1〜2年で、お客様や業界で「変わってきたな」と感じることは何ですか？具体例を1つ。',
    'このまま今のやり方を続けると、会社として最もマズいのは何ですか？影響するKPI/場面を1つ。'
  ]},
  { label: '戦略', goal: '顧客課題×自社の強み×制約×脅威で、勝ち筋を1本に絞る。', probes: [
    'あなたのお客様が今いちばん困っていることは何ですか？対象と困りごとを具体・数値で1つ。',
    'その困りごとを、あなたの会社はどんな強み（資産/能力/関係）で解決できそうですか？',
    'それが実現すると、お客様にどんな「嬉しい変化」が起きますか？Before→Afterを1行で。',
    '競合や新技術の登場で、その強みが通用しなくなるとしたら、どんな状況ですか？',
    '進める上で一番の「やりにくさ」（社内ルール/習慣/体制など）は何ですか？どうかわしますか？',
    'この戦い方が正しいと確かめる数字（KR）を1〜2個と、やめる条件（KILL）を1つ。'
  ]},
  { label: '未来像', goal: '顧客視点の1シーンで価値を見える化し、希望を共有する。', probes: [
    'この戦略が実現したら、お客様のどんな場面で「ありがとう」と言われたいですか？1シーンで。',
    'その未来が近づいているとわかる「小さなサイン」を1つ。観測方法と頻度も。'
  ]},
  { label: '行動', goal: '最初の一歩と学習リズムを決め、動ける状態を作る。', probes: [
    'まず最初の一歩を、誰といつから始めますか？具体行動を1つだけ。',
    'それを続けるため、どんな話し合いやチェックの場を作りますか？頻度と役割も。'
  ]},
];

const CHAPTER_GUIDE_V4_EXPERT: ChapterGuide[] = [
  { label: '現状', goal: '外部変化→KPIインパクト→臨界域を明確化。', probes: [
    '過去4〜8Qで構造的変化が顕著な指標を1つ（例：解約率/粗利/在庫回転）。推移と要因を簡潔に。',
    '変化が継続した場合の影響を1つのKPIで定量化（△◯%/◯件、期限◯年◯Q）。臨界域も定義。'
  ]},
  { label: '戦略', goal: '顧客Job×自社Moat×制約×DisruptionでGTMウェッジとKR/KILLを定義。', probes: [
    '優先セグメントと最大のPain/Jobを1つ。単位金額や時間損失など経済負担で示す。',
    '痛みに最短で効く自社資産/能力/関係を特定。価値式（成果＝現状−痛み＋強み）を1行で。',
    '競合/代替/新技術で価値式が壊れる条件を特定。回避の設計変更を1つ。',
    '実装制約（人/資本/プロセス）を踏まえた最小GTMウェッジ（誰に/何を/いくら/導入LT）。',
    '検証用KRを2個（数値・期限）と撤退KILL1個（条件・期限）。',
    '優先しない領域/施策を1つ（トレードオフ）。見直し期日も。'
  ]},
  { label: '未来像', goal: '顧客現場1シーン＋外部シグナル（Leading）で検証可能に。', probes: [
    '3年後の顧客現場を1シーンで描写（人物/場所/当社の価値の見え方）。',
    '外部Leading指標を1つ（例：標準採用打診）。観測方法/周期/閾値を定義。'
  ]},
  { label: '行動', goal: '最初の一歩→レビューリズム→Owner/KPIを明記。', probes: [
    'ロール（例：IS/PM/SV）×行動×開始時期を1つ。チェックリスト3点以内。',
    'Owner/先行KPI/レビュー頻度（毎週/隔週/月次）を定義。'
  ]},
];

// 事業ポートフォリオ用は従来のままでも良いが、ここでは標準/エキスパートを優先
function hasPortfolio(ctx?: ReqBodyB['context']) { return !!ctx?.portfolio?.businesses?.length; }
function getChapterGuide(chapterIndex: number, ctx?: ReqBodyB['context'], depthBias?: DepthBias): ChapterGuide {
  const base = depthBias === 'expert' ? CHAPTER_GUIDE_V4_EXPERT : CHAPTER_GUIDE_V4_STANDARD;
  const idx = Math.max(0, Math.min(3, chapterIndex));
  return base[idx];
}

/* ========== レンズ（既存。裏の品質担保として残置） ========== */
const CONSULTING_LENSES: Record<ConsultantLens, {
  title: string; principles: string[]; sampleAngles: string[]; goodTerms?: string[]; avoidTerms?: string[]; }> = {
  drucker: { title: 'ドラッカー（顧客・使命・強み）',
    principles: ['顧客は誰か／顧客にとっての価値','使命の文脈で問う','強みに資源集中'],
    sampleAngles: ['誰のどの不便','顧客側の成果指標'], goodTerms: ['顧客','価値','強み','成果','貢献'], avoidTerms: ['抽象的価値'] },
  porter: { title: 'ポーター（競争戦略）',
    principles: ['どこで戦うかを選ぶ','トレードオフ','活動の一貫性'],
    sampleAngles: ['参入障壁','代替品','購買力'], goodTerms: ['ポジショニング','参入障壁','代替','選択と集中'], avoidTerms: ['全部やる'] },
  christensen: { title: 'クリステンセン（ジョブ/破壊）',
    principles: ['顧客のジョブ','非消費と過剰品質','強みが障害になり得る'],
    sampleAngles: ['非消費者','十分に良い'], goodTerms: ['ジョブ','非消費','過剰品質','別解'] },
  collins: { title: 'ジム・コリンズ（偉大さ/人）',
    principles: ['ハリネズミ','適所適材','厳しい現実の直視'],
    sampleAngles: ['人選','習慣化','規律'], goodTerms: ['情熱','世界一になれる','経済エンジン','規律'] },
  charan: { title: 'ラム・チャラン（Execution）',
    principles: ['誰が・いつまでに・何で測る','現場の数字と実態','仕組み化'],
    sampleAngles: ['責任者','レビュー頻度','早期警戒'], goodTerms: ['責任者','期限','KPI','レビュー','仕組み化'] },
  design: { title: 'デザイン思考（体験）',
    principles: ['つまずきの描写','理想体験から逆算','観察可能な一場面'],
    sampleAngles: ['1シーン','Before→After','観察指標'], goodTerms: ['観察','プロトタイプ','体験','一場面'] },
};
function pickConsultingLenses(params: {
  chapterIndex: number; stepNumber: number; context?: ReqBodyB['context']; previousAnswer?: string; lensOverride?: ConsultantLens[];
}): ConsultantLens[] {
  if (params.lensOverride?.length) return params.lensOverride;
  const { chapterIndex, context, previousAnswer } = params;
  const lenses: ConsultantLens[] = [];
  const hasMVV = !!(context?.mission || context?.vision || context?.value);
  const hasSWOT = !!(context?.strength || context?.weakness || context?.opportunity || context?.threat);
  if (chapterIndex === 0) lenses.push('drucker','design','porter');
  else if (chapterIndex === 1) lenses.push('porter','collins','drucker');
  else if (chapterIndex === 2) lenses.push('design','christensen','drucker');
  else lenses.push('charan','collins','porter');
  if (hasMVV) { const i = lenses.indexOf('drucker'); if (i > 0) { lenses.splice(i,1); lenses.unshift('drucker'); } }
  if (hasSWOT) { const i = lenses.indexOf('porter'); if (i > 0) { lenses.splice(i,1); lenses.unshift('porter'); } }
  if (isNegationJa(previousAnswer || '')) {
    const pri: ConsultantLens[] = chapterIndex === 0 ? ['design','porter'] : ['porter','christensen'];
    for (let k = pri.length - 1; k >= 0; k--) {
      const l = pri[k]; const idx = lenses.indexOf(l);
      if (idx > 0) { lenses.splice(idx,1); lenses.unshift(l); }
    }
  }
  return Array.from(new Set(lenses)).slice(0, 3);
}

/* ========== プローブ選択/重複回避 ========== */
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

function isNegationJa(s: string) {
  const t = (s || '').toLowerCase();
  return /(ない|ありません|不要|求めていない|求めない|変える必要はない|変革は不要|しなくていい|問題ない|問題はない|影響はない|危機ではない|方向性はない|課題はない)/.test(t);
}

/** プローブ選択（Ver4：章ごとのステップ数に対応） */
function pickSeedProbe(
  chapterIndex: number,
  stepNumber: number,
  previousQuestions: string[],
  previousAnswer?: string,
  context?: ReqBodyB['context'],
  depthBias?: DepthBias
): string | '' {
  const idx = Math.max(0, Math.min(3, chapterIndex));
  const stepIdx = clampStepDyn(idx, stepNumber, 1) - 1;

  if (isNegationJa(previousAnswer || '')) {
    const pool = [...(CONTRADICT_SEEDS as any)[idx]] as string[];
    for (const cand of pool) if (isTooSimilar(cand, previousQuestions).ok) return cand;
    return '';
  }

  const guide = getChapterGuide(idx, context, depthBias);
  const baseList: string[] = [...(guide?.probes ?? [])];
  const candidate = baseList[stepIdx];
  if (!candidate) return '';
  if (isTooSimilar(candidate, previousQuestions).ok) return candidate;

  for (let i = 0; i < baseList.length; i++) {
    if (i === stepIdx) continue;
    const alt = baseList[i];
    if (alt && isTooSimilar(alt, previousQuestions).ok) return alt;
  }
  return '';
}

/* ========== SYSTEM_PROMPT（Ver4仕様） ========== */
const SYSTEM_PROMPT = `
あなたは経営者に伴走する戦略ファシリテーターです。
与えられる情報（SEEDテーマ / 直前回答 / Q&A履歴 / 財務サマリ / LENSヒント）を使い、
重複せず、直前回答の具体語を必ず含める次の問いを「1つだけ」提示してください。

【Ver4の章別ステップ数】
- なぜ今(0): 2問（変化の具体 / 危機の具体）
- どう戦う(1): 6問（顧客課題 / 強み / 価値のBefore→After / 脅威 / 制約 / KR&KILL）
- どんな未来像(2): 2問（顧客の1シーン / 外部シグナル）
- どう行動する(3): 2問（最初の一歩 / レビューの場）

【厳守】
- 「北極星KPI」は使わず、「Objective/OKR/Key Results」を用いる
- questionは直前回答の固有語(数値/期間/顧客像等)のいずれかを**明示名指し**で含める
- 抽象語の裸使用は禁止（具体名・数値・期限・顧客像・役割と結び付ける）
- 既出と主題が被らない
- question 50〜120字 / reason 40〜100字
- 出力は JSON のみ {"question":"...","reason":"..."}（説明・コードフェンス禁止）
`.trim();

/* ========== 入力整形 ========== */
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

  if (ctx?.portfolio?.businesses?.length) {
    parts.push(`- 事業構成:`);
    for (const b of ctx.portfolio.businesses) {
      const marginTxt = b.margin != null ? fmtPct(b.margin) : '—';
      parts.push(`  ・${b.name}（売上比 ${b.revenueShare ?? '—'}% / 粗利 ${marginTxt} / 成長 ${b.growth ?? '—'}%）`);
    }
    if (ctx.portfolio.focus) parts.push(`- 現在の注力事業: ${ctx.portfolio.focus}`);
  }

  if (fin) {
    parts.push(
      `- 財務KPI: 売上 ${fmtMilYen(fin.latestSales)} / CAGR ${fmtPct(fin.revCagrPct)} / 営利率 ${fmtPct(fin.latestOpMargin)} / ROE ${fmtPct(fin.roe)} / ROA ${fmtPct(fin.roa)}`
    );
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

function resolveStepFixed(chapterIndex: number, answers: Array<{ stepNumber: number; answer: string }>, hint?: number, explicit?: number) {
  if (typeof explicit === 'number') return clampStepDyn(chapterIndex, explicit, 1);
  if (Number.isFinite(hint)) return clampStepDyn(chapterIndex, Number(hint), 1);
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
        answersSoFar = ch.steps
          .map((s) => ({ stepNumber: s.stepNumber, answer: s.answer ?? '' }))
          .sort((a, b) => a.stepNumber - b.stepNumber);
      }
    }
  }

  const explicitStep = (body as any).stepNumber;
  const stepHint = typeof (body as any).stepHint === 'number' ? (body as any).stepHint : Number((body as any).stepHint);
  const stepNumber = resolveStepFixed(chapterIndex, answersSoFar ?? [], stepHint, explicitStep);

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

/* ========== 粒度バイアス → 実行深度 ========== */
function depthFromBias(b?: DepthBias): Depth {
  if (b === 'abstract') return 'board';
  if (b === 'concrete') return 'ops';
  if (b === 'expert') return 'exec'; // expertは実装上はexecベースで扱う
  return 'exec';
}

/* ========== ユーザープロンプト生成 ========== */
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
  depthBias?: DepthBias;
  lensOverride?: ConsultantLens[];
}) {
  const { chapterIndex, chapterTitle, depth, depthBias } = payload;
  const fin = buildFinanceSummary(payload.csvFinanceData);
  const guide = getChapterGuide(Math.max(0, Math.min(3, chapterIndex)), payload.context, depthBias);

  const chapterBodyRaw = payload.chapterBody && payload.chapterBody.trim().length > 0
    ? payload.chapterBody
    : buildFallbackBody(payload.context, fin);
  const chapterBody = sanitizeText(chapterBodyRaw || '', 4000);
  const stepNumber = clampStepDyn(chapterIndex, payload.stepNumber, 1);

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

  const prev = payload.previousAnswer ? `直前の回答:\n${sanitizeText(payload.previousAnswer, 800)}\n` : '';

  const seed = pickSeedProbe(chapterIndex, stepNumber, payload.previousQuestions, payload.previousAnswer, payload.context, depthBias);

  const financeBlock = fin
    ? `\n【財務KPIサマリ（参照のみ）】\n- 最新年度: ${fin.latestYear ?? '—'}\n- 売上: ${fmtMilYen(fin.latestSales)} ／ 売上CAGR: ${fmtPct(fin.revCagrPct)} ／ トレンド: ${
        fin.trend === 'up' ? '右肩上がり' : fin.trend === 'down' ? '低下' : '横ばい'
      }\n- 営業利益率: ${fmtPct(fin.latestOpMargin)} ／ ROE: ${fmtPct(fin.roe)} ／ ROA: ${fmtPct(fin.roa)}\n※ サマリに無い数値の創作は禁止。`
    : '';

  const askedTopics = payload.previousQuestions.length
    ? `\n【既出の質問（重複禁止）】\n- ${payload.previousQuestions.map((q) => sanitizeText(q, 120)).join('\n- ')}\n`
    : '';

  const negHint = isNegationJa(payload.previousAnswer)
    ? '\n【注意】直前回答が前提を否定。SEEDは「前提検証/弱いシグナル/維持基準/トリガー」寄りに。\n'
    : '';

  const seedLine = seed
    ? `SEEDテーマ（この主題の範囲内で具体化）:\n> ${seed}\n`
    : `SEEDは使い切り（章内の手番数に応じて）。既出と重複しない「補助的なまとめ質問」を1つだけ出してください。\n`;

  const lenses = pickConsultingLenses({
    chapterIndex,
    stepNumber,
    context: payload.context,
    previousAnswer: payload.previousAnswer,
    lensOverride: payload.lensOverride,
  });
  const lensBlock = lenses.length ? (
    '\n【LENSヒント（裏の品質担保）】\n' +
    lenses.map((k, i) => {
      const L = CONSULTING_LENSES[k];
      const principles = `- 原則: ${L.principles.join(' / ')}`;
      const angles = L.sampleAngles.length ? `- 典型観点: ${L.sampleAngles.join(' / ')}` : '';
      return `${i+1}. ${L.title}\n${principles}\n${angles}`.trim();
    }).join('\n')
  ) : '';

  const depthHint =
    depth === 'board'
      ? '【粒度】Board：Owner/ツール/頻度などの語は避け、テーマ/選択/前提の確認に集中。'
      : depth === 'exec'
      ? '【粒度】Exec：KPIと期限までは具体化。Owner/ツール/チェックリストは出さない。'
      : '【粒度】Ops：Owner・頻度・ツールまで具体化。数値/期限/責任も含める。';

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
今回のステップ: ${stepNumber} / 上限 ${maxStepsForChapter(chapterIndex)}
【本章の推奨プローブ例】
- ${getChapterGuide(chapterIndex, payload.context, depthBias).probes.join('\n- ')}

${askedTopics}
${seedLine}
${negHint}
${lensBlock}
${depthHint}
要件:
- JSONのみ: {"question":"...","reason":"..."}
- questionは1つ、50〜120字（多重質問禁止）
- reasonは40〜100字
- 既出Qと同一主題・言い換えを避ける
`.trim();
}

/* ========== Route ========== */
export async function POST(req: Request) {
  const routeHeaders = {
    'Cache-Control': 'no-store',
    'X-GROWTH-Route': 'app/api/generate-question',
  } as const;

  try {
    const rawBody = (await req.json()) as ReqBody;
    const norm0 = normalizeBody(rawBody);

    // depthBias を normalizeBody から受ける（expert対応）
    const depth: Depth = depthFromBias(norm0.depthBias);

    if (norm0.safety?.requireConfirm && !norm0.safety?.confirmed) {
      return new NextResponse(JSON.stringify({ error: 'Confirmation required', needConfirm: true }), {
        status: 412,
        headers: { ...routeHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    if (!norm0.chapterTitle) {
      return new NextResponse(JSON.stringify({ error: 'chapterTitle が不足しています' }), {
        status: 400,
        headers: { ...routeHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // 章ごとの上限に合わせて stepNumber を再クランプ
    const norm = { ...norm0, stepNumber: clampStepDyn(norm0.chapterIndex, norm0.stepNumber, 1) };

    const userPrompt = buildUserPrompt({ ...norm, depth, depthBias: norm.depthBias });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);

    const completion = await openai.chat.completions.create(
      {
        model: process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.35,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `以下の情報から「次の1問だけ」を生成。JSONのみを返却（{"question","reason"}）。\n\n${userPrompt}` },
        ],
      },
      { signal: controller.signal }
    ).finally(() => clearTimeout(timer));

    const raw = completion.choices?.[0]?.message?.content ?? '';
    let parsed = safeParseJson<any>(raw);
    if (!parsed || typeof parsed !== 'object') {
      return new NextResponse(JSON.stringify({ error: 'LLM JSON parse error', raw }), {
        status: 502,
        headers: { ...routeHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    let q = (parsed.step?.question ?? parsed.question ?? '').trim();
    let r = (parsed.step?.reason   ?? parsed.reason   ?? '').trim();

    // 重複チェック → リライト
    const dupCheck = isTooSimilar(q, norm.previousQuestions);
    if (!dupCheck.ok) {
      const revisePrompt = `
以下の制約で**重複しない新しい1問**に修正：
- 既出Q: ${norm.previousQuestions.map((x) => `「${x}」`).join('、')}
- 元出力: Q="${q}" / R="${r}"
- JSONのみ {"question":"...","reason":"..."}
- question 50〜120字 / reason 40〜100字
- 観点をずらす（第2章なら：脅威/制約/価値のBefore→After/KR・KILL/顧客像/GTM等)`.trim();

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
      if (q2 && r2 && isTooSimilar(q2, norm.previousQuestions).ok) { q = q2; r = r2; }
    }

    // 粒度違反/汎用すぎ → 矯正
    if (!q || violatesDepth(q, depth) || looksTooGeneric(q, norm.chapterIndex, depth)) {
      const directive =
        depth === 'board'
          ? 'テーマ/選択/前提に焦点。Owner/ツール/頻度は使わない。'
          : depth === 'exec'
          ? 'KPIと期限は含めるが、Owner/ツール/チェックリストは出さない。'
          : 'Owner/頻度/ツールを含め、数値と期限も入れて実行レベルへ。';

      const rewrite = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.35,
        max_tokens: 220,
        messages: [
          { role: 'system', content: '日本語で、JSONのみを返答します。' },
          { role: 'user', content:
            `次のquestionを指定の粒度に修正。${directive}
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
      return new NextResponse(JSON.stringify({ error: 'Invalid step payload', parsed }), {
        status: 502,
        headers: { ...routeHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const step: AnswerStep = {
      stepNumber: clampStepDyn(norm.chapterIndex, norm.stepNumber, 1),
      depth,
      question: q,
      reason: r,
      answer: '',
    };

    return new NextResponse(JSON.stringify({ step, meta: {
      chapterIndex: norm.chapterIndex,
      maxSteps: maxStepsForChapter(norm.chapterIndex), // ★ 第2章は常に 6 を返す
      depthBias: norm.depthBias ?? 'standard',
    }}), {
      status: 200,
      headers: { ...routeHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = e?.name === 'AbortError' ? 504 : 500;
    console.error('generate-question error:', e?.name, msg);
    return new NextResponse(JSON.stringify({ error: 'Server error', detail: msg }), {
      status,
      headers: { ...routeHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
