import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { supabase } from '@/utils/supabase';
import { StrategyData, ChapterStory, Department } from '@/types/strategy';

type Role = 'user' | 'assistant' | 'system';

interface Message {
  role: Role;
  content: string;
}

interface RequestBody {
  messages: Message[];
  userId: string;
  strategyId: string;
}

function formatChapters(chapters: ChapterStory[] = []) {
  return chapters.map((ch, i) => `【第${i + 1}章：${ch.title}】\n${ch.body}`).join('\n\n');
}

function formatDepartments(departments: Department[] = []) {
  return departments.map((dept) => {
    const projText = dept.projects?.map((proj) => {
      const okr = proj.okrs?.[0];
      return `  - プロジェクト: ${proj.title}
    - Objective: ${okr?.objective || '（未設定）'}
    - KeyResults: ${okr?.keyResults || '（未設定）'}
    - Owner: ${okr?.owner || '（未設定）'}`;
    }).join('\n') || '  - プロジェクトなし';

    return `■部門: ${dept.name}
・ミッション: ${dept.mission || '（未設定）'}
${projText}`;
  }).join('\n\n');
}

export async function POST(req: Request) {
  try {
    const body: RequestBody = await req.json();
    const { messages, userId, strategyId } = body;

    console.log('✅ APIリクエスト受信:', { userId, strategyId, messageCount: messages.length });

    if (
      !Array.isArray(messages) ||
      !messages.every((m) => typeof m.role === 'string' && typeof m.content === 'string')
    ) {
      console.warn('❌ メッセージ形式エラー:', messages);
      return NextResponse.json({ error: '無効なメッセージ形式です。' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('strategy_data')
      .select('*')
      .eq('user_id', userId)
      .eq('id', strategyId)
      .single();

    if (error) {
      console.error('❌ Supabase取得エラー:', error);
    } else {
      console.log('✅ Supabaseデータ取得成功');
    }

    const strategy: StrategyData | null = data ?? null;

    const statusLines: string[] = [];
    const adviceLines: string[] = [];

    if (!strategy) {
      statusLines.push('⚠️ 戦略データが取得できませんでした。');
      adviceLines.push('ログインや保存状態をご確認ください。');
    } else {
      if (!strategy.mission || !strategy.vision || !strategy.value) {
        statusLines.push('・MVV（Mission, Vision, Value）が未入力');
        adviceLines.push('企業としての方向性・価値観を明確にしましょう。');
      } else {
        statusLines.push('・MVVは入力済み');
      }

      if (!strategy.story || (Array.isArray(strategy.story) && strategy.story.length === 0)) {
        statusLines.push('・戦略ストーリーが未作成');
        adviceLines.push('MVVやSWOTをもとに、戦略ストーリーを構築してください。');
      } else {
        statusLines.push('・戦略ストーリーは作成済み');
      }

      if (!strategy.editableCascadeResult?.length) {
        statusLines.push('・部門戦略が未設定');
        adviceLines.push('全社戦略を部門ごとに分解して、役割を明確にしましょう。');
      } else {
        statusLines.push('・部門戦略は設定済み');
      }

      const hasOKRs = strategy.editableCascadeResult?.some((d) =>
        d.projects?.some((p) => p.okrs?.length)
      );
      if (!hasOKRs) {
        statusLines.push('・OKRが未設定');
        adviceLines.push('プロジェクトの目的を明確にするOKRを設定しましょう。');
      } else {
        statusLines.push('・OKRは設定済み');
      }
    }

    // 🔍 ユーザーの直近入力とスニペット生成
    const userMessagesOnly = messages.filter((m) => m.role === 'user');
    const userInput = userMessagesOnly.at(-1)?.content ?? '';

    const contextSnippet = `
【経営戦略の想い】${strategy?.vision || ''}
【業種】${strategy?.industry || ''}
【売上】${strategy?.revenue || ''}
【社員数】${strategy?.employees || ''}
【SWOT】
- 強み: ${strategy?.strength || ''}
- 弱み: ${strategy?.weakness || ''}
- 機会: ${strategy?.opportunity || ''}
- 脅威: ${strategy?.threat || ''}
    `.trim();

    console.log('📋 戦略ステータス:\n', statusLines.join('\n'));

    const systemMessage: Message = {
      role: 'system',
      content: `
あなたは「GROWTH」という戦略実行プラットフォームのAIエージェントです。
ユーザーは中堅企業の経営者であり、あなたの役割は以下です：
- ユーザーの状況に応じて、次のステップを優しく促すこと
- MVV・ストーリー・部門戦略・OKRの一貫性を支援すること
- 専門用語は使わず、温かく前向きにアドバイスをすること

【現在の戦略ステータス】
${statusLines.join('\n')}

【経営戦略の内容】
■MVV
- Mission: ${strategy?.mission || '（未入力）'}
- Vision: ${strategy?.vision || '（未入力）'}
- Value: ${strategy?.value || '（未入力）'}

■基本情報
- 事業内容: ${strategy?.businessContent || '（未入力）'}
- 顧客セグメント: ${strategy?.customerSegment || '（未入力）'}
- 業種: ${strategy?.industry || '（未入力）'}
- 売上: ${strategy?.revenue || '（未入力）'}
- 従業員数: ${strategy?.employees || '（未入力）'}

■SWOT
- 強み: ${strategy?.strength || '（未入力）'}
- 弱み: ${strategy?.weakness || '（未入力）'}
- 機会: ${strategy?.opportunity || '（未入力）'}
- 脅威: ${strategy?.threat || '（未入力）'}

■ストーリー要約
${strategy?.strategySummary || '（未入力）'}

■最終ストーリー（各章）
${formatChapters(strategy?.finalStory || [])}

■部門戦略とOKR
${formatDepartments(strategy?.editableCascadeResult || [])}

【アドバイスのヒント】
${adviceLines.join('\n')}

【直近の戦略文脈（スニペット）】
${contextSnippet}

※以下は禁止事項です：
- 評価・昇進・報酬など人事的な判断
- 法務・税務・労務・会計など専門的助言

ユーザーが自然に前向きな行動に進めるよう、あなたは「信頼できる戦略コーチ」として振る舞ってください。
      `.trim(),
    };

    // 初回アクセスは挨拶のみ返す
    if (userMessagesOnly.length === 0) {
      console.log('ℹ️ 初回アクセスのため挨拶メッセージを返します。');
      return NextResponse.json({
        content: `こんにちは。私はあなたの経営戦略実行を支援するAIエージェントです。\n\n戦略の整理や、実行へのヒントが必要なときは、いつでもお声がけください。`,
      });
    }

    console.log('🧠 OpenAI API 呼び出し開始');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [systemMessage, ...messages],
      temperature: 0.7,
    });

    const content = completion.choices?.[0]?.message?.content;

    if (!content) {
      console.error('❌ OpenAI応答なし');
      return NextResponse.json(
        { error: 'AIエージェントが応答できませんでした。' },
        { status: 500 }
      );
    }

    console.log('✅ OpenAI 応答取得成功');
    return NextResponse.json({ content });
  } catch (e) {
    console.error('❌ ask-ceo-agent エラー:', e);
    return NextResponse.json(
      { error: 'OpenAI APIでエラーが発生しました。' },
      { status: 500 }
    );
  }
}
