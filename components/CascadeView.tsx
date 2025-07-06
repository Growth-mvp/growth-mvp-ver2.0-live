type Props = {
  cascade: any[]
}

export function CascadeView({ cascade }: Props) {
  if (!cascade.length) {
    return <div>戦略のカスケードを表示するエリアです。</div>
  }

  return (
    <ul className="list-disc pl-5">
      {cascade.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}
