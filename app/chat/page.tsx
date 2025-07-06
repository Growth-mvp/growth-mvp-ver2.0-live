'use client'

import { useState } from 'react'
import { useStrategyStore } from '@/store/strategyStore'

export default function ChatWithAIPage() {
  const {
    vision,
    industry,
    revenueRange,
    employeeRange,
    swot,
  } = useStrategyStore()

  const [chatInput, setChatInput] = useState('')
  const [chatResponse, setChatResponse] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  const handleChatWithAI = async () => {
    if (!chatInput.trim()) return
    setChatLoading(true)
    try {
      const prompt = generatePrompt({
        vision,
        industry,
        revenueRange,
        employeeRange,
        swot,
        question: chatInput,
      })

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await response.json()
      setChatResponse(data.result || 'AI応答が取得できませんでした')
    } catch (e) {
      setChatResponse('エラーが発生しました')
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="flex max-w-7xl mx-auto">
      <main className="w-2/3 pr-6">
        <h2 className="text-2xl font-bold">AIに聞く：社長の考え</h2>
        <p className="text-sm text-gray-600 mb-4">
          経営戦略に関して、社長の代わりにAIが優しく回答します。
        </p>

        <textarea
          className="w-full border p-2 rounded mb-2"
          rows={3}
          placeholder="社長に聞きたいことを入力してください"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
            onClick={handleChatWithAI}
            disabled={chatLoading}
          >
            {chatLoading ? '送信中...' : '質問する'}
          </button>
          <button
            className="bg-gray-300 px-3 py-1 rounded hover:bg-gray-400"
            onClick={() => {
              setChatInput('')
              setChatResponse('')
            }}
          >
            リセット
          </button>
        </div>
        {chatResponse && (
          <div className="mt-4 bg-gray-100 p-3 rounded text-sm whitespace-pre-wrap">
            {chatResponse}
          </div>
        )}
      </main>

      <aside className="w-1/3 bg-gray-50 p-4 border-l">
        <h3 className="font-semibold mb-2">経営者AIボット</h3>
        <p className="text-sm text-gray-600">
          あなたの質問に対して、社長の意図や戦略方針に基づいてAIが即座に回答します。
        </p>
        <p className="text-xs text-gray-400 mt-4">
          ※特定の人物・未公開情報・法務関連には答えられません。
        </p>
      </aside>
    </div>
  )
}

function generatePrompt({
  vision,
  industry,
  revenueRange,
  employeeRange,
  swot,
  question,
}: {
  vision: string
  industry: string
  revenueRange: string
  employeeRange: string
  swot: { strength: string; weakness: string; opportunity: string; threat: string }
  question: string
}) {
  return `
あなたは「社長の考えを補助的に伝えるAI」です。以下の経営情報に基づいて、社員からの質問に優しく簡潔に答えてください。

【経営戦略の想い】${vision}
【業種】${industry}
【売上】${revenueRange}
【社員数】${employeeRange}
【SWOT】
- 強み: ${swot.strength}
- 弱み: ${swot.weakness}
- 機会: ${swot.opportunity}
- 脅威: ${swot.threat}

ただし、次のような質問には絶対に答えないでください：
・特定の人物や処遇（昇進・評価など）に関する質問
・未公開の財務・投資情報
・法務・契約・リスクに関する情報

不適切な質問と判断した場合は以下のように答えてください：
「申し訳ありません。その質問にはお答えできませんが、何か他にお力になれることがあればお聞かせください。」

質問: ${question}
  `
}
