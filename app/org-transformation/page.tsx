'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  saveOrgAlignmentCase,
  requestOrgAlignmentCase,
  getOrgAlignmentCasesByUser,
  type OrgAlignmentCaseListItem,
} from '@/utils/supabase';
import { safeGetSession } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';
import OrgAlignmentIntakeChat from '@/components/org-transformation/OrgAlignmentIntakeChat';
import OrgAlignmentIntakeReviewCard from '@/components/org-transformation/OrgAlignmentIntakeReviewCard';

// ===== 型定義 =====
type VisibilityMode = 'anonymous' | 'manager_only' | 'named';

type CounterpartyType =
  | 'executive'
  | 'manager'
  | 'own_department'
  | 'other_department'
  | 'backoffice'
  | 'field_member'
  | 'customer'
  | 'unknown'
  | 'other';

type OrgAlignmentStatus =
  | 'draft'
  | 'generated'
  | 'alignment_requested'
  | 'in_alignment'
  | 'closed';

type OrgAlignmentIssueType =
  | '部門間連携のズレ'
  | '経営と現場の認識のズレ'
  | '戦略と実行計画のズレ'
  | '実行計画と評価制度のズレ'
  | '役割責任のズレ'
  | '優先順位のズレ'
  | '意思決定基準のズレ'
  | '情報共有のズレ'
  | '挑戦と失敗許容のズレ'
  | 'ツール・施策への不信感'
  | 'その他';

type CompanyRecognitionMode = 'strategy_based' | 'needs_confirmation';

type OrgAlignmentResult = {
  title: string;
  inputSummary: string;
  issueType: OrgAlignmentIssueType;
  participantRecognitionHypothesis: string;
  companyRecognitionMode: CompanyRecognitionMode;
  companyRecognitionTitle: string;
  companyRecognition: string;
  alignmentPoints: string[];
  recommendedNextAction: {
    title: string;
    detail: string;
  };
  riskLevel: 'low' | 'medium' | 'high';
  riskReason: string;
};

type ExampleCase = {
  title: string;
  situation: string;
  myRecognition: string;
  otherHypothesis: string;
  alignmentQuestion: string;
};

// ===== 選択肢定義 =====
const counterpartyOptions = [
  { value: 'executive' as const, label: '経営' },
  { value: 'manager' as const, label: '上司・管理職' },
  { value: 'own_department' as const, label: '自部門' },
  { value: 'other_department' as const, label: '他部門・関連部門' },
  { value: 'backoffice' as const, label: '管理部門' },
  { value: 'field_member' as const, label: '現場メンバー' },
  { value: 'customer' as const, label: '顧客' },
  { value: 'unknown' as const, label: '特定できない' },
  { value: 'other' as const, label: 'その他' },
];

const visibilityOptions = [
  {
    value: 'anonymous' as const,
    label: '匿名で共有',
    description: '入力者名を出さずに、認識のズレとして共有します。',
  },
  {
    value: 'manager_only' as const,
    label: '管理者にのみ共有',
    description: 'すり合わせの場を設定する管理者にだけ入力者を共有します。',
  },
  {
    value: 'named' as const,
    label: '名前を出して共有',
    description: '関係者に入力者名を共有したうえで、すり合わせを依頼します。',
  },
];

const processSteps = [
  ['STEP1', '違和感・もやもやを入力'],
  ['STEP2', '関係当事者の認識仮説を整理'],
  ['STEP3', '会社として確認すべき認識を整理'],
  ['STEP4', '擦り合わせるべきポイントを整理'],
  ['STEP5', 'すり合わせの場を依頼'],
] as const;

const exampleCases: ExampleCase[] = [
  {
    title: '関連部門が期待通りに動いてくれない',
    situation:
      '関連部門へ協力を依頼しているが、対応が遅かったり、期待していた水準まで動いてもらえなかったりする。',
    myRecognition:
      'こちらは全社的に重要な取り組みだと考えているため、関連部門にも優先度を上げて協力してほしい。',
    otherHypothesis:
      '相手部門は、自部門の通常業務や直近KPIを優先すべきだと考えており、この依頼の重要度が十分に伝わっていない可能性がある。',
    alignmentQuestion:
      'この取り組みは会社全体・各部門にとってどの程度優先すべきものなのか。どこまで協力する必要があるのか。',
  },
  {
    title: '経営が現場に無理な指示を出してくる',
    situation:
      '経営から新しい方針や指示が出るが、現場の人員・時間・業務量を踏まえると、実行するのが難しいと感じる。',
    myRecognition:
      '現場の実態を十分に理解しないまま指示が出ており、このままでは既存業務にも支障が出るのではないかと感じている。',
    otherHypothesis:
      '経営側は、会社として今やるべき重要テーマであり、現場にも工夫して実行してほしいと考えている可能性がある。',
    alignmentQuestion:
      '経営が実現したいことと、現場が実行できる範囲をどう擦り合わせ、優先順位やリソース配分を見直すべきか。',
  },
  {
    title: '失敗が許されず、挑戦しにくい',
    situation:
      '会社としては挑戦や変革が求められているが、実際には失敗すると評価が下がったり責任を問われたりするため、思い切った行動が取りにくい。',
    myRecognition:
      '挑戦しろと言われても、失敗したときの責任や評価への影響が大きく、現実的には安全な選択をせざるを得ない。',
    otherHypothesis:
      '経営・管理職側は、会社の成長には新しい挑戦が必要であり、現場にも主体的に動いてほしいと考えている可能性がある。',
    alignmentQuestion:
      'どこまでの挑戦なら許容されるのか。失敗した場合に何を学び、どのように評価・改善につなげるのか。',
  },
];

export default function OrgTransformationPage() {
  // ===== ユーザー情報 =====
  const userStore = useUserStore();
  const currentUserId = userStore.user?.id ?? null;
  const currentCompanyId = userStore.companyId ?? null;

  // ===== 入力フォームstate =====
  const [intakeDraft, setIntakeDraft] = useState<{
    situation_text?: string;
    my_recognition_text?: string;
    ideal_text?: string;
    expectation_text?: string;
    counterparty_type?: CounterpartyType;
    counterparty_detail?: string;
  }>({});
  const [intakeComplete, setIntakeComplete] = useState(false);
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>('manager_only');

  // ===== 生成・依頼state =====
  const [isGenerating, setIsGenerating] = useState(false);
  const [alignmentResult, setAlignmentResult] = useState<OrgAlignmentResult | null>(null);
  const [savedCaseId, setSavedCaseId] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestDone, setRequestDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // ===== 履歴一覧state =====
  const [myCases, setMyCases] = useState<OrgAlignmentCaseListItem[]>([]);
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!intakeComplete) return false;
    return [
      intakeDraft.situation_text,
      intakeDraft.my_recognition_text,
      intakeDraft.ideal_text,
      intakeDraft.expectation_text,
    ].some((value) => (value || '').trim().length > 0);
  }, [intakeDraft, intakeComplete]);

  const applyExample = (example: ExampleCase) => {
    setIntakeDraft({
      situation_text: example.situation,
      my_recognition_text: example.myRecognition,
      ideal_text: example.alignmentQuestion,
      expectation_text:
        '相手側の事情や優先順位も確認したうえで、企業としてどう動くべきかを一緒に整理したい。',
      counterparty_type: 'unknown',
    });
    setIntakeComplete(true);
  };

  // ===== 初回表示時に履歴を取得 =====
  useEffect(() => {
    if (!currentUserId) return;

    const loadMyCases = async () => {
      setIsLoadingCases(true);

      try {
        const cases = await getOrgAlignmentCasesByUser(currentUserId);
        setMyCases(cases);
      } catch (error) {
        console.error(error);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : '自分のすり合わせ履歴の取得に失敗しました。',
        );
      } finally {
        setIsLoadingCases(false);
      }
    };

    loadMyCases();
  }, [currentUserId]);

  // ===== AI生成処理 =====
  const handleGenerateAlignment = async () => {
    if (!canSubmit) return;

    setIsGenerating(true);
    setErrorMessage('');
    setAlignmentResult(null);

    try {
      // Get Supabase auth session
      const { ok: sessionOk, data: sessionData, error: sessionError } = await safeGetSession();

      if (!sessionOk || !sessionData?.session?.access_token) {
        setErrorMessage('ログイン情報を確認できません。再ログインしてください。');
        setIsGenerating(false);
        return;
      }

      // OpenAI APIでAI整理を実行
      const response = await fetch('/api/org-alignment/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          situationText: intakeDraft.situation_text,
          myRecognitionText: intakeDraft.my_recognition_text,
          idealText: intakeDraft.ideal_text,
          expectationText: intakeDraft.expectation_text,
          counterpartyType: intakeDraft.counterparty_type || 'unknown',
          counterpartyDetail: intakeDraft.counterparty_detail,
          visibilityMode,
          strategyContext: null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error ||
            `API error: ${response.status} ${response.statusText}`,
        );
      }

      const responseData = await response.json();
      // ★ DEBUG: API レスポンスのデバッグ情報をログ出力
      console.log('[ORG-ALIGNMENT DEBUG]', responseData.debug);

      const aiResult = responseData.result as OrgAlignmentResult;

      if (!aiResult) {
        throw new Error('AI整理結果が返されません。');
      }

      // Supabaseに保存
      const saved = await saveOrgAlignmentCase({
        companyId: currentCompanyId,
        userId: currentUserId,
        situationText: intakeDraft.situation_text || '',
        myRecognitionText: intakeDraft.my_recognition_text || '',
        idealText: intakeDraft.ideal_text || '',
        expectationText: intakeDraft.expectation_text || '',
        counterpartyType: intakeDraft.counterparty_type || 'unknown',
        counterpartyDetail: intakeDraft.counterparty_detail,
        visibilityMode,
        aiResult,
      });

      setSavedCaseId(saved.id);
      setAlignmentResult(aiResult);
      setRequestDone(false);

      // 履歴一覧を再取得
      if (currentUserId) {
        const cases = await getOrgAlignmentCasesByUser(currentUserId);
        setMyCases(cases);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error
          ? `認識のズレの整理に失敗しました: ${error.message}`
          : '認識のズレの整理・保存に失敗しました。時間をおいて再度お試しください。',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // ===== すり合わせ依頼処理 =====
  const handleRequestAlignment = async () => {
    if (!alignmentResult) return;

    if (!savedCaseId) {
      setErrorMessage(
        '保存済みの整理結果が見つかりません。もう一度AI整理を実行してください。',
      );
      return;
    }

    setIsRequesting(true);
    setErrorMessage('');

    try {
      // TODO: API実装後に以下に差し替え
      // const response = await fetch('/api/org-alignment/request', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     caseId: savedCaseId,
      //     visibilityMode,
      //   }),
      // });

      // if (!response.ok) {
      //   throw new Error('すり合わせ依頼に失敗しました。');
      // }

      // Supabaseで依頼状態に更新
      await requestOrgAlignmentCase(savedCaseId, visibilityMode);

      setRequestDone(true);

      // 履歴一覧を再取得
      if (currentUserId) {
        const cases = await getOrgAlignmentCasesByUser(currentUserId);
        setMyCases(cases);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(
        'すり合わせ依頼に失敗しました。時間をおいて再度お試しください。',
      );
    } finally {
      setIsRequesting(false);
    }
  };

  // ===== Helper関数 =====
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'draft':
        return '下書き';
      case 'generated':
        return 'AI整理済み';
      case 'alignment_requested':
        return 'すり合わせ依頼済み';
      case 'in_alignment':
        return '対応中';
      case 'closed':
        return '完了';
      default:
        return '未設定';
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '';

    try {
      return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value));
    } catch {
      return value;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-12">
        {/* ===== 1. ページヘッダー：白枠カードなし ===== */}
        <header className="px-1 py-8 md:py-12">
          <p className="mb-3 text-xs font-semibold tracking-[0.28em] text-slate-500">
            ORGANIZATION ALIGNMENT ROOM
          </p>

          <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">
            組織変革・すり合わせルーム
          </h1>

          <p className="mt-7 max-w-4xl text-2xl font-semibold leading-relaxed text-slate-950 md:text-3xl">
            人と組織の問題を、「認識のズレ」から捉え直す。
          </p>

          <div className="mt-6 max-w-5xl space-y-4 text-base leading-8 text-slate-700 md:text-lg">
            <p>
              人と組織の問題は、意識やコミュニケーション、組織風土を変えるだけでは解決しません。
              <br />
              その背景には、{" "}
              <span className="font-semibold text-slate-950">方針・戦略、優先順位、役割責任、評価、意思決定に対する互いの認識のズレ</span>
              {" "}が潜んでいることが多いからです。<br /><br />当ルームでは、個人が抱える違和感やモヤモヤを起点として「認識のズレ」をAIで構造的に整理。<br />会社が目指す方向性を軸に、経営、現場、部門の認識をかみ合わせ、組織全体の判断と行動のスピードを揃えていきます。
            </p>
          </div>

</header>

        {/* ===== 2. あるある事例 ===== */}
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-2xl font-bold text-slate-950">
              よくある違和感、もやもや
            </h2>
            
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {exampleCases.map((example) => (
              <article
                key={example.title}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-base font-bold leading-7 text-slate-950">
                  {example.title}
                </h3>

                <p className="mt-2 flex-1 text-sm leading-7 text-slate-600">
                  {example.situation}
                </p>

                <button
                  type="button"
                  onClick={() => applyExample(example)}
                  className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                >
                  この事例を入力欄に反映
                </button>
              </article>
            ))}
          </div>
        </section>

        {/* ===== 3. STEP1：チャット式入力セクション ===== */}
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-2xl font-bold text-slate-950">
              STEP1：AIとのヒアリングで違和感を整理
            </h2>
            <p className="text-slate-600">
              AIとの対話を通じて、現場の違和感やもやもやを具体的に整理します。
              最大2回の追加質問を通じて、STEP2以降の生成品質を高めます。
            </p>
          </div>

          {!intakeComplete ? (
            <>
              {/* チャット式ヒアリング */}
              <OrgAlignmentIntakeChat
                onComplete={(draft) => {
                  setIntakeDraft(draft);
                  setIntakeComplete(true);
                }}
              />

              {/* あるある事例 */}
              <div className="space-y-4">
                <p className="text-sm font-semibold text-slate-600">
                  イメージが湧きづらい場合は、事例から始めることもできます。
                </p>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {exampleCases.map((example) => (
                    <article
                      key={example.title}
                      className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <h3 className="text-base font-bold leading-7 text-slate-950">
                        {example.title}
                      </h3>

                      <p className="mt-2 flex-1 text-sm leading-7 text-slate-600">
                        {example.situation}
                      </p>

                      <button
                        type="button"
                        onClick={() => {
                          applyExample(example);
                        }}
                        className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                      >
                        この事例から始める
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* 整理カード確認 */}
              <OrgAlignmentIntakeReviewCard
                draft={intakeDraft}
                onUpdate={(updatedDraft) => setIntakeDraft(updatedDraft)}
                onProceed={handleGenerateAlignment}
                isProcessing={isGenerating}
              />

              {/* すり合わせの場を依頼する際の共有範囲 */}
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    6. すり合わせの場を依頼する際の共有範囲
                  </p>
                  <p className="mt-1 text-xs leading-6 text-slate-500">
                    STEP5で「すり合わせの場を依頼」を選択した場合、どの範囲に共有するかを選択できます。
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {visibilityOptions.map((option) => {
                      const isSelected = visibilityMode === option.value;

                      return (
                        <label
                          key={option.value}
                          className={`relative block cursor-pointer rounded-2xl border bg-white p-4 pl-11 transition-colors ${
                            isSelected
                              ? 'border-slate-900 ring-1 ring-slate-900'
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="visibilityMode"
                            value={option.value}
                            checked={isSelected}
                            onChange={() => setVisibilityMode(option.value)}
                            className="absolute left-4 top-5 h-4 w-4 accent-slate-950"
                          />

                          <span className="block w-full text-sm font-semibold leading-6 text-slate-950">
                            {option.label}
                          </span>

                          <span className="mt-1 block w-full text-xs leading-6 text-slate-500">
                            {option.description}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 入力内容をリセットするオプション */}
              <button
                type="button"
                onClick={() => {
                  setIntakeDraft({});
                  setIntakeComplete(false);
                }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
              >
                最初からやり直す
              </button>
            </>
          )}
        </section>

        {/* ===== 4. 生成結果セクション（STEP2～STEP5） ===== */}
        {alignmentResult && (
          <section className="space-y-5">
            <div>
              <h2 className="mb-2 text-2xl font-bold text-slate-950">
                AIが整理した認識のズレ
              </h2>
              <p className="text-slate-600">
                入力内容を、個人や部署への批判ではなく、擦り合わせるべき認識のズレとして整理しました。
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold tracking-wide text-slate-400">
                分類
              </p>
              <p className="mt-1 font-semibold text-slate-950">
                {alignmentResult.issueType}
              </p>

              <h3 className="mt-5 text-lg font-bold text-slate-950">
                {alignmentResult.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {alignmentResult.inputSummary}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">STEP2</p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">
                  関係当事者の認識仮説
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {alignmentResult.participantRecognitionHypothesis}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">STEP3</p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">
                  {alignmentResult.companyRecognitionTitle}
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {alignmentResult.companyRecognition}
                </p>

                {alignmentResult.companyRecognitionMode === 'needs_confirmation' && (
                  <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                    現在、会社の戦略・部門方針・OKR・実行計画の情報が十分に連携されていないため、
                    ここでは断定ではなく、会社として確認すべき判断基準として整理しています。
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">STEP4</p>
              <h3 className="mt-1 text-lg font-bold text-slate-950">
                擦り合わせるべきポイント
              </h3>

              <ul className="mt-4 space-y-3">
                {alignmentResult.alignmentPoints.map((point, index) => (
                  <li key={index} className="flex items-start gap-3 text-sm leading-7 text-slate-700">
                    <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">STEP5</p>
              <h3 className="mt-1 text-lg font-bold text-slate-950">
                {alignmentResult.recommendedNextAction.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {alignmentResult.recommendedNextAction.detail}
              </p>

              <button
                type="button"
                onClick={handleRequestAlignment}
                disabled={isRequesting || requestDone}
                className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {requestDone ? 'すり合わせ依頼済み' : isRequesting ? '依頼しています...' : 'すり合わせの場を依頼'}
              </button>
            </div>

            {errorMessage && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {errorMessage}
              </div>
            )}
          </section>
        )}

        {/* ===== 自分のすり合わせ履歴 ===== */}
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-2xl font-bold text-slate-950">
              自分のすり合わせ履歴
            </h2>
            <p className="text-slate-600">
              自分が入力し、AIで整理した認識のズレと、すり合わせ依頼の状況を確認できます。
            </p>
          </div>

          {!currentUserId && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-7 text-slate-600 shadow-sm">
              ログインユーザー情報を確認できないため、履歴一覧は表示できません。
              AI整理と保存は可能ですが、後から自分の履歴として表示するにはユーザーIDの連携が必要です。
            </div>
          )}

          {currentUserId && (
            <>
              {isLoadingCases ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                  履歴を読み込んでいます...
                </div>
              ) : myCases.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-7 text-slate-600 shadow-sm">
                  まだ保存されたすり合わせ履歴はありません。
                </div>
              ) : (
                <div className="space-y-3">
                  {myCases.map((item) => {
                    const result = item.ai_result as OrgAlignmentResult | null;
                    const isExpanded = expandedCaseId === item.id;

                    return (
                      <article
                        key={item.id}
                        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                {getStatusLabel(item.status)}
                              </span>

                              {result?.issueType && (
                                <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                                  {result.issueType}
                                </span>
                              )}
                            </div>

                            <h3 className="text-base font-bold text-slate-950">
                              {result?.title ?? item.situation_text ?? '無題のすり合わせ'}
                            </h3>

                            <p className="mt-2 text-sm leading-7 text-slate-600">
                              {result?.inputSummary ?? item.situation_text}
                            </p>

                            <p className="mt-2 text-xs text-slate-400">
                              {formatDateTime(item.created_at)}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCaseId(isExpanded ? null : item.id)
                            }
                            className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                          >
                            {isExpanded ? '閉じる' : '詳細を見る'}
                          </button>
                        </div>

                        {isExpanded && result && (
                          <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
                            <div>
                              <p className="text-xs font-semibold text-slate-400">
                                関係当事者の認識仮説
                              </p>
                              <p className="mt-1 text-sm leading-7 text-slate-700">
                                {result.participantRecognitionHypothesis}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs font-semibold text-slate-400">
                                {result.companyRecognitionTitle}
                              </p>
                              <p className="mt-1 text-sm leading-7 text-slate-700">
                                {result.companyRecognition}
                              </p>
                            </div>

                            <div>
                              <p className="text-xs font-semibold text-slate-400">
                                擦り合わせるべきポイント
                              </p>
                              <ul className="mt-2 space-y-2">
                                {result.alignmentPoints.map((point) => (
                                  <li
                                    key={point}
                                    className="flex items-start gap-2 text-sm leading-7 text-slate-700"
                                  >
                                    <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                                    <span>{point}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
