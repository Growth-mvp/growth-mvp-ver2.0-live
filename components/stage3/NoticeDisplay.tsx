'use client';

interface NoticeDisplayProps {
  notice: string | null | undefined;
}

export function NoticeDisplay({ notice }: NoticeDisplayProps) {
  if (!notice) {
    return null;
  }

  return (
    <div className="mb-6 text-sm p-3 rounded-xl border border-success/30 bg-success-soft text-success">
      {notice}
    </div>
  );
}
