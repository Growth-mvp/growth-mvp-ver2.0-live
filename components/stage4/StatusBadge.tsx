// components/stage4/StatusBadge.tsx
import React from 'react';
import { CheckCircle2, AlertCircle, Clock } from 'lucide-react';

export type Status = 'Draft' | 'Review' | 'Approved';

type StatusBadgeProps = {
  status: Status;
  className?: string;
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const configs: Record<Status, { label: string; icon: React.ReactNode; bg: string; text: string }> = {
    Draft: {
      label: '下書き',
      icon: <Clock className="w-3.5 h-3.5" />,
      bg: 'bg-gray-100',
      text: 'text-gray-700',
    },
    Review: {
      label: 'レビュー中',
      icon: <AlertCircle className="w-3.5 h-3.5" />,
      bg: 'bg-yellow-100',
      text: 'text-yellow-800',
    },
    Approved: {
      label: '承認済み',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      bg: 'bg-green-100',
      text: 'text-green-800',
    },
  };

  const config = configs[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text} ${className}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

type StatusSelectProps = {
  value: Status;
  onChange: (status: Status) => void;
  disabled?: boolean;
};

export function StatusSelect({ value, onChange, disabled }: StatusSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Status)}
      disabled={disabled}
      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <option value="Draft">下書き</option>
      <option value="Review">レビュー中</option>
      <option value="Approved">承認済み</option>
    </select>
  );
}
