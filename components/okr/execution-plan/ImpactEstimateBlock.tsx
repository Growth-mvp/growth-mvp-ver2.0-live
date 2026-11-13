'use client';

import { useEffect, useState } from 'react';

import { SOURCE_LABEL, type EstimateRow, type ImpactEstimate, type ParamKey } from '@/lib/stage4/planView/impactEstimate';

const CHECK_LABEL: Record<EstimateRow['check'], string> = {
  MATCHES_STAGE3: 'STAGE3と一致',
  UNCONFIRMED: '未確認',
  NOT_CALCULATED: '未算定',
};

/* 前提の入力欄。入力すると、その値を保存された編集に載せ、試算は保存された編集から計算し直す（試算の式は変えない） */
function ParamInput({
  param,
  onEdit,
}: {
  param: { key: ParamKey; label: string; unit: string; value: number | null; source: keyof typeof SOURCE_LABEL };
  onEdit: (key: ParamKey, value: number | null) => void;
}) {
  const [text, setText] = useState(param.value === null ? '' : String(param.value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text);
    if (parsed !== null && !Number.isFinite(parsed)) return;
    // 入力中の表記（例：「3.」）は、同じ値なら書き換えない
    if (parsed !== param.value) setText(param.value === null ? '' : String(param.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param.value]);
  const isYear = param.key === 'startYear' || param.key === 'endYear';
  return (
    <div className="plan-param">
      <label className="plan-param-label">
        {param.label}（{param.unit}）
        <input
          type="number"
          inputMode="decimal"
          step={isYear ? 1 : 'any'}
          min={0}
          value={text}
          aria-label={`${param.label}を修正する`}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const t = raw.trim();
            if (t === '') {
              onEdit(param.key, null);
              return;
            }
            const n = Number(t);
            if (Number.isFinite(n)) onEdit(param.key, n);
          }}
        />
      </label>
      <span className="plan-tag">{SOURCE_LABEL[param.source]}</span>
    </div>
  );
}

export function ImpactEstimateBlock({
  estimate,
  onEdit,
}: {
  estimate: ImpactEstimate;
  /** 前提の修正の保存口。省略時は前提の入力欄を出さない（保存できない文書） */
  onEdit?: (key: ParamKey, value: number | null) => void;
}) {
  return (
    <section aria-labelledby="impact-estimate" className="plan-impact-estimate">
      <h3 id="impact-estimate" className="plan-h3">
        業績への貢献（参考試算）
      </h3>
      <p className="plan-note">
        AIの仮説や既存データから算出した参考試算です。利用者の修正は、この計画書の修正として保存されます。確定した業績予測ではなく、STAGE6の正式な計画には反映していません。
      </p>
      {onEdit && (
        <>
          <p className="plan-note">前提は直接入力できます。変えると、下の試算を自動で計算し直します（計算結果は入力できません）。</p>
          <div className="plan-params">
            {estimate.params.map((p) => (
              <ParamInput key={p.key} param={p} onEdit={onEdit} />
            ))}
          </div>
        </>
      )}
      {estimate.status === 'NOT_CALCULATED' ? (
        <p className="plan-p">未算定：{estimate.reason}</p>
      ) : (
        <>
          <table className="plan-table">
            <thead>
              <tr>
                <th>項目</th>
                <th>試算値（百万円）</th>
                <th>計算式</th>
                <th>出所</th>
                <th>確認状態</th>
              </tr>
            </thead>
            <tbody>
              {estimate.rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.valueText ?? (r.valueMJPY === null ? '未算定' : r.valueMJPY)}</td>
                  <td>{r.formula ?? '—'}</td>
                  <td>{r.source}</td>
                  <td>
                    <span className="plan-tag">{CHECK_LABEL[r.check]}</span>
                    {r.note && <div className="plan-note">{r.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="plan-p">
            STAGE3の売上増分の目標：{estimate.stage3RevenueMJPY === null ? '未登録' : `${estimate.stage3RevenueMJPY}百万円`}（試算とは別の数値）
          </p>
          <h4 className="plan-h3">注意</h4>
          <ul className="plan-list">
            {estimate.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
