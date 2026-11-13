'use client';

import PlanDocument from './PlanDocument';

export type RegenState =
  | { status: 'BUSY' }
  | { status: 'FAILED'; message: string }
  | { status: 'READY'; draft: Record<string, unknown>; previewToken: string; notice: string | null };

const noop = () => {};

/* 再生成の案は、従来の文書形式でそのまま見せる。選べるのは「この案を使う」と「元の計画に戻る」の2つだけ */
export function RegenPanel({ state, onUse, onCancel }: { state: RegenState; onUse: () => void; onCancel: () => void }) {
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
  return (
    <section aria-label="新しい案" className="plan-regen-panel">
      <h2 className="plan-h2">新しいAI案</h2>
      <p className="plan-note">
        「この案を使う」を押すと、現在の計画書がこの案に替わります。利用者が書いた修正は残ります。採用と開始は解除されるため、改めて採用・開始してください。
      </p>
      {state.notice && (
        <p role="status" className="plan-note">
          {state.notice}
        </p>
      )}
      <div className="plan-toolbar">
        <button type="button" className="plan-btn-primary" onClick={onUse}>
          この案を使う
        </button>
        <button type="button" className="plan-btn-quiet" onClick={onCancel}>
          元の計画に戻る
        </button>
      </div>
      <PlanDocument
        bundle={state.draft}
        readOnly
        showAdoption={false}
        persisted
        mode="read"
        committed={{}}
        draft={{}}
        adopted={false}
        adoptable={false}
        blockers={[]}
        notice={null}
        onEnterEdit={noop}
        onApply={noop}
        onDiscard={noop}
        onDraftChange={noop}
        onAdopt={noop}
        onUnadopt={noop}
        onOpenStart={noop}
      />
    </section>
  );
}
