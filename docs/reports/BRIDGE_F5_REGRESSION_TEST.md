# BRIDGE F-5 回帰テスト手順書

**対象**: STAGE5→STAGE6 Bridge Stabilization 最終検証
**目的**: OKR ID安定化、__META__埋め込み、progress_logs集計、weight算出の統合動作確認
**日付**: STAGE6実装完了後、本番導入前
**実施者**: 開発チーム（要テスト環境アクセス権）

---

## B-1. テスト前提（環境）

### B-1-1. 環境チェック項目

- [ ] **テスト用DB環境**
  - `progress_logs` テーブルが存在し、以下の列が必須（型は実装に合わせて確認）:
    - `id` (主キー)
    - `company_id` (NOT NULL, フィルタ用に索引推奨)
    - `okr_id` (NULL可、フィルタ用に索引推奨)
    - `project_id` (NULL可)
    - `content` (テキスト、__META__ 埋め込み対応)
    - `score` (数値型)
    - `status` (テキスト)
    - `created_at` (タイムスタンプ, NOT NULL, 索引推奨)
    - `user_id` (NOT NULL)
  - 推奨索引: `(company_id, created_at)`, `(company_id, okr_id, created_at)` - 実装の DB に合わせて作成

- [ ] **テスト用 Company/Dept/Project**
  - `Company A` (company_id = `test-company-001`)
  - `Dept A` (dept_id = `test-dept-001`, company_id = `test-company-001`)
  - `Project X` (project_id = `test-proj-x`, dept_id = `test-dept-001`)
  - `Project Y` (project_id = `test-proj-y`, dept_id = `test-dept-001`)

- [ ] **テスト用 OKR（最低2件、編集・並び替え実施用）**
  - `OKR #1: "Increase Revenue by 20%"`
    - okr_id = `test-okr-001` (固定, UUIDまたは UUID-v4フォーマット)
    - 紐付けプロジェクト: `Project X`
    - KR:
      - KR-1.1: "Sales Conversion Rate to 45%"
      - KR-1.2: "Customer Acquisition Cost down to $100"

  - `OKR #2: "Improve Operational Efficiency"`
    - okr_id = `test-okr-002` (固定)
    - 紐付けプロジェクト: `Project Y`
    - KR:
      - KR-2.1: "Process Automation Coverage 80%"

- [ ] **テスト用 progress_logs（90日内、最低3回の投入点）**
  - 以下を計画的に投入可能な状態:
    - ログ #1: 10日前 (`now - 10 days`)
    - ログ #2: 50日前 (`now - 50 days`)
    - ログ #3: 85日前 (`now - 85 days`)
    - ログ #4（境界テスト）: 90日前ちょうど (`now - 90 days`)
    - ログ #5（外側）: 91日前 (`now - 91 days`)

- [ ] **デバッグフラグ設定**
  - `.env.local` に `NEXT_PUBLIC_DEBUG_BRIDGE=1` を設定（ローカルのみ）
  - `[bridge][F-5]` タグ付きコンソールログが出力されることを確認

---

## B-2. F-5 テスト項目（必須）

### B-2-1. OKR ID 安定性

#### テスト概要
OKRの編集（タイトル変更、KR追加/削除、並び替え）後、`okr_id` が変わらないことを確認。

#### 前提状態
- STAGE5 の OKR Editor で `OKR #1` と `OKR #2` が表示されている
- 各OKRの `okr_id` をコピー記録（例：`test-okr-001`, `test-okr-002`）

#### 手順

1. **OKR タイトル変更テスト**
   ```
   操作：OKR #1 の title を "Increase Revenue by 20%" → "Increase Revenue by 25%"
   → Save
   → ブラウザ F12 → Network → `/okr` リクエストを確認
   → Response の okr_id を前後で比較
   ```
   期待結果：okr_id は変わらない（`test-okr-001` のまま）

2. **KR 追加テスト**
   ```
   操作：OKR #1 に新規 KR を追加 "Market Share +5%"
   → Save
   ```
   期待結果：OKR #1 の okr_id は変わらない

3. **KR 削除テスト**
   ```
   操作：OKR #1 の最後の KR (KR-1.2) を削除
   → Save
   ```
   期待結果：OKR #1 の okr_id は変わらない

4. **OKR 並び替えテスト**
   ```
   操作：ドラッグ&ドロップで OKR #1 と OKR #2 を入れ替え
   → Save
   ```
   期待結果：
   - OKR #1 (現在2番目) の okr_id = `test-okr-001` (不変)
   - OKR #2 (現在1番目) の okr_id = `test-okr-002` (不変)

5. **フロント（ストア）での okr_id 確認**
   ```javascript
   // ブラウザコンソール（STAGE5 または STAGE6 開発者ツール）:
   // useStrategyStore から departments を取得して okr_id を確認
   const departments = window?.__STAGE5_STORE__?.getState?.()?.departments ?? [];
   departments.forEach(dept => {
     dept.projects?.forEach(proj => {
       proj.okrs?.forEach(okr => {
         console.log(`OKR: title="${okr.title}", id="${okr.id}"`);
       });
     });
   });
   ```
   期待結果：各OKRの `id` フィールドが編集前後で一貫している（NULL でない、重複なし）

#### 失敗時の症状
- okr_id が 新しい UUID に変わっている → **CRITICAL**
- okr_id が NULL になっている → **CRITICAL**
- progress_logs の okr_id と OKR の okr_id がミスマッチ → **MAJOR**

#### 確認ログ
```
[bridge][F-5] okr_id stable: okr_id=test-okr-001 title=Increase Revenue by 25% (unchanged)
[bridge][F-5] okr_id stable: okr_id=test-okr-002 at idx=0 (reordered, id preserved)
```

---

### B-2-2. __META__ 埋め込み健全性

#### テスト概要
execution ログ保存時に `__META__:{JSON}` が確実に埋め込まれ、必要な粒度の情報を保持していることを確認。

#### 前提状態
- STAGE5 Execution ページで、`OKR #1` と紐付けられた進捗ログ入力フォーム表示
- Network DevTools 開視

#### 手順

1. **メタデータ埋め込み確認**
   ```
   操作：
   - OKR: "OKR #1: Increase Revenue by 20%"
   - Dept: "Dept A"
   - Project: "Project X"
   - Progress Content: "Completed 3 sales deals this week"
   - Score: 0.8 (80%)
   - Status: "done"
   → "Save Checkin" ボタン クリック
   ```

2. **Network リクエスト確認**
   ```
   F12 → Network タブ → `/api/` または `supabase` の saveProgressLog リクエストを確認
   Request Body の content フィールドを確認：
   ```
   期待フォーマット：
   ```
   __META__:{"companyId":"test-company-001","deptId":"test-dept-001","projectId":"test-proj-x","okrId":"test-okr-001"}
   Completed 3 sales deals this week
   ```
   （形式: `__META__:{JSON}\n{本文}` の構造）

3. **Network リクエスト body の確認**
   - Network タブで saveProgressLog の Request Payload を確認
   - `content` フィールドの先頭に `__META__:{...}` が含まれていることを確認
   期待結果：
   - JSON 内に最低限、以下が含まれる:
     - `companyId`: `test-company-001`
     - `okrId`: `test-okr-001`
     - その他（deptId, projectId など）があれば確認

4. **parseMetadata() 逆解析確認**
   ```javascript
   // ブラウザコンソール：
   const { parseMetadata } = await import('/utils/execution/metadata.ts');
   const logContent = `__META__:{"companyId":"test-company-001","okrId":"test-okr-001"}\nCompleted 3 sales deals...`;
   const meta = parseMetadata(logContent);
   console.log('[bridge][F-5] parseMetadata result:', meta);
   ```
   期待結果：
   ```javascript
   {
     companyId: "test-company-001",
     okrId: "test-okr-001",
     // 他のフィールド（deptId, projectId など）はあれば含まれる
     // timestamp は無い場合もある（その場合は created_at をDB から参照）
   }
   ```

5. **__META__ 欠損時のフォールバック確認（古いログをシミュレート）**
   - 古いログ（__META__ なし）を progress_logs に挿入（DBクライアント経由）
     - content: `'Legacy log without metadata'` （__META__ ヘッダなし）
     - 他の列: company_id=test-company-001, okr_id=test-okr-001 など通常値

   STAGE6 Tab1 をリロード：
   期待結果：
   - STAGE6 が落ちない（エラーが出ない）
   - 該当OKRの寄与度は weight=1.0（係数なし）で計算される
   - コンソールに警告ログ出力: `[bridge][F-5] metadata not found, fallback to weight=1.0`（またはそれに相当するログ）

#### 失敗時の症状
- `__META__` が全く埋め込まれていない → **CRITICAL**
- `__META__` に `okrId` や `companyId` が欠落している → **MAJOR**
- parseMetadata() が JSON パースエラーを吐く → **MAJOR**
- STAGE6 が欠損メタデータで落ちる → **CRITICAL**

#### 確認ログ
```
[bridge][F-5] metadata embed: companyId=test-company-001 okrId=test-okr-001
[bridge][F-5] metadata parsed: {companyId:test-company-001, okrId:test-okr-001, timestamp:2025-02-15...}
[bridge][F-5] metadata not found, fallback to weight=1.0 for okr_id=test-okr-001
```

---

### B-2-3. progress_logs 集計（company_id / 90日 / okr_id優先）

#### テスト概要
progress_logs の集計が、正しく company_id でフィルタされ、90日境界を正確に判定し、okr_id 優先で集計されることを確認。

#### 前提状態
- テスト用 progress_logs が以下の状態で準備可能:
  - ログ #1: 10日前（okr_id = `test-okr-001`）
  - ログ #2: 50日前（okr_id = `test-okr-001`）
  - ログ #3: 85日前（okr_id = `test-okr-001`）
  - ログ #4: 90日前ちょうど（okr_id = `test-okr-001`）
  - ログ #5: 91日前（okr_id = `test-okr-001`）← 除外対象
  - ログ #6: 30日前（project_id = `test-proj-x`, okr_id = NULL）← 古いログ（フォールバック）

#### 手順

1. **90日境界テスト**
   ```
   操作：
   上記ログ #1～#5 を投入
   STAGE6 Tab1 (Impact Tab) を表示
   コンソール: console.log('[bridge][F-5] loadProgressLogs args:', { fromDate, limit })
   ```
   期待結果：
   - `loadProgressLogs()` の `fromDate` は `now - 90日` の時点
   - **集計ロジック**: `created_at >= fromDate` （gte、大なり等しい）
   - **ログ #4（90日前ちょうど）は含まれる** （>= なため）
   - ログ #1,#2,#3,#4 が集計に含まれる（4件）
   - ログ #5（91日前）は除外される（fromDate より前）
   - 実際のコンソール出力例:
     ```
     [bridge][F-5] loadProgressLogs args: {
       companyId: "test-company-001",
       fromDate: "2024-11-16T10:00:00Z",  // 現在が2025-02-15 の場合
       limit: 1000
     }
     // created_at >= 2024-11-16T10:00:00Z の全ログを取得
     ```

2. **company_id フィルタテスト**
   ```
   操作：
   別 company_id でも ログを作成（company_id = 'other-company'）
   STAGE6 Tab1 を再表示
   ```
   期待結果：
   - `test-company-001` の OKR の寄与度は変わらない（other-company のログは無視）
   - コンソール確認:
     ```
     [bridge][F-5] loadProgressLogs: found 4 logs for companyId=test-company-001
     ```

3. **okr_id 優先集計テスト**
   ```
   操作：
   - ログ #6 (okr_id=NULL, project_id='test-proj-x') を投入
   - `OKR #1` (okr_id='test-okr-001') の Project を 'test-proj-x' に設定
   - STAGE6 Tab1 を表示
   ```
   期待結果：
   - ログ #1,#2,#3,#4 は okr_id で直接マッチ（集計対象）
   - ログ #6 (okr_id=NULL) は project_id でマッチするがカウント済みでない
   - **二重計上なし**: ログ #6 は別ラインで集計されるか、スキップされるかのいずれか
   - コンソール確認:
     ```
     [bridge][F-5] execution weight: okrId=test-okr-001 logsMatched=4 (by okrId priority)
     [bridge][F-5] execution weight: okrId=test-okr-001 logsMatched=4 (okrId priority wins, projectId fallback skipped)
     ```

4. **ログなし時の動作**
   ```
   操作：
   - `OKR #2` (okr_id='test-okr-002', Project='test-proj-y') の progress_logs をクリア
   - STAGE6 Tab1 を表示
   ```
   期待結果：
   - OKR #2 の executionWeight = 1.0（ニュートラル係数）
   - コンソール: `[bridge][F-5] execution weight: okrId=test-okr-002 logsMatched=0 weight=1.0 (default)`

#### 失敗時の症状
- 90日前のログが含まれたり除外されたりと不安定 → **MAJOR**
- okr_id がなくても project_id で二重計上される → **CRITICAL**
- company_id フィルタが効いていない（他社のログが混ざる） → **CRITICAL**
- ログがないのに weight が 1.0 でない → **MAJOR**

#### 確認ログ
```
[bridge][F-5] 90day boundary: fromDate=2024-11-16T10:00:00Z (90 days before now)
[bridge][F-5] loadProgressLogs: found 4 logs for companyId=test-company-001 (logs #1,#2,#3,#4)
[bridge][F-5] execution weight: okrId=test-okr-001 logsMatched=4 (by okrId priority)
[bridge][F-5] execution weight: okrId=test-okr-002 logsMatched=0 weight=1.0 (default)
```

---

### B-2-4. weight算出の単調性

#### テスト概要
progress_logs の投入回数・更新で weight が直感的に増減し、異常値（NaN, Infinity, 負値）に陥らないことを確認。

#### 前提状態
- `OKR #1` に progress_logs が計5件、score 平均が 0.6 の状態
- STAGE6 Tab1 が表示可能

#### 手順

1. **初期 weight 確認**
   ```
   操作：
   STAGE6 Tab1 を表示
   コンソール: console.log('[bridge][F-5] initial weight:', weight)
   OKR #1 の寄与度（⭐数値）を記録（例：weight=0.92）
   ```
   期待結果：
   - weight が 0.6 ～ 1.2 の範囲内
   - NaN / Infinity でない
   - 計算式の履歴ログ:
     ```
     [bridge][F-5] weight calc: okrId=test-okr-001 logsCount=5 avgRating=0.6 weight=0.92
     ```

2. **スコア高い ログを追加 (weight 上昇テスト)**
   ```
   操作：
   - 新規 progress_log を投入: score=0.95, status='done'
   - STAGE6 Tab1 をリロード（またはリアルタイム更新を待つ）
   - 寄与度（⭐数値）を再確認
   ```
   期待結果：
   - avgRating が上昇（例：0.6 → 0.68）
   - weight が増加する（例：0.92 → 0.95～1.0）
   - コンソール:
     ```
     [bridge][F-5] weight calc: okrId=test-okr-001 logsCount=6 avgRating=0.68 weight=0.95
     ```

3. **スコア低い ログを追加 (weight 低下テスト)**
   ```
   操作：
   - 新規 progress_log を投入: score=0.3, status='blocked'
   - STAGE6 Tab1 をリロード
   - 寄与度を再確認
   ```
   期待結果：
   - avgRating が低下
   - weight が低下する（下限 0.6 に近づく）
   - コンソール:
     ```
     [bridge][F-5] weight calc: okrId=test-okr-001 logsCount=7 avgRating=0.54 weight=0.72
     ```

4. **⭐で視覚確認 (Regression Test 再現手順)**
   ```
   STAGE6 Tab1 Impact タブ→ OKR #1 行 → "Execution Contribution" 欄の数値（⭐）
   初期: 0.92 → ログ追加後: 0.95 → ログ追加後: 0.72

   グラフ表示があれば、プロジェクト寄与度グラフも同様に変動確認
   ```

5. **異常値ガード確認**
   ```
   操作（手動DB操作の場合）：
   INSERT INTO progress_logs
   (..., score=NULL, status='unknown', ...)  // 異常データ
   STAGE6 Tab1 をリロード
   ```
   期待結果：
   - STAGE6 が落ちない
   - weight が NaN / Infinity でない
   - 代わりに weight=1.0（デフォルト）に落ちる
   - コンソール警告: `[bridge][F-5] weight guard: invalid score=null, fallback to 1.0`

#### 失敗時の症状
- weight が NaN または Infinity になる → **CRITICAL**
- weight が負の値になる → **CRITICAL**
- ログ追加しても weight が変わらない → **MAJOR**
- weight が逆方向に変わる（高スコア投入で低下） → **CRITICAL**

#### 確認ログ
```
[bridge][F-5] weight calc: okrId=test-okr-001 logsCount=5 avgRating=0.6 weight=0.92
[bridge][F-5] weight calc: okrId=test-okr-001 logsCount=6 avgRating=0.68 weight=0.95
[bridge][F-5] weight calc: okrId=test-okr-001 logsCount=7 avgRating=0.54 weight=0.72
[bridge][F-5] weight guard: invalid score=null, fallback to 1.0
```

---

### B-2-5. STAGE6 Tab1 反映

#### テスト概要
weight計算の結果が、STAGE6 Tab1 の「Impact」タブに正確に反映され、並び順やフィルタが崩れないことを確認。

#### 前提状態
- STAGE6 Tab1（Impact タブ）が表示可能
- 複数OKR（OKR #1, #2）が Project に紐付けられている

#### 手順

1. **初期表示確認**
   ```
   操作：
   STAGE6 Impact タブ を開く
   プロジェクト寄与度の一覧（Project X, Project Y）を確認
   各プロジェクト行の「Execution Contribution」⭐数値を記録
   ```
   期待結果：
   - 各プロジェクト行が表示されている
   - ⭐数値が 0.6～1.2 の範囲内
   - ソート順（降順/昇順）が保持されている（あれば）

2. **weight 変化の即時反映**
   ```
   操作：
   - 別ウィンドウで progress_log を新規投入
   - STAGE6 Impact タブ をリロード（または自動リロード待機）
   - ⭐数値を再確認
   ```
   期待結果：
   - 該当プロジェクトの⭐数値が変化
   - 他プロジェクトの⭐数値は変わらない
   - ソート順（ある場合）が保持される
   - コンソール: `[bridge][F-5] Impact tab: Project X contribution=0.68*weight=0.92=0.63`

3. **並び順保持確認**
   ```
   操作（ソート機能がある場合）：
   - 「Execution Contribution」ヘッダをクリック → 降順ソート
   - progress_log を投入
   - STAGE6 をリロード
   - ソート順を再確認
   ```
   期待結果：
   - 依然、降順ソート状態を保持
   - 新しい並び順で再計算される
   - コンソール: `[bridge][F-5] Impact tab sort preserved: desc`

4. **複数OKR の独立性確認**
   ```
   操作：
   - OKR #1 に対して progress_log を投入
   - STAGE6 Impact タブ をリロード
   - OKR #1 の寄与度は変化、OKR #2 は不変を確認
   ```
   期待結果：
   - Project X (OKR #1) の⭐数値が変化
   - Project Y (OKR #2) の⭐数値が不変
   - コンソール: `[bridge][F-5] Impact: Project X updated=0.92, Project Y unchanged=1.0`

#### 失敗時の症状
- weight 변更後 Impact タブの数値が更新されない → **MAJOR**
- ソート順が無視される → **MAJOR**
- 別OKRのweight 変化が誤って他プロジェクトに反映 → **CRITICAL**
- Impact タブの一覧から行が消える → **CRITICAL**

#### 確認ログ
```
[bridge][F-5] Impact tab loaded: 2 projects
[bridge][F-5] Impact: Project X updated, weight=0.92 → contribution=0.63
[bridge][F-5] Impact: Project Y unchanged, weight=1.0 → contribution=0.68
[bridge][F-5] Impact sort: desc (preserved)
```

---

### B-2-6. 保存→ログアウト→復元

#### テスト概要
progress_logs を保存後、別セッション（ログアウト→再ログイン）で開き直しても寄与度が正確に再計算されることを確認。

#### 前提状態
- 複数の progress_logs が 90日内に投入済み
- テスト用ユーザーアカウント（test-user）でログイン中

#### 手順

1. **初期状態のweight 記録**
   ```
   操作：
   - STAGE6 Impact タブ を表示
   - OKR #1 の⭐数値を記録（例：0.92）
   - コンソール: console.log('Initial weight:', weight)
   ```

2. **ログアウト**
   ```
   操作：
   - ユーザーメニュー → Logout をクリック
   - ブラウザローカルストレージ確認（DevTools → Application → Local Storage が消えること）
   ```

3. **別セッションで再ログイン**
   ```
   操作：
   - ページを再読込（Ctrl+Shift+R でキャッシュクリア）
   - 同じ test-user でログイン
   - 同じ Company A にアクセス
   - STAGE6 Impact タブ を再表示
   ```

4. **weight の再計算確認**
   ```
   期待結果：
   - OKR #1 の⭐数値が初期値と同じ（0.92）
   - progress_logs が DB から再読込されている
   - コンソール: `[bridge][F-5] session restore: weight=0.92 (same as initial)`
   ```

5. **ローカルスナップショット vs DB**
   ```
   （オプション：ローカルキャッシュ機能がある場合）
   - ローカルスナップショット（IndexedDB等）の timestamp と DB 取得の timestamp を比較
   - 二重適用されていないことを確認
   ```
   期待結果：
   - DB が優先される（Stale-While-Revalidate であれば UI は一度古い値を表示後に更新）
   - 計算結果が重複しない

#### 失敗時の症状
- ログイン後にweight が異なる値になる → **MAJOR**
- progress_logs が二重に読み込まれ weight が異常値に → **CRITICAL**
- キャッシュから古い値が残り続ける → **MAJOR**

#### 確認ログ
```
[bridge][F-5] session initial: weight=0.92
[bridge][F-5] session restore: weight=0.92 (DB reload, no double-apply)
[bridge][F-5] session cache: ローカルスナップショット timestamp={ts1}, DB timestamp={ts1}, same
```

---

### B-2-7. パフォーマンス

#### テスト概要
progress_logs 取得が重くないこと（90日フィルタがサーバ側で効いていること）、STAGE6 初期表示がフリーズしないことを確認。

#### 前提状態
- progress_logs テーブルに 1000件以上のログが存在（過去3年分想定）
- Network DevTools でリクエスト・レスポンス時間を測定可能

#### 手順

1. **サーバ側90日フィルタの確認**
   ```
   操作：
   - F12 → Network タブ → `loadProgressLogs` API リクエストを確認
   - Request Query String を確認: ?fromDate=2024-11-16...&limit=1000
   - Response の件数を確認（期待：90日内のログのみ、例：4～50件）
   ```
   期待結果：
   - Request に `fromDate` パラメータが含まれている
   - Response の配列要素数が 1000件よりはるかに少ない（例：20件）
   - Response Body の bytes が小さい（10KB以下目安）
   - コンソール: `[bridge][F-5] loadProgressLogs response: 20 logs, 8.3 KB`

2. **全件取得の禁止確認**
   ```
   操作：
   - Network の loadProgressLogs リクエストで fromDate が **ない** 場合は NG
   - `SELECT COUNT(*) FROM progress_logs WHERE company_id=...` が重い場合の確認
   ```
   期待結果：
   - 必ず `fromDate` 制限が適用されている
   - Query で INDEX が使われている（DB実行計画）
   - 所要時間 < 100ms

3. **STAGE6 初期表示の応答性**
   ```
   操作：
   - STAGE6 Impact タブ をナビゲート
   - ページの読み込み時間を確認（F12 → Network で所要時間）
   - UI が反応する（ボタン押下、スクロール等が遅延していないか）確認
   ```
   期待結果：
   - STAGE6 ページの初期表示が目視で「フリーズ」していない
   - Network Request に fromDate パラメータが含まれ、レスポンスが軽い（数MB以下）
   - UI インタラクション（クリック、スクロール）が遅延していない

4. **大規模データセット耐性**
   ```
   操作（テスト用 DB準備）：
   - progress_logs に 90日内で 500件のログを追加
   - STAGE6 Impact タブ を複数回リロード
   - UI の応答性を確認
   ```
   期待結果：
   - ページロード時間がほぼ変わらない（100件時と 500件時で顕著な差がない）
   - メモリが増え続けない（複数リロード後も DevTools → Memory が安定）
   - UI がクリック反応する

#### 失敗時の症状
- fromDate パラメータなし、全件取得している → **CRITICAL**
- STAGE6 ページがいつまでも読み込み中（UI が反応しない、数秒以上フリーズ） → **MAJOR**
- メモリが増え続ける（複数リロード後に DevTools メモリ使用量が増加） → **MAJOR**

#### 確認ログ
```
[bridge][F-5] loadProgressLogs: fromDate=2024-11-16T10:00:00Z limit=1000 response=20 logs
[bridge][F-5] performance: Network request ~1秒以内, UI 応答良好
[bridge][F-5] performance: 500 logs でもページロード時間ほぼ同等、メモリ安定
```

---

## B-3. テスト実行順序と確認ポイント

| 順序 | テスト項目 | 優先度 | 推定時間 | 依存 |
|---|---|---|---|---|
| 1 | B-2-1 OKR ID 安定性 | 必須 | 15分 | なし |
| 2 | B-2-2 __META__ 埋め込み | 必須 | 20分 | B-2-1 |
| 3 | B-2-3 progress_logs 集計 | 必須 | 25分 | B-2-2 |
| 4 | B-2-4 weight 単調性 | 必須 | 20分 | B-2-3 |
| 5 | B-2-5 STAGE6 Tab1 反映 | 必須 | 15分 | B-2-4 |
| 6 | B-2-6 保存→ログアウト→復元 | 必須 | 15分 | B-2-5 |
| 7 | B-2-7 パフォーマンス | 推奨 | 15分 | B-2-3 |

---

## B-4. テスト結果記録

### テスト実行日時
- 日付: _____________
- 実施者: _____________
- テスト環境: [ローカル / ステージング / 本番前]

### テスト結果サマリー

| テスト項目 | 結果 | 備考 |
|---|---|---|
| B-2-1 OKR ID 安定性 | ☐ PASS ☐ FAIL | |
| B-2-2 __META__ 埋め込み | ☐ PASS ☐ FAIL | |
| B-2-3 progress_logs 集計 | ☐ PASS ☐ FAIL | |
| B-2-4 weight 単調性 | ☐ PASS ☐ FAIL | |
| B-2-5 STAGE6 Tab1 反映 | ☐ PASS ☐ FAIL | |
| B-2-6 保存→ログアウト→復元 | ☐ PASS ☐ FAIL | |
| B-2-7 パフォーマンス | ☐ PASS ☐ FAIL | |

### 発見されたバグ（ある場合）

```
[BUG #1] OKR ID が変わる（B-2-1 失敗）
症状: タイトル変更後、okr_id が新規 UUID に変わった
再現手順: ...
影響度: CRITICAL
修正: ...

[BUG #2] __META__ に okrId が含まれていない（B-2-2 失敗）
症状: parseMetadata() で okrId=undefined
再現手順: ...
影響度: MAJOR
修正: ...
```

---

## 附録：デバッグログ出力確認方法

### コンソール出力ルール

開発時に `[bridge][F-5]` タグを付けたログを仕込んでいます。
本番環境では非表示（`NEXT_PUBLIC_DEBUG_BRIDGE !== '1'`）です。

```bash
# ローカル環境でのみ有効化
echo "NEXT_PUBLIC_DEBUG_BRIDGE=1" >> .env.local
```

### よくあるログ出力例

```javascript
// /utils/execution/metadata.ts
console.log('[bridge][F-5] metadata embed:', { companyId, okrId, timestamp });

// /utils/stage6/execution.ts
console.log('[bridge][F-5] weight calc:', { okrId, logsCount, avgRating, weight });

// /components/stage6/hooks/useStage6Data.ts
console.log('[bridge][F-5] loadProgressLogs:', { companyId, fromDate, found: data.length });
```

---

## 附録：本番導入前チェックリスト

- [ ] F-5 回帰テスト が全て PASS
- [ ] npm run type-check が通っている
- [ ] npm run build が通っている
- [ ] DBインデックスが構築されている（`(company_id, created_at)`）
- [ ] 環境変数 NEXT_PUBLIC_DEBUG_BRIDGE が本番で設定されていない（デフォルト）
- [ ] ログローテーション設定済み（ログが無限に増えない）
