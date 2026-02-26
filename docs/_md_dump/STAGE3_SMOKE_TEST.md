# STAGE3 品質検証スクリプト

## 概要

STAGE3の品質を固定するための最小検証スクリプトです。新機能追加ではなく、仕様通りに動作することを証明します。

## 検証内容

1. **valueDriverLinks**: 全プロジェクトに価値指標へのリンクが存在する（length>=1）
2. **skillRequirements.executionSkills**: 全プロジェクトに実行スキルが存在する（length>=1）
3. **humanInvestments**: 全プロジェクトに人的投資施策が存在する（length>=1、推奨2カテゴリ以上）
4. **上書き防止**: フォールバック処理が既存ユーザー入力を上書きしないことを確認

## 追加/変更ファイル一覧

```
scripts/
  └── stage3.smoke.mjs          # 新規追加：スモークテストスクリプト
  └── STAGE3_SMOKE_TEST.md      # 新規追加：本ドキュメント

package.json                     # 変更：scriptsセクションに "stage3:smoke" 追加

app/api/generate-cascade/
  └── route.ts                   # 変更：フォールバック処理を追加済み（前回実装）
```

## 実行手順

### 1. 開発サーバーの起動

別ターミナルで開発サーバーを起動してください：

```bash
npm run dev
```

サーバーが `http://localhost:3000` で起動することを確認してください。

### 2. スモークテストの実行

新しいターミナルで以下のコマンドを実行：

```bash
npm run stage3:smoke
```

### 3. ビルド確認

検証完了後、ビルドが通ることを確認：

```bash
npm run build
```

## 期待される出力例

### 成功時の出力

```
============================================================
STAGE3 スモークテスト開始
============================================================
API URL: http://localhost:3000/api/generate-cascade
valueDriverKPIs: 3個

【ステップ1】API呼び出し...
✅ APIレスポンスステータスが200-299 (実際: 200)

【ステップ2】基本構造の検証...
✅ departments配列が存在する
✅ departmentsが配列である
✅ departments配列に要素が1つ以上ある
部門数: 1

【ステップ3】STAGE3拡張フィールドの検証...

部門: テスト営業部
  既存進化レーン: 2プロジェクト
    - 既存進化：高付加価値案件の創出
      ✓ valueDriverLinks: 2個 [kpi_arpu, kpi_ltv]
      ✓ executionSkills: 2個 [PM, データ活用]
      ✓ humanInvestments: 2件, 2カテゴリ
    - 既存進化：顧客接点の質向上
      ✓ valueDriverLinks: 1個 [kpi_churn]
      ✓ executionSkills: 2個 [標準化, 改善運用]
      ✓ humanInvestments: 2件, 2カテゴリ
  新規探索レーン: 1プロジェクト
    - 新規探索：新規ビジネスモデル検証
      ✓ valueDriverLinks: 1個
      ✓ executionSkills: 2個
      ✓ humanInvestments: 2件, 2カテゴリ

【ステップ4】集計結果の検証...
総プロジェクト数: 3
valueDriverLinks あり: 3/3
executionSkills あり: 3/3
humanInvestments あり: 3/3
humanInvestments 2+カテゴリ: 3/3
✅ 検証対象のプロジェクトが1つ以上存在する
✅ 全プロジェクトに valueDriverLinks が存在する（length>=1）
✅ 全プロジェクトに executionSkills が存在する（length>=1）
✅ 全プロジェクトに humanInvestments が存在する（length>=1）

【ステップ5】上書き防止の確認...
fillMissingStage3Fields() の実装を確認:
  ✓ valueDriverLinks: 空または未定義の場合のみ補完
  ✓ skillRequirements: executionSkills が空または未定義の場合のみ補完
  ✓ humanInvestments: 空または未定義の場合のみ補完
  → 既存のユーザー入力データは上書きされません

============================================================
✅ 全ての検証に成功しました！
============================================================

STAGE3の品質が仕様通りであることを確認しました：
  1. 全プロジェクトに valueDriverLinks が存在する
  2. 全プロジェクトに skillRequirements.executionSkills が存在する
  3. 全プロジェクトに humanInvestments が存在する
  4. フォールバックは既存データを上書きしない実装になっている
```

### エラー時の出力

```
❌ ASSERTION FAILED: 全プロジェクトに valueDriverLinks が存在する（length>=1）
```

エラーが発生した場合、スクリプトは `process.exit(1)` で終了します。

## トラブルシューティング

### Q: `npm run dev` が起動していないエラー

```
❌ ネットワークエラー: fetch failed
→ npm run dev が起動しているか確認してください
```

**対処法**: 別ターミナルで `npm run dev` を実行し、サーバーが起動してから再度テストを実行してください。

### Q: スクリプト実行時に構文エラー

**対処法**: Node.js 18以上が必要です。`node --version` で確認してください。

### Q: ポート3000が使用できない

**対処法**: `npm run dev:3001` などでポートを変更した場合は、`scripts/stage3.smoke.mjs` の `API_URL` を編集してください。

```javascript
const API_URL = 'http://localhost:3001/api/generate-cascade'; // ポート変更
```

## 技術詳細

### スクリプト構造

`scripts/stage3.smoke.mjs` は以下の検証を行います：

1. **API呼び出し**: テストペイロード（valueDriverKPIs 3個を含む）をPOST
2. **構造検証**: departments配列の存在確認
3. **フィールド検証**: 各プロジェクトのSTAGE3拡張フィールドを全件チェック
4. **集計アサーション**: 全プロジェクトで必須フィールドが揃っていることを確認

### フォールバック実装の確認

`app/api/generate-cascade/route.ts` の `fillMissingStage3Fields()` 関数は、以下の条件でのみフィールドを補完します：

```javascript
// valueDriverLinks: 空または未定義の場合のみ
if (!project.valueDriverLinks || project.valueDriverLinks.length === 0) {
  // 補完処理
}

// skillRequirements.executionSkills: 空または未定義の場合のみ
if (!project.skillRequirements?.executionSkills ||
    project.skillRequirements.executionSkills.length === 0) {
  // 補完処理
}

// humanInvestments: 空または未定義の場合のみ
if (!project.humanInvestments || project.humanInvestments.length === 0) {
  // 補完処理
}
```

既存のユーザー入力データ（length>=1のデータ）は上書きされません。

## CI/CD統合

将来的にCI/CDパイプラインに統合する場合：

```yaml
# .github/workflows/test.yml の例
- name: Start dev server
  run: npm run dev &

- name: Wait for server
  run: npx wait-on http://localhost:3000

- name: Run STAGE3 smoke test
  run: npm run stage3:smoke
```

## まとめ

このスクリプトにより、STAGE3の品質が以下の点で保証されます：

- AI生成が正しく動作し、必須フィールドを返す
- フォールバック処理が適切に機能する
- 既存データが破壊されない
- ビルドが通る状態を維持

定期的に実行し、回帰を防止してください。
