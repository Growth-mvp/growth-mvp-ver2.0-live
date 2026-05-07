'use client'

import { AutoResizeTextarea } from '@/components/ui/AutoResizeTextarea'

type Props = {
  inputText: string
  setInputText: (text: string) => void
  onGenerate: () => void
  loading: boolean
}

export function StrategyInput({ inputText, setInputText, onGenerate, loading }: Props) {
  return (
    <div className="flex flex-col h-full">
      <label className="mb-2 font-semibold">経営戦略の入力</label>
      <AutoResizeTextarea
        className="flex-grow border border-gray-300 rounded p-2"
        value={inputText}
        onChange={e => setInputText(e.target.value)}
        placeholder="ここに経営戦略やSWOT分析を書いてください..."
        minRows={4}
        maxRows={12}
      />
      <button
        className="mt-4 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        onClick={onGenerate}
        disabled={loading || inputText.trim() === ''}
      >
        {loading ? '生成中...' : '要約＆カスケード展開'}
      </button>
    </div>
  )
}
