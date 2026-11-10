'use client';

import type { EstimateCheck, ImpactEstimate } from '@/lib/stage4/planView/impactEstimate';

const CHECK_LABEL: Record<EstimateCheck, string> = {
  MATCHES_STAGE3: 'STAGE3と一致',
  MISMATCH: '不一致',
  UNCONFIRMED: '未確認',
  NOT_CALCULATED: '未算定',
};

export function ImpactEstimateBlock({ estimate }: { estimate: ImpactEstimate }) {
  return (
    <section aria-labelledby="impact-estimate" className="plan-impact-estimate">
      <h3 id="impact-estimate" className="plan-h3">
        業績への貢献（試算）
      </h3>
      <p className="plan-note">参考情報です。確定した業績予測ではなく、STAGE6には反映していません。</p>
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
                  <td>{r.valueMJPY === null ? '未算定' : r.valueMJPY}</td>
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
          <h4 className="plan-h3">STAGE3の目標値（試算とは別の数値）</h4>
          <ul className="plan-list">
            <li>売上増分：{estimate.stage3Targets.revenueMJPY === null ? '未登録' : `${estimate.stage3Targets.revenueMJPY}百万円`}</li>
            <li>営業利益：{estimate.stage3Targets.opIncomeMJPY === null ? '未登録' : `${estimate.stage3Targets.opIncomeMJPY}百万円`}</li>
          </ul>
          {estimate.consistency.length > 0 && (
            <>
              <h4 className="plan-h3">照合</h4>
              <ul className="plan-list">
                {estimate.consistency.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
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
