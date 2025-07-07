import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 📦 受信データの確認ログ
    console.log('📩 受信したbody:', body);

    const {
      thought,
      industry,
      revenue,
      employees,
      mission,
      visionStatement,
      value,
      strength,
      weakness,
      opportunity,
      threat,
    } = body;

    // 入力チェック（4つは必須）
    if (!thought || !industry || !revenue || !employees) {
      console.warn('⚠️ 入力不足: 必須項目が足りません');
      return NextResponse.json(
        { error: '必要な情報が不足しています。' },
        { status: 400 }
      );
    }

    const prompt = [
      'あなたは経営コンサルタントです。',
      '',
      '以下の経営情報をもとに、社員に伝えるべき「戦略ストーリー（4段構成）」を作成してください。',
      '',
      `【経営者の思い】${thought}`,
      `【業種】${industry}`,
      `【売上】${revenue}`,
      `【従業員数】${employees}`,
      `【ミッション】${mission || '（未入力）'}`,
      `【ビジョン】${visionStatement || '（未入力）'}`,
      `【バリュー】${value || '（未入力）'}`,
      '【SWOT】',
      `- 強み: ${strength || '（未入力）'}`,
      `- 弱み: ${weakness || '（未入力）'}`,
      `- 機会: ${opportunity || '（未入力）'}`,
      `- 脅威: ${threat || '（未入力）'}`,
      '',
      '構成は以下としてください：',
      '### ① 現状の危機や背景（なぜ今、変革が必要なのか）',
      '### ② 経営者が描く未来の方向性（どこを目指すのか）',
      '### ③ SWOTに基づいた戦略的な選択（強み×機会などのクロス分析を含む）',
      '### ④ 社員に求める行動や期待（自分ごととして捉えてもらう）',
      '',
      '社員が感情的にも納得・共感し、自分の役割を理解できるようなストーリーにしてください。'
    ].join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    console.log('🧠 OpenAI APIレスポンス:', response);

    const storyText = response.choices?.[0]?.message?.content;

    if (!storyText) {
      console.error('❌ OpenAIからストーリーが返されませんでした');
      return NextResponse.json(
        { error: 'OpenAIからの返答がありませんでした。' },
        { status: 500 }
      );
    }

    return NextResponse.json({ story: storyText });
  } catch (error: any) {
    console.error('❌ 戦略ストーリー生成エラー:', error?.message || error);
    return NextResponse.json(
      { error: '戦略ストーリー生成に失敗しました' },
      { status: 500 }
    );
  }
}
