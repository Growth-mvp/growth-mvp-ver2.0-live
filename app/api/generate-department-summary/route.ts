export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText, toTextStory } from '@/app/api/_shared/utils';
import { getIndustryLabel } from '@/utils/industryTemplates';
import { z } from 'zod';

/* ========= 型定義 ========= */
type AnswerStep = { stepNumber: number; question?: string; reason?: string; answer?: string };
type ReqBody = {
  departmentName: string;
  story?: Array<{ title: string; body: string }> | string;
  answers: AnswerStep[];
  industry?: string;          // 任意
  patterns?: string[];        // ④ 勝ちパターン（任意）
};
type OKR = { objective: string; keyResults: string[]; owner?: string };
type Out = { mission: string; projects: string[]; okrs: OKR[] };

/* ========= バリデーション ========= */
const ReqSchema = z.object({
  departmentName: z.string().min(1),
  story: z.any().optional(),
  answers: z.array(
    z.object({
      stepNumber: z.number().int(),
      question: z.string().optional(),
      reason: z.string().optional(),
      answer: z.string().optional(),
    })
  ).min(1),
  industry: z.string().optional(),
  patterns: z.array(z.string()).optional(),
});

/* ========= ユーティリティ ========= */
function ensureThreeAnswered(answers: AnswerStep[]): { ok: boolean; reason?: string } {
  const byStep = new Map<number, AnswerStep>();
  for (const a of answers) {
    const n = Number(a?.stepNumber);
    if (n >= 1 && n <= 3 && !byStep.has(n)) byStep.set(n, a);
  }
  if (![1, 2, 3].every((n) => byStep.has(n))) return { ok: false, reason: '3問（1,2,3）の回答が必要です' };
  for (const n of [1, 2, 3]) {
    const ans = (byStep.get(n)?.answer || '').trim();
    if (!ans) return { ok: false, reason: `Q${n} の回答が空です` };
  }
  return { ok: true };
}

function normalizeProjects(list: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase().replace(/[！!。．.、,・\s]+$/g, '').normalize('NFKC');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out.slice(0, 5);
}

function normalizeOkrs(list: unknown[]): OKR[] {
  const out: OKR[] = [];
  for (const o of Array.isArray(list) ? (list as any[]) : []) {
    const objective = String(o?.objective ?? '').trim();
    const keyResults = (Array.isArray(o?.keyResults) ? o.keyResults : [])
      .map((k: unknown) => String(k ?? '').trim())
      .filter(Boolean)
      .slice(0, 4);
    const owner = o?.owner ? String(o.owner).trim() : undefined;
    if (!objective && keyResults.length === 0) continue;
    out.push({ objective, keyResults, owner });
    if (out.length >= 2) break;
  }
  return out;
}

function extractJsonObject<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/m);
    if (m) {
      try { return JSON.parse(m[0]) as T; } catch {}
    }
  }
  return null;
}

/** 日本語の余計な半角スペースを整理 */
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

/** OpenAI（JSON強制・指数バックオフ付き） */
async function callOpenAIWithRetry(
  messages: { role: 'system' | 'user'; content: string }[],
  tries = 3
) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      const ai = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.25,
        max_tokens: 900,
        messages,
      });
      return ai;
    } catch (e: any) {
      lastErr = e;
      const status = Number(e?.status ?? e?.code ?? 0);
      const isRetryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!isRetryable || i === tries - 1) break;
      const retryAfter = Number(e?.response?.headers?.get?.('retry-after')) || 0;
      const backoff = retryAfter > 0 ? retryAfter * 1000 : [300, 800, 1500][Math.min(i, 2)];
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/* ========= ④: 部門×勝ちパターン（フォールバック用ヒント） ========= */
function patternHintsByDepartment(dept: string, patterns: string[]) {
  const d = (dept || '').toLowerCase();
  const has = (k: string) => patterns.map(p => p.toLowerCase()).includes(k.toLowerCase());

  const baseByDept = () => {
    if (d.includes('sales') || d.includes('営業')) return {
      mission: '信頼とスピードで受注を伸ばし、継続率向上に貢献する。',
      projects: [
        '重点アカウント攻略プレイブックの標準化',
        'SQL化率向上のための案件審査ゲート運用',
        'オンボ前提の見積もり/導線テンプレ導入',
      ],
      okrs: { objective: '重点セグメントで受注を加速', krs: ['SQL化率 +10pp', 'Win rate +5pp', '上位10社で新規5件'] },
    };
    if (d.includes('marketing') || d.includes('マーケ')) return {
      mission: '勝ち筋に沿った需要創出で、良質なパイプラインを供給する。',
      projects: [
        'ICP×課題×導線のマッピング（地図化）',
        'API連携・導入TTV短縮の事例ナラティブ制作',
        '指名/比較KWの順位改善',
      ],
      okrs: { objective: '需要創出の効率化', krs: ['MQL→SQL +15pp', '指名検索 +30%', '事例記事 月4本'] },
    };
    if (d.includes('r&d') || d.includes('開発') || d.includes('製品') || d.includes('prod')) return {
      mission: '顧客価値の体感速度を最大化するプロダクトを届ける。',
      projects: [
        'トップ3顧客課題の即応解消',
        'オンボTTV短縮の設定ウィザード実装',
        '内製ツール整備で開発速度 +20%',
      ],
      okrs: { objective: '価値の早期体感', krs: ['主要機能NPS +10', 'リードタイム -20%', '重大不具合 -30%'] },
    };
    if (d.includes('ops') || d.includes('operation') || d.includes('オペ')) return {
      mission: '高効率・高品質の提供体制で顧客価値を安定供給する。',
      projects: [
        '標準作業×自動化で原価と手戻り削減',
        '品質起点の一次解決率向上',
        '導入リードタイム短縮のクリティカルパス可視化',
      ],
      okrs: { objective: '効率的な提供', krs: ['COGS比率 -3pp', 'OTD 98%', '一次解決率 +10pp'] },
    };
    // CS / サポート
    return {
      mission: '継続率最大化と紹介創出を通じて、成長を支える。',
      projects: [
        'オンボード体験の定型化とヘルススコア運用',
        'アダプション・キャンペーン（活用深度向上）',
        'リファラル・プログラムの運用',
      ],
      okrs: { objective: '継続率と紹介の構造化', krs: ['GRR +5pp', '拡張MRR +10%', '紹介経由リード比率 +20%'] },
    };
  };

  const base = baseByDept();
  const add: string[] = [];
  const krsAdd: string[] = [];

  if (has('subscriptionMoat')) {
    add.push('解約理由×対処プレイブックの整備', '成功体験の「やめない理由」メッセージセット');
    krsAdd.push('Churn -20%', 'NRR 110% 以上');
  }
  if (has('platformPlay')) {
    add.push('主要SaaS/APIとの接続テンプレ化', '連携カタログ/コネクタの公開');
    krsAdd.push('連携経由の受注 30%', '接続TTV -30%');
  }
  if (has('serviceDelight')) {
    add.push('オンボTTV短縮の伴走CSパッケージ', 'NPS向上のサプライズ施策のABテスト');
    krsAdd.push('オンボTTV -40%', 'NPS +10');
  }
  if (has('manufacturingKaizen')) {
    add.push('標準作業チェックリストと改善カンバン運用', '欠陥/手戻りの継続削減');
    krsAdd.push('手戻り -30%', '欠陥密度 -20%');
  }
  if (has('brandTrust')) {
    add.push('信頼資産（SLA/セキュリティ/実績）の可視化', 'リファレンス整備と公開');
    krsAdd.push('指名検索 +30%', '信頼項目満足度 +10pt');
  }
  if (has('dataNetwork')) {
    add.push('利用データを用いた推奨/通知の精度向上', 'ヘルススコア自動化');
    krsAdd.push('推奨CTR +20%', '健康スコア×解約予測AUC +0.05');
  }
  if (has('speedOperator')) {
    add.push('週次リリースと小粒改善の連打', '意思決定の可視化（WIP制限）');
    krsAdd.push('リードタイム -20%', 'WIP 平均 -20%');
  }

  return {
    mission: base.mission,
    projects: normalizeProjects([...base.projects, ...add]),
    okrs: [{
      objective: base.okrs.objective,
      keyResults: normalizeProjects([...base.okrs.krs, ...krsAdd]).slice(0, 4),
    }],
  };
}

/* ========= ヒューリスティック サマリー生成 ========= */
function buildHeuristicSummary(args: {
  departmentName: string;
  storyText: string;
  answers: AnswerStep[];
  industryLabel: string;
  patterns: string[];
}): Out {
  const { departmentName, storyText, answers, industryLabel, patterns } = args;
  const a1 = tidyJa((answers.find(a => a.stepNumber === 1)?.answer || '').trim());
  const a2 = tidyJa((answers.find(a => a.stepNumber === 2)?.answer || '').trim());
  const a3 = tidyJa((answers.find(a => a.stepNumber === 3)?.answer || '').trim());

  const base = patternHintsByDepartment(departmentName, patterns);

  const mission = tidyJa(
    `${departmentName}は、${industryLabel ? `${industryLabel}領域において` : ''}「${a2 || '顧客価値'}」を最速で実現するため、${a3 || '選択と集中'}を徹底し、全員で${a1 || '役割を果たす'}。`
  ).slice(0, 140);

  const hint: string[] =
    storyText && storyText.length > 0
      ? normalizeProjects([`ストーリー整合レビュー（${departmentName}観点）`])
      : [];

  // ★ owner は任意。存在する場合のみ付与（TS2339対策）
  const okrs = base.okrs.map((o) => {
    const r: OKR = {
      objective: tidyJa(o.objective),
      keyResults: o.keyResults.map(tidyJa),
    };
    if ((o as any).owner) r.owner = String((o as any).owner);
    return r;
  });

  return {
    mission,
    projects: normalizeProjects([...base.projects, ...hint]).map(tidyJa),
    okrs,
  };
}

/* ========= メインハンドラ ========= */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = ReqSchema.safeParse(raw);
    if (!parsed.success) {
      return new NextResponse(JSON.stringify({ error: '入力形式が不正です' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    const body = parsed.data as ReqBody;
    const dept = body.departmentName.trim();
    if (!dept) {
      return new NextResponse(JSON.stringify({ error: 'departmentName が必要です' }), {
        status: 400, headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    // 業種ラベル（任意）
    const industry = body.industry || '';
    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';

    const storyText = typeof body.story === 'string' ? body.story : toTextStory(body.story);
    const steps = [...(body.answers || [])].sort((a, b) => a.stepNumber - b.stepNumber);
    const okCheck = ensureThreeAnswered(steps);
    if (!okCheck.ok) {
      return new NextResponse(JSON.stringify({ error: okCheck.reason || '3問の回答が必要です' }), {
        status: 400, headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    // ④ 勝ちパターン（任意）
    const patterns: string[] = Array.isArray(body.patterns) ? body.patterns.map(String) : [];

    const stepsText = steps
      .map(
        (s) =>
          `- Q${s.stepNumber}: ${sanitizeText(String(s.question || ''), 120)}\n  A: ${sanitizeText(
            String(s.answer || ''),
            400
          )}`
      )
      .join('\n');

    const industryLine = industryLabel
      ? `業種: ${industryLabel}${industry ? `（${industry}）` : ''}`
      : '業種: （未指定）';

    const context = `
${industryLine}
部門: ${dept}
【経営ストーリー（要約入力）】
${sanitizeText(storyText || '', 1600) || '(未入力)'}
【部長の回答（1:役割/2:価値/3:集中と選択）】
${stepsText}
【勝ちパターン】${patterns.length ? patterns.join(', ') : '—'}
`.trim();

    const system = `
あなたは経営戦略ファシリテーターです。
業種背景と勝ちパターン（patterns）を踏まえ、部長の3回答に整合する実行可能なサマリーを日本語で出力します。
- mission: 80〜140字。存在意義と最終成果を1文で。
- projects: 3〜5件。実行主体とアウトプットが想像できる粒度で。
- okrs: 1〜2セット。objectiveは短文、keyResultsは測定可能（数値or頻度）に。
制約:
- 出力は {"mission":"...", "projects":["..."], "okrs":[{"objective":"...","keyResults":["..."],"owner":""}]} の JSON のみ。
- 回答/ストーリー/業界特性/勝ちパターンと矛盾する創作は禁止。
- 「やらないこと」はKRに含めない。
`.trim();

    const user = `次の文脈を要約し、Mission/Projects/OKRを出力してください。\n${context}`;

    // === OpenAI呼び出し（失敗時はヒューリスティックで200返却） ===
    let rawAi = '';
    try {
      const ai = await callOpenAIWithRetry(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        3
      );
      rawAi = ai?.choices?.[0]?.message?.content ?? '';
    } catch (e: any) {
      const out = buildHeuristicSummary({
        departmentName: dept,
        storyText,
        answers: steps,
        industryLabel,
        patterns,
      });
      return new NextResponse(JSON.stringify(out), {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'x-fallback-used': 'heuristic',
        },
      });
    }

    // === JSON抽出 ===
    const parsedOut = extractJsonObject<Out>(rawAi);
    if (!parsedOut?.mission || !Array.isArray(parsedOut?.projects) || !Array.isArray(parsedOut?.okrs)) {
      const out = buildHeuristicSummary({
        departmentName: dept,
        storyText,
        answers: steps,
        industryLabel,
        patterns,
      });
      return new NextResponse(JSON.stringify(out), {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'x-fallback-used': 'heuristic-parse',
        },
      });
    }

    // 正規化＋整形
    const mission = tidyJa(String(parsedOut.mission || '').trim().slice(0, 240));
    const projects = normalizeProjects(parsedOut.projects).map(tidyJa);
    const okrs = normalizeOkrs(parsedOut.okrs).map((o) => ({
      objective: tidyJa(o.objective),
      keyResults: o.keyResults.map(tidyJa),
      owner: o.owner,
    }));

    return new NextResponse(
      JSON.stringify({ mission, projects, okrs }),
      { headers: { 'Cache-Control': 'no-store', 'content-type': 'application/json; charset=utf-8' } }
    );
  } catch (e: any) {
    console.error('dept-summary error:', e?.message || e);
    return new NextResponse(
      JSON.stringify({ error: 'Server error', detail: e?.message || String(e) }),
      { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  }
}
