'use client';

interface EmptyPyramidMessageProps {
  isHydrating: boolean;
}

export function EmptyPyramidMessage({ isHydrating }: EmptyPyramidMessageProps) {
  if (isHydrating) {
    return null;
  }

  return <div className="text-sm text-gray-600">部門がありません。</div>;
}
