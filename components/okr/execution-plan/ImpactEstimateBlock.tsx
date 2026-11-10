'use client';

import type { EstimateCheck, ImpactEstimate } from '@/lib/stage4/planView/impactEstimate';

const CHECK_LABEL: Record<EstimateCheck, string> = {
  MATCHES_STAGE3: 'STAGE3と一致',
  UNCONFIRMED: '未確認',
  NOT_CALCULATED: '未算定',
};

export function ImpactEstimateBlock({ estimate }: { estimate: ImpactEstimate }) {
  return (
    <section aria-labelledby="impact-estimate" className="plan-impact-estimate">
      <h3 id="impact-estimate" className="plan-h3">
        業績への貢献（参考試算）
      </h3>
      <p className="plan-note">既存データから算出した参考試算です。確定した業績予測ではなく、STAGE6には反映していません。</p>
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
