'use client';

import type { PreviewRow } from '@/lib/stage4/planView/regenPreview';

export type RegenState =
  | { status: 'BUSY' }
  | { status: 'FAILED'; message: string }
  | { status: 'READY'; rows: PreviewRow[]; selected: string[] };

const STATUS_LABEL: Record<PreviewRow['status'], string> = {
  SAME: '変更なし',
  AVAILABLE: '反映できる',
  MANUAL: '修正あり（上書きしない）',
  EXCLUDED: '反映しない',
  NOT_IN_CURRENT: '現在の計画にない',
  NOT_IN_NEW: '新しい案にない',
};

const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '（なし）' : String(v));

export function RegenPanel({
  state,
  onToggle,
  onApply,
  onCancel,
}: {
  state: RegenState;
  onToggle: (itemId: string) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  if (state.status === 'BUSY') {
    return (
      <section aria-label="新しい案" className="plan-regen-panel">
        <p className="plan-p">新しい案を作成しています…（保存はされません）</p>
      </section>
    );
  }
  if (state.status === 'FAILED') {
    return (
      <section aria-label="新しい案" className="plan-regen-panel">
        <p role="alert" className="plan-p">{state.message}</p>
        <button type="button" className="plan-btn-quiet" onClick={onCancel}>
          閉じる
        </button>
      </section>
    );
  }
  const changed = state.rows.filter((r) => r.status !== 'SAME');
  const available = state.rows.filter((r) => r.status === 'AVAILABLE');
  return (
    <section aria-label="新しい案" className="plan-regen-panel">
      <h3 className="plan-h3">新しいAI案との比較（保存されていません）</h3>
      <p className="plan-note">
        反映すると、画面の修正として入ります。「草案として保存」を押すまでは、保存された計画書のままです。利用者が修正した項目は上書きしません。
      </p>
      {changed.length === 0 ? (
        <p className="plan-p">新しい案と現在の計画書に、違いはありません。</p>
      ) : (
        <table className="plan-table">
          <thead>
            <tr>
              <th>反映</th>
              <th>項目</th>
              <th>現在の内容</th>
              <th>新しいAI案</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((r) => (
              <tr key={r.itemId}>
                <td>
                  {r.status === 'AVAILABLE' && (
                    <input
                      type="checkbox"
                      aria-label={`${r.label}を反映する`}
                      checked={state.selected.includes(r.itemId)}
                      onChange={() => onToggle(r.itemId)}
                    />
                  )}
                </td>
                <td>{r.label}</td>
                <td>{show(r.currentValue)}</td>
                <td>{show(r.newValue)}</td>
                <td>
                  <span className="plan-tag">{STATUS_LABEL[r.status]}</span>
                  {r.reason && <div className="plan-note">{r.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="plan-toolbar">
        <button
          type="button"
          className="plan-btn-primary"
          onClick={onApply}
          disabled={available.length === 0 || state.selected.length === 0}
        >
          選んだ項目を反映する（未保存）
        </button>
        <button type="button" className="plan-btn-quiet" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </section>
  );
}
