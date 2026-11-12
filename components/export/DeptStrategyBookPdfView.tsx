import type { CSSProperties, ReactNode } from 'react';
import type { DeptBookPdfData } from '@/utils/export/buildDeptStrategyBookPdf';

/* A4 縦（幅 794px）。PDFは画面の描画を画像にして出力するため、日本語の文字化けは起きない。 */
const page: CSSProperties = {
  width: '794px',
  boxSizing: 'border-box',
  padding: '48px 56px',
  background: '#ffffff',
  color: '#111111',
  fontFamily: '"Yu Gothic", "Hiragino Sans", "Meiryo", "Noto Sans JP", sans-serif',
  fontSize: '13px',
  lineHeight: '1.9',
  overflowWrap: 'anywhere',
};

function Chapter({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="report-section" style={{ marginTop: '22px' }}>
      <h2 className="report-h2" style={{ fontSize: '16px', fontWeight: 700, borderLeft: '4px solid #111111', paddingLeft: '10px', margin: '0 0 10px' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Lines({ lines, list = false }: { lines: string[]; list?: boolean }) {
  if (list) {
    return (
      <ul className="report-list" style={{ margin: 0, paddingLeft: '20px' }}>
        {lines.map((l, i) => (
          <li key={i} className="report-text">
            {l}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      {lines.map((l, i) => (
        <p key={i} className="report-text" style={{ margin: '0 0 4px' }}>
          {l}
        </p>
      ))}
    </>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="report-text" style={{ marginTop: '6px' }}>
      <div style={{ fontSize: '11px', color: '#555555', fontWeight: 700 }}>{label}</div>
      {children}
    </div>
  );
}

export function DeptStrategyBookPdfView({ data }: { data: DeptBookPdfData }) {
  const hasMission = data.mission.length + data.missionDescription.length + data.currentPosition.length > 0;
  const shown = [
    hasMission,
    data.strategicRole.length > 0,
    data.keyIssues.length > 0,
    data.projects.length > 0,
    data.intraCollab.length > 0,
    data.interCollab.length > 0,
  ];
  const no = (index: number) => `${shown.slice(0, index).filter(Boolean).length + 1}. `;
  return (
    <div id="dept-strategy-book-pdf" style={page}>
      <header style={{ borderBottom: '2px solid #111111', paddingBottom: '12px' }}>
        <div style={{ fontSize: '12px', color: '#444444' }}>{data.companyName}</div>
        <h1 className="report-h2" style={{ fontSize: '22px', fontWeight: 800, margin: '4px 0 2px' }}>
          {data.departmentName}　事業・部門戦略書
        </h1>
        <div style={{ fontSize: '12px', color: '#333333' }}>
          確定版{data.confirmedDate ? `　確定日：${data.confirmedDate}` : ''}
        </div>
      </header>

      {hasMission && (
        <Chapter title={`${no(0)}事業・部門の使命`}>
          <Lines lines={data.mission} />
          {data.missionDescription.length > 0 && (
            <Labeled label="概要・仮説">
              <Lines lines={data.missionDescription} />
            </Labeled>
          )}
          {data.currentPosition.length > 0 && (
            <Labeled label="現在の位置づけ">
              <Lines lines={data.currentPosition} />
            </Labeled>
          )}
        </Chapter>
      )}

      {data.strategicRole.length > 0 && (
        <Chapter title={`${no(1)}全社戦略における役割`}>
          <Lines lines={data.strategicRole} />
        </Chapter>
      )}

      {data.keyIssues.length > 0 && (
        <Chapter title={`${no(2)}重点課題と勝ち筋`}>
          <Lines lines={data.keyIssues} list />
        </Chapter>
      )}

      {data.projects.length > 0 && (
        <Chapter title={`${no(3)}確定した重点プロジェクト`}>
          {data.projects.map((p, i) => (
            <div key={`${p.title}-${i}`} className="report-card" style={{ borderTop: i === 0 ? 'none' : '1px solid #d9d9d9', paddingTop: '10px', marginTop: '10px' }}>
              <div className="report-h3" style={{ fontSize: '14px', fontWeight: 700 }}>
                {p.title}
              </div>
              {p.purpose.length > 0 && (
                <Labeled label="目的・選定理由">
                  <Lines lines={p.purpose} />
                </Labeled>
              )}
              {p.hypothesis.length > 0 && (
                <Labeled label="成果仮説">
                  <Lines lines={p.hypothesis} />
                </Labeled>
              )}
              {p.goals.length > 0 && (
                <Labeled label="KPI・目標">
                  <Lines lines={p.goals} list />
                </Labeled>
              )}
            </div>
          ))}
        </Chapter>
      )}

      {data.intraCollab.length > 0 && (
        <Chapter title={`${no(4)}事業内・部門内の連携`}>
          <Lines lines={data.intraCollab} list />
        </Chapter>
      )}

      {data.interCollab.length > 0 && (
        <Chapter title={`${no(5)}他事業・部門との連携と確定した調整事項`}>
          <Lines lines={data.interCollab} list />
        </Chapter>
      )}
    </div>
  );
}
