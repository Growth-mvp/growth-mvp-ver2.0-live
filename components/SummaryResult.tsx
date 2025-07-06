type Props = {
  summary: string
}

export function SummaryResult({ summary }: Props) {
  return (
    <div>
      <h2 className="font-semibold mb-2">要約結果</h2>
      <div className="whitespace-pre-wrap bg-gray-50 p-3 rounded min-h-[200px]">
        {summary || 'ここに要約が表示されます。'}
      </div>
    </div>
  )
}
