"use client";

import { useMemo, useState, useEffect } from "react";
import {
  saveOrgAlignmentCase,
  requestOrgAlignmentCase,
  getOrgAlignmentCasesByUser,
  deleteOrgAlignmentCase,
  type OrgAlignmentCaseListItem,
} from "@/utils/supabase";
import { safeGetSession } from "@/utils/supabase/client";
import { useUserStore } from "@/store/userStore";
import { useStrategyStore } from "@/store/strategyStore";
import OrgAlignmentFixedIntakeForm from "@/components/org-transformation/OrgAlignmentFixedIntakeForm";
import OrgAlignmentIntakeReviewCard from "@/components/org-transformation/OrgAlignmentIntakeReviewCard";
import {
  type VisibilityMode,
  type CounterpartyType,
  type OrgAlignmentStatus,
  type OrgAlignmentIssueType,
  type CompanyRecognitionMode,
  type OrgAlignmentResult,
} from "@/types/org-alignment";

// ===== 選択肢定義 =====
const counterpartyOptions = [
  { value: "executive" as const, label: "経営" },
  { value: "manager" as const, label: "上司・管理職" },
  { value: "own_department" as const, label: "自部門" },
  { value: "other_department" as const, label: "他部門・関連部門" },
  { value: "backoffice" as const, label: "管理部門" },
  { value: "field_member" as const, label: "現場メンバー" },
  { value: "customer" as const, label: "顧客" },
  { value: "unknown" as const, label: "特定できない" },
  { value: "other" as const, label: "その他" },
];

const visibilityOptions = [
  {
    value: "anonymous" as const,
    label: "匿名で共有",
    description: "入力者名を出さずに、認識のズレとして共有します。",
  },
  {
    value: "manager_only" as const,
    label: "管理者にのみ共有",
    description: "すり合わせの場を設定する管理者にだけ入力者を共有します。",
  },
  {
    value: "named" as const,
    label: "名前を出して共有",
    description: "関係者に入力者名を共有したうえで、すり合わせを依頼します。",
  },
];

const processSteps = [
  ["STEP1", "違和感・もやもやを入力"],
  ["STEP2", "関係当事者の認識仮説を整理"],
  ["STEP3", "会社として確認すべき認識を整理"],
  ["STEP4", "擦り合わせるべきポイントを整理"],
  ["STEP5", "すり合わせの場を依頼"],
] as const;

export default function OrgTransformationPage() {
  // ===== ユーザー情報 =====
  const userStore = useUserStore();
  const currentUserId = userStore.user?.id ?? null;
  const currentCompanyId = userStore.companyId ?? null;

  // ===== 戦略情報 =====
  const strategyStore = useStrategyStore();
  const currentStrategyId = strategyStore.strategyId ?? null;

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
  const [visibilityMode, setVisibilityMode] =
    useState<VisibilityMode>("manager_only");

  // ===== 生成・依頼state =====
  const [isGenerating, setIsGenerating] = useState(false);
  const [alignmentResult, setAlignmentResult] =
    useState<OrgAlignmentResult | null>(null);
  const [savedCaseId, setSavedCaseId] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestDone, setRequestDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // ===== 履歴一覧state =====
  const [myCases, setMyCases] = useState<OrgAlignmentCaseListItem[]>([]);
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [deletingCaseId, setDeletingCaseId] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!intakeComplete) return false;
    return [
      intakeDraft.situation_text,
      intakeDraft.my_recognition_text,
      intakeDraft.ideal_text,
      intakeDraft.expectation_text,
    ].some((value) => (value || "").trim().length > 0);
  }, [intakeDraft, intakeComplete]);

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
            : "自分のすり合わせ履歴の取得に失敗しました。",
        );
      } finally {
        setIsLoadingCases(false);
      }
    };

    loadMyCases();
  }, [currentUserId]);

  // ===== 固定フォーム送信処理（直接 generate を実行） =====
  const handleFixedIntakeSubmit = async (formData: {
    situationText: string;
    myRecognitionText: string;
    idealText: string;
    expectationText: string;
    counterpartyType: CounterpartyType;
    counterpartyDetail: string;
    visibilityMode: VisibilityMode;
  }) => {
    setIsGenerating(true);
    setErrorMessage("");
    setAlignmentResult(null);
    setIntakeDraft({}); // reset draft
    setIntakeComplete(false); // reset completion flag

    try {
      // Get Supabase auth session
      const {
        ok: sessionOk,
        data: sessionData,
        error: sessionError,
      } = await safeGetSession();

      if (!sessionOk || !sessionData?.session?.access_token) {
        setErrorMessage(
          "ログイン情報を確認できません。再ログインしてください。",
        );
        setIsGenerating(false);
        return;
      }

      // OpenAI APIでAI整理を実行
      const response = await fetch("/api/org-alignment/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          situationText: formData.situationText,
          myRecognitionText: formData.myRecognitionText,
          idealText: formData.idealText,
          expectationText: formData.expectationText,
          counterpartyType: formData.counterpartyType || "unknown",
          counterpartyDetail: formData.counterpartyDetail,
          visibilityMode: formData.visibilityMode,
          strategyId: currentStrategyId,
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
      console.log("[ORG-ALIGNMENT DEBUG]", responseData.debug);

      const aiResult = responseData.result as OrgAlignmentResult;

      if (!aiResult) {
        throw new Error("AI整理結果が返されません。");
      }

      // Supabaseに保存
      const saved = await saveOrgAlignmentCase({
        companyId: currentCompanyId,
        userId: currentUserId,
        situationText: formData.situationText,
        myRecognitionText: formData.myRecognitionText,
        idealText: formData.idealText,
        expectationText: formData.expectationText,
        counterpartyType: formData.counterpartyType,
        counterpartyDetail: formData.counterpartyDetail,
        visibilityMode: formData.visibilityMode,
        aiResult,
      });

      setSavedCaseId(saved.id);
      setAlignmentResult(aiResult);
      setRequestDone(false);
      setVisibilityMode(formData.visibilityMode); // visibility_mode も更新

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
          : "認識のズレの整理・保存に失敗しました。時間をおいて再度お試しください。",
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
        "保存済みの整理結果が見つかりません。もう一度AI整理を実行してください。",
      );
      return;
    }

    setIsRequesting(true);
    setErrorMessage("");

    try {
      const {
        ok: sessionOk,
        data: sessionData,
        error: sessionError,
      } = await safeGetSession();

      if (!sessionOk || !sessionData?.session?.access_token) {
        setErrorMessage(
          "ログイン情報を確認できません。再ログインしてください。",
        );
        setIsRequesting(false);
        return;
      }

      const response = await fetch(
        `/api/org-alignment/cases/${savedCaseId}/request-alignment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionData.session.access_token}`,
          },
          body: JSON.stringify({
            visibilityMode,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[request-alignment] API error:', {
          status: response.status,
          errorData,
          caseId: savedCaseId,
        });
        const errorMessage =
          errorData.detail ||
          errorData.error ||
          `API error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      setRequestDone(true);

      // 履歴一覧を再取得
      if (currentUserId) {
        const cases = await getOrgAlignmentCasesByUser(currentUserId);
        setMyCases(cases);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error
          ? `すり合わせ依頼に失敗しました: ${error.message}`
          : "すり合わせ依頼に失敗しました。時間をおいて再度お試しください。",
      );
    } finally {
      setIsRequesting(false);
    }
  };

  // ===== 履歴削除処理 =====
  const handleDeleteCase = async (caseId: string) => {
    if (!currentUserId) {
      setErrorMessage(
        "ログインユーザー情報を確認できないため、履歴を削除できません。",
      );
      return;
    }

    const confirmed = window.confirm(
      "このすり合わせ履歴を削除します。削除後は元に戻せません。よろしいですか？",
    );

    if (!confirmed) return;

    setDeletingCaseId(caseId);
    setErrorMessage("");

    try {
      await deleteOrgAlignmentCase(caseId, currentUserId);

      setMyCases((prev) => prev.filter((item) => item.id !== caseId));
      setExpandedCaseId((prev) => (prev === caseId ? null : prev));
      if (savedCaseId === caseId) {
        setSavedCaseId(null);
        setAlignmentResult(null);
        setRequestDone(false);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error
          ? `履歴の削除に失敗しました: ${error.message}`
          : "履歴の削除に失敗しました。時間をおいて再度お試しください。",
      );
    } finally {
      setDeletingCaseId(null);
    }
  };

  // ===== Helper関数 =====
  const getStatusLabel = (status: string) => {
    switch (status) {
      case "draft":
        return "下書き";
      case "generated":
        return "AI整理済み";
      case "alignment_requested":
        return "すり合わせ依頼済み";
      case "in_alignment":
        return "対応中";
      case "closed":
        return "完了";
      default:
        return "未設定";
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return "";

    try {
      return new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
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
            組織変革・違和感を伝えるルーム
          </h1>

          <p className="mt-4 max-w-4xl text-2xl font-semibold leading-relaxed text-slate-950 md:text-1xl">
            組織は、モチベーション、コミュニケーション、カルチャーだけでは変わらない
          </p>

          <div className="mt-6 max-w-5xl space-y-4 text-base leading-8 text-slate-700 md:text-lg">
            <p>
              社内の不満や違和感の背景には、単なる人同士の関係性だけでなく、方針、仕組み、優先順位、役割責任、評価、意思決定への不納得感があります。
              <br /> GROWTH SHIFTは、それを人や組織の対立構造ではなく、経営、部門、現場、それぞれの立場による見え方や、言葉の定義などの<span className="font-semibold text-slate-950">
                「認識のズレ」
              </span>{" "}の構造として可視化し、整理します。<br />
              <br /> 
              そして、そのズレをSTAGE1〜3の会社の方向性と照らし合わせながら、「今、会社にとって本当に議論し解決すべきポイントは何か」を明確にします。
              <br />誰かを責めるのではなく、現場の違和感を組織の課題解決につなげ、会社全体の判断基準と行動を変えていくためのルームです。
            </p>
          </div>
        </header>

        {/* ===== 2. STEP1：固定4問フォームセクション ===== */}
        <section className="space-y-5">
          {!alignmentResult ? (
            <>
              {/* 固定4問フォーム - 直接 generate に繋ぐ */}
              <OrgAlignmentFixedIntakeForm
                onSubmit={handleFixedIntakeSubmit}
              />
            </>
          ) : null}
        </section>

        {/* ===== 3. 生成結果セクション（STEP2～STEP5） ===== */}
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

                {alignmentResult.companyRecognitionMode ===
                  "needs_confirmation" && (
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
                  <li
                    key={index}
                    className="flex items-start gap-3 text-sm leading-7 text-slate-700"
                  >
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
                {requestDone
                  ? "すり合わせ依頼済み"
                  : isRequesting
                    ? "依頼しています..."
                    : "すり合わせの場を依頼"}
              </button>
            </div>

            {errorMessage && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            {/* 最初からやり直すボタン */}
            <button
              type="button"
              onClick={() => {
                setAlignmentResult(null);
                setSavedCaseId(null);
                setRequestDone(false);
              }}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
            >
              最初からやり直す
            </button>
          </section>
        )}

        {/* ===== 4. 自分のすり合わせ履歴 ===== */}
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
                              {result?.title ??
                                item.situation_text ??
                                "無題のすり合わせ"}
                            </h3>

                            <p className="mt-2 text-sm leading-7 text-slate-600">
                              {result?.inputSummary ?? item.situation_text}
                            </p>

                            <p className="mt-2 text-xs text-slate-400">
                              {formatDateTime(item.created_at)}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCaseId(isExpanded ? null : item.id)
                              }
                              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                            >
                              {isExpanded ? "閉じる" : "詳細を見る"}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteCase(item.id)}
                              disabled={deletingCaseId === item.id}
                              className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-red-50 disabled:text-red-300"
                            >
                              {deletingCaseId === item.id
                                ? "削除中..."
                                : "削除"}
                            </button>
                          </div>
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
