// /components/stage1/Stage1ToStage2Panel.tsx
'use client';

import { useStrategyStore } from '@/store/strategyStore';
import IssueBlockPanel from './IssueBlockPanel';
import Stage2Bridge from './Stage2Bridge';

/**
 * ② 論点整理 + STAGE2へ 統合パネル
 * - IssueBlockPanel で論点選択
 * - 下部に Stage2Bridge（論点未選択なら disabled）
 */
export default function Stage1ToStage2Panel() {
  const stage1Issues = useStrategyStore((s) => s.stage1Issues ?? []);

  // 論点が未選択の場合、遷移ボタン disabled
  const hasIssues = stage1Issues.length > 0;

  return (
    <div className="space-y-6">
      {/* 論点整理パネル */}
      <div>
        <h3 className="text-lg font-semibold mb-4">論点整理</h3>
        <IssueBlockPanel />
      </div>

      {/* 分割線 */}
      <div className="border-t border-gray-200 pt-6">
        {/* STAGE2へ遷移 */}
        <div>
          <h3 className="text-lg font-semibold mb-4">次のフェーズへ</h3>
          <p className="text-sm text-gray-600 mb-4">
            {hasIssues ? (
              <>
                <span className="text-green-700 font-medium">✓ 論点が {stage1Issues.length} 件選択されています。</span>
                <br />
                下記ボタンで STAGE2（経営戦略策定）へ進みます。
              </>
            ) : (
              <>
                <span className="text-amber-700 font-medium">⚠ 論点が未選択です。</span>
                <br />
                上記で論点を選択してから、下記ボタンを有効にしてください。
              </>
            )}
          </p>
          <div className="opacity-100">
            <Stage2Bridge disabled={!hasIssues} />
          </div>
        </div>
      </div>
    </div>
  );
}
