'use client';

interface NoticeDisplayProps {
  notice: string | null | undefined;
}

export function NoticeDisplay({ notice }: NoticeDisplayProps) {
  if (!notice) {
    return null;
  }

  return (
    <div className="mb-6 text-sm p-3 rounded-xl border bg-emerald-50 text-emerald-800">
      {notice}
    </div>
  );
}
