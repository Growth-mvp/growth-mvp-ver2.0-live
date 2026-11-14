/* 設計案の確認用（評価専用）。STAGE5 プロジェクトモーダルの新しい構成を、架空のデータで描画する。
 * 保存・通信・PDF生成はしない。ボタンの動きは画面の表示の切り替えだけ。 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

type Action = { no: number; title: string; status: '未着手' | '進行中' | '完了'; owner: string; due: string; result: string };

const ACTIONS: Action[] = [
  { no: 1, title: '現状の数値と原因を集める', status: '進行中', owner: '鈴木（仮）', due: '2027年1月', result: '失注理由の集計を3件まで済ませた' },
  { no: 2, title: '原因に効く打ち手を一つ試す', status: '未着手', owner: '鈴木（仮）', due: '2027年3月', result: '' },
  { no: 3, title: '更新案内の一斉送付', status: '未着手', owner: '佐藤（仮）', due: '2027年3月', result: '' },
];

const AI_PROPOSAL = {
  summary: '継続率が90%で止まっている。失注の理由は「価格」より「担当者の交代時の引き継ぎ不足」の割合が高い可能性があります。',
  causes: ['更新時期の前に、担当者が変わっている顧客が多い', '更新案内が一斉に届き、個別の提案が少ない'],
  options: ['担当交代の顧客を洗い出し、引き継ぎの場を設ける', '更新3か月前に、顧客ごとの利用状況を添えて案内する'],
  nextSteps: ['担当交代の顧客を、直近12か月で一覧にする（今週）', '上司に、引き継ぎの場を設けてよいか確認する（来週）'],
};

const SUPERVISOR_DRAFT =
  '保守契約の継続率が90%で止まっています。原因を見ると、担当が変わった顧客での更新落ちが目立ちます。\n' +
  '担当交代の顧客を洗い出し、引き継ぎの場を一度設けたいです。来週、15分ほどお時間をいただけますか。';

const card = 'rounded-2xl border border-slate-200 bg-white p-4';
const label = 'text-xs font-semibold tracking-wide text-slate-500';
const btnPrimary = 'rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700';
const btnQuiet = 'rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50';
const chip = (s: Action['status']) =>
  `rounded-full px-2 py-0.5 text-xs font-semibold ${
    s === '完了' ? 'bg-emerald-100 text-emerald-800' : s === '進行中' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'
  }`;

function Preview() {
  const [problem, setProblem] = useState('継続率が90%で止まっています。理由がつかめていません。');
  const [aiShown, setAiShown] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [memo, setMemo] = useState<string[]>([]);
  const [openAction, setOpenAction] = useState<number | null>(null);
  const [helpMode, setHelpMode] = useState<null | 'supervisor' | 'peer'>(null);
  const [copied, setCopied] = useState(false);
  const [showKpi, setShowKpi] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const toggle = (k: string) => setPicked((p) => ({ ...p, [k]: !p[k] }));
  const saveToMemo = () => {
    const lines = [...AI_PROPOSAL.nextSteps.filter((_, i) => picked[`n${i}`]), ...AI_PROPOSAL.options.filter((_, i) => picked[`o${i}`])];
    if (lines.length) setMemo((m) => [...m, ...lines]);
  };

  return (
    <div className="bg-slate-100 p-6 pb-16 text-slate-900">
      <div className="mx-auto max-w-[860px] space-y-5">
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          設計案の確認用です。架空のデータで表示しており、保存・送信・PDF生成は行いません。
        </div>

        <header className="flex items-start justify-between gap-4">
          <div>
            <div className={label}>営業部 ・ 担当 鈴木（仮）</div>
            <h1 className="mt-1 text-2xl font-bold">既存顧客の保守契約更新</h1>
            <p className="mt-1 text-sm text-slate-600">目標：保守契約の継続率 95%</p>
          </div>
          <button type="button" className={btnQuiet}>
            実行計画書（PDF）
          </button>
        </header>

        {/* 1. 今、何に困っているか */}
        <section className={card}>
          <div className={label}>今、何に困っているか</div>
          <textarea
            aria-label="困っていること"
            className="mt-2 w-full resize-none rounded-xl border border-slate-300 p-3 text-base leading-7 focus:outline-none focus:ring-2 focus:ring-slate-300"
            rows={2}
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">思ったままで構いません。</span>
            <button type="button" className={btnPrimary} onClick={() => setAiShown(true)}>
              AIと相談する
            </button>
          </div>
        </section>

        {/* 2. AIと相談する */}
        {aiShown && (
          <section className={`${card} border-sky-200 bg-sky-50/40`}>
            <div className={label}>AIの整理（提案です。採用するものを選べます）</div>
            <p className="mt-2 text-sm leading-6">{AI_PROPOSAL.summary}</p>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-slate-600">考えられる原因</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {AI_PROPOSAL.causes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-600">解決策の候補（採用するものを選ぶ）</div>
                <ul className="mt-1 space-y-2 text-sm">
                  {AI_PROPOSAL.options.map((o, i) => (
                    <li key={o}>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 border-0 p-0" checked={!!picked[`o${i}`]} onChange={() => toggle(`o${i}`)} />
                        <span>{o}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-600">次の行動の候補</div>
              <ul className="mt-1 space-y-2 text-sm">
                {AI_PROPOSAL.nextSteps.map((n, i) => (
                  <li key={n}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 border-0 p-0" checked={!!picked[`n${i}`]} onChange={() => toggle(`n${i}`)} />
                      <span>{n}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-slate-500">選んだものだけ、この案件のメモに残ります。計画は変わりません。</span>
              <button type="button" className={btnQuiet} onClick={saveToMemo}>
                選んだ内容をメモに残す
              </button>
            </div>
            {memo.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 border-t border-sky-200 pt-3 pl-5 text-sm text-slate-700">
                {memo.map((m, i) => (
                  <li key={`${m}-${i}`}>{m}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* 3. 人に協力を求める */}
        <section className={card}>
          <div className={label}>人に協力を求める</div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <button type="button" className={`${btnQuiet} text-left`} onClick={() => setHelpMode('supervisor')}>
              <div className="font-semibold">上司に相談する</div>
              <div className="mt-1 text-xs text-slate-500">相談文を作って、ご自身で伝えます</div>
            </button>
            <button type="button" className={`${btnQuiet} text-left`} onClick={() => setHelpMode('peer')}>
              <div className="font-semibold">同僚・他部門に頼む</div>
              <div className="mt-1 text-xs text-slate-500">依頼文を作って、ご自身で伝えます</div>
            </button>
            <a href="#" className={`${btnQuiet} block text-left`} onClick={(e) => e.preventDefault()}>
              <div className="font-semibold">組織変革ルームで管理者に共有</div>
              <div className="mt-1 text-xs text-slate-500">管理者にだけ届きます。公開範囲は本人が決めます</div>
            </a>
          </div>
          {helpMode && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-600">
                {helpMode === 'supervisor' ? '上司への相談文（たたき台）' : '同僚・他部門への依頼文（たたき台）'}
              </div>
              <textarea
                aria-label="相談文"
                className="mt-2 w-full resize-none rounded-lg border border-slate-300 bg-white p-3 text-sm leading-6"
                rows={4}
                readOnly
                value={helpMode === 'supervisor' ? SUPERVISOR_DRAFT : '来週の打ち合わせで、担当交代の顧客の一覧を一緒に見てもらえますか。'}
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-500">この画面からは送信されません。内容をご自身で伝えてください。</span>
                <button
                  type="button"
                  className={btnQuiet}
                  onClick={() => {
                    setCopied(true);
                  }}
                >
                  {copied ? 'コピーしました' : 'コピーする'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 4. 次にどう行動するか + 実施事項（簡潔な一覧） */}
        <section className={card}>
          <div className={label}>実施事項</div>
          <ol className="mt-3 divide-y divide-slate-100">
            {ACTIONS.map((a) => {
              const open = openAction === a.no;
              return (
                <li key={a.no} className="py-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 text-left"
                    onClick={() => setOpenAction(open ? null : a.no)}
                    aria-expanded={open}
                  >
                    <span className="flex items-center gap-3">
                      <span className="w-5 text-sm text-slate-400">{a.no}</span>
                      <span className="text-sm font-medium">{a.title}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={chip(a.status)}>{a.status}</span>
                      <span className="text-xs text-slate-400">{open ? '閉じる' : '開く'}</span>
                    </span>
                  </button>
                  {open && (
                    <div className="mt-2 ml-8 space-y-2 text-sm">
                      <div className="text-xs text-slate-500">担当 {a.owner} ・ 期限 {a.due}</div>
                      <div>
                        <span className="text-xs font-semibold text-slate-600">成果：</span>
                        {a.result || '未記録'}
                      </div>
                      <div className="flex gap-2">
                        <button type="button" className={btnQuiet}>
                          状態を変える
                        </button>
                        <button type="button" className={btnQuiet}>
                          成果を記録する
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {/* 5. KPI・KR実績（必要時に展開） */}
        <section className={card}>
          <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setShowKpi(!showKpi)} aria-expanded={showKpi}>
            <span className={label}>KPI・KR実績</span>
            <span className="text-xs text-slate-400">{showKpi ? '閉じる' : '開く'}</span>
          </button>
          {showKpi && (
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1">KPI</th>
                  <th className="py-1">目標</th>
                  <th className="py-1">期限</th>
                  <th className="py-1">担当</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="py-2">保守契約の継続率</td>
                  <td>3社（ハーネス修正）</td>
                  <td>2027年6月</td>
                  <td>鈴木一郎（仮）</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        {/* 6. 過去の記録（必要時に展開） */}
        <section className={card}>
          <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
            <span className={label}>これまでの記録</span>
            <span className="text-xs text-slate-400">{showHistory ? '閉じる' : '開く'}</span>
          </button>
          {showHistory && (
            <ul className="mt-3 space-y-2 text-sm">
              <li className="border-l-2 border-slate-200 pl-3">2026/11/12　失注理由の集計を始めた</li>
              <li className="border-l-2 border-slate-200 pl-3">2026/11/10　上司と更新案内の方針を確認した</li>
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

document.documentElement.style.height = 'auto';
document.body.style.height = 'auto';
document.body.style.backgroundColor = '#f1f5f9';

createRoot(document.getElementById('root')!).render(<Preview />);
