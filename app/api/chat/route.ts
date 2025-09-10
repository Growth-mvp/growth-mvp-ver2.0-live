import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { prompt } = await req.json()

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OpenAI APIキーが未設定です。' }, { status: 500 })
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'あなたは経営戦略に詳しいAIアシスタントです。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
      }),
    })

    const data = await response.json()
    const result = data.choices?.[0]?.message?.content ?? '回答が得られませんでした。'
    return NextResponse.json({ result })
  } catch (error) {
    console.error('APIエラー:', error)
    return NextResponse.json({ error: 'API呼び出しに失敗しました。' }, { status: 500 })
  }
}
