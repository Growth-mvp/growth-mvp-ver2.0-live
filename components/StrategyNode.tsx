// components/StrategyNode.tsx

interface Node {
  title: string
  children?: Node[]
}

interface Props {
  node: Node
  depth: number
}

export function StrategyNode({ node, depth }: Props) {
  return (
    <div className={`ml-${depth * 4} border-l pl-2 border-gray-300`}>
      <p className="font-semibold">{node.title}</p>
      {node.children && node.children.length > 0 && (
        <div className="ml-4 space-y-1">
          {node.children.map((child, idx) => (
            <StrategyNode key={idx} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}