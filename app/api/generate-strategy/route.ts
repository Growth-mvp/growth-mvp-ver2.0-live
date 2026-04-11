// /app/api/generate-strategy/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { z } from 'zod';
import { sanitizeText, extractJsonObject } from '@/app/api/_shared/utils';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';

/* =========================
 * 入力スキーマ
 * ======================= */
const DeptIn = z.object({ name: z.string().min(1).optional() });
const BodySchema = z.object({
  userId: z.string().optional(),
  companyId: z.string().optional(),
  thought: z.string().optional(),
  industry: z.string().optional(),
  revenue: z.string().optional(),
  employees: z.string().optional(),
  mission: z.string().optional(),
  visionStatement: z.string().optional(),
  value: z.string().optional(),
  strength: z.string().optional(),
  weakness: z.string().optional(),
  opportunity: z.string().optional(),
  threat: z.string().optional(),
  story: z.string().optional(),
  departments: z.array(DeptIn).optional(),
});
type BodyIn = z.infer<typeof BodySchema>;

/* =========================
 * 出力スキーマ（AI応答の検証用）
 * ======================= */
const OkrSchema = z.object({
  objective: z.string().optional(),
  keyResults: z.array(z.string()).optional(),
});
const ProjectSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  okrs: z.array(OkrSchema).optional(),
});
const DepartmentOutSchema = z.object({
  name: z.string().optional(),
  strategy: z.string().optional(),
  projects: z.array(ProjectSchema).optional(),
});
const AiOutSchema = z.object({
  strategy: z.object({ summary: z.string().optional() }).optional(),
  departments: z.array(DepartmentOutSchema).optional(),
});
type AiOut = z.infer<typeof AiOutSchema>;

/* =========================
 * ユーティリティ
 * ======================= */
function listDeptNames(arr?: Array<{ name?: string }>) {
  return (Array.isArray(arr) ? arr : [])
    .map(d => (d?.name ?? '').trim())
    .filter(Boolean);
}

function buildPrompt(input: BodyIn, deptNames: string[]) {
  return `
あなたは大手企業向けの戦略コンサルタントです。

以下の経営情報をもとに、現場実行までつながる「経営→部門→プロジェクト→OKR」のカスケードをコンパクトに提案してください。
- 生成する部門は「入力に含まれる部門名のみ」。新しい部門名は作らない。
- 説明文は不要。必ず JSON のみで返す。

【経営者の思い】${sanitizeText(input.thought ?? '', 1200)}
【業種】${sanitizeText(input.industry ?? '', 200)}
【売上】${sanitizeText(input.revenue ?? '', 120)}（単位は入力のまま）
【社員数】${sanitizeText(input.employees ?? '', 120)}

【MVV】
- Mission: ${sanitizeText(input.mission ?? '', 600)}
- Vision: ${sanitizeText(input.visionStatement ?? '', 600)}
- Value : ${sanitizeText(input.value ?? '', 600)}

【SWOT】
- 強み: ${sanitizeText(input.strength ?? '', 800)}
- 弱み: ${sanitizeText(input.weakness ?? '', 800)}
- 機会: ${sanitizeText(input.opportunity ?? '', 800)}
- 脅威: ${sanitizeText(input.threat ?? '', 800)}

【戦略ストーリー（参考）】
${sanitizeText(input.story ?? '', 1800)}

【使用する部門名（厳守）】${deptNames.join('、') || '（未指定）'}

出力は JSON のみ（コードフェンス禁止）。形式:
{
  "strategy": { "summary": "..." },
  "departments": [
    {
      "name": "（入力にある部門名のみ）",
      "strategy": "部門の役割と貢献焦点（簡潔に）",
      "projects": [
        {
          "name": "実行可能なプロジェクト名（名詞句）",
          "description": "現場で想像できる粒度で1文",
          "okrs": [{ "objective": "...", "keyResults": ["...", "..."] }]
        }
      ]
    }
  ]
}
`.trim();
}

/* =========================
 * OpenAI 呼び出し（JSON強制→整形フォールバック）
 * ======================= */
async function askOpenAI(prompt: string) {
  // 1st: JSON強制
  try {
    const c1 = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      max_tokens: 1800,
      messages: [
        { role: 'system', content: 'あなたは戦略コンサルタントです。出力は必ずJSONのみ。' },
        { role: 'user', content: prompt },
      ],
    });
    return c1.choices?.[0]?.message?.content ?? '';
  } catch (e1: any) {
    // 2nd: プレーン → 整形
    const c2 = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      temperature: 0.4,
      max_tokens: 1800,
      messages: [
        { role: 'system', content: 'あなたは戦略コンサルタントです。' },
        { role: 'user', content: prompt },
      ],
    });
    const raw2 = c2.choices?.[0]?.message?.content ?? '';
    const c3 = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 1200,
      messages: [
        { role: 'system', content: '次のテキストを正しいJSONだけに整形。説明やコードブロックは禁止。' },
        { role: 'user', content: raw2 },
      ],
    });
    return c3.choices?.[0]?.message?.content ?? '';
  }
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: NextRequest) {
  try {
    // 0) Bearer トークン認証＆membership確認
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // ★ Role チェック: admin / manager のみ許可
    try {
      await assertMinRole(membership, 'manager');
    } catch {
      return NextResponse.json(
        { error: 'insufficient_role' },
        { status: 403 }
      );
    }

    // 1) 入力の読み込み＆検証
    const bodyRaw = await req.json().catch(() => ({}));
    const bodySafe = BodySchema.safeParse(bodyRaw);
    if (!bodySafe.success) {
      return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 });
    }
    const body: BodyIn = bodySafe.data;

    const deptNames = listDeptNames(body.departments);
    if (deptNames.length === 0) {
      return NextResponse.json({ error: '部門名が未入力です' }, { status: 400 });
    }

    // 2) プロンプト→OpenAI
    const prompt = buildPrompt(body, deptNames);
    let aiRaw = '';
    try {
      aiRaw = await askOpenAI(prompt);
    } catch (e: any) {
      const status = Number(e?.status ?? e?.code ?? 500);
      const message = e?.message || 'OpenAI error';
      return NextResponse.json({ error: message }, { status: status === 429 ? 429 : 502 });
    }

    // 3) JSON抽出→スキーマでサニタイズ
    const aiParsedLoose = extractJsonObject<any>(aiRaw) || {};
    const aiParsed = AiOutSchema.safeParse(aiParsedLoose);
    const normalized: AiOut = aiParsed.success ? aiParsed.data : {};

    // 4) 余分な部門を除外（入力に存在するもののみ）
    const allow = new Set(deptNames);
    const departments = (normalized.departments || [])
      .map(d => ({
        name: (d?.name ?? '').trim(),
        strategy: sanitizeText(d?.strategy ?? '', 800),
        projects: Array.isArray(d?.projects)
          ? d!.projects!
              .map(p => ({
                name: (p?.name ?? '').toString().trim(),
                description: sanitizeText(p?.description ?? '', 300),
                okrs: Array.isArray(p?.okrs)
                  ? p!.okrs!.map(o => ({
                      objective: sanitizeText(o?.objective ?? '', 120),
                      keyResults: Array.isArray(o?.keyResults)
                        ? o!.keyResults!.map(k => sanitizeText(k ?? '', 120)).filter(Boolean).slice(0, 5)
                        : [],
                    }))
                  : [],
              }))
              .filter(p => p.name)
          : [],
      }))
      .filter(d => d.name && allow.has(d.name));

    const strategySummary =
      (normalized.strategy?.summary ?? '').toString().trim();

    return NextResponse.json(
      { strategy: { summary: strategySummary }, departments },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    console.error('❌ generate-strategy error:', err?.message || err);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
