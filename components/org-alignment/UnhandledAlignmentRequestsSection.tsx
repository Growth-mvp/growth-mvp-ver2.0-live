// /components/org-alignment/UnhandledAlignmentRequestsSection.tsx
'use client';

import { useEffect, useState } from 'react';
import { safeGetSession } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';

export interface AlignmentRequest {
  id: string;
  caseId: string;
  requestedBy: string;
  requesterName: string | null;
  requesterEmail: string | null;
  requestedAt: string;
  status: string;
  handledBy: string | null;
  handledAt: string | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  case: {
    id: string;
    situationText: string | null;
    counterpartyType: string | null;
    counterpartyDetail: string | null;
    visibilityMode: string | null;
    createdAt: string;
    createdBy: string | null;
    posterName: string | null;
    posterEmail: string | null;
  };
}

interface UnhandledAlignmentRequestsSectionProps {
  companyId: string;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '未対応', color: 'text-red-600' },
  reviewing: { label: '確認中', color: 'text-yellow-600' },
  scheduled: { label: 'すり合わせ設定済み', color: 'text-blue-600' },
  resolved: { label: '対応完了', color: 'text-green-600' },
  on_hold: { label: '保留', color: 'text-gray-600' },
};

const statusOptions = [
  { value: 'pending', label: '未対応' },
  { value: 'reviewing', label: '確認中' },
  { value: 'scheduled', label: 'すり合わせ設定済み' },
  { value: 'resolved', label: '対応完了' },
  { value: 'on_hold', label: '保留' },
];

export default function UnhandledAlignmentRequestsSection({
  companyId,
}: UnhandledAlignmentRequestsSectionProps) {
  const [requests, setRequests] = useState<AlignmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<Record<string, string>>({});
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchRequests();
  }, [companyId]);

  const fetchRequests = async () => {
    setLoading(true);
    setError('');

    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setError('ログインセッションが無効です。');
        setLoading(false);
        return;
      }

      const res = await fetch(
        `/api/org-alignment/admin/requests?companyId=${companyId}&status=pending`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
          },
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `API error: ${res.status}`);
      }

      const resData = await res.json();
      setRequests(resData.requests || []);

      // 初期化
      const initialStatuses: Record<string, string> = {};
      const initialNotes: Record<string, string> = {};
      (resData.requests || []).forEach((req: AlignmentRequest) => {
        initialStatuses[req.id] = req.status;
        initialNotes[req.id] = req.adminNote || '';
      });
      setUpdatingStatus(initialStatuses);
      setAdminNotes(initialNotes);
    } catch (err: any) {
      console.error('fetchRequests error:', err);
      setError(err.message || '依頼一覧の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (requestId: string, newStatus: string) => {
    setUpdatingRequestId(requestId);
    setError('');

    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setError('ログインセッションが無効です。');
        setUpdatingRequestId(null);
        return;
      }

      const res = await fetch(`/api/org-alignment/admin/requests/${requestId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          status: newStatus,
          adminNote: adminNotes[requestId] || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `API error: ${res.status}`);
      }

      // 一覧を再取得
      await fetchRequests();
      setUpdatingRequestId(null);
      setExpandedRequestId(null);
    } catch (err: any) {
      console.error('handleStatusChange error:', err);
      setError(err.message || 'ステータス更新に失敗しました。');
      setUpdatingRequestId(null);
    }
  };

  const formatDateTime = (dateString: string) => {
    try {
      return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(dateString));
    } catch {
      return dateString;
    }
  };

  const visibilityLabel: Record<string, string> = {
    anonymous: '匿名',
    manager_only: '管理者のみ',
    named: '名前付き',
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
        読み込み中...
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-950">
            未対応のすり合わせ依頼
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            メンバーから依頼されたすり合わせの状態を管理します。
          </p>
        </div>
        <div className="rounded-full bg-red-50 px-4 py-2 text-center">
          <p className="text-xs font-semibold text-red-600">未対応</p>
          <p className="text-2xl font-bold text-red-600">{requests.length}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          未対応のすり合わせ依頼はありません
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => {
            const isExpanded = expandedRequestId === request.id;
            const isUpdating = updatingRequestId === request.id;

            return (
              <div
                key={request.id}
                className="rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                {/* ===== リスト表示 ===== */}
                <div
                  className="cursor-pointer p-4 hover:bg-slate-50"
                  onClick={() =>
                    setExpandedRequestId(isExpanded ? null : request.id)
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={`text-xs font-semibold ${
                            statusLabels[request.status]?.color || 'text-gray-600'
                          }`}
                        >
                          {statusLabels[request.status]?.label || request.status}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          {visibilityLabel[request.case.visibilityMode] ||
                            request.case.visibilityMode}
                        </span>
                      </div>

                      <h3 className="text-sm font-semibold text-slate-950">
                        {request.case.situationText?.substring(0, 80) || '（テキストなし）'}
                        {request.case.situationText && request.case.situationText.length > 80
                          ? '...'
                          : ''}
                      </h3>

                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
                        <span>
                          対象:{' '}
                          {request.case.counterpartyType ||
                            '（未設定）'}
                        </span>
                        <span>
                          投稿者:{' '}
                          {request.case.posterName || '（匿名）'}
                        </span>
                        <span>
                          依頼日: {formatDateTime(request.requestedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <svg
                        className={`h-5 w-5 text-slate-400 transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 14l-7 7m0 0l-7-7m7 7V3"
                        />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* ===== 展開時の詳細 ===== */}
                {isExpanded && (
                  <div className="border-t border-slate-200 p-4 space-y-4">
                    {/* 依頼内容 */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500">
                        状況・違和感
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">
                        {request.case.situationText}
                      </p>
                    </div>

                    {/* ステータス変更 */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500">
                        ステータス
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {statusOptions.map((option) => (
                          <button
                            key={option.value}
                            onClick={() =>
                              handleStatusChange(request.id, option.value)
                            }
                            disabled={isUpdating}
                            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                              updatingStatus[request.id] === option.value
                                ? 'bg-slate-900 text-white'
                                : 'border border-slate-300 text-slate-700 hover:bg-slate-100'
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 管理者メモ */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500">
                        管理者メモ
                      </p>
                      <textarea
                        value={adminNotes[request.id] || ''}
                        onChange={(e) =>
                          setAdminNotes({
                            ...adminNotes,
                            [request.id]: e.target.value,
                          })
                        }
                        className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="対応内容などのメモを記入してください"
                        rows={3}
                      />
                    </div>

                    {/* 情報表示 */}
                    <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                      <p>
                        <span className="font-semibold">依頼者:</span>{' '}
                        {request.requesterName || request.requesterEmail || '不明'}
                      </p>
                      <p>
                        <span className="font-semibold">対象部門:</span>{' '}
                        {request.case.counterpartyType || '未設定'}
                      </p>
                      <p>
                        <span className="font-semibold">共有範囲:</span>{' '}
                        {visibilityLabel[request.case.visibilityMode] ||
                          request.case.visibilityMode}
                      </p>
                      <p>
                        <span className="font-semibold">依頼日時:</span>{' '}
                        {formatDateTime(request.requestedAt)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
