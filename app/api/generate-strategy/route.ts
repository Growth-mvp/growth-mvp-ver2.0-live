
import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

/** ====== サーバー用 Supabase（service role） ======
 *  フロント用の anon ではなく、SERVER環境変数の service_role を使う。
 *  ※ このファイルは server-only のため、NEXT_PUBLIC は使わない。
 */
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,           // URL は public でもOK
  process.env.SUPABASE_SERVICE_ROLE_KEY!,          // ★ server 環境変数
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type DeptIn = { name: string };
type BodyIn = {
  userId?: string;
  companyId?: string;              // あれば会社単位で保存
  thought?: string;
  industry?: string;
  revenue?: string;
  employees?: string;
  mission?: string;
  visionStatement?: string;
  value?: string;
  strength?: string;
  weakness?: string;
  opportunity?: string;
  threat?: string;
  story?: string;
  departments?: DeptIn[];          // 部門名だけの配列を期待
};

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BodyIn;

    const {
      userId,
      companyId,
      thought = '',
      industry = '',
      revenue = '',
      employees = '',
      mission = '',
      visionStatement = '',
      value = '',
      strength = '',
      weakness = '',
      opportunity = '',
      threat = '',
      story = '',
      departments = [],
    } = body ?? {};

    if (!userId && !companyId) {
      return NextResponse.json({ error: 'userId か companyId のどちらかが必要です' }, { status: 400 });
    }

    const departmentNames =
      (Array.isArray(departments) ? departments : [])
        .map(d => (d?.name ?? '').trim())
        .filter(Boolean)
        .join('、') || '';

    const prompt = `
あなたは大手企業向けの戦略コンサルタントです。

以下の経営情報をもとに、組織の変革を実現するためのカスケード構造を設計してください。
目的は「現場のマネージャーが納得し、実際のプロジェクトに落とし込み、チームメンバーが行動できるほど具体的で説得力のある構造」にすることです。

◉ 必ず以下の構造を含めてください：
- 経営戦略（summary）：方向性と狙いの背景を含めて明確に
- 部門戦略（指定された部門名のみ）：部門の役割・貢献目標を明示
- プロジェクト（各部門に1〜3件）：実際の現場行動としての施策を記述
- OKR（各プロジェクトにObjective1件、KeyResults2〜3件）：測定可能な行動指標で表現

◉ 可能な限り現実的・具体的な内容にしてください。
- 抽象的なキーワード（例：DX、グローバル化）だけではなく、「どこで・誰が・何を・どうする」を意識
- OKRは現場の社員が読んで「これなら実行できる」と思える粒度に
- 強み・弱み・機会・脅威を反映した戦略上の焦点が伝わること

【経営者の思い】${thought}
【業種】：${industry}
【売上】：${revenue}億円
【社員数】：${employees}名

【MVV】
ミッション：${mission}
ビジョン：${visionStatement}
バリュー：${value}

【SWOT】
強み：${strength}
弱み：${weakness}
機会：${opportunity}
脅威：${threat}

【戦略ストーリー】：${story}

【使用すべき部門名】：${departmentNames}
※上記の部門名のみを使用してください。GPTが勝手に新しい部門名を作らないようにしてください。

出力は JSON のみ：
{
  "strategy": { "summary": "..." },
  "departments": [
    {
      "name": "部門名",
      "strategy": "...",
      "projects": [
        {
          "name": "...",
          "description": "...",
          "okrs": [
            {
              "objective": "...",
              "keyResults": ["...", "..."]
            }
          ]
        }
      ]
    }
  ]
}
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';

    // コードブロック/前後の文字を許容してJSONを抽出
    const jsonText = (() => {
      const m = raw.match(/\{[\s\S]*\}$/m);
      return m ? m[0] : raw;
    })();

    let parsed: any = {};
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // 最後の保険：JSONモードで再試行
      const again = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.2,
        messages: [
          { role: 'system', content: '前の回答を正しいJSONだけに整形して返して。' },
          { role: 'user', content: raw },
        ],
        response_format: { type: 'json_object' as const },
      });
      parsed = JSON.parse(again.choices?.[0]?.message?.content ?? '{}');
    }

    const strategySummary: string = parsed?.strategy?.summary ?? '';
    const cascade = Array.isArray(parsed?.departments) ? parsed.departments : [];

    // ====== 保存：strategy_data へ upsert ======
    // 会社単位があれば company_id で、無ければ user_id で互換 upsert
    const payload: any = {
      company_id: companyId ?? null,
      user_id: userId ?? null,
      strategySummary,
      editableCascadeResult: cascade,  // ツリー本体はここへ
      // 参考：必要ならフロントの入力も一緒に残せる
      thought,
      industry,
      revenue,
      employees,
      mission,
      vision: visionStatement,
      value,
      strength,
      weakness,
      opportunity,
      threat,
      story,
      updated_by: userId ?? null,
      updated_at: new Date().toISOString(),
    };

    const onConflict = companyId ? 'company_id' : 'user_id';

    const { error: upsertError } = await supabaseAdmin
      .from('strategy_data')
      .upsert([payload], { onConflict, returning: 'representation' } as any);

    if (upsertError) {
      console.error('❌ strategy_data upsert error:', upsertError);
      // 保存失敗でも、生成結果は返してフロントで扱えるようにする
    }

    return NextResponse.json({
      strategy: { summary: strategySummary },
      departments: cascade,
    });
  } catch (err) {
    console.error('❌ 生成エラー:', err);
    return NextResponse.json({ error: '戦略生成に失敗しました。' }, { status: 500 });
  }
}
