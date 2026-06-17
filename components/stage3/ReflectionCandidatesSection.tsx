'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { safeGetSession } from '@/utils/supabase/client';
import type { Project, Department } from '@/types/strategy';

export type ReflectionCandidate = {
  id: string;
  shared_topic_id: string;
  target_department?: string;
  title: string;
  summary?: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
};

interface ReflectionCandidatesSectionProps {
  onDelete?: (candidateId: string) => void;
}

export function ReflectionCandidatesSection({
  onDelete,
}: ReflectionCandidatesSectionProps) {
  const [candidates, setCandidates] = useState<ReflectionCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchCandidates();
  }, []);

  const fetchCandidates = async () => {
    setLoading(true);
    setError('');
    try {
      console.log('[STAGE3 ReflectionCandidatesSection] fetchCandidates called');
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        console.warn('[STAGE3] Not authenticated');
        setCandidates([]);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/org-alignment/shared/reflection-candidates?target_stage=stage3', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionData.session.access_token}`,
        },
      });
      if (!res.ok) {
        console.warn('[STAGE3] Failed to fetch reflection candidates:', res.status);
        setCandidates([]);
        return;
      }
      const data = await res.json();
      console.log('[STAGE3] API response:', data);
      const filtered = (data.candidates || []).filter((c: ReflectionCandidate) => c.status === 'pending');
      console.log('[STAGE3] Filtered pending candidates:', filtered.length);
      setCandidates(filtered);
    } catch (err) {
      console.error('[STAGE3] fetchCandidates error:', err);
      setError('反映候補の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCandidate = async (candidateId: string) => {
    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setError('ログインしてください。');
        return;
      }

      const res = await fetch('/api/org-alignment/shared/reflection-candidates', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ id: candidateId, status: 'rejected' }),
      });

      if (res.ok) {
        setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
        onDelete?.(candidateId);
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('Delete failed:', res.status, errorData);
        setError(`削除処理に失敗しました (${res.status}): ${errorData.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('handleDeleteCandidate error:', err);
      setError(`削除処理に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-950">
            組織変革ルームからの反映候補
          </h3>
          <p className="mt-1 text-xs text-gray-600">
            この内容を参考に、必要に応じてプロジェクト・KPIを追加してください。
          </p>
        </div>
        <div className="shrink-0 ml-4">
          {expanded ? (
            <ChevronUp className="h-5 w-5 text-gray-600" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-600" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {loading ? (
            <p className="text-sm text-gray-600">読み込み中...</p>
          ) : (
            candidates.map((candidate) => (
              <div key={candidate.id} className="rounded-xl bg-white p-4 border border-gray-200">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-gray-700">
                      プロジェクト・KPIへの反映候補
                    </p>
                    {candidate.target_department && (
                      <p className="mt-1 text-xs text-gray-600">
                        対象部門：{candidate.target_department}
                      </p>
                    )}
                    <p className="mt-2 font-semibold text-slate-950">
                      {candidate.title}
                    </p>
                    {candidate.summary && (
                      <p className="mt-1 text-sm text-gray-700">
                        {candidate.summary}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleDeleteCandidate(candidate.id)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    この候補を削除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
