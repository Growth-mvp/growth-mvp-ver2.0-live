'use client';

interface EmptyExecutionMessageProps {
  isHydrating: boolean;
}

export function EmptyExecutionMessage({ isHydrating }: EmptyExecutionMessageProps) {
  if (isHydrating) {
    return null;
  }

  return <div className="text-sm text-gray-600">表示できる実行計画がありません。</div>;
}
