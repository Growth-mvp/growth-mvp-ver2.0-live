/* STAGE5 最終設計案の確認用（評価専用）。中央の実行支援パネルと、右側のAI経営コンサルタントを、同時に操作できる構成で描画する。
 * 架空のデータ。保存・送信・AI呼び出し・PDF生成はしない。ボタンは表示の切り替えだけ。 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

type Screen = 'start' | 'consult' | 'share';

const PROJECT = '既存顧客の保守契約更新';
const DEPT = '営業部';
const OWNER = '鈴木一郎（仮）';

const NEXT_ACTIONS = [
  { title: '担当が変わった顧客を直近12か月で一覧にする', status: '進行中', due: '今週' },
  { title: '引き継ぎの場を設けてよいか上司に確認する', status: '未着手', due: '来週' },
  { title: '更新3か月前に、利用状況を添えて案内する', status: '未着手', due: '12月' },
];

const AI_REPLY = {
  summary: '継続率が90%で止まっています。更新の時期に担当が変わっている顧客で、更新が落ちている可能性があります。',
  causes: ['担当交代の時期と更新時期が重なっている', '更新案内が一斉に届き、個別の提案が少ない'],
  options: ['担当交代の顧客に、引き継ぎの場を設ける', '更新3か月前に、利用状況を添えて案内する'],
  needHelp: '引き継ぎの場を設けるには、上司の判断が必要です。',
  next: ['担当が変わった顧客を一覧にする（今週）', '上司に引き継ぎの場の可否を確認する（来週）'],
};

const SHARE_DRAFT =
  '保守契約の継続率が90%で止まっています。更新時期に担当が変わった顧客で更新が落ちているようです。\n' +
  '担当交代の顧客に引き継ぎの場を設けたいです。来週、上司に15分ほどご相談させてください。';

const TOP_TEXT = SHARE_DRAFT.replace('\n', ' / ').slice(0, 72) + '…';

const cardWrap = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
const kicker = 'text-[11px] font-semibold tracking-wider text-slate-500';
const btnPrimary = 'rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-300';
const btnSecondary = 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50';
const btnGhost = 'px-2 py-2 text-sm text-slate-500 hover:text-slate-800';

function Pyramid({ selectedIndex }: { selectedIndex: number }) {
  const items = [
    { label: '全社戦略', level: 0 },
    { label: DEPT, level: 1 },
    { label: PROJECT, level: 2 },
    { label: '新規顧客開拓', level: 2 },
    { label: '経理部', level: 1 },
    { label: '業務改善', level: 2 },
  ];
  return (
    <div className="space-y-1.5 text-xs">
      <div className={kicker}>ピラミッド（従来のまま）</div>
      {items.map((it, i) => (
        <div
          key={it.label}
          className={`rounded-lg px-2.5 py-2 ${it.level === 0 ? 'font-semibold text-slate-700' : ''} ${
            i === selectedIndex ? 'bg-slate-900 font-semibold text-white' : 'text-slate-600'
          }`}
          style={{ marginLeft: it.level * 10 }}
        >
          {it.label}
        </div>
      ))}
    </div>
  );
}

function Center({ screen, onScreen }: { screen: Screen; onScreen: (s: Screen) => void }) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [agree, setAgree] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'shared' | 'draft'>('idle');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState(false);
  const [moreOpen, setMoreOpen] = useState<null | 'kpi' | 'history'>(null);

  return (
    <div className={`${cardWrap} flex min-h-[560px] flex-col`}>
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className={kicker}>
            {DEPT} ・ 責任者 {OWNER}
          </div>
          <h2 className="mt-1 text-xl font-bold text-slate-900">{PROJECT}</h2>
        </div>
        <button type="button" className={btnSecondary}>
          実行計画書をPDFで確認
        </button>
      </header>

      {screen === 'start' && (
        <div className="flex flex-1 flex-col gap-6 pt-5">
          <section>
            <div className="text-sm font-semibold text-slate-800">今、困っていること</div>
            <textarea
              aria-label="困っていること"
              rows={2}
              placeholder="例：継続率が伸びない理由がつかめない"
              className="mt-2 w-full resize-none rounded-xl border border-slate-300 p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className={btnPrimary} onClick={() => onScreen('consult')}>
                AI経営コンサルタントに相談する
              </button>
              <button type="button" className={btnSecondary} onClick={() => onScreen('share')}>
                組織に協力を求める
              </button>
            </div>
          </section>

          <section>
            <div className="text-sm font-semibold text-slate-800">次にやること</div>
            <ul className="mt-2 divide-y divide-slate-100">
              {NEXT_ACTIONS.map((a) => (
                <li key={a.title} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full bg-slate-300" />
                    <span className="text-slate-800">{a.title}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                    <span>{a.due}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">{a.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-auto space-y-2 border-t border-slate-100 pt-4">
            <div className={kicker}>補助情報（必要な時だけ開く）</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnGhost} onClick={() => setMoreOpen(moreOpen === 'kpi' ? null : 'kpi')} aria-expanded={moreOpen === 'kpi'}>
                KPI・KR実績 {moreOpen === 'kpi' ? '▴' : '▾'}
              </button>
              <button type="button" className={btnGhost} onClick={() => setMoreOpen(moreOpen === 'history' ? null : 'history')} aria-expanded={moreOpen === 'history'}>
                これまでの記録 {moreOpen === 'history' ? '▴' : '▾'}
              </button>
            </div>
            {moreOpen === 'kpi' && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                保守契約の継続率：目標 95%（STAGE4で修正済み）／ 実績 未入力
              </div>
            )}
            {moreOpen === 'history' && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                11/12　担当交代の顧客を洗い出し始めた
                <br />
                11/10　上司と更新案内の方針を確認した
              </div>
            )}
          </section>
        </div>
      )}

      {screen === 'consult' && (
        <div className="flex flex-1 flex-col gap-5 pt-5">
          <section className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <span className="text-xs text-slate-500">あなたの相談</span>
            <div className="mt-1">継続率が90%で止まっています。理由がつかめていません。</div>
          </section>

          <section>
            <div className="text-sm font-semibold text-slate-800">提案の中から、採用するものを選んでください</div>
            <ul className="mt-2 space-y-2 text-sm">
              {AI_REPLY.next.map((n, i) => (
                <li key={n}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 border-0 p-0"
                      checked={!!picked[`n${i}`]}
                      onChange={() => setPicked((p) => ({ ...p, [`n${i}`]: !p[`n${i}`] }))}
                    />
                    <span>{n}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">採用したものだけ、次にやることに入ります。計画は変わりません。</span>
              <button type="button" className={btnSecondary} onClick={() => setAdded(true)}>
                {added ? '次にやることに追加しました' : '選んだものを追加'}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {AI_REPLY.needHelp}
            <button type="button" className="ml-2 font-semibold underline" onClick={() => onScreen('share')}>
              協力を依頼する文面を作る
            </button>
          </section>

          <section className="mt-auto border-t border-slate-100 pt-4 text-xs text-slate-500">
            相談の内容は、あなたの画面にだけ残ります。社内には共有されません。
          </section>
        </div>
      )}

      {screen === 'share' && (
        <div className="flex flex-1 flex-col gap-4 pt-5">
          <section>
            <div className="text-sm font-semibold text-slate-800">社内に共有する投稿（AIの下書きです。編集できます）</div>
            <textarea
              aria-label="投稿の本文"
              rows={4}
              defaultValue={SHARE_DRAFT}
              className="mt-2 w-full resize-none rounded-xl border border-slate-300 p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </section>

          <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
            <div className="font-semibold">この投稿は社内に共有されます</div>
            <div className="mt-1 text-xs">
              トップ画面の「最近動きのあったプロジェクト」に、部門名・プロジェクト名と本文の冒頭が表示されます。投稿者の名前は表示されません。
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 border-0 p-0" checked={agree} onChange={() => setAgree(!agree)} />
              <span>内容を確認し、社内に共有することに同意します</span>
            </label>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={!agree || shareState !== 'idle'}
              onClick={() => setShareState('shared')}
            >
              {shareState === 'shared' ? '社内に共有しました' : '社内に共有する'}
            </button>
            <button type="button" className={btnSecondary} disabled={shareState !== 'idle'} onClick={() => setShareState('draft')}>
              {shareState === 'draft' ? '自分だけのメモに残しました' : '自分だけのメモに残す'}
            </button>
            <button type="button" className={btnGhost} onClick={() => onScreen('consult')}>
              やめる
            </button>
          </div>

          {shareState === 'shared' && (
            <section className="rounded-xl border border-slate-200 p-3">
              <div className={kicker}>トップ画面での表示（プレビュー）</div>
              <div className="mt-2 rounded-lg bg-white p-3 shadow-sm">
                <div className="text-[11px] text-slate-500">
                  {DEPT} ・ {PROJECT} ・ 今日
                </div>
                <div className="mt-1 text-sm text-slate-800">{TOP_TEXT}</div>
              </div>
            </section>
          )}

          <section className="mt-auto border-t border-slate-100 pt-3 text-xs text-slate-500">
            下書きは、この画面の中にだけ残ります。社内には共有されません。
          </section>
        </div>
      )}
    </div>
  );
}

function AiPanel({ screen }: { screen: Screen }) {
  return (
    <aside aria-label="AI経営コンサルタント" className="flex min-h-[560px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4">
        <div className="text-base font-bold text-slate-900">AI経営コンサルタント</div>
        <div className="mt-1 text-xs text-slate-500">経営も現場の実行も、同じAIが一緒に考えます</div>
        <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
          対象：{PROJECT}（{DEPT}）
          <div className="mt-0.5 text-[11px] text-slate-500">参照：全社戦略・部門戦略・実行計画・共有済みの記録（あなたの権限の範囲）</div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-hidden p-4 text-sm leading-6">
        {screen === 'start' && (
          <div className="rounded-xl bg-slate-50 p-3">
            このプロジェクトについて、困っていることを一言で教えてください。原因と解決策を一緒に考えます。
          </div>
        )}

        {screen === 'consult' && (
          <>
            <div className="ml-6 rounded-xl bg-slate-900 p-3 text-white">継続率が90%で止まっています。理由がつかめていません。</div>
            <div className="space-y-3 rounded-xl bg-slate-50 p-3">
              <div>
                <div className="text-xs font-semibold text-slate-500">整理</div>
                <div>{AI_REPLY.summary}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">考えられる原因</div>
                <ul className="list-disc pl-5">
                  {AI_REPLY.causes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">解決策の候補</div>
                <ul className="list-disc pl-5">
                  {AI_REPLY.options.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">必要な協力</div>
                <div>{AI_REPLY.needHelp}</div>
              </div>
            </div>
            <div className="text-[11px] text-slate-500">提案です。採用したものだけ、中央の「次にやること」に入ります。</div>
          </>
        )}

        {screen === 'share' && (
          <div className="rounded-xl bg-slate-50 p-3">
            協力依頼の文面を作りました。内容を確認してから、社内に共有してください。共有しない場合は、自分だけのメモに残せます。
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 p-3">
        <div className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-400">続けて相談する（この設計案では送信しません）</div>
      </div>
    </aside>
  );
}

function Preview() {
  const [screen, setScreen] = useState<Screen>('start');
  const tabs: Array<{ key: Screen; label: string }> = [
    { key: 'start', label: '1 初期表示' },
    { key: 'consult', label: '2 AI相談時' },
    { key: 'share', label: '3 協力依頼の全社共有' },
  ];
  return (
    <div className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto w-[1240px] space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            設計案の確認用です。架空のデータで表示しています。保存・送信・AI呼び出し・PDF生成は行いません。
          </div>
          <nav aria-label="画面の状態" className="flex gap-2">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setScreen(t.key)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                  screen === t.key ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="grid grid-cols-[220px_1fr_340px] gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <Pyramid selectedIndex={2} />
          </div>
          <Center screen={screen} onScreen={setScreen} />
          <AiPanel screen={screen} />
        </div>
      </div>
    </div>
  );
}

document.documentElement.style.height = 'auto';
document.body.style.height = 'auto';
document.body.style.backgroundColor = '#f1f5f9';

createRoot(document.getElementById('root')!).render(<Preview />);
