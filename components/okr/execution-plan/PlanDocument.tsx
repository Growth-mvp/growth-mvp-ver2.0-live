'use client';

import { useMemo, useState } from 'react';
import { buildDocModel, type DocModel, type Edits, type EditValue } from '@/lib/stage4/planView/documentModel';
import type { ImpactEstimate } from '@/lib/stage4/planView/impactEstimate';
import type { PlanMode } from '@/lib/stage4/planView/planState';
import { ImpactEstimateBlock } from './ImpactEstimateBlock';
import { PLAN_DOC_CSS } from './planDocStyles';

type Mode = PlanMode;

export type PlanDocumentProps = {
  bundle: unknown;
  /** 読み取り専用（保存済みの計画の表示など）。修正・採用の操作を出さない */
  readOnly?: boolean;
  /** 採用の欄を出すか（省略時は出す）。採用は保存を伴うため、保存できない文書では出さない */
  showAdoption?: boolean;
  /** 草案と採用・開始の記録が保存先（API）に残るか */
  persisted?: boolean;
  /** STAGE3の前提からの参考試算（前提が無い案件は null）。第5章の中に出す */
  impactEstimate?: ImpactEstimate | null;
  mode: Mode;
  committed: Edits;
  draft: Edits;
  adopted: boolean;
  adoptable: boolean;
  blockers: string[];
  notice: string | null;
  onEnterEdit: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onDraftChange: (key: string, value: EditValue) => void;
  onAdopt: () => void;
  onUnadopt: () => void;
  onOpenStart: () => void;
};

function EditableBlock({
  label,
  value,
  mode,
  onChange,
  multiline = true,
  className = 'plan-p',
}: {
  label: string;
  value: string;
  mode: Mode;
  onChange: (v: string) => void;
  multiline?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (mode === 'read') {
    return <p className={className}>{value}</p>;
  }
  if (!open) {
    return (
      <button type="button" className="plan-edit-target" aria-label={`${label}を修正する`} onClick={() => setOpen(true)}>
        <span className={className}>{value || '（記載なし）'}</span>
      </button>
    );
  }
  return (
    <div className="plan-edit-open">
      {multiline ? (
        <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : (
        <input aria-label={label} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      <button type="button" className="plan-btn-quiet" onClick={() => setOpen(false)}>
        この部分を閉じる
      </button>
    </div>
  );
}

function EditableMonth({ label, value, mode, onChange }: { label: string; value: string; mode: Mode; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (mode === 'read') return <span>{value}</span>;
  if (!open) {
    return (
      <button type="button" className="plan-edit-target plan-edit-inline" aria-label={`${label}を修正する`} onClick={() => setOpen(true)}>
        {value}
      </button>
    );
  }
  return (
    <span className="plan-edit-open-inline">
      <input aria-label={label} type="month" value={toMonthInput(value)} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="plan-btn-quiet" onClick={() => setOpen(false)}>
        閉じる
      </button>
    </span>
  );
}

/* 表示の「2027年2月」と、入力の「2027-02」を相互に変換する */
function toMonthInput(ja: string): string {
  const m = /^(\d{4})年(\d{1,2})月$/.exec(ja);
  return m ? `${m[1]}-${String(Number(m[2])).padStart(2, '0')}` : '';
}

export default function PlanDocument(props: PlanDocumentProps) {
  const { bundle, committed, draft, adopted, adoptable, blockers, notice } = props;
  const readOnly = props.readOnly === true;
  const mode: Mode = readOnly ? 'read' : props.mode;
  const edits = mode === 'edit' ? draft : committed;
  const doc: DocModel = useMemo(() => buildDocModel(bundle, edits), [bundle, edits]);

  const setEdit = (key: string, value: EditValue) => props.onDraftChange(key, value);
  const editable = (key: string, label: string, original: string) => ({
    label,
    value: Object.prototype.hasOwnProperty.call(edits, key) ? String(edits[key] ?? '') : original,
    mode,
    onChange: (v: string) => setEdit(key, v),
  });

  const editCount = Object.keys(committed).length;

  return (
    <div className="plan-page">
      <style>{PLAN_DOC_CSS}</style>
      {!readOnly && (
      <div className="plan-toolbar" role="toolbar" aria-label="計画書の操作">
        <div className="plan-toolbar-actions">
          {mode === 'read' ? (
            <button type="button" className="plan-btn-primary" onClick={props.onEnterEdit}>
              計画書を修正する
            </button>
          ) : (
            <>
              <span className="plan-edit-state">修正中：この画面の中だけで反映されます</span>
              <button type="button" className="plan-btn-primary" onClick={props.onApply}>
                修正を反映する
              </button>
              <button type="button" className="plan-btn-quiet" onClick={props.onDiscard}>
                修正をやめる
              </button>
            </>
          )}
        </div>
        {mode === 'read' && editCount > 0 && <div className="plan-edit-note">修正した箇所：{editCount} 件（修正しなかった箇所はそのままです）</div>}
        {notice && <div className="plan-edit-note" role="status">{notice}</div>}
      </div>
      )}

      <article className="plan-paper" aria-label="実行計画書">
        <header className="plan-paper-head">
          <div className="plan-kicker">実行計画書</div>
          <h1 className="plan-title">{doc.projectTitle}</h1>
          <table className="plan-basics">
            <tbody>
              <tr>
                <th>対象部門</th>
                <td>{doc.department}</td>
                <th>計画期間</th>
                <td>{doc.period}</td>
              </tr>
              <tr>
                <th>実行責任者</th>
                <td colSpan={3}>
                  {mode === 'edit' ? (
                    <EditableBlock
                      {...editable('responsible', '実行責任者', doc.responsible.raw)}
                      multiline={false}
                      className="plan-inline"
                    />
                  ) : (
                    <>
                      {doc.responsible.text}
                      {doc.responsible.candidate && <span className="plan-note"> （候補。実行開始前に確定します）</span>}
                    </>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="plan-company">{doc.company}</p>
        </header>

        <section className="plan-section" aria-labelledby="sec1">
          <h2 id="sec1" className="plan-h2">
            <span className="plan-no">1</span> 目的・背景
          </h2>
          <h3 className="plan-h3">このプロジェクトに取り組む理由</h3>
          <EditableBlock {...editable(doc.purpose.reason.key, '取り組む理由', doc.purpose.reason.text)} />
          <h3 className="plan-h3">解決する顧客の課題</h3>
          <EditableBlock {...editable(doc.purpose.problem.key, '解決する顧客の課題', doc.purpose.problem.text)} />
          <h3 className="plan-h3">実現したい状態</h3>
          <EditableBlock {...editable(doc.purpose.state.key, '実現したい状態', doc.purpose.state.text)} />
          <h3 className="plan-h3">会社の戦略との関係</h3>
          <EditableBlock {...editable(doc.purpose.strategy.key, '会社の戦略との関係', doc.purpose.strategy.text)} />
        </section>

        <section className="plan-section" aria-labelledby="sec2">
          <h2 id="sec2" className="plan-h2">
            <span className="plan-no">2</span> 目標・期待成果
          </h2>
          <EditableBlock {...editable(doc.goals.customerOutcome.key, '顧客が得る成果', doc.goals.customerOutcome.text)} />
          <table className="plan-table plan-kpi-table">
            <thead>
              <tr>
                <th>指標</th>
                <th>目標</th>
                <th>期限</th>
                <th>担当</th>
              </tr>
            </thead>
            <tbody>
              {doc.goals.kpis.map((k) => (
                <tr key={k.label} className={k.confirmed ? 'plan-kpi-confirmed' : undefined}>
                  <td>
                    {k.label}
                    <span className="plan-tag">{k.statusLabel}</span>
                  </td>
                  <td>
                    {k.targetKey && mode === 'edit' ? (
                      <EditableBlock {...editable(k.targetKey, `${k.label}の目標`, k.target)} multiline={false} className="plan-inline" />
                    ) : (
                      k.target
                    )}
                  </td>
                  <td>
                    {k.dueKey && mode === 'edit' ? (
                      <EditableMonth label={`${k.label}の期限`} value={k.due} mode={mode} onChange={(v) => setEdit(k.dueKey!, v)} />
                    ) : (
                      k.due
                    )}
                  </td>
                  <td>{k.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="plan-note">確定した目標は、この画面からは変更できません（STAGE3で変更します）。</p>
        </section>

        <section className="plan-section" aria-labelledby="sec3">
          <h2 id="sec3" className="plan-h2">
            <span className="plan-no">3</span> 具体的な実施事項
          </h2>
          <table className="plan-table plan-actions-table">
            <thead>
              <tr>
                <th className="plan-col-no">No.</th>
                <th className="plan-col-title">実施事項</th>
                <th>主な内容</th>
                <th className="plan-col-due">期限</th>
              </tr>
            </thead>
            <tbody>
              {doc.actions.map((a) => (
                <tr key={a.no}>
                  <td className="plan-col-no">{a.no}</td>
                  <td className="plan-col-title">
                    {mode === 'edit' ? (
                      <EditableBlock {...editable(a.titleKey, `実施事項${a.no}`, a.title)} multiline={false} className="plan-inline plan-strong" />
                    ) : (
                      <strong>{a.title}</strong>
                    )}
                    <div className="plan-owner">{a.owner}</div>
                    <dl className="plan-action-fields">
                      <dt>成果物</dt>
                      <dd>{a.deliverable ?? '記載なし（この草案には成果物の記載がありません）'}</dd>
                      <dt>次に進める条件</dt>
                      <dd>{a.exitCondition ?? '記載なし（この草案には判断条件の記載がありません）'}</dd>
                      <dt>収益化の段階</dt>
                      <dd>{a.stage ?? '記載なし'}</dd>
                    </dl>
                  </td>
                  <td>{a.content}</td>
                  <td className="plan-col-due">
                    <EditableMonth label={`実施事項${a.no}の期限`} value={a.due} mode={mode} onChange={(v) => setEdit(a.dueKey, v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="plan-section" aria-labelledby="sec4">
          <h2 id="sec4" className="plan-h2">
            <span className="plan-no">4</span> 推進体制・スケジュール
          </h2>
          <h3 className="plan-h3">協力する部門と役割</h3>
          <ul className="plan-list">
            {doc.organization.roles.map((r, i) => (
              <li key={`${r.unit}-${i}`}>
                <strong>{r.unit}</strong>：{r.role}
              </li>
            ))}
          </ul>
          <h3 className="plan-h3">主要な実施時期</h3>
          <ul className="plan-list">
            {doc.organization.schedule.map((s, i) => (
              <li key={`${s.when}-${i}`}>
                <strong>{s.when}</strong>：{s.what}
              </li>
            ))}
          </ul>
          <h3 className="plan-h3">実行開始の前に確認すること</h3>
          <ol className="plan-list plan-ordered">
            {doc.impact.regulatory.map((t) => (
              <li key={`reg-${t}`}>
                {t}
                <span className="plan-tag plan-tag-hold">開始前に確認</span>
              </li>
            ))}
            {doc.organization.beforeStart.map((t) => (
              <li key={`pre-${t}`}>{t}</li>
            ))}
          </ol>
        </section>

        <section className="plan-section" aria-labelledby="sec5">
          <h2 id="sec5" className="plan-h2">
            <span className="plan-no">5</span> 業績への貢献と留意事項
          </h2>
          <h3 className="plan-h3">顧客が得る効果</h3>
          <p className="plan-p">{doc.goals.customerOutcome.text}</p>
          <h3 className="plan-h3">自社の売上・利益への貢献</h3>
          <EditableBlock {...editable(doc.impact.companyResult.key, '自社の売上・利益への貢献', doc.impact.companyResult.text)} />
          {props.impactEstimate && <ImpactEstimateBlock estimate={props.impactEstimate} />}
          <h3 className="plan-h3">財務効果の算定</h3>
          <ul className="plan-list">
            {doc.impact.financeLines.map((f) => (
              <li key={f.label}>
                <span className={`plan-fin plan-fin-${f.status === 'NOT_CALCULATED' ? 'none' : 'some'}`}>
                  {f.status === 'NOT_CALCULATED' ? '未算定' : f.status === 'CONFIRMED' ? '確認済み' : '参考試算（未確認）'}
                </span>{' '}
                {f.text}
              </li>
            ))}
          </ul>
          <h3 className="plan-h3">実行上の重要なリスク</h3>
          <table className="plan-table plan-risk-table">
            <thead>
              <tr>
                <th>リスク</th>
                <th>対策</th>
                <th>確認時期</th>
              </tr>
            </thead>
            <tbody>
              {doc.impact.risks.map((r, i) => (
                <tr key={`risk-${i}`}>
                  <td>{r.risk}</td>
                  <td>
                    {mode === 'edit' ? (
                      <EditableBlock {...editable(r.countermeasureKey, `リスク${i + 1}の対策`, r.countermeasure)} className="plan-inline" />
                    ) : (
                      r.countermeasure
                    )}
                  </td>
                  <td>{r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="plan-h3">規制・安全などの確認事項</h3>
          <p className="plan-p">
            {doc.impact.regulatory.length > 0
              ? '次の事項は、実行を開始する前に、確認者と確認日を記録して確認します。確認していない段階では、実行を開始しません。'
              : 'この計画に、規制・安全に関する確認事項はありません。'}
          </p>
        </section>

        <details className="plan-supplement">
          <summary>補足情報（根拠・確定情報）</summary>
          <div className="plan-supplement-body">
            <h4 className="plan-h4">確定している目標（STAGE3）</h4>
            <ul className="plan-list">
              {doc.goals.kpis
                .filter((k) => k.confirmed)
                .map((k) => (
                  <li key={`c-${k.label}`}>
                    {k.label}：目標 {k.target}、期限 {k.due}、担当 {k.owner}
                  </li>
                ))}
            </ul>
            {doc.supplement.stage3Notes.length > 0 && (
              <>
                <h4 className="plan-h4">確定目標についての注意</h4>
                <ul className="plan-list">
                  {doc.supplement.stage3Notes.map((n, i) => (
                    <li key={`n-${i}`}>{n}</li>
                  ))}
                </ul>
              </>
            )}
            <h4 className="plan-h4">この計画の根拠（入力情報）</h4>
            <ul className="plan-list plan-evidence">
              {doc.supplement.evidence.map((e, i) => (
                <li key={`e-${i}`}>
                  <span className="plan-evidence-label">{e.label}</span>：{e.text}
                </li>
              ))}
            </ul>
          </div>
        </details>
        <footer className="plan-paper-foot">
          作成：AIによる草案を基に、担当者が確認・修正します。 ／{' '}
          {props.persisted ? '修正は「草案として保存」で保存されます' : '開発用の画面内での操作のため、保存されません'}
        </footer>
      </article>

      {!readOnly && props.showAdoption !== false && (
      <section className="plan-next" aria-label="計画案の採用">
        <h2 className="plan-h3">計画案の採用</h2>
        {mode === 'edit' ? (
          <p className="plan-note">修正を反映してから、採用できます。</p>
        ) : adopted ? (
          <p className="plan-p">
            採用済み
            <button type="button" className="plan-btn-quiet" onClick={props.onUnadopt}>
              採用を取り消す
            </button>
          </p>
        ) : (
          <button type="button" className="plan-btn-primary" onClick={props.onAdopt} disabled={!adoptable}>
            この計画案を採用する
          </button>
        )}
        <p className="plan-note">未確認の事項があっても採用できます。実行の開始は、別の操作で確認します。</p>
        {!adoptable && blockers.length > 0 && (
          <ul className="plan-list">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <div className="plan-next-actions">
          <button type="button" className="plan-btn-quiet" onClick={props.onOpenStart}>
            実行開始の確認へ進む
          </button>
        </div>
      </section>
      )}
    </div>
  );
}
