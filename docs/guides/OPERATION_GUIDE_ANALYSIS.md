# 操作ガイド作成に向けた全画面分析レポート

**作成日**: 2026-09-29  
**対象**: Growth MVP v2.0 - 全9主要画面  
**目的**: 各画面の操作フロー、実装状況、ドキュメント矛盾を明確化し、操作ガイド作成の基礎資料を提供

---

## 1. Home (/app/page.tsx)

| 項目 | 内容 |
|------|------|
| **画面名・パス** | Home (`/app`) |
| **主な操作数** | 8+（6つのSTAGEナビ + CTA 2つ + ExecutionPanel複数リンク） |
| **主要コンポーネント** | PyramidNavigator（戦略設計図）、ExecutionPanel（実行サマリー）、ExportPdfButton |
| **Happy Path** | ホーム表示 → CTAクリック → `/stage1` へ遷移 |
| **状態管理の使用方法** | `useUserStore` でuser情報取得、ExecutionPanel内で `useStage6Data` + API fetch |
| **AI機能の有無** | ❌ ホーム自体にAI生成なし。ExecutionPanel の API（`/api/stage5/execution-summary`）にAI処理の可能性あり |
| **CLAUDE.md記載状況** | ⚠️ 詳細記載なし。ナビゲーションハブとしての説明のみ |
| **実装の完成度** | ✅ 完全実装。アニメーション、複数パネル、API連携も完備 |
| **文書との矛盾** | なし |
| **実画面確認が必要な点** | ExecutionPanel の API レスポンス内容（AI生成の詳細） |
| **優先度** | **低**（ナビゲーションハブのため、操作ガイドでは簡潔記載） |

---

## 2. STAGE0 (/app/stage0/page.tsx) - アイスブレイク

| 項目 | 内容 |
|------|------|
| **画面名・パス** | STAGE0（アイスブレイク `//app/stage0`) |
| **主な操作数** | 4（入力・追加・削除・開始） |
| **入力フィールド一覧** | 参加者名テキスト入力（ひらがな推奨）、Enter キー自動追加対応 |
| **Happy Path** | 参加者入力 → 「はじめる」→ ルーレット抽選 → クロージング → ホームへ |
| **バリデーション・エラー表示** | 空白自動無視、重複排除、参加者0人時ボタン disabled |
| **保存メカニズム** | ❌ なし（セッション限定、ページ離脱でリセット） |
| **状態管理** | Zustand 不使用、純粋 React Hooks (`useState`) |
| **CLAUDE.md記載状況** | ❌ STAGE0 は記載されていない。STAGE1～6のみ記載 |
| **実装の完成度** | ✅ 完全実装。ルーレットロジック、重複防止、82個のトピック |
| **文書との矛盾** | ❌ 大矛盾。STAGE0 は CLAUDE.md に「ユーザーオンボーディング」として記載されるべき |
| **実画面確認が必要な点** | ルーレットアニメーション、UI/UX、トピックデータの表示順 |
| **優先度** | **高**（ドキュメント化されていない隠れた画面） |

---

## 3. STAGE1 (/app/stage1/page.tsx) - 企業価値分析

| 項目 | 内容 |
|------|------|
| **画面名・パス** | STAGE1（企業価値分析 `/stage1`) |
| **主な操作数** | 5セクション（折りたたみ）× 2タブ = 最大10操作分岐 |
| **AI機能有無・種類** | ❌ AI生成なし（ファイルインポートのみ） |
| **Happy Path フロー** | 企業情報 → 財務データ入力 → 分析実行 → 論点選択 → STAGE2遷移 |
| **バリデーション・エラー表示** | UI警告（amber/red）+ Console詳細ログ |
| **保存メカニズム** | 自動保存（1.2s debounce） + 手動保存 |
| **次ステージ遷移条件** | stage1Issues ≥ 1件 + canEdit権限 |
| **遷移時自動処理** | businessPortfolio構築 + Supabase永続化 |
| **主要操作** | ファイルインポート(PDF/Excel/CSV) / 財務データ手入力 / ベンチマーク入力 / 分析実行 / 論点選択 |
| **CLAUDE.md記載状況** | ✅ 「Issue/metric analysis」として記載あり。詳細度は低い |
| **実装の完成度** | ✅ 完全実装。複数フォーマット対応、集計機能、ポートフォリオ生成まで |
| **文書との矛盾** | ⚠️ ファイルインポート機能（PDF/Excel解析）が CLAUDE.md に未記載 |
| **実画面確認が必要な点** | ファイルインポートの精度、エラーメッセージ表示 |
| **優先度** | **中**（操作ガイドで入力フロー・ファイル形式の説明が必須） |

---

## 4. STAGE2 (/app/stage2/page.tsx) - 全社戦略構想

| 項目 | 内容 |
|------|------|
| **画面名・パス** | STAGE2（戦略構想 `/stage2`） |
| **主な操作数** | タブ3個（入力/戦略議論/最終確定） + ボタン5個（12問リセット/たたき台/O/T/経営意図/確定） |
| **TEMPLATE12詳細** | 4章12問（固定長）、各問に理由文付き、deep-dive対象4問明示 |
| **Happy Path流れ** | 12問回答 → Draft生成表示 → Final生成表示 → STAGE3へ確定遷移 |
| **AI生成機能** | ✅有 / Draft(4章) / Final(4章) / DeepDive(追加質問) / O/T提案 / STAGE3ブリッジ の5機能 |
| **文書矛盾点** | ❌なし（CLAUDE.md完全準拠）。Deep-dive機能は「Version 1.1」として反映追跡まで実装済み |
| **自動保存の詳細** | debounce 300ms, interval 1500ms。生成中・保存中は15/10秒間抑止 |
| **状態管理** | `useStrategyStore` で answers12（固定長12）、MVV、SWOT、stories を管理 |
| **重要ルール** | **answers12 固定長維持**：要素追加・削除禁止。インデックス順序厳密 |
| **CLAUDE.md記載状況** | ✅ 詳細記載あり。「12-question framework」「Draft/Final」「Deep-dive（実装中）」として記載 |
| **実装の完成度** | ✅ 完全実装。Deep-diveのVersion1.1（反映追跡）も実装済み |
| **文書との矛盾** | ⚠️ CLAUDE.md では「currently being implemented」とあるが、Deep-dive機能は既に完全実装 |
| **実画面確認が必要な点** | Draft/Final の生成タイムアウト（120/180秒）、エラーハンドリング、Deep-dive反映UI |
| **優先度** | **最高**（6ステージ中最複雑。操作ガイドで詳細フロー・各AI機能・タイムアウト対応を記載） |

---

## 5. STAGE3 (/app/cascade/page.tsx) - 戦略展開ブリッジ

| 項目 | 内容 |
|------|------|
| **画面名・パス** | STAGE3 - Cascade（戦略展開 `/cascade`） |
| **主な操作数** | 部門：3(追加/削除/編集), プロジェクト：3(追加/削除/owner), 生成：2(全社/部門) |
| **Happy Path** | finalStoryFinal + stage2FinalDocumentEdits入力 → STEP1(生成) → STEP2(議論) → STEP3(確認) → STEP4(プロジェクト) → 全部門検証済み → `/okr`へ遷移 |
| **AI生成機能の詳細** | `/api/stage3/generate-strategy-bridge` (strategicCore出力) + `/api/generate-cascade` (projects/OKRs/lanes出力) |
| **再生成の特殊処理** | STEP2回答反映時、preserveOkrs=false → 旧projects全件削除 → 新規生成データで置換 |
| **STAGE2連携** | finalStoryFinal (4章) + stage2FinalDocumentEdits を strategy bridge生成・cascade payloadのコンテキストに使用 |
| **次ステージへの遷移条件** | 部門数 > 0 + 全部門に projects/OKRs 確認 |
| **データ流** | Zustand Store 中央管理 + Autosave (500ms debounce, 800ms minInterval) + Supabase永続化 |
| **検証・Dirty管理** | cascadeBaselineRef hash比較 + STAGE4移行前に部門数・プロジェクト数確認 |
| **2レーン構造** | lanes.existing（既存進化）vs lanes.new（新規探索）の分類。API返却時に分類後、store保存時は統合 |
| **CLAUDE.md記載状況** | ✅ 「Strategic bridge」として記載。実装との齟齬は少ない |
| **実装の完成度** | ✅ 完全実装。4つのSTEP設計、2レーン構造、再生成cleanup、DB validation も完備 |
| **文書との矛盾** | ⚠️ strategicCore の出力フィールド詳細（keyThemes, departmentIssues等）が CLAUDE.md に未記載 |
| **実画面確認が必要な点** | STEP1-4の画面遷移UI、2レーン表示、STEP2の「6つの質問」の内容確認 |
| **優先度** | **高**（STAGE2の成果を部門別に展開する重要なステップ。4つのSTEP説明が複雑） |

---

## 6. STAGE4 (/app/stage4/page.tsx) - OKRs & 実行計画

| 項目 | 内容 |
|------|------|
| **画面名・パス** | STAGE4（OKRs `/stage4`） |
| **主な操作数** | 3（部門フィルタ選択、プロジェクトチェックボックス複選、見直しボタン） |
| **OKR構造の詳細** | 旧OKR（互換維持）+ 新構造化OKR（財務・説明責任） 併存 |
| **track フィールド** | EVOLVE（既存改善）vs EXPLORE（新規不確実性）の戦略分類 |
| **Happy Path** | STAGE3プロジェクト確定 → 部門ごとbaseline自動作成 → KPI/スキル/投資の編集 → 整合プレビュー確認 → ステータス遷移（Draft→Review→Approved） |
| **AI生成機能** | `POST /api/stage4/generate-execution-draft` でOKR/KPI/ステップを自動生成（実装予定） |
| **日付・期限管理** | YYYY-MM形式（Ym型）で四半期・月単位。KPI期限3-6ヶ月後、ステップ期限1-3ヶ月後 |
| **KPI生成ルール** | STAGE3固定KPIは変更・追加・削除しない。target/unit/due/owner/milestonesのみ変更可能 |
| **STAGE3からのデータ引き継ぎ** | `createBaselineFromStage3(dept)` でプロジェクト構造・KPI目標・スキル要件・人的投資を自動抽出 |
| **自動保存メカニズム** | dirty=true + version++ で Supabase同期。REVISION_CONFLICT検知対応 |
| **Orphan cleanup** | 削除された部門の計画を自動クリーンアップ |
| **主要コンポーネント** | StatusBadge, DiffViewer, AlignmentPreview, ProjectEditor, KpiTreePanel |
| **CLAUDE.md記載状況** | ✅ 「OKRs & quarterly execution」として記載。trackフィールド・日付管理の詳細は限定的 |
| **実装の完成度** | ✅ 95%実装。OKR生成API実装予定。UI/UX完全、STAGE3連携完全、Supabase永続化完全 |
| **文書との矛盾** | ⚠️ STAGE4のUI構成（StatusBadge, DiffViewer等）が CLAUDE.md に未記載 |
| **実画面確認が必要な点** | DiffViewer画面、AlignmentPreview確認方法、StatusSelect操作 |
| **優先度** | **高**（trackフィールド・日付管理・KPI生成ルールの説明が必須） |

---

## 7. STAGE5 (/app/execution/page.tsx) - 実行支援・月次レポート

| 項目 | 内容 |
|------|------|
| **画面名・パス** | STAGE5（実行支援 `/execution`） |
| **主な操作数** | 8（ペイン開く→テンプレート挿入→メモ入力→スコア設定→AI整理→メモ反映→保存→履歴表示） |
| **Happy Path フロー** | ピラミッドクリック → ExecPanel開く → メモ入力 → AI整理 → 保存 → 履歴に追加 |
| **AI生成機能** | ✅有：メモ→issues/nextActions/supportDraft変換（`/api/stage5/assist-execution`） |
| **実装の完成度** | **部分実装（60%）** - 個別進捗管理は完全、月次集計/トレンド分析は未実装 |
| **未実装機能** | 月別集計、期間比較、部門別KPI集約、PDF出力、スケジュール管理 |
| **テンプレートボタン** | 「モヤモヤ」「困りごと」「見直したいこと」の3つ（自由記述補助） |
| **成果見込み管理** | 実績%・確度入力 → STAGE6に反映 |
| **データ保存メカニズム** | localStorage（seenActivityMap）+ Supabase progress_logs（チェックイン/フィードバック） |
| **メタデータ埋め込み** | progress_log にcompanyId/deptName/projectTitle/okrIdを__META__として保存 |
| **STAGE4からのデータ引き継ぎ** | departments[] + Cascade + DB OKR Map で STAGE4プロジェクト構造を参照 |
| **OKR ID解決** | `buildDbOkrMap()` で Snapshot OKRと DB レコードの紐づけ |
| **CLAUDE.md記載状況** | ⚠️ 「Monthly reporting (not yet fully implemented)」と記載。実装が進んでいることが反映されていない |
| **実装の完成度** | **60-70%** （個別進捗管理・AI支援は完全。月次集計機能が不足） |
| **文書との矛盾** | ❌ CLAUDE.md が古い。実装はAI整理機能・ピラミッド表示・OKR追跡を完備 |
| **実画面確認が必要な点** | ExecPanel UI、テンプレートボタンの表示、AI整理結果の表示形式 |
| **優先度** | **中-高**（月次レポート部分の未実装を理解した上での操作ガイド） |

---

## 8. STAGE6 (/app/stage6/page.tsx) - シナリオプランニング & 財務シミュレーション

| 項目 | 内容 |
|------|------|
| **画面名・パス** | STAGE6（シナリオプランニング `/stage6`） |
| **主な操作数** | 3（部門フィルタ選択、プロジェクトチェックボックス複選、見直しボタン） |
| **シナリオプランニング機能** | **UI編集なし**。3シナリオ（low/base/high）は結果表示のみ（successRate, synergyRate をパラメータとして計算） |
| **財務シミュレーション機能** | **高機能**。Baseline + KRs → YearlyPL × 3年度のフル計算。Unit Normalization (MJPY統一)、executionWeight (STAGE5進捗) 反映、Phase E自動推定 |
| **Happy Path フロー** | hydrate → 3本比較表示 → プロジェクト寄与一覧 → 見直し候補表示 → STAGE4/3へ遷移修正 → re-hydrate |
| **AI生成機能の有無** | **なし**（参照のみ。STAGE2/3/4の結果を参照） |
| **主要表示** | TabValueDashboard（現状/見込み/目標3本比較） + TabImpact（プロジェクト寄与） + ReviewCandidatesSection（見直し対象） |
| **計算エンジン** | `useStage6Data` フック（1500+行）でクライアント側計算。API不要 |
| **データ引き継ぎ** | STAGE1 (financePL) + STAGE2 (companyTargets) + STAGE4 (KRs, 目標額) + STAGE5 (progressLogs) |
| **executionWeight反映** | STAGE5の進捗ログ（score/status）をスコアに変換 → KRs に乗算して見込み値を調整 |
| **3年度推移グラフ** | baselineRevenue/allRevenue/selectedRevenue の3系列。Phase E（自動推定）による線形ランプ |
| **見直し対象判定** | 目標値と見込み値のギャップが大きいプロジェクト（最大5件） |
| **CLAUDE.md記載状況** | ✅ 「Complex scenario planning & financial simulation」と記載。詳細は限定的 |
| **実装の完成度** | **95%完成** - Phase E自動推定実装済み。北極星メトリクス同期完成。年次配賦ランプ完成 |
| **未実装機能** | explicit export/print機能、scenario編集UI、real-time chat/collaboration |
| **文書との矛盾** | ⚠️ 3シナリオの計算方法（successRate/synergyRate）が CLAUDE.md に未記載 |
| **実画面確認が必要な点** | 3本比較グラフ、プロジェクト寄与テーブル、見直し候補の選定ロジック |
| **優先度** | **中**（複雑な計算ロジックだが、ユーザー操作は少ない。基本的な見方のみ説明） |

---

## 9. ORG-TRANSFORMATION (/app/org-transformation/page.tsx) - 組織変革

| 項目 | 内容 |
|------|------|
| **画面名・パス** | ORG-TRANSFORMATION（組織変革 `/org-transformation`） |
| **主な操作数** | 5（フォーム入力 → AI生成 → 結果確認 → すり合わせ依頼 → 履歴管理） |
| **Happy Path フロー** | フォーム入力 (4問) → AI生成 (POST /api/org-alignment/generate) → 結果表示 (STEP2～5) → すり合わせ依頼 → 管理者処理 |
| **AI生成機能** | ✅有 / OpenAI (gpt-4o系) / 関係当事者仮説・会社判断基準の構造化 / temperature:0.25 |
| **フォーム構成** | 4問固定 + 共有範囲ラジオボタン（匿名/管理者のみ/名前付き） |
| **AI出力（STEP2～5）** | 相手側認識仮説 → 会社判断基準 → すり合わせポイント(3-5個) → 推奨アクション |
| **UI構成** | セクション形式 / タブなし / STEP1(フォーム) → STEP2～5(結果) → 履歴管理 |
| **データ永続化** | Supabase / org_alignment_cases テーブル / status: generated → alignment_requested |
| **状態管理** | userStore/strategyStore (Zustand) + useState (フロー制御) |
| **STAGE1-3連携** | mission/vision/value/ceoIntent、story/answers12/winPatterns、departments/companyTargets を参照 |
| **STAGE4連携** | executionPlans 有無で companyRecognitionMode判定 |
| **管理者機能** | /admin/org-insights/ で全社レベルの共有論点として集計・分析 |
| **主要API** | `/api/org-alignment/generate`、`/api/org-alignment/cases/{id}/request-alignment`、`/api/org-alignment/admin/insights/generate` |
| **セキュリティ** | getAuthUserIdFromBearer + requireMembership / visibility_mode別のアクセス制御 |
| **CLAUDE.md記載状況** | ⚠️ 記載はあるが詳細が不足。目的・フロー・API詳細は明記されていない |
| **実装の完成度** | ✅中～高 / フロント・バック・Supabase保存・管理者集計まで実装済み |
| **文書との矛盾** | ❌ 大矛盾。ORG-TRANSFORMATION の目的・4問フォーム・STEP2-5の詳細構成がCLAUDE.mdに未記載 |
| **実画面確認が必要な点** | 4問フォーム、AI出力の5つのSTEP表示、すり合わせ依頼フロー、履歴管理UI |
| **優先度** | **高**（STAGE1-4との連携・管理者機能を含む独立した機能。ドキュメント化されていない） |

---

## 分析サマリー & 推奨事項

### 全体構成の評価

| 区分 | 画面 | 完成度 | CLAUDE.md記載 | 優先度 |
|------|------|--------|--------------|--------|
| ナビ | Home | ✅完全 | ⚠️低 | 低 |
| 導入 | STAGE0 | ✅完全 | ❌なし | **最高** |
| 分析 | STAGE1 | ✅完全 | ✅中程度 | 中 |
| 戦略立案 | STAGE2 | ✅完全 | ✅高 | **最高** |
| 戦略展開 | STAGE3 | ✅完全 | ✅中程度 | 高 |
| 実行計画 | STAGE4 | ✅95% | ✅中程度 | 高 |
| 実行支援 | STAGE5 | ⚠️60% | ⚠️古い | 中-高 |
| シナリオ | STAGE6 | ✅95% | ✅中程度 | 中 |
| 組織変革 | ORG-TRANS | ✅中-高 | ❌低 | **高** |

### 主要な矛盾点

1. **STAGE0 未記載** - アイスブレイク機能が完全実装されているが CLAUDE.md に記載なし
2. **STAGE2 Deep-dive** - 「currently being implemented」とあるが既に Version 1.1 まで実装済み
3. **STAGE5 実装進捗** - 「not yet fully implemented」は正確だが、AI整理機能・ピラミッド表示が実装済みである点が反映されていない
4. **ORG-TRANSFORMATION** - 機能概要・フロー・STAGE連携の詳細が CLAUDE.md に未記載
5. **ファイルインポート** - STAGE1 の PDF/Excel/CSV インポート機能が CLAUDE.md に未記載

### 操作ガイド作成における推奨構成

```
1. イントロダクション
   - 6ステージの全体概要
   - 各ステージの目的・成果物
   - ユーザーロール（Admin/Manager/Member/Viewer）

2. STAGE0 - アイスブレイク（新規）
   - 目的：チーム内のラポール形成
   - 操作フロー：参加者入力 → ルーレット → クロージング
   - データ保存：なし（セッション限定）

3. STAGE1 - 企業価値分析
   - 目的：企業現状の把握
   - ファイルインポート（PDF/Excel/CSV対応）
   - 財務データ手入力フロー
   - 分析実行 → 論点選択

4. STAGE2 - 全社戦略構想（最詳細）
   - 12問フレームワーク（4章×3問構成）
   - Draft 生成 → 戦略議論 → Final 生成
   - Deep-dive 機能（4問対象、反映追跡）
   - MVV、SWOT、O/T提案
   - タイムアウト対応・エラーハンドリング

5. STAGE3 - 戦略展開ブリッジ
   - 全社戦略サマリー生成
   - 4つのSTEP（たたき台 → 議論 → 確認 → プロジェクト）
   - 部門追加・プロジェクト管理
   - STAGE4への検証・遷移条件

6. STAGE4 - OKRs & 実行計画
   - OKR構造（旧互換 + 新構造化）
   - track フィールド（EVOLVE vs EXPLORE）
   - 日付管理（YYYY-MM形式）
   - KPI生成ルール（STAGE3固定KPI変更禁止）
   - DiffViewer、AlignmentPreview、StatusSelect

7. STAGE5 - 実行支援・月次レポート
   - ピラミッド表示（水平レイアウト）
   - ExecPanel：進捗メモ入力 → AI整理
   - 成果見込み%・確度管理
   - 月次集計機能の未実装を明記

8. STAGE6 - シナリオプランニング & 財務シミュレーション
   - 3本比較（現状/見込み/目標）
   - プロジェクト寄与分析
   - 見直し候補表示
   - executionWeight反映

9. ORG-TRANSFORMATION - 組織変革
   - 目的：社内の認識ズレを構造化
   - 4問フォーム → AI生成（5つのSTEP） → すり合わせ依頼
   - 管理者ダッシュボード

10. トラブルシューティング
    - API タイムアウト対応（STAGE2: 120-180秒）
    - REVISION_CONFLICT 対応
    - ファイルインポートエラー
    - 認証・権限エラー

11. FAQ
    - answers12 の管理（固定長維持）
    - ローカル保存 vs Supabase保存
    - 再生成時のデータ上書き
    - 削除したデータの復旧可否
```

### ドキュメント更新が必要な項目

| 項目 | 現状 | 推奨 |
|------|------|------|
| **STAGE0** | CLAUDE.mdなし | 「User onboarding & team icebreaker」として追加 |
| **STAGE2 Deep-dive** | 「being implemented」 | 「Version 1.1 で反映追跡機能を実装済み」と更新 |
| **STAGE5** | 「not yet fully implemented」 | 「個別進捗管理は完全実装。月次集計機能は開発予定」と詳細化 |
| **ORG-TRANSFORMATION** | 簡潔な記載のみ | 機能概要・フロー・STAGE連携・管理者機能を追加 |
| **STAGE1 ファイルインポート** | 記載なし | 対応フォーマット（PDF/Excel/CSV）・エラー処理を追加 |
| **STAGE3 strategicCore** | 記載なし | 出力フィールド（keyThemes, departmentIssues等）の詳細を追加 |
| **STAGE4 UI コンポーネント** | 記載なし | StatusBadge, DiffViewer, AlignmentPreview の説明を追加 |
| **STAGE6 3シナリオ計算** | 記載なし | successRate/synergyRate のパラメータ定義を追加 |

---

## 結論

全9画面の分析結果：
- **実装度**: 全体 90% 以上。個別機能は高品質に実装されている
- **CLAUDE.md との齟齬**: 5項目が大矛盾（STAGE0 未記載、Deep-dive 古い情報、ORG-TRANSFORMATION 詳細不足など）
- **操作ガイドの優先度**:
  1. **最高**: STAGE0（新規）、STAGE2（複雑）、ORG-TRANSFORMATION（未ドキュメント化）
  2. **高**: STAGE1（ファイルインポート）、STAGE3（4STEP構成）、STAGE4（trackフィールド・日付管理）
  3. **中**: STAGE5（未実装機能を明記）、STAGE6（計算ロジック）

操作ガイド作成時は、各画面の Happy Path を中心に、エラーハンドリング・タイムアウト対応・権限管理を組み込むことで、ユーザーが確実に各ステージを進行できるドキュメントが実現できる。

