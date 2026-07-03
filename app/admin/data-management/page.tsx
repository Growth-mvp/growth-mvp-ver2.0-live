'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { useAccess } from '@/utils/access';
import { AlertCircle, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';

/**
 * AdminDataManagement
 *
 * 管理画面 > データ管理
 * 保存操作に関する危険な操作を集約：
 * - 最新データ読み込み（サーバーから再取得）
 * - データ初期化
 * - 全削除（会社名入力必須の2段階確認）
 */
export default function AdminDataManagementPage() {
  const router = useRouter();
  const { canEditCompany } = useAccess();

  // Store states
  const isDirty = useStrategyStore((s: StrategyState) => s.dirty);
  const companyName = useStrategyStore((s: StrategyState) => s.companyName);
  const companyId = useUserStore((s) => s.companyId);

  // Local states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 再取得モーダル
  const [showRefetchConfirm, setShowRefetchConfirm] = useState(false);

  // 全削除モーダル
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteCompanyNameInput, setDeleteCompanyNameInput] = useState('');
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);

  // 権限チェック
  const canManage = canEditCompany();

  const handleRefetch = async () => {
    if (!canManage) {
      setError('権限がありません');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await useStrategyStore.getState().refetchFromServer();
      setSuccess('最新データを読み込みました');
      setShowRefetchConfirm(false);
      // 3秒後にメッセージを消す
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラーが発生しました';
      setError(`読み込みに失敗しました: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!canManage) {
      setError('権限がありません');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      useStrategyStore.getState().resetAll();
      setSuccess('データを初期化しました');
      // 3秒後にメッセージを消す
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラーが発生しました';
      setError(`初期化に失敗しました: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!canManage) {
      setError('権限がありません');
      return;
    }

    if (deleteStep === 1) {
      // Step 1: 会社名入力確認
      if (deleteCompanyNameInput !== companyName) {
        setError('会社名が一致しません');
        return;
      }
      // Step 2へ進む
      setDeleteStep(2);
      setError(null);
      return;
    }

    // Step 2: 最終確認後の削除実行
    console.log('[AdminDataManagement] confirm modal submitted - proceeding to delete');
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      console.log('[AdminDataManagement] ===== DELETE START =====');
      console.log('[AdminDataManagement] Current store state:', {
        companyId: useStrategyStore.getState().companyId,
        finalStoryLength: (useStrategyStore.getState().finalStory ?? []).length,
        answers2Length: (useStrategyStore.getState().answers2 ?? []).length,
      });

      console.log('[AdminDataManagement] calling deleteAllOnServer', {
        companyId: useStrategyStore.getState().companyId,
      });
      await useStrategyStore.getState().deleteAllOnServer();
      console.log('[AdminDataManagement] deleteAllOnServer completed');

      // ローカルストレージをクリア（__deleting_company__ は保持）
      try {
        console.log('[AdminDataManagement] Clearing localStorage...');
        const DELETION_FLAG_KEY = '__deleting_company__';

        // 具体的なキーを削除
        localStorage.removeItem('strategy-store-v5');
        localStorage.removeItem('stage1-snapshot');
        localStorage.removeItem('stage2-snapshot');
        localStorage.removeItem('strategy-persist');

        // その他キャッシュキー（削除フラグは除外）
        Object.keys(localStorage).forEach((key) => {
          // ★ 削除フラグは保持（60秒間autosave抑止のため）
          if (key === DELETION_FLAG_KEY) {
            console.log('[AdminDataManagement] Skipping deletion flag key', { key });
            return;
          }

          if (
            key.includes('strategy') ||
            key.includes('stage') ||
            key.includes('company') ||
            key.includes('store')
          ) {
            localStorage.removeItem(key);
          }
        });
        console.log('[AdminDataManagement] localStorage cleared (deletion flag preserved)');
        console.log('[AdminDataManagement] Deletion flag current value:', {
          flag: localStorage.getItem(DELETION_FLAG_KEY) ? 'set' : 'null',
        });
      } catch (e) {
        console.warn('[AdminDataManagement] localStorage cleanup warn:', e);
      }

      console.log('[AdminDataManagement] Store state after reset:', {
        companyId: useStrategyStore.getState().companyId,
        finalStoryLength: (useStrategyStore.getState().finalStory ?? []).length,
        answers2Length: (useStrategyStore.getState().answers2 ?? []).length,
      });

      setSuccess('すべてのデータを削除しました');
      setShowDeleteConfirm(false);
      setDeleteStep(1);
      setDeleteCompanyNameInput('');

      // 削除後、ページをリロードしてキャッシュをクリア
      console.log('[AdminDataManagement] Reloading page...');
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラーが発生しました';
      console.error('[AdminDataManagement] Delete error:', {
        message,
        error: err,
      });
      // ★ 修正：エラーメッセージにより詳しい情報を含める
      let errorDisplay = `削除に失敗しました: ${message}`;
      if (err instanceof Error && err.message.includes('detail')) {
        // detail の詳細情報をパース して表示
        errorDisplay += '\n\n詳細: ' + message;
      }
      setError(errorDisplay);
      setDeleteStep(1);
      setDeleteCompanyNameInput('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* ヘッダー */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">データ管理</h1>
          <p className="text-gray-600 mt-2">サーバーとのデータ同期・初期化・削除操作</p>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-900">{error}</p>
          </div>
        )}

        {/* 成功表示 */}
        {success && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3">
            <RefreshCw className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-900">{success}</p>
          </div>
        )}

        {/* セクション1: 最新データ読み込み */}
        <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <div className="flex items-start gap-3">
            <RefreshCw className="w-6 h-6 text-blue-600 shrink-0 mt-1" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">最新データ読み込み</h2>
              <p className="text-sm text-gray-600 mt-1">
                サーバーから最新のデータを読み込みます。ローカルの未保存変更は失われます。
              </p>
            </div>
          </div>

          {isDirty && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-900">
                未保存の変更があります。読み込むと失われます。
              </p>
            </div>
          )}

          <button
            onClick={() => setShowRefetchConfirm(true)}
            disabled={loading || !canManage}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <RefreshCw className="w-4 h-4" />
            最新データを読み込む
          </button>
        </section>

        {/* セクション2: データ初期化 */}
        <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <div className="flex items-start gap-3">
            <RotateCcw className="w-6 h-6 text-orange-600 shrink-0 mt-1" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">データ初期化</h2>
              <p className="text-sm text-gray-600 mt-1">
                ローカルデータをリセットします。サーバーのデータは変更されません。
              </p>
            </div>
          </div>

          <button
            onClick={handleReset}
            disabled={loading || !canManage}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <RotateCcw className="w-4 h-4" />
            ローカルデータを初期化
          </button>
        </section>

        {/* セクション3: 全削除 */}
        <section className="bg-rose-50 border border-rose-200 rounded-lg p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-rose-600 shrink-0 mt-1" />
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-rose-900">全削除</h2>
              <p className="text-sm text-rose-800 mt-1">
                サーバーのすべてのデータを削除します。この操作は取り消せません。
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              console.log('[AdminDataManagement] delete button clicked', { canManage, companyId });
              setShowDeleteConfirm(true);
              setDeleteStep(1);
              setDeleteCompanyNameInput('');
              setError(null);
            }}
            disabled={loading || !canManage}
            className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <Trash2 className="w-4 h-4" />
            すべてのデータを削除
          </button>
        </section>
      </div>

      {/* 再取得確認モーダル */}
      {showRefetchConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">最新データを読み込みますか？</h3>

            {isDirty && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-900">
                  未保存の変更はすべて失われます。
                </p>
              </div>
            )}

            <p className="text-sm text-gray-600">
              サーバーから最新のデータを読み込みます。
            </p>

            <div className="flex gap-3 justify-end pt-4">
              <button
                onClick={() => setShowRefetchConfirm(false)}
                disabled={loading}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
              >
                キャンセル
              </button>
              <button
                onClick={handleRefetch}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {loading ? '読み込み中...' : '読み込む'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全削除確認モーダル */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            {deleteStep === 1 ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900">
                  会社名を入力して確認してください
                </h3>
                <p className="text-sm text-gray-600">
                  削除するデータ：<span className="font-semibold">{companyName}</span>
                </p>
                <input
                  type="text"
                  placeholder={companyName || '会社名を入力'}
                  value={deleteCompanyNameInput}
                  onChange={(e) => {
                    setDeleteCompanyNameInput(e.target.value);
                    setError(null);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                  disabled={loading}
                />
                <div className="flex gap-3 justify-end pt-4">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={loading}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    disabled={loading || deleteCompanyNameInput !== companyName}
                    className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 transition"
                  >
                    次へ
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-rose-900">
                  本当にすべてのデータを削除しますか？
                </h3>
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 space-y-2">
                  <p className="text-sm font-semibold text-rose-900">この操作は取り消せません：</p>
                  <ul className="text-sm text-rose-800 space-y-1 list-disc list-inside">
                    <li>すべてのストラテジーデータ</li>
                    <li>財務データ</li>
                    <li>シミュレーション結果</li>
                  </ul>
                </div>
                <div className="flex gap-3 justify-end pt-4">
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteStep(1);
                      setDeleteCompanyNameInput('');
                    }}
                    disabled={loading}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    disabled={loading}
                    className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 transition"
                  >
                    {loading ? '削除中...' : 'すべて削除する'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
