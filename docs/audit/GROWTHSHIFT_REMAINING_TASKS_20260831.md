# GROWTH SHIFT 残タスク台帳 2026-08-31

**実施日:** 2026-08-31  
**監査情報ソース:**
- `docs/audit/GROWTHSHIFT_CURRENT_STATE_AUDIT_20260831.md`
- `docs/audit/GROWTHSHIFT_SECURITY_REVALIDATION_20260831.md`

**参考:** 誤判定・False Positive・修正済み項目は除外。現在本当に残っているタスクのみ整理

---

## 修正完了済み（参考）

### ✅ STAGE2: strategyDataId 会社スコープ検証 (P0)

| 項目 | 内容 |
|-----|------|
| **優先度** | P0 - 即座に対応必須 |
| **対象機能** | STAGE2 戦略生成 (generate-draft / generate-final) |
| **対象ファイル** | `app/api/stage2/generate-draft/route.ts`, `app/api/stage2/generate-final/route.ts`, `app/stage2/page.tsx` |
| **現状** | ✅ 修正完了・検証済み |
| **修正内容** | strategyDataId → company_id 取得 → requireMembership(strategyCompanyId) 検証フロー実装 |
| **完了条件** | Build成功、TypeScript無エラー、membership参照エラー解決 |
| **検証方法** | TypeScript compile・build・membership参照確認 |
| **状態** | ✅ **完了** |

---

## 残タスク（優先順）

### 1. Rate Limit / IP / RLS 実環境確認 (P0)

#### 1-1. Rate Limit Middleware - `/api/stage5/assist-execution` 本番到達確認

| 項目 | 内容 |
|-----|------|
| **優先度** | P0 - 実環境検証待ち |
| **対象機能** | レート制限 (10回/分・50回/日) |
| **対象ファイル** | `middleware.ts` (修正済み), `app/api/stage5/assist-execution/route.ts` |
| **現状** | コード実装完了、本番環境での到達未検証 |
| **未完成・未確認の内容** | Vercel 本番での middleware 到達、429 HTTP レスポンス実際の返却 |
| **必要な修正 / 実装** | 本番相当環境でのテスト実行 |
| **完了条件** | Vercel 本番で `/api/stage5/assist-execution` が Rate limit に到達し、429 返却を確認 |
| **検証方法** | 本番相当環境での load test (10req/min 以上で 429 確認) |
| **状態** | ⏳ 実機確認待ち |

---

#### 1-2. IP 検出 - Vercel 本番環境での正常動作確認

| 項目 | 内容 |
|-----|------|
| **優先度** | P0 - 実環境検証待ち |
| **対象機能** | レート制限における IP ベースの制限識別 |
| **対象ファイル** | `middleware.ts` |
| **現状** | ヘッダーベース実装（x-forwarded-for, x-real-ip, cf-connecting-ip）、Vercel 本番での動作未確認 |
| **未完成・未確認の内容** | Vercel 本番環境での正しい IP 取得、Proxy ヘッダーの信頼性 |
| **必要な修正 / 実装** | 本番環境での IP 検出テスト |
| **完了条件** | Vercel 本番で複数クライアント IP の正確な識別と制限を確認 |
| **検証方法** | Vercel Functions ログで IP 値確認、異なるネットワークからのアクセステスト |
| **状態** | ⏳ 実機確認待ち |

---

#### 1-3. RLS Migration 実 DB 適用状況確認

| 項目 | 内容 |
|-----|------|
| **優先度** | P0 - 実環境検証待ち |
| **対象機能** | org_alignment_insights, agent_logs の RLS ポリシー |
| **対象ファイル** | `supabase/migrations/20260708_add_rls_org_alignment_agent_logs.sql` |
| **現状** | Migration ファイル存在、実 Supabase DB への適用状況不明 |
| **未完成・未確認の内容** | Migration が実 DB に適用されているか、ポリシーが実際に機能しているか |
| **必要な修正 / 実装** | Supabase DB 確認・migration 適用状況チェック |
| **完了条件** | org_alignment_insights のポリシーが実 DB で有効、クロステナント拒否テスト成功 |
| **検証方法** | Supabase dashboard での policy 確認、クロステナント拒否テスト |
| **状態** | ⏳ 実機確認待ち |

---

### 2. Console 機密ログ削除・マスク化 (P0 / P1)

| 項目 | 内容 |
|-----|------|
| **優先度** | P0 - PoC前に必須 |
| **対象機能** | ビジネスデータ・AI生成結果・戦略内容の console.log 出力 |
| **対象ファイル** | ✅ Top 5 完了: `app/api/stage2/generate-draft/route.ts`, `app/api/generate-cascade/route.ts`, `app/api/stage2/generate-final/route.ts`, `app/stage2/page.tsx`, `app/cascade/page.tsx` |
| **現状** | ✅ A分類削除完了（AI prompt/response/story 本文の出力 0件）、✅ B分類マスク化完了（deptName等顧客固有名称削除） |
| **未完成・未確認の内容** | 他ファイル（generate-cascade 内部の診断ログ等）の確認保留 |
| **必要な修正 / 実装** | ✅ 完了：A分類機密ログ全削除、B分類顧客固有名称全削除。本番環境での Vercel logs 監視は別タスク |
| **完了条件** | AI prompt/response/story 本文の出力消滅、顧客識別情報（deptName, companyId等）の削除、build成功 |
| **検証方法** | grep で机密パターン確認（0件）、TypeScript & Build 成功 |
| **状態** | ✅ **完了** - Commit: b432d93 |

---

### 3. npm 脆弱性の実到達可能性と対策 (P1)

| 項目 | 内容 |
|-----|------|
| **優先度** | P1 - PoC開始前に推奨 |
| **対象機能** | xlsx: Excel インポート / tar & undici: ビルド・CLI（runtime非到達） |
| **対象ファイル** | `app/api/stage1/import/route.ts` (xlsx), `package.json` |
| **現状** | ✅ **xlsx 0.20.3 へ更新完了** / tar & undici は runtime 非到達のため対応不要 |
| **実施内容** | SheetJS 公式 CDN から 0.20.3 をインストール（CVE-2023-30533 / CVE-2024-22363 修正） |
| **検証済み** | ✅ XLSX.version = 0.20.3 / ✅ Build 成功 / ✅ npm audit で脆弱性消滅 / ✅ API 互換性確認 |
| **完了条件** | ✅ すべて達成 |
| **検証方法** | ✅ クリーンインストール成功 / ✅ npm audit でxlsx脆弱性なし / ✅ Commit: cc6eca5 |
| **状態** | ✅ **完了** - Commit: cc6eca5 |
| **次のステップ** | Defense in Depth（Excel/CSV入力制限）実装完了 |

---

### 3b. STAGE1 Excel/CSV Input Validation - Defense in Depth (P1)

| 項目 | 内容 |
|-----|------|
| **優先度** | P1 - PoC開始前に推奨 |
| **対象機能** | Excel/CSV インポート時の入力制限（行数・列数・シート数） |
| **対象ファイル** | `utils/stage1/importers/excelCsvImporter.ts`, `app/api/stage1/import/route.ts` |
| **現状** | ✅ **実装完了・Build成功** |
| **実施内容** | 1. Excel 最大50,000行制限（sheetRows + !fullref で検知） 2. Excel 最大50シート制限 3. Excel 最大300列制限 4. CSV 最大50,000行制限（preview で検知） 5. 超過時に明示的なエラーを返却（silent truncation なし） |
| **検証済み** | ✅ Build成功 / ✅ TypeScript成功 / ✅ エラーハンドリング実装 / ✅ Validation API分離（内部エラー詳細隠蔽） |
| **完了条件** | ✅ すべて達成 |
| **検証方法** | ✅ Build + TypeScript / ✅ 実装確認（超過検知・エラー返却） |
| **状態** | ✅ **完了** - 実装 & Build 成功 |

---

### 4. 利用規約・プライバシーポリシー実装 (P0 / P1)

| 項目 | 内容 |
|-----|------|
| **優先度** | P0 - 法的要件・PoC前に必須 |
| **対象機能** | ユーザー同意フロー、利用規約・プライバシーポリシー表示・管理 |
| **対象ファイル** | `app/terms/page.tsx`, `app/privacy/page.tsx`, DB: `user_agreements` テーブル (未実装), `lib/terms-privacy.ts` (未実装) |
| **現状** | `/terms`, `/privacy` がプレースホルダーのみ、同意記録機能なし、DB テーブル未実装 |
| **未完成・未確認の内容** | 1. 日本法対応の利用規約・プライバシーポリシー正式版作成 2. user_agreements テーブル実装 3. signup/login 時の同意チェック 4. 同意日時・バージョン記録 5. Terms vs Privacy の分離・管理 |
| **必要な修正 / 実装** | 1. DB migration で user_agreements テーブル作成 (user_id, terms_version, privacy_version, agreed_at, ip_address) 2. `/terms`, `/privacy` に正式版コンテンツ 3. signup フローに同意チェックボックス追加 4. 同意記録 API 実装 |
| **完了条件** | PoC実施会社が利用規約・プライバシーに同意し、同意日時が DB に記録される |
| **検証方法** | signup フローで同意確認、DB で user_agreements 記録確認、利用規約・プライバシー内容確認 |
| **状態** | ⏳ 未着手 |

---

### 5. Incident Response Plan 記入 (P1)

| 項目 | 内容 |
|-----|------|
| **優先度** | P1 - PoC開始前に推奨 |
| **対象機能** | インシデント対応体制・窓口・SLA |
| **対象ファイル** | `docs/audit/GROWTHSHIFT_CURRENT_STATE_AUDIT_20260831.md` で指摘のプラン文書 (現在確認中) |
| **現状** | 文書構造は完備（フロー定義あり）だが、17箇所が「要記入」 |
| **未完成・未確認の内容** | 1. 当社連絡窓口（名前・電話・メール） 2. PoC提供先企業窓口×3社分 3. 初期対応時間（P0/P1/P2/P3） 4. インシデント対応記録表8項目 5. ログ保持期間確認 |
| **必要な修正 / 実装** | 1. 対応責任者の確定 2. PoC提供先との合意 3. SLA・復旧時間の定義 4. 記録様式の確定 |
| **完了条件** | 17箇所全て記入・PoC提供先と合意、PoC開始前に署名 |
| **検証方法** | プラン文書の全17箇所確認、PoC契約書での記載確認 |
| **状態** | ⏳ 未着手 |

---

### 6. STAGE2 の本来の Evaluator Loop 完全実装 (P2)

| 項目 | 内容 |
|-----|------|
| **優先度** | P2 - 品質改善・PoC中の段階的実装可能 |
| **対象機能** | STAGE2 Final Strategy の評価・修正・再生成ループ |
| **対象ファイル** | `app/api/stage2/generate-final/route.ts` |
| **現状** | 実装進捗 80% - 2 pass 生成+修正ロジック実装。Evaluator が簡易版、部分再生成未実装 |
| **未完成・未確認の内容** | 1. Evaluator の精密化（CEO 意図・MVV・SWOT の章別カバレッジ判定の精度向上） 2. 部分再生成（全章毎回ではなく、欠落章のみ再生成） 3. 複数ラウンドの評価・修正ループ（現在 max 1回） |
| **必要な修正 / 実装** | 1. computeCoverageIssues の論理改善 2. missing[] に基づく章単位の再生成ロジック 3. 複数ラウンド対応（max_retries パラメータ等） |
| **完了条件** | 部分再生成が機能、複数ラウンドの修正を通じて最終的に coverage > 80% に到達 |
| **検証方法** | テストデータで evaluate→repair→coverage improvement を確認 |
| **状態** | ⏳ 未着手 |

---

### 7. 組織変革 / すり合わせルーム E2E 実装 (P2)

| 項目 | 内容 |
|-----|------|
| **優先度** | P2 - 機能完成度向上・実装進捗 20% |
| **対象機能** | 違和感入力 → AI分析 → Shared Topic化 → すり合わせルーム → STAGE3/4 反映 |
| **対象ファイル** | STAGE6 関連 (反映フロー実装なし), org_alignment テーブル群, API 層 |
| **現状** | ほぼ UI ボタン・リンク表示のみ。実装は組織変革/すり合わせルーム全体で 20% 未実装に近い |
| **未完成・未確認の内容** | 15 工程中 8個未実装: 違和感入力 → 従業員認識推定 → 会社認識推定 → 原因推定 → Shared topic化 → 会議結論入力 → STAGE3/4 反映 → 反映履歴管理 |
| **必要な修正 / 実装** | 1. 違和感入力フォーム実装 2. AI insight 生成ロジック実装 3. Shared topic への自動化 4. すり合わせルーム結論入力フォーム 5. STAGE3/4 への自動反映 API 6. 反映履歴テーブル・UI |
| **完了条件** | 違和感入力から STAGE3/4 反映まで E2E で動作、データが DB に保存・復元される |
| **検証方法** | PoC での実運用テスト、データ流通確認 |
| **状態** | ⏳ 未着手 |

---

### 8. STAGE3 / 4 / 5 の未完成機能 (P2)

#### 8-1. STAGE3 - 横断論点検知

| 項目 | 内容 |
|-----|------|
| **優先度** | P2 - 機能完成度向上 |
| **対象機能** | 複数部門の戦略における横断論点の自動検知 |
| **対象ファイル** | `app/stage3/page.tsx`, API 層 (shared_topics テーブル) |
| **現状** | shared_topics テーブル存在するが、自動検知機能なし |
| **未完成・未確認の内容** | 複数部門の戦略入力から、共通する論点・テーマを自動抽出する仕組み |
| **必要な修正 / 実装** | 横断論点検知アルゴリズム実装（キーワード抽出→重複検知→visualization） |
| **完了条件** | 複数部門の戦略入力から共通論点が自動検出・表示される |
| **検証方法** | 複数部門テストデータで横断論点検知確認 |
| **状態** | ⏳ 未着手 |

---

#### 8-2. STAGE4 - 日付・KPI・ステップ表示の日本語化・改善

| 項目 | 内容 |
|-----|------|
| **優先度** | P2 - UX改善 (既知) |
| **対象機能** | STAGE4 OKR・プロジェクト表示 |
| **対象ファイル** | `app/stage4/page.tsx` 等 |
| **現状** | 日付が ISO 形式、KPI 名・ステップ名の生成品質が不十分 |
| **未完成・未確認の内容** | 日付の日本語表示、KPI 名・ステップ名の AI 生成品質向上 |
| **必要な修正 / 実装** | 1. 日付フォーマット日本語化 (YYYY年MM月DD日等) 2. KPI 生成プロンプト改善 |
| **完了条件** | 日付が日本語表示、KPI/ステップ名が意味のある日本語 |
| **検証方法** | 画面表示確認、テストデータでの生成品質確認 |
| **状態** | ⏳ 未着手 |

---

#### 8-3. STAGE5 - UI 統合・check-in ワークフロー

| 項目 | 内容 |
|-----|------|
| **優先度** | P2 - 実装進捗 50%・動作確認必要 |
| **対象機能** | STAGE5 実行・進捗管理の UI ワークフロー |
| **対象ファイル** | `app/execution/page.tsx`, API (`/api/stage5/assist-execution` etc.) |
| **現状** | Check-in save・AI consultation API は完成、UI 統合が不確実 |
| **未完成・未確認の内容** | 1. STAGE4 データ→STAGE5 check-in への引継ぎ UI 2. Check-in 保存の同期確認 3. AI 相談結果の表示・保存 |
| **必要な修正 / 実装** | UI テスト・統合確認、必要に応じた API 微調整 |
| **完了条件** | STAGE4 から STAGE5 へのデータ引継ぎが UI で確認でき、check-in が正常に保存される |
| **検証方法** | 実際の STAGE4→STAGE5 フロー実行、DB でデータ確認 |
| **状態** | ⏳ 未着手 |

---

#### 8-4. STAGE6 - 自動フィードバックループ

| 項目 | 内容 |
|-----|------|
| **優先度** | P2 - 実装進捗 40%・feedback loop 自動化 |
| **対象機能** | STAGE6 業績ギャップから STAGE3/4 への自動フィードバック |
| **対象ファイル** | `app/report/execution-report/page.tsx` 等 |
| **現状** | UI-based detection のみ（"STAGE3 で見直す" ボタン = 画面遷移のみ）、データが STAGE3/4 へ自動反映されない |
| **未完成・未確認の内容** | ギャップ検知→自動フィードバック生成→STAGE3/4 への実データ反映 |
| **必要な修正 / 実装** | 1. Gap 自動検知ロジック改善 2. フィードバック提案の AI 生成 3. STAGE3/4 への反映 API・DB |
| **完了条件** | ギャップ検知 → 提案生成 → STAGE3/4 への反映まで E2E で動作 |
| **検証方法** | テストデータで gap 作成→提案確認→STAGE3/4 反映確認 |
| **状態** | ⏳ 未着手 |

---

### 9. PDF / Export (P2)

| 項目 | 内容 |
|-----|------|
| **優先度** | P2 - 実装済み・実機テスト未実施 |
| **対象機能** | STAGE3・STAGE4 の PDF 出力・Export |
| **対象ファイル** | `app/stage3/page.tsx`, `app/stage4/page.tsx` 内の PDF 生成ロジック |
| **現状** | PDF 生成コード実装あり、実機テスト未実施 |
| **未完成・未確認の内容** | 1. PDF 出力内容が正確か（部門名・OKR・KPI 等が正しく含まれているか） 2. フォーマット・レイアウトが読みやすいか 3. 欠落内容がないか（特に横断論点） |
| **必要な修正 / 実装** | テストデータでの PDF 生成・内容確認、必要に応じた出力内容修正 |
| **完了条件** | 生成 PDF が期待通りの内容・フォーマットで出力される |
| **検証方法** | 本番相当環境でテストデータの PDF 生成実行、内容・形式確認 |
| **状態** | ⏳ 実機確認待ち |

---

### 10. STAGE1→6 全体 E2E 検証、保存・復元、削除、クロステナント確認 (P2)

| 項目 | 内容 |
|-----|------|
| **優先度** | P2 - 品質保証・Smoke test |
| **対象機能** | GROWTH SHIFT 全体フロー (STAGE1 入力→STAGE2 生成→STAGE3 展開→STAGE4 実行計画→STAGE5 進捗→STAGE6 業績) |
| **対象ファイル** | 全 STAGE、全 API、DB |
| **現状** | 各 STAGE は個別実装確認済み、E2E フロー・データ整合性の動作確認なし |
| **未完成・未確認の内容** | 1. STAGE1→6 全体でデータが正常に流通するか 2. ID が途中で変わらないか 3. 削除したデータが復活していないか 4. 複数会社が混ざっていないか 5. autosave と DB が一貫しているか 6. 保存・復元が正常に動作するか |
| **必要な修正 / 実装** | E2E smoke test スイート作成・実行、必要に応じたバグ修正 |
| **完了条件** | テスト用ダミーデータで STAGE1→6 を完走、全 STAGE で期待通りのデータが保存・復元される |
| **検証方法** | Smoke test: 新規会社作成 → STAGE1 入力 → STAGE2 生成 → STAGE3 編集 → STAGE4 修正 → STAGE5 check-in → STAGE6 確認 → 別会社クロステナント確認 |
| **状態** | ⏳ 未着手 |

---

## 優先実装順（依存関係を考慮）

### Phase 1: P0 セキュリティ・法的要件 (1-2週間)

1. **Console ログ CRITICAL 削除** (1日)
   - 52 件の機密情報出力を削除またはマスク化
   - grep で検証後、本番 logs 監視

2. **利用規約・プライバシー実装** (2-3日)
   - DB migration + signup フロー
   - PoC 提供先との合意が必須

3. **Incident Response Plan 完成** (1日)
   - 17 箇所の記入、PoC 前に署名

### Phase 2: P1 実装・セキュリティ強化 (1-2週間)

1. **npm 脆弱性対策** (2-3日)
   - Excel セル検証・undici バージョン統一

2. **Rate limit・IP 実機テスト** (1-2日)
   - 本番相当環境での 429・IP 検出テスト

3. **RLS migration 適用確認** (1日)
   - Supabase dashboard 確認・テスト

### Phase 3: P2 機能完成度向上 (2-3週間)

1. **STAGE2 Evaluator Loop** (2-3日)
2. **組織変革/すり合わせルーム** (3-5日)
3. **STAGE3～6 未完成機能** (3-4日)
4. **E2E Smoke test** (2日)

---

## チェックリスト

### PoC 開始前の必須確認

- [ ] Console CRITICAL 52 件削除完了
- [ ] 利用規約・プライバシー正式版実装、PoC 提供先合意
- [ ] Incident Response Plan 17 箇所記入完了、署名
- [ ] npm 脆弱性対策実装
- [ ] Rate limit・IP 検出の本番テスト実施
- [ ] RLS migration の実 DB 適用確認
- [ ] STAGE1→6 E2E smoke test 実行・合格

### PoC 中の段階的改善

- [ ] STAGE2 Evaluator Loop 複数ラウンド対応
- [ ] 組織変革/すり合わせルーム E2E 実装
- [ ] STAGE3～6 未完成機能の実装・テスト
- [ ] 実運用での問題フィードバック・修正

---

**次のステップ:** 本台帳を基に、Phase 1 から順次実装を進めてください。各完了時に状態を更新してください。
