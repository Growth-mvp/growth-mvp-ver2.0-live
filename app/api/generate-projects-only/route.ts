// /app/api/generate-projects-only/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { toTextStory, sanitizeText, extractJsonObject } from '@/app/api/_shared/utils';
import { getIndustryLabel } from '@/utils/industryTemplates';
import { z } from 'zod';

/* =========================
 * 入力スキーマ
 * ======================= */
const ReqSchema = z.object({
  departmentName: z.string().min(1, 'departmentName is required'),
  mission: z.string().min(1, 'mission is required'),
  story: z.any(), // string | Array<{title, body}>
  industry: z.string().optional(),
});

/* =========================
 * プロジェクトスキーマ（勝ち筋レバー付き）
 * ======================= */
const LeverEnum = z.enum([
  'ACQ',        // 新規・既存顧客数（獲得・利用頻度）
  'ARPU',       // 単価・顧客あたり収益
  'CHURN',      // 解約・離脱
  'COST',       // コスト全般
  'EFFICIENCY', // 業務効率・時間削減
  'FUTURE',     // 将来の種・仕組み（新規事業・基盤・人材 等）
]);

const HorizonEnum = z.enum(['short', 'mid', 'long']); // 短期/中期/長期
const KindEnum = z.enum(['growth', 'cost', 'efficiency', 'future']);

const ProjectSchema = z.object({
  // プロジェクト名（仮説が連想できるタイトル）
  title: z.string().min(1).catch(''),
  // 目的・狙い
  reason: z.string().default(''),
  // 「こうすれば勝てる／効くはず」という仮説（1〜2文）
  hypothesis: z.string().default(''),

  // どのレバーに効かせるか
  mainLever: LeverEnum.optional(),
  // いつ効いてくるか（short/mid/long）
  horizon: HorizonEnum.optional(),
  // growth/cost/efficiency/future（UIの色分けなどで使用）
  kind: KindEnum.optional(),

  // ★ どこで勝つか（具体性アップ用フィールド）
  targetCustomer: z.string().default('').optional(), // どの顧客セグメント
  targetChannel: z.string().default('').optional(),  // どのチャネル（直販/代理店/EC/店舗など）
  targetProduct: z.string().default('').optional(),  // どのプロダクト・サービス
  mainKpi: z.string().default('').optional(),        // 主要KPI（例：月間新規リード数 等）
});

type Project = z.infer<typeof ProjectSchema>;

/* =========================
 * ユーティリティ
 * ======================= */
function normalizeProjects(list: unknown[], max = 6): Project[] {
  const out: Project[] = [];
  const seen = new Set<string>();

  for (const raw of Array.isArray(list) ? list : []) {
    const candidate =
      typeof raw === 'string'
        ? { title: raw }
        : (raw as Record<string, unknown> | undefined) ?? {};

    const parsed = ProjectSchema.safeParse(candidate);
    if (!parsed.success) continue;

    const proj = parsed.data;
    const key = proj.title
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[！!。．.、,・\s]+$/g, '');

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(proj);
    if (out.length >= max) break;
  }

  return out;
}

function bulletsFallback(raw: string): string[] {
  return (
    raw
      .match(/^\s*[-・*]\s*(.+)$/gm)
      ?.map((l) => l.replace(/^\s*[-・*]\s*/, '').trim())
      .filter(Boolean) ?? []
  );
}

async function callOpenAIWithRetry(
  messages: { role: 'system' | 'user'; content: string }[],
  tries = 3,
) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        temperature: 0.4,
        response_format: { type: 'json_object' },
        max_tokens: 900,
        messages,
      });
    } catch (e: any) {
      lastErr = e;
      const status = Number(e?.status ?? e?.code ?? 0);
      const retryable =
        status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable || i === tries - 1) break;
      const retryAfter = Number(e?.response?.headers?.get?.('retry-after')) || 0;
      const backoff = retryAfter > 0 ? retryAfter * 1000 : [300, 700, 1300][Math.min(i, 2)];
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const parsed = ReqSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '必要な情報が不足しています（部門名、ミッション、ストーリー）' },
        { status: 400 },
      );
    }

    const { departmentName, mission, story, industry } = parsed.data;
    const storyText = toTextStory(story);
    const dept = departmentName.trim();
    const missionText = mission.trim();

    if (!dept || !missionText || !storyText?.trim()) {
      return NextResponse.json(
        { error: '必要な情報が不足しています（部門名、ミッション、ストーリー）' },
        { status: 400 },
      );
    }

    // 業種の日本語ラベル
    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';
    const industryLine = industryLabel
      ? `業種: ${industryLabel}${industry ? `（${industry}）` : ''}`
      : '業種: （未指定）';

    const prompt = `
${industryLine}
部門: ${dept}

以下は企業の経営戦略ストーリーです：

---
${sanitizeText(storyText, 2000)}
---

【部門ミッション】
${sanitizeText(missionText, 800)}

あなたは有能な経営コンサルタントです。
この経営戦略と部門ミッションに基づき、「${dept}」部門で注力すべき
「仮説ドリブンなプロジェクト案」を3〜6件、JSONで提案してください。

# 勝ち筋レバーの考え方（3〜5年スパンで、どのレバーで伸ばすか）

プロジェクトは「こうすれば勝てる／効くはず」という**戦略仮説**のセットです。
次の視点から設計してください：

1. どのレバーで成果を出すか（mainLever / kind）

- growth レバー（売上・LTVを伸ばす）
  - ACQ: 新規・既存顧客数を増やす（獲得・利用頻度アップ）
  - ARPU: 単価・顧客あたり売上を増やす（アップセル・値上げ・ミックス改善）
  - CHURN: 解約・離脱を減らし、LTVを伸ばす
- cost / efficiency レバー（コスト構造をひっくり返す）
  - COST: コスト全体を下げる（固定費・変動費・外注費など）
  - EFFICIENCY: 業務効率・時間削減（結果としてコスト・スループットに効く）
- future レバー（将来の種・仕組みを作る）
  - FUTURE: 中長期の種・仕組み（新規事業、データ基盤、人材育成、プラットフォーム等）

kind フィールドは、
- growth（売上・LTV向上）
- cost（コスト削減）
- efficiency（生産性向上）
- future（将来の成長の種・能力開発）
のいずれかを設定してください。

2. いつ効くか（時間軸: horizon）

- short: 〜1年でPLに効く施策（クイックヒット）
- mid: 1〜3年で効いてくる施策（ビジネスモデル強化）
- long: 3年以上かけて効いてくる施策（新規事業・人材・基盤など）

3. どこで勝つか（ターゲットの具体化）

以下の3点を必ず意識し、フィールドとして埋めてください：

- targetCustomer:
  - どの顧客セグメントにフォーカスするか
  - 例）「地方中核都市の中堅BtoB顧客」「主要空港を利用する訪日観光客」など
- targetChannel:
  - どのチャネルで攻めるか
  - 例）「自社営業」「代理店」「Webフォーム」「アプリ」「社内イントラ」など
- targetProduct:
  - どのプロダクト・サービス/プロセスに焦点を当てるか
  - 例）「主力定期便サービス」「サブスクリプションプラン」「社内人事制度」など
- mainKpi:
  - そのプロジェクトで最も重視するKPI（指標）を1つ
  - 例）「月間新規リード数」「顧客単価」「離職率」「1案件あたり工数」など

# プロジェクトの設計条件

- growth×short（売上アップ・単価UP系）は必ず少なくとも1件
- cost または efficiency（コスト削減・業務効率化）系も必ず1件以上
- future×mid/long（中長期の投資的プロジェクト）も必ず1件以上
- プロジェクト同士が被らないように、役割と射程を分けること
  - 例）「既存大口向け単価UP」「新規中堅顧客獲得」「バックオフィス効率化」「人材育成・評価制度刷新」など

# 各フィールドの意味

- title:
  - プロジェクト名（名詞句）
  - 見ただけで「どの顧客/チャネル/プロダクトを通じて、どのレバーに効かせるか」が想像できるタイトルにしてください
  - 例）「中堅B2B顧客向け高粗利パッケージの立ち上げ」
- reason:
  - そのプロジェクトの目的・狙い・背景（1文）
- hypothesis:
  - 以下のような形の仮説を1〜2文で日本語で書いてください
  - 例）「もし【ターゲット顧客/業務】に対して【施策/仕組み】を実行すれば、
          【行動/体験】がこう変わり、結果として【mainLever】が改善するはずだ。」
- mainLever:
  - "ACQ" | "ARPU" | "CHURN" | "COST" | "EFFICIENCY" | "FUTURE"
- horizon:
  - "short" | "mid" | "long"
- kind:
  - "growth" | "cost" | "efficiency" | "future"
- targetCustomer:
  - どの顧客セグメントにフォーカスするか
- targetChannel:
  - どのチャネルを主に使うか
- targetProduct:
  - どのプロダクト・サービス/プロセスを主戦場とするか
- mainKpi:
  - そのプロジェクトで最も重視するKPI（1つ）

# 出力形式（日本語のJSONのみ／説明禁止）

必ず次の形式の JSON オブジェクトだけを返してください。

{
  "projects": [
    {
      "title": "プロジェクト名",
      "reason": "目的・ねらい（1文）",
      "hypothesis": "こうすれば勝てる／効くはずだという仮説（1〜2文）",
      "mainLever": "ACQ | ARPU | CHURN | COST | EFFICIENCY | FUTURE のいずれか",
      "horizon": "short | mid | long のいずれか",
      "kind": "growth | cost | efficiency | future のいずれか",
      "targetCustomer": "ターゲット顧客セグメント",
      "targetChannel": "主なチャネル",
      "targetProduct": "対象となるプロダクト・サービス/プロセス",
      "mainKpi": "重視するKPI"
    }
  ]
}

制約:
- JSON以外のテキスト、日本語の説明文、コードフェンス（\`\`\`）は一切出力しないこと。
- title は必ずユニークにし、業種・部門に即した具体的な実行プロジェクトにすること。
`.trim();

    // OpenAI 呼び出し（JSON固定 & リトライ）
    let ai;
    try {
      ai = await callOpenAIWithRetry(
        [
          {
            role: 'system',
            content: 'あなたは有能な経営コンサルタントです。必ずJSONのみを返します。',
          },
          { role: 'user', content: prompt },
        ],
        3,
      );
    } catch (e: any) {
      const status = Number(e?.status ?? e?.code ?? 500);
      const message = e?.message || 'OpenAI error';
      return NextResponse.json(
        { error: message },
        { status: status === 429 ? 429 : 502 },
      );
    }

    // 1) JSON → 2) ゆるく抽出 → 3) 箇条書きフォールバック
    const raw = ai?.choices?.[0]?.message?.content || '';
    const parsedOut = extractJsonObject<any>(raw);

    let projects: Project[] = [];

    if (parsedOut && Array.isArray(parsedOut.projects)) {
      projects = normalizeProjects(parsedOut.projects, 6);
    }

    // JSONが崩れている/配列が空のときは、本文中の箇条書きからタイトルだけ拾う
    if (projects.length === 0) {
      const bulletTitles = bulletsFallback(raw);
      projects = normalizeProjects(
        bulletTitles.map((t) => ({ title: t })),
        6,
      );
    }

    return NextResponse.json(
      { projects },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err: any) {
    console.error('❌ プロジェクト再生成エラー:', err?.message || err);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 },
    );
  }
}
