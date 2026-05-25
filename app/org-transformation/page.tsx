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
  const [situationText, setSituationText] = useState<string>('');
  const [myRecognitionText, setMyRecognitionText] = useState<string>('');
  const [idealText, setIdealText] = useState<string>('');
  const [expectationText, setExpectationText] = useState<string>('');
  const [counterpartyType, setCounterpartyType] = useState<CounterpartyType>('unknown');
  const [counterpartyDetail, setCounterpartyDetail] = useState<string>('');
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
    return [situationText, myRecognitionText, idealText, expectationText].some(
      (value) => value.trim().length > 0,
    );
  }, [situationText, myRecognitionText, idealText, expectationText]);

  const applyExample = (example: ExampleCase) => {
    setSituationText(example.situation);
    setMyRecognitionText(example.myRecognition);
    setIdealText(example.alignmentQuestion);
    setExpectationText(
      '相手側の事情や優先順位も確認したうえで、企業としてどう動くべきかを一緒に整理したい。',
    );
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

  // ===== Mock結果生成ヘルパー =====
  const createMockAlignmentResult = (input: {
    situationText: string;
    myRecognitionText: string;
    idealText: string;
    expectationText: string;
    counterpartyType: CounterpartyType;
    counterpartyDetail: string;
  }): OrgAlignmentResult => {
    return {
      title: '関連部門の優先順位と協力範囲の認識のズレ',
      inputSummary: `${input.situationText || '違和感'} という状況で、本来のあり方についての考えと相手方の優先順位にズレがある可能性があります。`,
      issueType: '部門間連携のズレ',
      participantRecognitionHypothesis:
        input.counterpartyType !== 'unknown'
          ? `${counterpartyOptions.find((opt) => opt.value === input.counterpartyType)?.label || '関係当事者'}は、自部門の通常業務や直近KPIを優先すべきだと考えており、この依頼の重要度が十分に伝わっていない可能性があります。${input.counterpartyDetail ? `（${input.counterpartyDetail}）` : ''}`
          : '関係当事者は、自部門の通常業務や直近KPIを優先すべきだと考えており、この依頼の重要度が十分に伝わっていない可能性があります。',
      companyRecognitionMode: 'needs_confirmation',
      companyRecognitionTitle: '会社として確認すべき認識',
      companyRecognition:
        '会社として、この取り組みの優先度、関連部門にとっての価値、必要なリソース・協力範囲、意思決定基準を確認する必要があります。部門都合だけではなく、全社的な価値判断や経営方針に照らし合わせることが重要です。',
      alignmentPoints: [
        'この取り組みが会社全体にとってどの程度重要であり、優先度をどう判断するか',
        '関連部門にとって、どのような価値・リスク・工数が伴い、何を得られるのか',
        '協力範囲の現実的な限界は何か、代替案はあるのか',
        '優先順位やリソース配分の判断基準は何か、他の施策とのバランスはどう取るのか',
      ],
      recommendedNextAction: {
        title: 'すり合わせの場を依頼',
        detail:
          '関連部門と管理者を交えて、取り組みの重要度、協力範囲、優先順位、リソース配分について確認し、認識を一致させる場を設定します。',
      },
      riskLevel: 'medium',
      riskReason:
        '優先順位や役割分担が曖昧なままだと、部門間の協力が進まず、重要施策の実行が遅れる可能性があります。',
    };
  };

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
          situationText,
          myRecognitionText,
          idealText,
          expectationText,
          counterpartyType,
          counterpartyDetail,
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
        situationText,
        myRecognitionText,
        idealText,
        expectationText,
        counterpartyType,
        counterpartyDetail,
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

        {/* ===== 3. STEP1：入力セクション ===== */}
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-2xl font-bold text-slate-950">
              STEP1：もやもやと自分の認識を入力
            </h2>
            <p className="text-slate-600">
              まずは、現場で起きている違和感をそのまま入力してください。
              入力者自身の認識は本人が言語化し、AIは相手方の認識を仮説として整理します。
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">
                  1. どんな場面でもやもやしましたか？
                </span>
                <textarea
                  value={situationText}
                  onChange={(e) => setSituationText(e.target.value)}
                  placeholder="例：関連部門へ協力を依頼しているが、対応が遅かったり、期待していた水準まで動いてもらえなかったりする。"
                  className="min-h-[150px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">
                  2. その時、自分はどう受け止めましたか？
                </span>
                <textarea
                  value={myRecognitionText}
                  onChange={(e) => setMyRecognitionText(e.target.value)}
                  placeholder="例：全社的に重要な取り組みだと思っているが、相手部門には優先度が十分に伝わっていないように感じた。"
                  className="min-h-[150px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">
                  3. 本来どうあるべきだと思いますか？
                </span>
                <textarea
                  value={idealText}
                  onChange={(e) => setIdealText(e.target.value)}
                  placeholder="例：会社として優先すべき取り組みであれば、部門間で優先順位や協力範囲を明確にすべきだと思う。"
                  className="min-h-[150px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-900">
                  4. 相手に何を期待していましたか？
                </span>
                <textarea
                  value={expectationText}
                  onChange={(e) => setExpectationText(e.target.value)}
                  placeholder="例：相手部門の事情も踏まえたうえで、どこまで協力できるのか、どの条件なら進められるのかを話し合ってほしい。"
                  className="min-h-[150px] w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </label>
            </div>

            {/* 相手属性の選択 */}
            <div className="mt-6 space-y-3">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-900">
                  5. 関係している相手・部門（任意）
                </span>
                <select
                  value={counterpartyType}
                  onChange={(e) => setCounterpartyType(e.target.value as CounterpartyType)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  {counterpartyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {counterpartyType !== 'unknown' && counterpartyType !== 'other' && (
                <div className="text-xs text-slate-500">
                  選択した相手方を名指しするのではなく、その可能性のある認識として、AIが仮説として整理します。
                </div>
              )}

              {counterpartyType === 'other' && (
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-slate-900">
                    相手方の詳細
                  </span>
                  <input
                    type="text"
                    value={counterpartyDetail}
                    onChange={(e) => setCounterpartyDetail(e.target.value)}
                    placeholder="例：外部パートナー、その他"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                </label>
              )}
            </div>

            {/* 6. すり合わせの場を依頼する際の共有範囲 */}
            <div className="space-y-3 md:col-span-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  6. すり合わせの場を依頼する際の共有範囲
                </p>
                <p className="mt-1 text-xs leading-6 text-slate-500">
                  STEP5で「すり合わせの場を依頼」を選択した場合、どの範囲に共有するかを選択できます。
                </p>
              </div>

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

            <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">
              入力された内容は、個人や部門を責めるためではなく、認識のズレを整理し、
              擦り合わせるために使います。AIの提示内容は断定ではなく、対話の入口となる仮説です。
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={handleGenerateAlignment}
                disabled={!canSubmit || isGenerating}
                className={`rounded-xl px-6 py-3 font-semibold transition-colors ${
                  !canSubmit || isGenerating
                    ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                    : 'bg-slate-950 text-white hover:bg-slate-900'
                }`}
              >
                {isGenerating ? '整理・保存しています...' : 'AIで認識のズレを整理する'}
              </button>
            </div>
          </div>
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
