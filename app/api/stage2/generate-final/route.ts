// /app/api/stage2/generate-final/route.ts
// STAGE2：最終ストーリー生成API（社員向け熱量を持った語り）
// - North Star (companyTargets) を本文に確実に反映
// - “たまに漏れる” を消すため、生成後に要件チェック → 不足があれば 2nd pass（最小修正）で補修
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

/* ===== OpenAI設定 ===== */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const MODEL_PRIMARY = process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? 'gpt-4o';
const MODEL_FALLBACK = 'gpt-4o-mini';
const SUPPORTS_JSON_MODE = /^gpt-4o($|-)/;

/* ===== 4章タイトル ===== */
const CHAPTER_TITLES = ['第1章：なぜ今', '第2章：どう戦う', '第3章：どんな未来', '第4章：どう行動する'] as const;

/* ===== ユーティリティ ===== */
function sanitize(text: unknown, max = 2400): string {
  const s = text === null || text === undefined ? '' : typeof text === 'string' ? text : String(text);
  return s.replace(/\u0000/g, '').replace(/\s+$/g, '').slice(0, max);
}

function extractJsonLoose<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct && (typeof direct === 'object' || Array.isArray(direct))) return direct;
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const j = tryParse(fence[1]);
    if (j) return j;
  }
  const obj = raw.match(/\{[\s\S]*\}/);
  if (obj?.[0]) {
    const j = tryParse(obj[0]);
    if (j) return j;
  }
  return null;
}

/** 日本語テキストの余計な半角スペースを整理 */
function tidyJa(s: string): string {
  if (!s) return s;
  let out = s;
  out = out.replace(
    /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[ ]+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
    '$1$2'
  );
  out = out.replace(/([、。％%！!？?」』）)＞>])[ ]+/gu, '$1');
  out = out.replace(/[ ]+([、。％%！!？?」』）)＞>])/gu, '$1');
  out = out.replace(/(\d)[ ]+％/g, '$1％');
  out = out.replace(/[ ]{2,}/g, ' ');
  return out;
}

function includesAll(hay: string, needles: string[]): boolean {
  if (!hay) return false;
  for (const n of needles) {
    const nn = (n ?? '').trim();
    if (!nn) continue;
    if (!hay.includes(nn)) return false;
  }
  return true;
}

/* ===== 12問の回答を整形 ===== */
type Stage2Answer = {
  id: string;
  question: string;
  answer?: string;
  required?: boolean;
};

/* ===== North Star Metrics ===== */
type CompanyTarget = {
  id: string;
  label: string;
  unit?: string;
  base: number;
  low?: number;
  high?: number;
  dueYear?: number;
  priority?: number; // 1が最優先
  linkedIssueIds: string[];
  rationale: string;
};

function formatAnswers12(answers: Stage2Answer[]): string {
  if (!answers || answers.length === 0) return '（未回答）';
  const answered = answers.filter((a) => a.answer?.trim());
  if (answered.length === 0) return '（未回答）';
  return answered
    .map((a) => `Q: ${a.question.slice(0, 60)}...\nA: ${sanitize(a.answer, 300)}`)
    .join('\n\n');
}

/* ===== プロンプト構築 ===== */
function buildSystemPrompt(): string {
  return `あなたは「未来逆算×両利きの経営」を率いる経営者であり、全社員に本音と覚悟を届けるストーリーファシリテーターです。

【執筆の核心】
1. 【衝撃と共感から始める】過去の延長をやめ、3〜5年先の"当たり前"から今を見直す。事実で危機を語る。
2. 【選択と集中の覚悟】勝つところに資源を寄せ、やめることを明言。
3. 【勝利のイメージを描く】顧客の一場面で価値を見える化。数値があれば引用、なければ定性で可視化。
4. 【各個人への熱いバトン】期待行動を言い切る。「自分で決める」「速く試す」「学びを翌週反映」。

【魂の三要素（必ず自然文で挿入）】
- 第2章に「誇り」を示す一文（私たちが守り抜いてきた本質・流儀）
- 第3章に「賭け」を示す一文（未来へ踏み出す決断・リスクを受け止める覚悟）
- 第4章に「信念」を示す一文（仲間とやり抜く、何があってもブレない原則）

【勝ち筋の反映】
- 選択された勝ち筋に整合する語り・事例・トレードオフを織り込む
- 「やらないこと」宣言は、選んだ勝ち筋のロジックと矛盾させない

【North Star（会社の数値目標）— Final整合性チェック（重要）】
- 入力にNorth Starがある場合、最終ストーリーは必ずNorth Starに整合させる（矛盾禁止）。
- 少なくとも1つ、最優先（priorityが最小、未指定は1扱い）の目標について、目標名と数値（base/レンジ/期限）を本文内に具体的に明記する。
- linkedIssueIds がある目標は、該当するSTAGE1論点への対応（なぜ効くか）を第2章または第4章で必ず言及する。
- North Star が未入力の場合は「★North Star未入力のため一般化した」と明記し、推測で数値を作らない。

【出力制約（厳守）】
- 4章構成：なぜ今 / どう戦う / どんな未来 / どう行動する
- 各章450〜700文字から「増量版」へ：700〜1000文字目安。社員が読んで腹に落ちる語り口で。
  - 短すぎる場合は、具体例・背景・行動を追加して埋める
  - 数値・事実・事例・情景を織り込み、ただし冷たい説明にしない（熱い口調を維持）
  - 各章末に「社員への直接的な呼びかけ1文」と「経営としての意思宣言1文」を必ず入れる
    - 例1: 「皆さんには、この覚悟を一緒に実現する力があります。」（呼びかけ）
    - 例2: 「私たちは、この選択に全力で取り組みます。」（意思宣言）
- 章末は必ず「。」で完結させる（途中で切れない）
- 出力はJSONのみ：
{
  "finalStory": [
    {"title": "第1章：なぜ今", "body": "..."},
    {"title": "第2章：どう戦う", "body": "..."},
    {"title": "第3章：どんな未来", "body": "..."},
    {"title": "第4章：どう行動する", "body": "..."}
  ]
}`;
}

type GenerateFinalInput = {
  // NOTE: id を含まない payload が来る可能性があるため optional で受ける
  issueBlocks?: Array<{ id?: string; title: string; description?: string; linkedMetrics?: string[] }>;
  metricsSummary?: Record<string, unknown>;
  mvv?: { thought?: string; mission?: string; vision?: string; value?: string };
  swot?: { strength?: string; weakness?: string; opportunity?: string; threat?: string };
  storyDraft?: Array<{ title: string; body: string }>;
  winPatternsCandidate?: Array<{ id: string; name: string; valueDrivers?: string[]; rationale?: string }>;
  selectedWinPatternId?: string;
  answers12?: Stage2Answer[];
  companyTargets?: CompanyTarget[];
  industry?: string;
  segments?: string[];
};

function buildUserPrompt(input: GenerateFinalInput): string {
  const {
    issueBlocks = [],
    metricsSummary = {},
    mvv = {},
    swot = {},
    storyDraft = [],
    winPatternsCandidate = [],
    selectedWinPatternId,
    answers12 = [],
    companyTargets = [],
    industry,
    segments,
  } = input;

  // 選択された勝ち筋を特定
  const selectedWp = selectedWinPatternId
    ? winPatternsCandidate.find((wp) => wp.id === selectedWinPatternId)
    : winPatternsCandidate[0];

  const winPatternText = selectedWp
    ? `【選択された勝ち筋】${selectedWp.name}\n- 価値ドライバー: ${selectedWp.valueDrivers?.join(', ') || '—'}\n- 根拠: ${selectedWp.rationale || '—'}`
    : '【勝ち筋】未選択';

  // 論点サマリ
  const issuesText =
    issueBlocks.length > 0
      ? issueBlocks
          .map(
            (ib, i) =>
              `${i + 1}. ${ib.title}${ib.linkedMetrics?.length ? `（${ib.linkedMetrics.join(', ')}）` : ''}`
          )
          .join('\n')
      : '（論点なし）';

  // Issue title resolution map（idが入っていれば解決、無ければ gracefully degrade）
  const issueTitleById = new Map<string, string>();
  for (const ib of issueBlocks) {
    const id = (ib as any)?.id;
    if (typeof id === 'string' && id) issueTitleById.set(id, ib.title);
  }

  // North Star Metrics formatting
  function formatCompanyTargets(): string {
    if (!companyTargets || companyTargets.length === 0) {
      return '（★North Star未入力のため一般化した）';
    }

    // priority小さい順（未指定は1扱い） + tie-breaker を追加して最優先を安定化
    const sorted = [...companyTargets].sort((a: any, b: any) => {
      const pa = Number.isFinite(a?.priority) ? Number(a.priority) : 1;
      const pb = Number.isFinite(b?.priority) ? Number(b.priority) : 1;
      if (pa !== pb) return pa - pb;

      const da = Number.isFinite(a?.dueYear) ? Number(a.dueYear) : 9999;
      const db = Number.isFinite(b?.dueYear) ? Number(b.dueYear) : 9999;
      if (da !== db) return da - db;

      const la = String(a?.label ?? '');
      const lb = String(b?.label ?? '');
      return la.localeCompare(lb, 'ja');
    });

    const lines: string[] = [];
    for (const t of sorted.slice(0, 6)) {
      const label = sanitize(t?.label, 60) || '（目標名未入力）';
      const unit = sanitize(t?.unit, 20);
      const base = Number.isFinite(t?.base) ? Number(t.base) : NaN;
      const low = Number.isFinite(t?.low) ? Number(t.low) : undefined;
      const high = Number.isFinite(t?.high) ? Number(t.high) : undefined;
      const dueYear = Number.isFinite(t?.dueYear) ? Number(t.dueYear) : undefined;
      const pr = Number.isFinite(t?.priority) ? Number(t.priority) : 1;

      const range = low !== undefined || high !== undefined ? `（レンジ: ${low ?? '—'}〜${high ?? '—'}）` : '';
      const due = dueYear ? `（期限: ${dueYear}年度）` : '';

      const linkedIds: string[] = Array.isArray(t?.linkedIssueIds)
        ? t.linkedIssueIds.filter((x: any) => typeof x === 'string')
        : [];
      const linkedTitles = linkedIds
        .map((issueId: string) => issueTitleById.get(issueId) || `（論点ID: ${issueId}）`)
        .slice(0, 3);

      const rationale = sanitize(t?.rationale, 200) || '—';

      lines.push(
        `- [優先度${pr}] ${label}${unit ? `（単位:${unit}）` : ''}: 基準値 ${Number.isFinite(base) ? base : '—'} ${range} ${due}\n` +
          `  理由: ${rationale}\n` +
          `  紐付く論点: ${linkedTitles.length ? linkedTitles.join(' / ') : '—'}`
      );
    }

    return lines.join('\n');
  }

  const companyTargetsText = formatCompanyTargets();

  // 指標サマリ
  const ms = metricsSummary as Record<string, number | string | undefined>;
  const metricsText =
    [
      ms.roic !== undefined ? `ROIC: ${Number(ms.roic).toFixed(1)}%` : null,
      ms.wacc !== undefined ? `WACC: ${Number(ms.wacc).toFixed(1)}%` : null,
      ms.pbr !== undefined ? `PBR: ${Number(ms.pbr).toFixed(2)}倍` : null,
    ]
      .filter(Boolean)
      .join(' / ') || '（指標なし）';

  // たたき台ストーリーの要約
  const draftSummary =
    storyDraft.length > 0
      ? storyDraft.map((ch) => `【${ch.title}】${ch.body.slice(0, 200)}...`).join('\n')
      : '（たたき台なし）';

  // 12問の回答
  const answersText = formatAnswers12(answers12);

  return `【会社情報】
業種: ${industry || '—'}
${segments?.length ? `事業セグメント: ${segments.join(', ')}` : ''}

【STAGE1の論点】
${issuesText}

【財務指標】
${metricsText}

【会社の数値目標（North Star Metrics）】
${companyTargetsText}

【MVV】
- Mission: ${sanitize(mvv.mission, 200) || '—'}
- Vision: ${sanitize(mvv.vision, 200) || '—'}
- Value: ${sanitize(mvv.value, 200) || '—'}
${mvv.thought ? `- 経営者の思い: ${sanitize(mvv.thought, 300)}` : ''}

【SWOT】
- 強み: ${sanitize(swot.strength, 200) || '—'}
- 弱み: ${sanitize(swot.weakness, 200) || '—'}
- 機会: ${sanitize(swot.opportunity, 200) || '—'}
- 脅威: ${sanitize(swot.threat, 200) || '—'}

${winPatternText}

【たたき台ストーリー（参考）】
${draftSummary}

【12問への回答（経営者の声）】
${answersText}

上記の情報を踏まえ、社員に熱量と覚悟が伝わる最終ストーリーを4章構成で生成してください。
たたき台を基盤としつつ、12問の回答で得られた経営者の思いを織り込み、「誇り」「賭け」「信念」を自然に含めてください。

【重要：文字数増加・熱量維持】
- 文章量を増やすが、メッセージの熱量・社員への伝わりやすさは絶対に落とさない。
- 各章は「現状の課題 → 選択の根拠 → 目標の意味」を具体的に語る（ポエム化禁止）。
- 目安：各章 700〜1000文字、合計 3000〜4000文字程度。
- 推奨：売上・営業利益などの具体的な数値、顧客の変化、社員の期待行動を「情景とともに」織り込む。
- 禁止：抽象論だけ、根拠のない断言、説教的なトーン。社員が「自分ごと化」できる具体性を優先。
- 各章末に「社員への直接的な呼びかけ（あなたたちへ）」と「経営としての意思宣言（私たちは）」を必ず入れる。

【深堀質問の回答を必ず反映】
- 上記「12問への回答」の内容は、全4章のいずれかで必ず1つ以上、根拠・具体例・行動の根拠として活用する。
- 特に経営者の思いが強い回答は、最も関連する章に自然に織り込む（例：「変革への覚悟」は第2章・第4章に、「社員への期待」は第4章に）。
- 深堀回答がない場合や「（未回答）」の場合は、一般的な語り口で埋める。
- 冷たい説明にせず、経営者の言葉を「社員の心に届く実感」に変換する。
`;
}

/* ===== 生成後の要件チェック（North Star / 連動論点 / 未入力明記） ===== */
type FinalChapter = { title: string; body: string };
type ParsedOutput = { finalStory?: Array<{ title?: string; body?: string }> };

function normalizeFinalStory(rawStory: Array<{ title?: string; body?: string }>): FinalChapter[] {
  const arr = Array.isArray(rawStory) ? rawStory : [];
  const out = CHAPTER_TITLES.map((title, i) => {
    const src = arr[i];
    let body = sanitize(src?.body || '（この章は未生成です）', 4000);
    body = tidyJa(body);
    if (body && !body.endsWith('。') && !body.endsWith('！') && !body.endsWith('？')) {
      body = body.replace(/[、,\s]+$/, '') + '。';
    }
    return { title, body };
  });
  return out;
}

function pickTopTarget(companyTargets: CompanyTarget[] | undefined): CompanyTarget | null {
  const list = Array.isArray(companyTargets) ? companyTargets : [];
  if (list.length === 0) return null;

  const sorted = [...list].sort((a: any, b: any) => {
    const pa = Number.isFinite(a?.priority) ? Number(a.priority) : 1;
    const pb = Number.isFinite(b?.priority) ? Number(b.priority) : 1;
    if (pa !== pb) return pa - pb;

    const da = Number.isFinite(a?.dueYear) ? Number(a.dueYear) : 9999;
    const db = Number.isFinite(b?.dueYear) ? Number(b.dueYear) : 9999;
    if (da !== db) return da - db;

    const la = String(a?.label ?? '');
    const lb = String(b?.label ?? '');
    return la.localeCompare(lb, 'ja');
  });

  return sorted[0] ?? null;
}

function formatTopTargetMustPhrase(t: CompanyTarget): string {
  const label = sanitize(t.label, 60) || '（目標名未入力）';
  const base = Number.isFinite(t.base) ? Number(t.base) : NaN;
  const due = Number.isFinite(t.dueYear) ? `${Number(t.dueYear)}年度` : '';
  // 「最低限これが出ればOK」な短い句にする（熱量文章に混ぜやすい）
  // ※ base が NaN の場合は label のみ必須に落とす
  const basePart = Number.isFinite(base) ? `基準値${base}` : '';
  const duePart = due ? `（期限:${due}）` : '';
  const parts = [`${label}`, basePart, duePart].filter(Boolean).join(' ');
  return parts.trim();
}

function computeCoverageIssues(
  story: FinalChapter[],
  input: GenerateFinalInput,
  issueTitleById: Map<string, string>
): string[] {
  const missing: string[] = [];
  const all = story.map((c) => c.body).join('\n');
  const ch2 = story[1]?.body || '';
  const ch4 = story[3]?.body || '';

  const targets = Array.isArray(input.companyTargets) ? input.companyTargets : [];
  if (!targets.length) {
    if (!all.includes('★North Star未入力のため一般化した')) {
      missing.push('North Star未入力時の明記：「★North Star未入力のため一般化した」を本文に含める');
    }
    // 未入力時は推測数値の生成禁止。ここでは “防止” ではなく “未入力明記” を担保。
    return missing;
  }

  const top = pickTopTarget(targets);
  if (top) {
    const mustPhrase = formatTopTargetMustPhrase(top);
    // 1) 目標名は必須（数値は可能な範囲で、少なくとも base があれば base を含めたい）
    const mustTokens: string[] = [];
    const label = sanitize(top.label, 60);
    if (label) mustTokens.push(label);
    if (Number.isFinite(top.base)) mustTokens.push(String(Number(top.base)));
    if (Number.isFinite(top.dueYear)) mustTokens.push(String(Number(top.dueYear)));
    if (mustTokens.length && !includesAll(all, mustTokens.slice(0, Math.min(2, mustTokens.length)))) {
      // まずは “雑に” でも入れてもらうための要件表現
      missing.push(`最優先North Starを本文に明記（例: ${mustPhrase}）`);
    }

    // 2) linkedIssueIds があれば、Ch2 or Ch4 に該当論点のタイトル（or ID表記）を入れる
    const linkedIds = Array.isArray(top.linkedIssueIds)
      ? top.linkedIssueIds.filter((x) => typeof x === 'string' && x)
      : [];
    if (linkedIds.length > 0) {
      const mustIssueMentions: string[] = [];
      for (const id of linkedIds.slice(0, 3)) {
        const title = issueTitleById.get(id);
        if (title) mustIssueMentions.push(title);
        else mustIssueMentions.push(`論点ID: ${id}`);
      }
      const inCh2or4 = (ch2 + '\n' + ch4).trim();
      // 1つでも良いが、できれば1つは確実に
      const hit = mustIssueMentions.some((x) => x && inCh2or4.includes(x));
      if (!hit) {
        missing.push(
          `linkedIssue（紐付く論点）への言及を第2章または第4章に含める（候補: ${mustIssueMentions.join(' / ')}）`
        );
      }
    }
  }

  return missing;
}

/* ===== 反映不足時のリペア（2nd pass：最小修正） ===== */
function buildRepairSystemPrompt(): string {
  return `あなたは経営者ストーリーのエディタです。
与えられたJSON（finalStory）を、要件に適合するよう「最小限の追記」で修正してください。

【厳守】
- 出力はJSONのみ（説明文・コードブロック禁止）
- 章数（4章）と章タイトルは維持
- 既存の文体（社員向け熱量）を壊さない
- 全面書き換えは禁止。必要な行・一文の追加で満たす
- North Star未入力時は「★North Star未入力のため一般化した」を本文に必ず含め、推測で数値を作らない
- North Starがある場合は、最優先目標の“目標名＋数値要素（可能なら基準値/期限）”を本文に必ず含める
- linkedIssue の言及は第2章または第4章に必ず入れる（なぜ効くかが伝わる一文で）
`.trim();
}

function buildRepairUserPrompt(
  original: { finalStory: FinalChapter[] },
  missing: string[],
  must: {
    topTargetPhrase?: string;
    linkedIssueMentions?: string[];
    hasTargets: boolean;
  }
): string {
  return `【不足している要件（これを満たすよう最小限追記）】
- ${missing.join('\n- ')}

【必須挿入（できるだけ自然に混ぜる）】
- North Star最優先（ある場合）: ${must.topTargetPhrase || '（なし）'}
- linkedIssue言及候補（ある場合は第2章or第4章に）: ${must.linkedIssueMentions?.length ? must.linkedIssueMentions.join(' / ') : '（なし）'}
- North Star未入力時の明記（targetsが無い場合のみ）: ★North Star未入力のため一般化した

【修正対象JSON（この構造を維持）】
${JSON.stringify(original, null, 2)}
`.trim();
}

/* ===== APIハンドラ ===== */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  console.log('[stage2/generate-final] POST ENTER', {
    at: new Date().toISOString(),
    method: req.method,
    contentLength: req.headers.get('content-length'),
  });

  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error('[stage2/generate-final] OPENAI_API_KEY is missing');
      return NextResponse.json({ error: 'OPENAI_API_KEY is missing' }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as GenerateFinalInput;

    // issueTitleById は buildUserPrompt 内でも作るが、2nd pass の coverage 判定で再利用したいのでここでも作る
    const issueTitleById = new Map<string, string>();
    const issueBlocks = Array.isArray(body.issueBlocks) ? body.issueBlocks : [];
    for (const ib of issueBlocks) {
      const id = (ib as any)?.id;
      if (typeof id === 'string' && id) issueTitleById.set(id, ib.title);
    }

    console.log('[stage2/generate-final] input parsed', {
      issueBlocksCount: body.issueBlocks?.length ?? 0,
      winPatternsCandidateCount: body.winPatternsCandidate?.length ?? 0,
      answers12Count: body.answers12?.length ?? 0,
      companyTargetsCount: body.companyTargets?.length ?? 0,
      selectedWinPatternId: body.selectedWinPatternId,
    });

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(body);
    console.log('[stage2/generate-final] prompts built', {
      systemLen: systemPrompt.length,
      userLen: userPrompt.length,
    });

    // OpenAI API呼び出し
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 58000);

    let raw = '';
    let usedModel = MODEL_PRIMARY;
    let tOpenAI = 0;

    try {
      tOpenAI = Date.now();
      console.log('[stage2/generate-final] BEFORE openai.chat.completions.create (1st attempt)', {
        model: MODEL_PRIMARY,
        temperature: 0.85,
        maxTokens: 3600,
      });

      const completion = await openai.chat.completions.create(
        {
          model: MODEL_PRIMARY,
          temperature: 0.85,
          max_tokens: 4800,
          presence_penalty: 0.6,
          frequency_penalty: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          ...(SUPPORTS_JSON_MODE.test(MODEL_PRIMARY) ? { response_format: { type: 'json_object' as const } } : {}),
        },
        { signal: controller.signal }
      );

      raw = completion.choices?.[0]?.message?.content?.trim() || '';
      const dur1 = Date.now() - tOpenAI;
      console.log('[stage2/generate-final] AFTER openai.chat.completions.create (1st attempt)', {
        durationMs: `${dur1}ms`,
        rawLen: raw.length,
        hasContent: !!raw,
      });
    } catch (e: unknown) {
      const dur1 = tOpenAI ? Date.now() - tOpenAI : undefined;
      const err1 = e as Error;
      console.warn(
        '[stage2/generate-final] 1st OpenAI attempt failed' + (dur1 ? ` (duration: ${dur1}ms)` : ''),
        err1?.message || e
      );

      usedModel = MODEL_FALLBACK;
      try {
        tOpenAI = Date.now();
        console.log('[stage2/generate-final] BEFORE openai.chat.completions.create (2nd attempt - fallback)', {
          model: MODEL_FALLBACK,
          reason: '1st attempt failed',
        });

        const completion2 = await openai.chat.completions.create(
          {
            model: MODEL_FALLBACK,
            temperature: 0.85,
            max_tokens: 4800,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' as const },
          },
          { signal: controller.signal }
        );

        raw = completion2.choices?.[0]?.message?.content?.trim() || '';
        const dur2 = Date.now() - tOpenAI;
        console.log('[stage2/generate-final] AFTER openai.chat.completions.create (2nd attempt - fallback)', {
          durationMs: `${dur2}ms`,
          rawLen: raw.length,
          hasContent: !!raw,
        });
      } catch (e2: unknown) {
        clearTimeout(timer);
        const dur2 = tOpenAI ? Date.now() - tOpenAI : undefined;
        const err2 = e2 as Error;
        const totalDurationMs = Date.now() - t0;
        console.error('[stage2/generate-final] OpenAI fallback error (both attempts failed)', {
          name: err2?.name,
          message: err2?.message || e2,
          duration2Ms: dur2,
          totalDurationMs: `${totalDurationMs}ms`,
          isAbortError: err2?.name === 'AbortError',
          stack: err2?.stack?.substring(0, 300),
        });
        return NextResponse.json({ error: err2?.message || 'OpenAI API error' }, { status: 500 });
      }
    } finally {
      clearTimeout(timer);
    }

    // JSON抽出
    const parsed = extractJsonLoose<ParsedOutput>(raw);
    if (!parsed) {
      console.error('[stage2/generate-final] Failed to parse JSON:', raw.slice(0, 500));
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    // 正規化
    let rawStory = parsed.finalStory || [];
    if (!Array.isArray(rawStory)) rawStory = [];
    let finalStory = normalizeFinalStory(rawStory);

    // ===== 反映不足チェック → 必要なら 2nd pass（最小修正） =====
    const missing = computeCoverageIssues(finalStory, body, issueTitleById);

    let repaired = false;
    let missingAfter: string[] = [];

    if (missing.length > 0) {
      console.warn('[stage2/generate-final] coverage missing -> repair:', missing);

      const targets = Array.isArray(body.companyTargets) ? body.companyTargets : [];
      const top = pickTopTarget(targets);
      const topPhrase = top ? formatTopTargetMustPhrase(top) : undefined;

      const linkedMentions: string[] = [];
      if (top) {
        const linkedIds = Array.isArray(top.linkedIssueIds)
          ? top.linkedIssueIds.filter((x) => typeof x === 'string' && x)
          : [];
        for (const id of linkedIds.slice(0, 3)) {
          const title = issueTitleById.get(id);
          if (title) linkedMentions.push(title);
          else linkedMentions.push(`論点ID: ${id}`);
        }
      }

      const repairController = new AbortController();
      const repairTimer = setTimeout(() => repairController.abort(), 35000);

      try {
        const repairPayload = { finalStory };
        const completionRepair = await openai.chat.completions.create(
          {
            model: usedModel,
            temperature: 0.0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: buildRepairSystemPrompt() },
              {
                role: 'user',
                content: buildRepairUserPrompt(repairPayload, missing, {
                  hasTargets: targets.length > 0,
                  topTargetPhrase: topPhrase,
                  linkedIssueMentions: linkedMentions,
                }),
              },
            ],
            max_tokens: 2200,
          },
          { signal: repairController.signal }
        );

        const raw2 = completionRepair.choices?.[0]?.message?.content?.trim() || '';
        const parsed2 = extractJsonLoose<ParsedOutput>(raw2);

        if (parsed2?.finalStory && Array.isArray(parsed2.finalStory)) {
          const repairedStory = normalizeFinalStory(parsed2.finalStory);
          missingAfter = computeCoverageIssues(repairedStory, body, issueTitleById);

          // “改善している” 場合のみ採用（悪化は棄却）
          if (missingAfter.length <= missing.length) {
            finalStory = repairedStory;
            repaired = true;
            console.log('[stage2/generate-final] repair applied. missingAfter:', missingAfter);
          } else {
            console.warn('[stage2/generate-final] repair rejected (worse). missingAfter:', missingAfter);
          }
        } else {
          console.warn('[stage2/generate-final] repair parse failed -> keep original');
        }
      } catch (e: any) {
        console.warn('[stage2/generate-final] repair call failed -> keep original:', e?.message || e);
      } finally {
        clearTimeout(repairTimer);
      }
    }

    const totalDurationMs = Date.now() - t0;
    console.log('[stage2/generate-final] END - preparing response', {
      finalStoryCount: finalStory.length,
      finalStoryLengths: finalStory.map((ch, i) => `Ch${i}: ${ch.body.length}`),
      usedModel,
      repaired,
      missingBeforeCount: missing.length,
      missingAfterCount: missingAfter.length,
      totalDurationMs: `${totalDurationMs}ms`,
      at: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        finalStory,
        _debug: {
          model: usedModel,
          repaired,
          missingBefore: missing.slice(0, 10),
          missingAfter: missingAfter.slice(0, 10),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: unknown) {
    const err = error as Error;
    const totalDurationMs = Date.now() - t0;
    console.error('[stage2/generate-final] FATAL Server error', {
      name: err?.name,
      message: err?.message || error,
      totalDurationMs: `${totalDurationMs}ms`,
      isAbortError: err?.name === 'AbortError',
      stack: err?.stack?.substring(0, 500),
    });
    const status = err?.name === 'AbortError' ? 504 : 500;
    return NextResponse.json({ error: err?.message || 'Server error' }, { status });
  }
}
