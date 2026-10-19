'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  canGeneratePlan,
  isUnsaved,
  markdownFileName,
  scopeKey,
  toPlanDocument,
  visibleDocument,
  type GenerateResponseBody,
  type PlanAudience,
  type PlanDocument,
  type PlanRole,
  type PlanScope,
} from '@/lib/plans/planDocumentState';
import { GenerationController } from '@/lib/plans/generationController';
import { supabase } from '@/utils/supabase/client';

type PlanTarget = {
  companyId: string | null | undefined;
  strategyId: string | null | undefined;
  audience: PlanAudience;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) {
    throw new Error('認証トークンが見つかりません。再度ログインしてください。');
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * 経営計画書の保存済み取得・生成・未保存時の操作を一括で扱う。
 *
 * 会社・戦略・audience の組み合わせをキーにし、キーが変わった時点で表示中の計画書を外す。
 * 非同期応答はリクエスト時のキーと現在のキーを照合し、一致しない結果は捨てる。
 */
export function usePlanDocument(target: PlanTarget, role: PlanRole) {
  const { companyId, strategyId, audience } = target;

  const scope: PlanScope | null = useMemo(() => {
    if (!companyId || !strategyId) return null;
    if (!UUID_PATTERN.test(companyId) || !UUID_PATTERN.test(strategyId)) return null;
    return { companyId, strategyId, audience };
  }, [companyId, strategyId, audience]);

  const key = scope ? scopeKey(scope) : '';

  const [stored, setStored] = useState<PlanDocument | null>(null);
  const [isRestoring, setIsRestoring] = useState(scope !== null);
  const [generation] = useState(() => new GenerationController());
  const [generating, setGenerating] = useState<{ key: string; token: number } | null>(null);
  const isGenerating = generating !== null && generating.key === key;
  const [error, setError] = useState<string | null>(null);

  const activeKey = useRef(key);
  useEffect(() => {
    activeKey.current = key;
  }, [key]);

  const doc = visibleDocument(stored, key);
  const hasUnsaved = isUnsaved(doc);
  const canGenerate = canGeneratePlan(role) && scope !== null;

  // 会社・戦略が変わったら、進行中の生成を無効にして生成中の表示を解除する
  useEffect(() => {
    generation.scopeChanged();
    setGenerating(null);
  }, [generation, key]);

  // 保存済み計画書の復元（会社・戦略・audience が変わるたびに再取得）
  useEffect(() => {
    setStored(null);
    setError(null);
    if (!scope) {
      setIsRestoring(false);
      return;
    }

    const requestKey = key;
    const controller = new AbortController();
    setIsRestoring(true);

    (async () => {
      try {
        const response = await fetch(`/api/plans/${scope.audience}/saved`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(scope),
          signal: controller.signal,
        });
        if (activeKey.current !== requestKey) return;

        if (response.status === 404) {
          setStored(null);
          return;
        }
        if (!response.ok) {
          throw new Error(`保存済みの計画書を読み込めませんでした（${response.status}）`);
        }
        const body = (await response.json()) as GenerateResponseBody;
        setStored(toPlanDocument(scope, { ...body, status: 'saved', saveReason: null }));
      } catch (err) {
        if (controller.signal.aborted || activeKey.current !== requestKey) return;
        setError(err instanceof Error ? err.message : '保存済みの計画書を読み込めませんでした。');
      } finally {
        if (activeKey.current === requestKey && !controller.signal.aborted) {
          setIsRestoring(false);
        }
      }
    })();

    return () => controller.abort();
    // scope は key から一意に決まるため key のみで再実行する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const generate = useCallback(async () => {
    if (!scope || !canGenerate) return;

    // 切替後の結果を画面に出さないため、応答はトークンで照合する（キーだけでは切り替え往復を防げない）
    const token = generation.start(key);
    if (token === null) return;
    setGenerating({ key, token });
    setError(null);
    try {
      const response = await fetch(`/api/plans/${scope.audience}/generate`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ companyId: scope.companyId, strategyId: scope.strategyId }),
      });
      if (!generation.isCurrent(token)) return;

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || `生成に失敗しました（${response.status}）`);
      }
      const body = (await response.json()) as GenerateResponseBody;
      setStored(toPlanDocument(scope, body));
    } catch (err) {
      if (!generation.isCurrent(token)) return;
      setError(err instanceof Error ? err.message : '計画書の生成に失敗しました。');
    } finally {
      // 無効になった旧リクエストは、新しい会社の生成中状態に触れない
      generation.finish(token);
      setGenerating((current) => (current !== null && current.token === token ? null : current));
    }
  }, [scope, key, canGenerate, generation]);

  // 未保存の本文がある間は、ページの再読み込み・閉じる操作で警告する
  useEffect(() => {
    if (!hasUnsaved) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    // アプリ内のリンク遷移を確認する（ダウンロード用のリンクは除外）
    const onClickCapture = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]');
      if (!anchor || anchor.hasAttribute('download')) return;
      const proceed = window.confirm(
        'この計画書は未保存です。画面を離れると本文は失われます。移動しますか？'
      );
      if (!proceed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [hasUnsaved]);

  const copyText = useCallback(async (): Promise<boolean> => {
    if (!doc) return false;
    try {
      await navigator.clipboard.writeText(doc.generatedText);
      return true;
    } catch {
      return false;
    }
  }, [doc]);

  const downloadMarkdown = useCallback(() => {
    if (!doc || !scope) return;
    const blob = new Blob([doc.generatedText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = markdownFileName(scope.audience, doc.generatedAt);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [doc, scope]);

  return {
    doc,
    hasUnsaved,
    isRestoring,
    isGenerating,
    error,
    canGenerate,
    generate,
    copyText,
    downloadMarkdown,
  };
}
