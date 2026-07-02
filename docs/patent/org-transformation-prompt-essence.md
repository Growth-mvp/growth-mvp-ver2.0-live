# GROWTHSHIFTの組織変革・すり合わせ機能 プロンプト指示エッセンス表

**対象機能**: 組織変革・違和感を伝えるルーム、全社すり合わせルーム、STAGE3/STAGE4への反映候補生成  
**作成日**: 2026-07-01  
**目的**: ソフトウェア特許出願向けの資料として、プロンプト全文ではなくAI処理のデータ処理内容を開示

---

## 処理フロー概要

```
【STEP1: 社員の違和感入力】
  intake/route.ts: 多ターン対話でユーザー入力を段階的に収集
           ↓ [違和感ドラフト出力]
【STEP2: 会社固有データを踏まえたAI構造化・照合】
  generate/route.ts: STAGE1〜3情報と照合し「認識のズレ」として構造化
           ↓ [org_alignment_cases に保存]
【STEP3: 全社AI集計・論点化】
  admin/insights/generate/route.ts: 全社ケースを AI が3〜5個の論点にまとめて可視化
           ↓ [org_alignment_insights + shared_topics 自動作成]
【STEP4: すり合わせ状況管理】
  shared/topics/[id]/route.ts: 論点のすり合わせ結果（alignment_result, changed_things等）を管理
           ↓ [status遷移: published → in_alignment → action_planned → reflected → closed]
【STEP5: STAGE3/4への反映候補生成】
  reflection-candidates/route.ts: shared_topic の strategy_reflection から
                   STAGE3/4向けの projects/OKRs候補を生成・登録
```

---

## 処理別プロンプト指示エッセンス表

| 処理番号 | 処理名 | 入力データ | 参照データ | AIへの指示エッセンス | 注意条件・制約 | 出力データ | 発明上の特徴 |
|---|---|---|---|---|---|---|---|
| **1** | **社員の違和感入力情報の取得** | ユーザーメッセージ（自然言語）、conversationHistory（会話履歴）、currentDraft（段階的に収集中の構造化データ）、conversationRound（ターン数） | 各種テンプレート質問、入力意図判定用辞書 | 【inputIntent判定】ユーザー入力の意図を「needs_input_help（入力支援要求）」「emotional_venting（感情的発散）」「personal_attack（人格攻撃）」「sensitive_or_harassment（ハラスメント）」「too_vague（曖昧）」「actual_concern（実際の違和感）」等に分類し、それぞれ異なるサポート応答を生成。【多ターン対話】次の段階の質問（generateFollowUpQuestion）を動的に生成し、ユーザーから「どんな場面でもやもやしたか」「自分の受け止め」「本来あるべき姿」「期待していたこと」「関係する相手・部門」を段階的に引き出す。 | ・感情的発散や人格攻撃は入力支援・リダイレクトで対応、直接整理には進めない。・ハラスメント系キーワード検出時は慎重対応。・1回の対話で自動判定、4〜5ターンで情報を揃える。 | IntakeResponse（assistantMessage, status: 'asking'\|'ready_for_review', draft: {situation_text, my_recognition_text, ideal_text, expectation_text, counterparty_type, counterparty_detail}, conversationRound） | **多段階フォーム自動化**: 自然言語でのフリー入力から、ユーザー意図を判定して異なるサポートを提供。不適切な入力を弾きつつ、有効な違和感を段階的に構造化。 |
| **2** | **会社固有データを踏まえたAI認識構造化・照合処理** | situationText, myRecognitionText, idealText, expectationText（ステップ1からの4点セット）、counterpartyType（相手・部門の種類）、strategyContext（ペイロードまたはDB取得） | STAGE1: mission, vision, value, ceoIntent / STAGE2: story, answers2, winPatterns（全社戦略） / STAGE3: departments（部門ミッション・プロジェクト・KPI）、companyTargets（KPI判断基準） | 【18種類のissueType分類と分類別指示】各issueTypeごとに異なる「concernTypeInstruction」を動的に挿入。例：「部門間協力のズレ」なら「部門や担当者を責めず、どこまで協力すべきか、どの役割責任を誰が持つかが揃っていない状態として整理せよ」「優先順位のズレ」なら「やる気の問題ではなく、全社・部門・現場で何を優先すべきかの判断基準が揃っていない状態として整理せよ」など。【strategy_based vs needs_confirmation】STAGE1〜3情報の有無で companyRecognitionMode を自動判定（mission/vision/value/ceoIntent または departments/companyTargets が存在すれば strategy_based、そうでなければ needs_confirmation）。【相手側認識の仮説化】入力内容から「相手方・制度設計側・経営側の限られた情報・時間・役割責任の中での合理的行動」を仮説として生成し、個人批判を避ける。【会社としての認識生成】strategy_based の場合、STAGE1〜3の戦略情報を判断材料として使い「会社として何を確認すべきか」「どの判断基準・優先順位・役割責任が揃っていないか」を導き出す。ただし、存在しない戦略情報は捏造しない。 | ・AIの分類ブレを防ぐため、issueType, companyRecognitionMode, companyRecognitionTitle をサーバー側で固定。・相手側の行動が会社方針・KPI・優先順位と関係する場合のみ戦略情報を反映。・入力者の違和感を無理に戦略用語へ置き換えない。・温度0.25、JSON出力モード固定。 | OrgAlignmentResult: {title, inputSummary, issueType（固定）, participantRecognitionHypothesis（相手側認識仮説）, companyRecognitionMode（固定）, companyRecognitionTitle（固定）, companyRecognition（会社としての認識）, alignmentPoints[]（すり合わせの場で確認できる問い3〜5個）, recommendedNextAction{title, detail}, riskLevel（low\|medium\|high）, riskReason} + debug情報（STAGE別availability） | **会社戦略に基づいた認識構造化**: 個人の不満を「会社方針・優先順位・役割責任・評価・KPIとの認識ズレ」として再フレーミング。相手側の行動を「その役割・KPI・制約下での合理的判断」として仮説化。STAGE1〜3を参照してズレの本質を浮かび上がせる。 |
| **3** | **全社すり合わせ論点化・可視化処理** | cases[]（org_alignment_cases テーブルの全ケース、各ケースに ai_result フィールド含む）、departments[]（STAGE3の部門情報） | STAGE1〜3の会社方針・部門戦略・KPI・プロジェクト情報 | 【全社AI集計指示】複数のケース（個別の違和感ケース）を分析し、会社全体の視点で「組織として対処すべき論点」を3〜5個に集約。【発行型論点化】単なる分類ではなく、各論点について「タイトル、詳細説明、関連issueType、影響部門、優先度スコア、重要度・緊急度、現場の認識 vs 会社としての認識、判断軸、推奨すり合わせ形式、具体的な次アクション（複数、各々に責任者と期限）、STAGE3/4への還流候補」を生成。【relatedCaseCount配分制御】各ケースを1論点に割り当て、全論点の relatedCaseCount の合計がケース総数と必ず一致するよう制御。複数論点にまたがる場合は最も関連が深い論点に割り当て。【insightSourceMappings管理】各論点に関連するケースのインデックスを明示的に指定し、後続の処理で「どのケースがどの論点を支持しているか」を追跡可能に。 | ・論点は3〜5個。多すぎると焦点がぼやける。・優先度スコア = (重要度点×0.5 + 緊急度点×0.5) × 20。・relatedCaseCount は整数、0以上。・insightSourceMappings の caseIndices の合計 = ケース総数。・温度0.3、JSON出力モード固定。・部門別トレンド（部門名、件数、上位issueType、平均リスクレベル）も集計。 | OrgAlignmentInsightDashboard: {companyId, summary, insights[]（各要素: title, description, relatedIssueTypes[], affectedDepartments[], recommendedActions[], stage3Stage4Relevance, relatedCaseCount, priorityScore, importance, urgency, impactScope, recognitionGap{fieldView, companyView, gapEssence}, companyAxis, sessionType, nextActions[{title, owner, dueDate, status}], strategyReflection{stage3Status, stage4Status, relatedDepartments[], generatedProjects[], generatedOkrs[]}）, categoryCounts（issueType別件数）, priorityCounts{low, medium, high}, departmentTrends[], sourceCaseCount, generatedAt} + insightSourceMappings[]（各要素: caseIndices[]） | **全社スケール論点化**: 個別ケースから組織全体の構造的ズレを抽出。複数関係者の認識を1つの論点に集約。ケースの割当てを厳密に管理し、後続の意思決定・STAGE反映を追跡可能に。 |
| **4** | **全社論点のすり合わせ状況管理・戦略反映候補処理** | alignment_result（テキスト、すり合わせ結果の要約）、changed_things[]（変わることになったこと）、unchanged_things[]（変わらないこと）、next_actions[{title, owner, dueDate, status: '未着手'\|'対応中'\|'完了'}]、strategy_reflection（STAGE3/4への還流データ）、status（論点のライフサイクル状態）、stage3/4_reflected_at（タイムスタンプ） | org_alignment_shared_topics テーブルの既存トピック情報 | AIは使用されない。ユーザー/管理者の手動入力と可視化が主。ただし、入力データの一貫性・妥当性をサーバー側で検証し、不正なステータス遷移や不完全なアクション定義を拒否。 | ・status遷移: published → in_alignment → action_planned → reflected → closed。逆戻りなし。・changed_things, unchanged_things, next_actions は配列で、各要素は指定フォーマット。・stage3_reflected_at, stage4_reflected_at は ISO 8601形式タイムスタンプ。・visibility_mode（anonymous, manager_only, named）による情報出し分け。 | shared_topic更新: {alignment_result, changed_things[], unchanged_things[], next_actions[], strategy_reflection, status, stage3_reflected_at, stage4_reflected_at} | **ライフサイクル管理**: 論点をpublished（公開）から closed（完結）まで、組織として追跡。すり合わせの結果、何が変わり何が変わらないかを明示的に記録。STAGE3/4への還流を可視化。 |
| **5** | **STAGE3/STAGE4への反映候補生成処理** | target_stage（'stage3' or 'stage4'）、existingTopic.strategy_reflection（STEP3で自動生成された generatedProjects[], generatedOkrs[]） | org_alignment_shared_topics.strategy_reflection フィールド | AIは使用されない。strategy_reflection 内の generatedProjects/generatedOkrs（既にSTEP3で AI生成済み）を、org_alignment_stage_reflection_candidates テーブルへ機械的に変換・登録。target_stage に応じて stage3Status または stage4Status を「反映候補」に更新。 | ・target_stage は必須、'stage3' or 'stage4' のみ。・strategy_reflection が空の場合、反映候補生成は失敗。・candidate_type は 'project' or 'okr'。・status: pending → accepted or rejected。・stage3/4_reflected_at タイムスタンプを記録。 | org_alignment_stage_reflection_candidates[]: {id, candidate_type（'project' or 'okr'）, title, objective, key_results[], status（'pending'）, topic_id, created_at} | **階段的フロー制御**: 論点化→すり合わせ→反映候補生成と、段階を踏んで STAGE3/4 への入力を準備。各段階で人間の確認・承認を挟み、完全自動化を避ける。 |

---

## 重要な実装上の特徴

### 1. **18種類の Organization Misalignment Type 分類**

整理対象のズレを以下の18カテゴリに分類：
- 部門間協力のズレ、挑戦と失敗許容のズレ、評価制度とのズレ、経営方針と現場実態のズレ、権限・意思決定のズレ、役割責任のズレ、優先順位のズレ、ツール・仕組みへの不信、情報共有・説明不足、人員・時間・負荷のズレ、業務プロセス・効率化のズレ、組織風土・モチベーションのズレ、人材育成・成長支援のズレ、スキル・能力要件のズレ、顧客・市場とのズレ、KPI・目標設計のズレ、変化への抵抗、その他

各タイプに対応した詳細な「concernTypeInstruction」がシステムプロンプトに含まれ、AIが個人批判ではなく「組織構造・判断基準・優先順位・役割責任・評価・支援」のズレとして再フレーミングするよう指示される。

### 2. **会社固有戦略情報に基づいた「認識ズレ」の導出**

- **STAGE1**: Mission / Vision / Value / CEO Intent
- **STAGE2**: 全社戦略（Story、Win Patterns）
- **STAGE3**: 部門戦略（部門ミッション、プロジェクト、KPI判断基準）

これらを「参照データ」として、個人の違和感が「会社のどの判断基準・優先順位・KPIとズレているか」を構造化。

### 3. **Strategy-Based vs Needs-Confirmation の自動判定**

STAGE1〜3の戦略情報の有無で `companyRecognitionMode` を自動判定：
- **strategy_based**: STAGE1〜3のいずれかの情報が存在 → 会社方針に照らした「あるべき認識」を生成
- **needs_confirmation**: 戦略情報が不足 → 会社として「確認すべき認識」の観点を示す

### 4. **相手側認識の仮説化**

入力内容から「相手方が置かれた状況・役割責任・KPI・時間制約の中での合理的判断」を仮説として生成。個人や部門を責めるのではなく、複数の立場の前提を整理。

### 5. **全社スケール論点化における Case 配分制御**

- 各ケースを1つの論点に割り当て（1つのケースが複数論点にまたがる場合は最も関連が深い論点に）
- 全論点の `relatedCaseCount` の合計が「ケース総数」と必ず一致
- `insightSourceMappings` でケースインデックスを明示的に指定、後続の追跡を可能に

### 6. **入力段階での Intent Detection（多段階フォーム自動化）**

ユーザー入力の意図を検出し、異なるサポート応答を提供：
- **needs_input_help**: 「何を書けばいいか」→ テンプレート例示
- **emotional_venting**: 感情的発散 → リダイレクト、感情を受け止めた上で質問
- **personal_attack**: 人格攻撃 → 対象を「人」から「仕組み・判断基準」へ転換
- **sensitive_or_harassment**: ハラスメント系 → 慎重対応、別プロセス検討
- **actual_concern**: 実際の違和感 → 通常の段階的整理へ

不適切な入力を弾きつつ、有効な違和感を構造化。

### 7. **STAGE3/STAGE4への段階的反映**

論点化 → すり合わせ実施 → 反映候補生成 → 承認フロー という段階を踏むことで：
- 各段階で人間の確認・判断を挟む
- 自動化と人間の判断のバランスを取る
- 完全な自動意思決定を避ける

---

## 実装状況メモ

### 実装完了
- ✅ 社員の違和感入力（多ターン対話 + inputIntent判定）
- ✅ 会社固有データを踏まえたAI構造化・照合（18分類 + concernTypeInstruction）
- ✅ 全社AI集計・論点化（relatedCaseCount配分制御 + insightSourceMappings）
- ✅ すり合わせ状況管理（status遷移 + changed_things/unchanged_things/next_actions）
- ✅ STAGE3/4への反映候補生成（機械的変換）

### 今後の改善候補
- AI集計時の「部門別傾向」の分析精度向上（現在は簡単な集計）
- 「複数論点にまたがるケース」の自動判定ロジック強化
- STAGE3/4への反映確認の自動フォローアップ機能

---

## 特徴的なプロンプト指示候補（特許上の重要ポイント）

### 1. **「認識ズレ」フレーミング**
社員の違和感を「個人の不満・愚痴」ではなく「会社の方針・役割・優先順位・KPIとの認識差分」として整理する。特に以下の観点で再フレーミング：
- 誰が何を重視しているのか（方針・KPI・役割責任）
- 相手側の制約・情報・役割責任は何か
- 会社全体としては何を判断基準にすべきか

### 2. **相手側認識の仮説化**
相手方・制度設計側・経営側の「ありえる認識仮説」として整理。断定せず、「その役割・KPI・優先順位を重視していた可能性がある」という仮説的アプローチで、個人批判を避ける。

### 3. **会社固有戦略情報（STAGE1〜3）の参照と自動判定**
- STAGE1（mission/vision/value/ceoIntent）が存在 → strategy_based で「あるべき認識」を生成
- STAGE2（戦略・winPatterns）が存在 → 全社戦略との接続を確認
- STAGE3（部門ミッション・KPI）が存在 → 部門別判断基準を反映
- 戦略情報が不足 → needs_confirmation で「確認すべき判断軸」を示す

### 4. **18種類の Organization Misalignment Type による自動分類と分類別指示**
単なる分類ではなく、各タイプごとに「どの観点で整理すべきか」を明示的に指示：
- 「優先順位のズレ」なら「やる気の問題ではなく、判断基準の揃え方」
- 「評価制度とのズレ」なら「不満ではなく、評価対象の見直し」
- 「KPI目標設計のズレ」なら「短期成果と長期戦略の優先順位」

### 5. **多段階フォーム自動化（Intent Detection）**
ユーザー入力の意図を自動判定し、異なるサポートを提供：
- 入力支援要求 → テンプレート・例示
- 感情的発散 → 感情受容 + 組織的観点へのリダイレクト
- 人格攻撃 → 「人」から「仕組み・判断基準」への転換
- 不適切な入力 → 別プロセスへ誘導

### 6. **会社全体の視点への段階的集約**
個別ケース → 全社AI集計 → 3〜5個の論点にまとめて可視化。この過程で：
- 個人の声を「組織の構造的課題」として昇華
- 複数の同じタイプのズレを1つの論点に集約
- 全社的な改善テーマとして経営層へ提示

### 7. **Case 配分制御による追跡可能性**
各ケースを1つの論点に割り当て、全論点の `relatedCaseCount` の合計がケース総数と必ず一致するよう制御。`insightSourceMappings` でケースインデックスを明示的に指定することで、「どのケースがどの論点の根拠となっているか」を後続のSTAGE3/4反映時に追跡可能に。

### 8. **ライフサイクル管理と段階的意思決定**
論点を published（公開）→ in_alignment（すり合わせ中）→ action_planned（アクション計画策定）→ reflected（STAGE3/4へ反映）→ closed（完結）として管理。各段階で人間の確認・判断を挟むことで、完全自動化ではなく「人間が最終的な意思決定をする」フロー。

### 9. **Strategy Reflection の段階的生成**
STAGE3AI集計時に generatedProjects/generatedOkrs を自動生成し、その後の「反映候補生成」フェーズで STAGE3/4 向けの具体的な projects/OKRs候補として登録。単なる「提案」ではなく、実行計画へ組み込む準備としての仕組み。

### 10. **組織的解決と個人支援の分離**
- 全社論点化：「組織として対処すべきテーマ」を可視化
- すり合わせ：経営・部門・現場の認識を1つのテーブルに集める
- STAGE3/4反映：戦略・KPI・実行計画への組み込み

個人レベルの悩みを「組織的に解決可能なテーマ」として再構成し、単なる個別相談で終わらせない。

---

## DB テーブル構造（参考）

- `org_alignment_cases`: 社員の違和感ケース（各ケースに ai_result フィールド）
- `org_alignment_insights`: 全社AI集計結果
- `org_alignment_insight_sources`: 論点と投稿（ケース）の紐付け
- `org_alignment_shared_topics`: すり合わせ論点の管理（status, alignment_result等）
- `org_alignment_stage_reflection_candidates`: STAGE3/4への反映候補
- `org_alignment_requests`: すり合わせ依頼・未対応トラッキング

---

## 権限制御

- **intake**: 同じ company のメンバーなら可能
- **generate**: 同じ company のメンバー。strategyContext は company または user 単位で取得
- **admin/insights/generate**: **admin ロール必須**
- **shared/topics**: 同じ company のメンバー。visibility_mode による情報出し分け
- **reflection-candidates**: 同じ company のメンバー
