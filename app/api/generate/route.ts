// app/api/generate/route.ts
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json()

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    })

    const text = response.choices[0]?.message?.content || 'ストーリー生成に失敗しました。'
    return NextResponse.json({ result: text })
  } catch (error) {
    console.error('ストーリー生成エラー:', error)
    return NextResponse.json({ result: 'エラーが発生しました。' }, { status: 500 })
  }
}
