// /app/api/generate-story-draft/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

// ★ 追加：勝ちパターン辞書
import { topPatterns } from '@/lib/strategyPatterns.top';
import { mapTopToWin } from '@/lib/strategyPatterns.map';
import { buildWinPatternsFromIds } from '@/lib/winPatterns';
import type { WinPattern } from '@/types/strategy';

/**
 * 出力は常に { story: {title, body}[] }（最低4章に満たす）
 * 章タイトルは固定テンプレで上書きして順序を安定化。
 */

// ---- OpenAI ----
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ---- モデルの安全選択（環境変数が変でも既定に落とす）----
const ALLOW_MODELS = new Set<string>([
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4o-mini-2024-07-18',
  'gpt-4o-2024-08-06',
]);
function pickSafeModel() {
  const envModel =
    process.env.OPENAI_MODEL || process.env.NEXT_PUBLIC_OPENAI_MODEL || '';
  return ALLOW_MODELS.has(envModel) ? envModel : 'gpt-4o-mini';
}

// ✅ 見出しテンプレ（固定）
const TITLE_TEMPLATES = [
  '第1章：なぜ今（現状）',
  '第2章：どう戦う（戦略）',
  '第3章：どんな未来像（会社の未来像）',
  '第4章：どう行動する（行動）',
] as const;

// ✅ 各章のゴール（legacy / future で切替）
const CHAPTER_GOALS_LEGACY = [
  '現状：財務・市場・事業環境から、なぜ今戦略を見直す必要があるのかを自然文で示す。論点リストはUI側で表示するため本文で再掲しない。',
  '戦略：成長領域、顧客価値、製品・市場・チャネル、投資・資源配分、見直すことを整理する。90日施策や人材施策を主役にしない。',
  '未来像：戦略が実現した場合に、顧客・事業・市場評価・企業価値がどう変わるかを具体的に描く。数値は入力値のみ使う。',
  '行動：最初に検証・設計すべき経営アクションを示す。市場検証、製品ポートフォリオ、投資基準、資本市場への説明を中心にする。',
] as const;

const CHAPTER_GOALS_FUTURE = [
  '現状：財務・市場・事業環境から、なぜ今戦略を見直す必要があるのかを自然文で示す。論点リストはUI側で表示するため本文で再掲しない。',
  '戦略：成長領域、顧客価値、製品・市場・チャネル、投資・資源配分、見直すことを整理する。90日施策や人材施策を主役にしない。',
  '未来像：戦略が実現した場合に、顧客・事業・市場評価・企業価値がどう変わるかを具体的に描く。数値は入力値のみ使う。',
  '行動：最初に検証・設計すべき経営アクションを示す。市場検証、製品ポートフォリオ、投資基準、資本市場への説明を中心にする。',
] as const;

/** 未入力は空文字に。JSON.stringifyは使わない */
function sanitize(text: any, max = 2400): string {
  const s =
    text === null || text === undefined
      ? ''
      : typeof text === 'string'
      ? text
      : String(text);
  return s.replace(/\u0000/g, '').replace(/\s+$/g, '').slice(0, max);
}


/** オブジェクト形式/トップレベル形式の両方から文字列を安全に拾う */
function pickText(...values: any[]): string {
  for (const v of values) {
    const s = sanitize(v, 2000).trim();
    if (s) return s;
  }
  return '';
}

/** たたき台ストーリー用には、人材・鼓舞・不適切表現を入力素材から弱める */
function removePeopleRelatedNoise(text: string, max = 2400): string {
  if (!text) return '';
  let out = sanitize(text, max);

  // センシティブ/不適切な断片は最優先で除去
  out = out
    .replace(/生産性\s*の?\s*低い\s*高齢層/g, '')
    .replace(/高齢層/g, '')
    .replace(/社員が育っていない/g, '')
    .replace(/人材挑戦し高めあう文化/g, '')
    .replace(/あなたたちには無限の可能性があります/g, '')
    .replace(/ついて来てください/g, '');

  // 人材・採用・育成を含む短い文/箇条書きを、たたき台生成用素材から除去
  const ng = /(採用|育成|人材|社員教育|能力開発|研修|人員|組織風土|企業文化|社員一人ひとり|自分で決める|速く試す|学びを翌週反映|仲間|全力|賭け|必ず成功|信念|誇り)/;
  out = out
    .split(/(?<=[。！？\n])/)
    .filter((part) => !ng.test(part))
    .join('')
    .replace(/（\s*人\s*[・,、/]\s*/g, '（')
    .replace(/採用\s*[\/・、,]?\s*育成[、,]?/g, '')
    .replace(/人\s*[・,、/]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return out;
}

/** 出力本文に混入した不要語を最終ガードで除去・置換 */
function cleanDraftStoryBody(text: string): string {
  if (!text) return text;
  let out = sanitize(text, 2400);

  // 論点一覧/サマリ混入を除去
  out = stripRedundantIssueSummary(out);
  out = out
    .replace(/論点サマリ[ー]?\s*[:：][\s\S]*?(?=\n\n|これらの論点|私たち|当社|我々|$)/g, '')
    .replace(/論点（STAGE1分析より）[\s\S]*?(?=\n\n|これらの論点|私たち|当社|我々|$)/g, '')
    .replace(/最大5件表示\s*/g, '')
    .replace(/論点ID\s*[:：]?\s*[^\n。]*/g, '');

  // 人材関連・鼓舞表現を抑制
  const replacements: Array<[RegExp, string]> = [
    [/採用プロセス(?:の)?見直し/g, '事業上のボトルネックの見直し'],
    [/採用・育成プログラム(?:の)?強化/g, '事業基盤の強化'],
    [/育成プログラム(?:の)?強化/g, '事業基盤の強化'],
    [/技術革新を推進するための人材育成/g, '技術革新を支える製品開発と事業運営の仕組みづくり'],
    [/人材育成/g, '事業基盤の強化'],
    [/人材不足/g, '実行上の制約'],
    [/人材確保/g, '実行体制の確保'],
    [/人材/g, '体制'],
    [/育成/g, '強化'],
    [/社員教育|能力開発|研修/g, '体制整備'],
    [/賭け/g, '判断'],
    [/全力で取り組みます/g, '責任を持って進めます'],
    [/必ず成功(?:へ導いてみせます|します)?/g, '実現可能性を高めます'],
    [/一緒に(?:この挑戦に)?立ち向かいましょう/g, 'この方向性を共有して進めます'],
    [/一緒に乗り越えていきましょう/g, '着実に乗り越えていきます'],
    [/あなたたち/g, '皆さん'],
  ];
  for (const [from, to] of replacements) out = out.replace(from, to);

  // センシティブな文を丸ごと除去
  out = out
    .split(/(?<=[。！？\n])/)
    .filter((part) => !/(生産性\s*の?\s*低い\s*高齢層|高齢層|社員が育っていない|無限の可能性)/.test(part))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out;
}

function containsPeopleCentering(text: string): boolean {
  const hits = (text.match(/採用|育成|人材|社員教育|能力開発|研修|人材不足|社員一人ひとり|自分で決める|速く試す|学びを翌週反映/g) || []).length;
  return hits >= 2;
}

function defaultStrategyChapter(companyTargetText = ''): string {
  const target = companyTargetText
    ? `\n\n目標数値は、この戦略の結果として確認する到達点です。${companyTargetText.replace(/【[^】]+】\n?/g, '')}`
    : '';
  return [
    '私たちの戦い方は、三つの軸で整理できます。第一に、成長が見込める事業領域へ資源を集中し、既存の延長だけに頼らない収益基盤をつくることです。エンバイロメント、デジタルソサエティ、エネルギー＆インダストリーのような領域では、顧客課題の変化を捉え、当社の技術を新しい用途へ広げる必要があります。',
    '第二に、顧客ニーズを起点に製品・サービスの価値を磨き直すことです。ROICが資本コストを上回っている状態を維持するには、売上を追うだけでなく、どの顧客、どの製品、どのチャネルで価値を生むのかを選び直す必要があります。',
    '第三に、財務余力を成長投資に振り向ける判断基準を明確にすることです。短期の利益だけでなく、中長期の収益基盤をつくる投資に資源を配分し、同時に優先度の低い取り組みは見直します。PBRなどの市場評価に対しては、単なる説明強化ではなく、成長領域、資本効率、投資基準、収益性の再現性を示すことで改善の道筋をつくります。' + target,
  ].join('\n\n');
}

function buildCompanyTargetDigest(targets: any): string {
  const arr = Array.isArray(targets) ? targets : [];
  if (!arr.length) return '';
  const lines = arr.slice(0, 6).map((t: any) => {
    const label = sanitize(t?.label ?? t?.name ?? t?.metric ?? t?.title ?? '目標', 80);
    const year = sanitize(t?.dueYear ?? t?.targetYear ?? t?.year ?? t?.deadline ?? '', 40);
    const unit = sanitize(t?.unit ?? '', 40);
    const value = t?.target ?? t?.value ?? t?.amount ?? t?.targetValue ?? '';
    const num = Number(String(value).replace(/,/g, ''));
    let valueText = sanitize(value, 80);
    if (Number.isFinite(num) && unit.includes('百万円')) {
      valueText = `${Math.round(num / 100)}億円`;
    } else if (Number.isFinite(num) && unit) {
      valueText = `${valueText}${unit}`;
    }
    return `・${year ? `${year}年度 ` : ''}${label}: ${valueText}`;
  });
  return `【業績目標（入力値を優先。年度・数値は変更しない）】\n${lines.join('\n')}`;
}


/** STAGE1の選択論点を、本文にコピーされにくい「戦略シグナル」へ圧縮する */
function buildStrategySignalDigest(body: any): string {
  const src = Array.isArray(body?.issueBlocks)
    ? body.issueBlocks
    : Array.isArray(body?.issues)
    ? body.issues
    : Array.isArray(body?.metricsSummary?.issues)
    ? body.metricsSummary.issues
    : [];
  if (!src.length) return '';

  const ng = /(採用|育成|人材|社員教育|能力開発|研修|高齢層|社員一人ひとり|自分で決める|速く試す|学びを翌週反映)/;
  const lines: string[] = [];
  for (const it of src.slice(0, 6)) {
    const title = sanitize(it?.title ?? it?.name ?? it?.label ?? '', 80);
    const desc = sanitize(it?.description ?? it?.summary ?? it?.body ?? it?.text ?? '', 220);
    const metric = sanitize(
      Array.isArray(it?.linkedMetrics)
        ? it.linkedMetrics.join(' / ')
        : it?.metric ?? it?.metrics ?? it?.evidence ?? '',
      120,
    );
    const raw = [title, desc, metric].filter(Boolean).join('。');
    const cleaned = removePeopleRelatedNoise(raw, 260);
    if (!cleaned || ng.test(cleaned)) continue;

    let hint = '';
    const lower = cleaned.toLowerCase();
    if (/pbr|市場評価/.test(lower)) hint = '市場から見た成長性・資本効率への懸念を解消する必要がある';
    else if (/roic|wacc|価値創造|再投資/.test(lower)) hint = '価値を生んでいる領域を見極め、再投資先を選ぶ必要がある';
    else if (/d\/e|財務余力|資本政策|投資基準/.test(lower)) hint = '財務余力を活かす投資基準と優先順位を明確にする必要がある';
    else if (/営業利益率|収益性|利益率/.test(lower)) hint = '高収益の源泉を分解し、他領域でも再現する必要がある';
    else if (/成長|cagr|売上/.test(lower)) hint = '成長を支える市場・製品・チャネルを見直す必要がある';
    else hint = cleaned;

    if (!lines.includes(`・${hint}`)) lines.push(`・${hint}`);
  }

  if (!lines.length) return '';
  return `【戦略シグナル（本文に一覧として再掲せず、自然文に織り込む）】\n${lines.slice(0, 5).join('\n')}`;
}

/** 第2章のメモ調フォーマットと90日アクション混入を抑える */
function cleanStrategyChapter(text: string, targetDigest = ''): string {
  if (!text) return text;
  const raw = sanitize(text, 2400);
  const memoLike = /狙う価値ドライバー|主要戦略|90日アクション|根拠（SWOT）|トレードオフ|^\s*\d+\)\s*/m.test(raw);

  // たたき台として自然文にしたいため、AIが分析メモ形式で返した場合は
  // 中途半端に整形せず、戦略章の安全版へ差し替える。
  if (memoLike) {
    return defaultStrategyChapter(targetDigest);
  }

  let out = cleanDraftStoryBody(text);
  out = out
    .replace(/^\s*\d+\)\s*狙う価値ドライバー[:：].*$/gm, '')
    .replace(/^\s*主要戦略[:：]\s*/gm, '')
    .replace(/^\s*[-・]?\s*90日アクション[:：].*$/gm, '')
    .replace(/^\s*根拠（SWOT）[:：].*$/gm, '')
    .replace(/^\s*トレードオフ[:：]\s*/gm, '留意点として、')
    .replace(/短期的なリターンを重視したプロジェクトに資源を集中させる/g, '短期の収益性と中長期の成長可能性を分けて評価し、資源配分の優先順位を明確にする')
    .replace(/短期的なリターンを重視/g, '短期の収益性と中長期の成長可能性を両立')
    .replace(/広報戦略を策定し、投資家向けの説明会を実施する/g, '成長領域、資本効率、投資基準、収益性の再現性を説明できる状態にする')
    .replace(/広報戦略/g, '企業価値向上ストーリー')
    .replace(/投資家向けの説明会/g, '資本市場への説明')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // まだメモ形式・90日施策・人材中心が残る場合は安全な戦略章に差し替え
  if (
    containsPeopleCentering(out) ||
    /90日アクション|採用|育成|人材|社員教育|研修|能力開発/.test(out) ||
    (/狙う価値ドライバー/.test(out) && /主要戦略/.test(out))
  ) {
    return defaultStrategyChapter(targetDigest);
  }
  return out;
}

/** 第4章の行動を、90日アクション中心かつ人材抜きに整える */
function cleanActionChapter(text: string): string {
  if (!text) return text;
  let out = cleanDraftStoryBody(text);
  out = out
    .replace(/Value（行動原則）に沿った実行ルールとして、[^。]*?(?:人材|体制)[^。]*。?/g, '')
    .replace(/Valueに沿った実行ルールとして、[^。]*?(?:人材|体制)[^。]*。?/g, '')
    .replace(/具体的には、?(?:人材|体制)、製品、経営の3要素[^。]*。?/g, '')
    .replace(/(?:人材|体制)、製品、経営の3要素を重視[^。]*。?/g, '')
    .replace(/品格と向上心を持つ.*?(?:重要である|求められる)。?/g, '')
    .replace(/採用[^。\n]*[。\n]?/g, '')
    .replace(/育成[^。\n]*[。\n]?/g, '')
    .replace(/人材[^。\n]*[。\n]?/g, '')
    .replace(/体制[^。\n]*(?:製品|経営)[^。\n]*[。\n]?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (/採用|育成|人材|社員教育|研修|能力開発|人材、製品、経営|体制、製品、経営/.test(out) || out.length < 80) {
    out = [
      '最初の90日では、三つの確認から始めます。第一に、成長市場や新興市場について、顧客課題、競合、価格水準、参入障壁を整理し、どの市場を優先するかを明確にします。',
      '第二に、既存の製品ポートフォリオを見直し、どの製品・用途・チャネルに資源を寄せるべきかを検討します。第三に、投資基準を整理し、短期収益と中長期成長のどちらを狙う投資なのかを区別して判断できる状態をつくります。',
      'これらの検討結果をもとに、次の段階で各部門の戦略と実行計画へ落とし込みます。',
    ].join('\n\n');
  }
  return out;
}

/** ざっくりJSON抽出: json_object / ```json / 最初の {...} / 配列トップレベルにも対応 */
function extractJsonLoose(raw: string): any | null {
  if (!raw) return null;
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct && (typeof direct === 'object' || Array.isArray(direct))) return direct;
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const j = tryParse(fence[1]);
    if (j && (typeof j === 'object' || Array.isArray(j))) return j;
  }
  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj?.[0]) {
    const j = tryParse(obj[0]);
    if (j && typeof j === 'object') return j;
  }
  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr?.[0]) {
    const j = tryParse(arr[0]);
    if (Array.isArray(j)) return j;
  }
  return null;
}

/**
 * 第1章本文に混入した「論点サマリー」ブロックを完全に除去する
 * - 見出し型 + 箇条書き（既存対応）
 * - 文章型「当社の課題と論点」「論点1/2/3」（新規対応）
 * - 本文先頭〜1200文字に限定、削除後は空なら元を返す（安全弁）
 */
function stripRedundantIssueSummary(body: string): string {
  if (!body || body.length < 5) return body;

  // 先頭1200文字を処理対象に（それ以降を退避）
  const checkLength = Math.min(1200, body.length);
  const head = body.substring(0, checkLength);
  const tail = body.substring(checkLength);

  let processed = head;

  // パターン群：複数のバリエーションを順番に除去
  const patterns: RegExp[] = [
    // 1. 見出しキーワード + 箇条書き
    /^\s*(?:当社の課題と論点|論点サマリー|主要論点|論点|課題|現状の論点|現状|サマリー|ポイント)\s*[:：]?\s*[\n]*(?:\s*(?:[-*・]|[0-9]+\.|[①②③④⑤⑥⑦⑧⑨⑩])\s+.+(?:\n|$)){2,10}/m,

    // 2. 「論点1」「課題1」などの構造化列挙パターン
    // 例：「論点1:」「論点2:」「課題3:」「課題①」など、複数行続く
    /^(?:\s*(?:論点|課題|ポイント|要点|主要課題)\s*[0-9０-９一二三四五六七八九十①-⑩]+\s*[:：]\s*.+(?:\n|$)){2,6}/m,

    // 3. 「当社の課題と論点」という見出し + 続くテキスト（改行含む、最大10行）
    /^【?当社の課題と論点】?\s*[\n]*(?:^.*$\n?){0,10}/m,

    // 4. 見出し無し、箇条書きのみ（冒頭から2〜6行連続）
    /^(?:\s*(?:[-*・]|[0-9]+\.|[①②③④⑤⑥⑦⑧⑨⑩])\s+.+(?:\n|$)){2,6}/m,
  ];

  for (const pattern of patterns) {
    const matched = processed.match(pattern);
    if (matched) {
      processed = processed.replace(pattern, '');
    }
  }

  // 先頭の空白・改行を削除し、後半部分と再結合
  const trimmed = processed.trim();

  // 削除後に内容が完全に空になった場合は元を返す（安全弁）
  if (!trimmed && processed.length < checkLength * 0.5) {
    return body;
  }

  return tail ? (trimmed ? trimmed + '\n' + tail : tail).trim() : trimmed;
}

/** 任意のJSONから章配列を抽出・正規化 */
function coerceChapters(parsed: any): Array<{ title?: string; body?: string }> {
  if (!parsed) return [];
  const candidates: any[] = [];
  const pushIfArray = (v: any) => {
    if (Array.isArray(v)) candidates.push(v);
  };

  if (Array.isArray(parsed)) candidates.push(parsed);
  if (parsed && typeof parsed === 'object') {
    pushIfArray(parsed.chapters);
    pushIfArray(parsed.story);
    pushIfArray(parsed.stories);
    pushIfArray(parsed.sections);
    pushIfArray(parsed.data?.chapters);
    pushIfArray(parsed.data?.story);
    pushIfArray(parsed.result?.chapters);
  }

  const arr = candidates.find((a) => Array.isArray(a)) || [];
  if (!arr.length) return [];

  const getTitle = (o: any, i: number) =>
    sanitize(
      o?.title ??
        o?.heading ??
        o?.name ??
        o?.label ??
        `Chapter ${i + 1}`,
      120,
    );

  const getBody = (o: any) => {
    const raw =
      o?.body ??
      o?.content ??
      o?.text ??
      o?.summary ??
      o?.description ??
      (typeof o === 'string' ? o : '');
    return sanitize(raw, 2400);
  };

  return arr.map((item: any, i: number) => ({
    title: getTitle(item, i),
    body: getBody(item),
  }));
}

/** story を短い要約列にしてプロンプトへ（※ Q&Aは使わない） */
function buildStoryDigest(body: any): string {
  const storyArr: Array<{ title?: string; body?: string }> = Array.isArray(
    body?.story,
  )
    ? body.story
    : Array.isArray(body?.context?.story)
    ? body.context.story
    : [];

  if (!storyArr?.length) return '';
  return storyArr
    .slice(0, 4)
    .map((c: any, i: number) => {
      const t = sanitize(c?.title ?? `Chapter ${i + 1}`, 80);
      const b = sanitize(c?.body ?? '', 280);
      return `- ${t}: ${b}`;
    })
    .join('\n');
}

// ★ 追加：勝ちパターン辞書（t系）の要旨を生成

function buildTopPatternDigest(ids?: string[]) {
  const set = new Set((ids ?? []).map((s) => String(s).toLowerCase().trim()));
  const list = topPatterns
    .filter(
      (p) =>
        set.size === 0 || set.has(String(p.id).toLowerCase()),
    )
    .map(
      (p) =>
        `#${p.id} ${p.title}：${sanitize(p.summary ?? '', 280)}`,
    );
  return list.length
    ? `【参考：勝ちパターン10選】\n${list.join('\n')}`
    : '';
}

/* ============================================================
 * ★ 追加ヘルパー：事業ポートフォリオ＆財務サマリー要約
 * ==========================================================*/

/**
 * businessPortfolio から
 * 「事業名／売上構成比／成長率／利益率／ポジション」を抜き出して要約。
 * 型は厳密に想定せず、よくありそうなプロパティ名をゆるく拾う。
 */
function buildBusinessPortfolioDigest(portfolio: any): string {
  if (!Array.isArray(portfolio) || portfolio.length === 0) return '';

  const lines = portfolio.slice(0, 8).map((p: any) => {
    const name = sanitize(
      p?.name ??
        p?.businessName ??
        p?.segmentName ??
        p?.title ??
        '（名称未設定の事業）',
      80,
    );

    const share =
      p?.revenueShare ??
      p?.salesShare ??
      p?.share ??
      p?.ratio ??
      null;
    const growth =
      p?.growthRate ??
      p?.salesGrowth ??
      p?.growth ??
      null;
    const margin =
      p?.profitMargin ??
      p?.margin ??
      p?.opMargin ??
      null;
    const role =
      p?.positionLabel ??
      p?.position ??
      p?.category ??
      p?.role ??
      '';

    const metrics: string[] = [];
    if (share !== null && share !== undefined)
      metrics.push(`売上構成比 ${share}%`);
    if (growth !== null && growth !== undefined)
      metrics.push(`成長率 ${growth}%`);
    if (margin !== null && margin !== undefined)
      metrics.push(`利益率 ${margin}%`);

    const parts: string[] = [name];
    if (metrics.length) parts.push(metrics.join(' / '));
    if (role) parts.push(`ポジション: ${role}`);

    return '・' + parts.join(' ｜ ');
  });

  if (!lines.length) return '';
  return `【事業ポートフォリオ（主要事業の位置づけ）】\n${lines.join('\n')}`;
}

/**
 * financeSummary から「全社の規模感」と「直近数年のざっくりトレンド」を要約。
 * latestYear / latestYearTotal / byYear / trend など、ありそうなプロパティを緩く利用。
 */
function buildFinanceSummaryDigest(financeSummary: any): string {
  if (!financeSummary) return '';

  try {
    const lines: string[] = [];

    // 最新年度
    const latestYear =
      financeSummary.latestYear ??
      financeSummary.year ??
      (Array.isArray(financeSummary.years) &&
        financeSummary.years.length > 0
        ? financeSummary.years[financeSummary.years.length - 1]?.year
        : undefined);

    if (latestYear !== undefined) {
      let latestTotal =
        financeSummary.latestYearTotal ??
        financeSummary.totals?.[String(latestYear)] ??
        undefined;

      if (!latestTotal && Array.isArray(financeSummary.byYear)) {
        const found = financeSummary.byYear.find(
          (y: any) => String(y.year) === String(latestYear),
        );
        latestTotal = found?.total ?? found;
      }

      if (latestTotal) {
        const rev =
          latestTotal.revenue ??
          latestTotal.sales ??
          latestTotal.netSales ??
          latestTotal.net_revenue;
        const op =
          latestTotal.operatingIncome ??
          latestTotal.opIncome ??
          latestTotal.operatingProfit;
        const margin =
          latestTotal.opMargin ??
          latestTotal.margin ??
          latestTotal.operatingMargin;

        const metrics: string[] = [];
        if (rev !== undefined && rev !== null)
          metrics.push(`売上高: 約${rev}百万円`);
        if (op !== undefined && op !== null)
          metrics.push(`営業利益: 約${op}百万円`);
        if (margin !== undefined && margin !== null)
          metrics.push(`営業利益率: 約${margin}%`);

        if (metrics.length) {
          lines.push(
            '・最新年度（' +
              latestYear +
              '年）: ' +
              metrics.join(' / '),
          );
        }
      }
    }

    // 3年分くらいのトレンド
    const trendSource = Array.isArray(financeSummary.byYear)
      ? financeSummary.byYear
      : Array.isArray(financeSummary.trend)
      ? financeSummary.trend
      : null;

    if (trendSource && trendSource.length > 0) {
      const sliced = trendSource.slice(-3); // 直近3年程度
      sliced.forEach((y: any) => {
        const year = y.year ?? y.fiscalYear ?? '';
        const rev =
          y.revenue ?? y.sales ?? y.netSales ?? undefined;
        const op =
          y.operatingIncome ??
          y.opIncome ??
          y.operatingProfit ??
          undefined;
        const margin =
          y.opMargin ??
          y.margin ??
          y.operatingMargin ??
          undefined;

        const metrics: string[] = [];
        if (rev !== undefined && rev !== null)
          metrics.push(`売上 ${rev}`);
        if (op !== undefined && op !== null)
          metrics.push(`営利 ${op}`);
        if (margin !== undefined && margin !== null)
          metrics.push(`利益率 ${margin}%`);

        if (year && metrics.length) {
          lines.push(
            '・' + year + '年: ' + metrics.join(' / '),
          );
        }
      });
    }

    // 何も拾えなければ、ざっくりテキスト化
    if (!lines.length) {
      if (Array.isArray(financeSummary)) {
        financeSummary.slice(-3).forEach((row: any) => {
          lines.push(
            '・' +
              sanitize(
                Object.values(row).join(' / '),
                200,
              ),
          );
        });
      } else if (typeof financeSummary === 'object') {
        lines.push(
          '・' +
            sanitize(
              JSON.stringify(financeSummary),
              400,
            ),
        );
      }
    }

    if (!lines.length) return '';
    return `【財務サマリー（全社の規模感）】\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

type Mode = 'future' | 'legacy';

export async function POST(req: NextRequest) {
  try {
    // Bearer token authentication and membership validation
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // ---- デバッグ入口 ----
    const url = (req as any).nextUrl ?? new URL(req.url);
    const debug = url.searchParams.get('debug') || '';
    const model = pickSafeModel();

    if (debug === 'stub') {
      const story = TITLE_TEMPLATES.map((t, i) => ({
        title: t,
        body: `stub body ${i + 1}`,
      }));
      return NextResponse.json(
        { ok: true, phase: 'stub', story, _debug: { model } },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (debug === 'ping') {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json(
          { ok: false, model, error: 'NO_API_KEY' },
          { status: 500 },
        );
      }
      try {
        const c = await openai.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'pong' }],
          max_tokens: 5,
        });
        return NextResponse.json(
          {
            ok: true,
            model,
            usage: c.usage,
            content:
              c.choices?.[0]?.message?.content || '',
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, model, error: e?.message || String(e) },
          { status: 500 },
        );
      }
    }
    if (debug === 'json') {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json(
          { ok: false, model, error: 'NO_API_KEY' },
          { status: 500 },
        );
      }
      try {
        const c = await openai.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                '日本語で、必ず json のオブジェクト {"chapters":[{"title":"t","body":"b"}]} だけを返す。説明文やコードブロックは禁止。',
            },
            { role: 'user', content: 'テストなので1章で良い。' },
          ],
          max_tokens: 300,
        });
        return NextResponse.json(
          {
            ok: true,
            model,
            raw:
              c.choices?.[0]?.message?.content?.slice(
                0,
                400,
              ) || '',
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, model, error: e?.message || String(e) },
          { status: 500 },
        );
      }
    }

    // ---- 通常処理 ----
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is missing' },
        { status: 500 },
      );
    }

    const body = await req.json();

    const {
      thought,
      mission,
      vision,
      value,
      industry,
      revenue,
      employees,
      strength,
      weakness,
      opportunity,
      threat,
      csvFinanceData,
      financeSummary,      // ★ 追加：全社財務サマリー（任意）
      businessPortfolio,   // ★ 追加：事業ポートフォリオ配列（任意）
      temperature,
      patternIds,          // ★ t1,t2,... （TopPatternId[] 想定）
      mode: _mode,         // 'future' | 'legacy'（未指定は future）
      enhanceEmotion,      // ★ 追加：true/false（未指定はtrue）
    } = body || {};

    const mode: Mode = _mode === 'legacy' ? 'legacy' : 'future';

    // STAGE1論点および既存storyはUI側/保存側の表示情報であり、
    // APIプロンプトへ再投入すると『論点サマリ』が本文内に復活するため渡さない。

    const financialSummary =
      Array.isArray(csvFinanceData) && csvFinanceData.length > 0
        ? `\n\n【参考財務データ（抜粋・元CSVより）】\n${csvFinanceData
            .slice(0, 12)
            .map((row: any) =>
              sanitize(
                Object.values(row).join(' / '),
                200,
              ),
            )
            .join('\n')}${
            csvFinanceData.length > 12 ? '\n…' : ''
          }`
        : '';

    // ★ 新規：財務サマリー＆事業ポートフォリオの要約テキスト
    const financeSummaryDigest = buildFinanceSummaryDigest(
      financeSummary,
    );
    const portfolioDigest = buildBusinessPortfolioDigest(
      businessPortfolio,
    );

    // ★ 追加：勝ちパターン要旨
    const patternDigest = buildTopPatternDigest(
      Array.isArray(patternIds) ? patternIds : undefined,
    );

    // ✅ systemPrompt：たたき台は「経営判断用の冷静な戦略ドラフト」として生成する
    const goals =
      mode === 'future'
        ? CHAPTER_GOALS_FUTURE
        : CHAPTER_GOALS_LEGACY;

    const systemPrompt = [
      'あなたは経営戦略を、社員にも読める平易な日本語へ整理する編集者です。',
      '目的は、熱い演説を書くことではありません。経営が何を目指し、なぜ変わり、どの事業・顧客価値・投資方針で戦うのかを明確にすることです。',
      '出力は、STAGE2の「たたき台ストーリー」です。これは最終宣言ではなく、経営判断と議論のための冷静な戦略ドラフトです。',
      '必ず json のオブジェクトだけを返してください（説明文やコードブロックは禁止）。',
      '',
      '【最重要方針】',
      '- 第1章では、STAGE1論点を箇条書き・番号付き・「論点サマリ」形式で再掲しない。論点は自然文の背景として1〜2文に統合する。',
      '- 第2章の主役は、事業戦略・顧客価値・製品/市場の方向性・投資/資源配分である。採用・育成・社員行動を戦略の中心にしない。',
      '- 第2章に「90日アクション」という見出しや箇条書きを作らない。90日で確認することは第4章だけに書く。',
      '- 第2章では「1)」「狙う価値ドライバー」「主要戦略」「根拠（SWOT）」「トレードオフ」というラベルを絶対に出力しない。出力した場合、その章は不採用になる。',
      '- 「採用」「育成」「人材」「社員教育」「研修」「能力開発」「社員が育っていない」「生産性の低い高齢層」は使わない。',
      '- 「誇り」「賭け」「信念」「全力」「必ず成功」「一緒に挑もう」などの鼓舞表現を目的にしない。必要な意思は、選択・集中・投資判断として淡々と表現する。',
      '- 数値は入力にあるものだけを使い、年度・単位・値を変更しない。実績年度と目標年度を混同しない。百万円の数値は社員向けには億円表記を優先する。',
      '',
      '【第2章の必須構造】',
      '第2章は、原則として次の順に自然文で書く。',
      '1. どの事業領域を成長の柱にするか',
      '2. 顧客にどのような価値を提供するか',
      '3. 製品・市場・チャネルをどう見直すか',
      '4. 財務余力や投資基準をどう使うか',
      '5. PBRなど市場評価に対して、広報ではなく事業成長・資本効率・収益性の再現性でどう説明するか',
      '6. 何を優先し、何を見直すか',
      '',
      '【各章の役割】',
      `1) ${goals[0]}`,
      `2) ${goals[1]}`,
      `3) ${goals[2]}`,
      `4) ${goals[3]}`,
      '',
      '【出力フォーマット（厳守）】',
      '形式: { "chapters": [{"title":"...","body":"..."} ×4] }',
      '各章は 350〜700 字程度。短くてもよいが、論点の羅列ではなく自然な文章にする。',
      '第2章は「1) 狙う価値ドライバー」「主要戦略」「90日アクション」「根拠（SWOT）」のようなメモ形式にしない。自然な説明文にする。',
      'PBR改善は、広報・説明会だけでなく、成長領域、投資基準、資本効率、収益性の再現性を示す戦略として書く。',
      '投資戦略は短期リターン偏重にしない。短期収益と中長期成長の両立として書く。',
      patternDigest,
    ]
      .filter(Boolean)
      .join('\n');

    const mvvObj = body?.mvv && typeof body.mvv === 'object' ? body.mvv : {};
    const swotObj = body?.swot && typeof body.swot === 'object' ? body.swot : {};
    const targetDigest = buildCompanyTargetDigest(body?.companyTargets ?? body?.targets ?? body?.performanceGoals);
    const strategySignalDigest = buildStrategySignalDigest(body);

    const thoughtText = removePeopleRelatedNoise(pickText(thought, body?.ceoIntent, body?.intent), 1000);
    const missionText = removePeopleRelatedNoise(pickText(mission, mvvObj?.mission), 300);
    const visionText = removePeopleRelatedNoise(pickText(vision, mvvObj?.vision), 300);
    const valueText = removePeopleRelatedNoise(pickText(value, mvvObj?.value), 300);
    const strengthText = removePeopleRelatedNoise(pickText(strength, swotObj?.strength), 400);
    const weaknessText = removePeopleRelatedNoise(pickText(weakness, swotObj?.weakness), 400);
    const opportunityText = removePeopleRelatedNoise(pickText(opportunity, swotObj?.opportunity), 400);
    const threatText = removePeopleRelatedNoise(pickText(threat, swotObj?.threat), 400);

    const userPrompt = [
      '【経営者の思い（戦略判断に関係する部分のみ）】',
      thoughtText || '（未入力）',
      '',
      '【会社概要】',
      `- 業種: ${sanitize(industry, 120)}`,
      `- 売上高: ${sanitize(revenue, 120)} 百万円`,
      `- 従業員数: ${sanitize(employees, 120)} 人`,
      '',
      '【MVV】',
      `- Mission: ${missionText}`,
      `- Vision : ${visionText}`,
      `- Value  : ${valueText}`,
      '',
      '【SWOT】',
      `- 強み: ${strengthText}`,
      `- 弱み: ${weaknessText}`,
      `- 機会: ${opportunityText}`,
      `- 脅威: ${threatText}`,
      '',
      strategySignalDigest,
      targetDigest,
      financeSummaryDigest,
      portfolioDigest,
      financialSummary ? removePeopleRelatedNoise(financialSummary, 1600) : '',
      '',
      '【執筆要件】',
      '- 第1章に「論点サマリ」「論点1」「最大5件表示」などを書かない。',
      '- 第2章では、事業領域・顧客価値・製品/市場・投資/資源配分・市場評価改善の筋道を中心にする。',
      '- 第2章は箇条書きや分析メモではなく、3〜4段落の自然文にする。',
      '- 第4章の90日アクションは、市場検証、製品ポートフォリオ、投資基準、顧客フィードバック、資本市場への説明準備に寄せる。',
      '- 深掘りQ&Aの内容は参照しないこと。',
    ]
      .filter(Boolean)
      .join('\n');

    const temp =
      typeof temperature === 'number' ? temperature : 0.4;

    // ---- タイムアウト（ハング対策）----
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      45000,
    );
    let raw = '';
    try {
      // 1回目: JSON強制
      const c1 = await openai.chat.completions.create(
        {
          model,
          temperature: temp,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 1600,
        },
        { signal: controller.signal },
      );
      raw =
        c1.choices?.[0]?.message?.content?.trim() || '';
    } catch (e: any) {
      // 2回目: JSON強制を外してフォールバック
      try {
        const c2 = await openai.chat.completions.create(
          {
            model,
            temperature: temp,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 1600,
          },
          { signal: controller.signal },
        );
        raw =
          c2.choices?.[0]?.message?.content?.trim() ||
          '';
      } catch (e2: any) {
        clearTimeout(timer);
        console.error(
          '❌ ストーリー生成API失敗:',
          e2?.message || e2,
        );
        return NextResponse.json(
          { error: e2?.message || 'OpenAI error' },
          { status: 500 },
        );
      }
    } finally {
      clearTimeout(timer);
    }

    // --- ゆるい抽出 → 多形対応で章配列を取り出す ---
    const parsedLoose = extractJsonLoose(raw);
    const coerced = coerceChapters(parsedLoose);

    // フォールバック（章が取れない時）
    if (!coerced.length) {
      const chapters = TITLE_TEMPLATES.map((title) => ({
        title,
        body: '（この章は未生成です）',
      }));
      return NextResponse.json(
        {
          story: chapters,
          _debug: { model, fallback: true, mode },
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // ---- ここから「表現補正（二段階目）」 ※デフォルトOFF。必要時のみ明示的に有効化 ----
    let enhancedChapters = coerced;
    const doEnhance = enhanceEmotion === true; // 既定は false（熱量過多を避ける）
    if (doEnhance) {
      try {
        const enhanceSystem =
          'あなたは経営戦略ストーリーの編集者です。構造を壊さず、平易で具体的な日本語に整えます。熱量や鼓舞表現を増やしてはいけません。出力はJSONのみ。';
        const enhanceUser = [
          '【編集方針】',
          '- 各章の論理は保ちつつ、語り口を「経営者本人の声」に寄せる。',
          '- 「誇り」「賭け」「信念」「全力」などの鼓舞語を追加してはいけない。',
          '- 文体は平易で具体的にする。比喩や演説調は控える。',
          '- 各章は250〜400字の範囲を目安に整える（超過時は圧縮）。',
          '',
          '【対象JSON】',
          JSON.stringify(
            { chapters: enhancedChapters },
            null,
            2,
          ).slice(0, 6000), // 安全のため上限
          '',
          '【出力形式（厳守）】',
          '{"chapters":[{"title":"...","body":"..."}]} のみ。',
        ].join('\n');

        const cEnh =
          await openai.chat.completions.create({
            model,
            temperature: Math.min(0.6, temp + 0.1),
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: enhanceSystem },
              { role: 'user', content: enhanceUser },
            ],
            max_tokens: 900,
          });

        const rawEnh =
          cEnh.choices?.[0]?.message?.content?.trim() ||
          '';
        const parsedEnh = extractJsonLoose(rawEnh);
        const coercedEnh = coerceChapters(parsedEnh);
        if (coercedEnh?.length >= 4) {
          enhancedChapters = coercedEnh;
        }
      } catch {
        // 補正失敗時はそのまま続行（既存挙動維持）
      }
    }

    // サーバ側で章タイトル/順序を固定（本文はenhancedの中身を使用）
    // ★ 第1章の本文から「論点サマリー」混入を確実に除去
    const chapters = TITLE_TEMPLATES.map((title, i) => {
      let body = enhancedChapters[i]?.body || '（この章は未生成です）';
      body = cleanDraftStoryBody(body);

      // 第2章はメモ形式・90日アクション・人材中心を抑えて、戦略章として整える
      if (i === 1) {
        body = cleanStrategyChapter(body, targetDigest);
      }

      // 第4章は人材施策ではなく、検証・投資判断・市場説明の行動へ寄せる
      if (i === 3) {
        body = cleanActionChapter(body);
      }

      // 第1章は論点サマリ混入をさらに強めに除去
      if (i === 0) {
        body = stripRedundantIssueSummary(body);
        body = cleanDraftStoryBody(body);
      }

      return {
        title,
        body: sanitize(body, 2400),
      };
    });

    // summary はUI側のSTAGE1論点表示と重複しやすいため返さない。
    const summary: any = undefined;

    // ★ 追加：勝ち筋候補（WinPattern[]）
    let winPatterns: WinPattern[] | undefined = undefined;
    try {
      const topIds = Array.isArray(patternIds)
        ? (patternIds.filter(
            (id: any) => typeof id === 'string',
          ) as string[])
        : [];
      const winIds = mapTopToWin(
        topIds as any, // TopPatternId[] 想定（実際にはUI側で制御）
      );
      winPatterns = buildWinPatternsFromIds(winIds);
    } catch {
      // 失敗しても全体処理は継続（付加情報なので）
      winPatterns = undefined;
    }

    return NextResponse.json(
      {
        story: chapters,
        summary,
        winPatterns, // ★ ここに勝ち筋候補を同梱
        _debug: { model, mode, enhanced: doEnhance === true },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    console.error(
      '❌ ストーリー生成エラー:',
      error?.message || error,
    );
    const status =
      error?.name === 'AbortError' ? 504 : 500;
    return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status },
    );
  }
}
