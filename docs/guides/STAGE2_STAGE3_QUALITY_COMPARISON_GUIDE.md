# STAGE2・STAGE3 品質比較テスト手順書

**目的**: 現在のモデル（gpt-4o / gpt-5.6-luna）と gpt-6-luna の出力品質を比較  
**実施環境**: ローカル開発環境（本番データは使用しないこと）  
**所要時間**: 約 1-2 時間

---

## 【準備】テスト用データの準備

### 1. テストデータの選定

以下の条件を満たす GROWTH SHIFT データを選定してください：

**条件**:
- ✅ STAGE2 以降のデータ（既にドラフト・最終生成済み）
- ✅ 十分な内容量（質問への回答が詳細）
- ✅ 実際のビジネス内容を含む
- ✅ STAGE3 まで進んだデータ（カスケード生成済み）

**対象データ**: 3-5 件の企業データを準備（複数の業種・規模が望ましい）

### 2. テストデータの保存

各テストごとに、以下の情報を記録します：

```
test-data-001/
├── company_info.json       # 企業情報（業種、売上、社員数など）
├── stage2_input.json       # STAGE2 入力（12問答、MVV、SWOT）
├── stage2_current.json     # 現在モデルの出力（ドラフト）
├── stage2_current_final.json  # 現在モデルの出力（最終）
├── stage2_gpt6luna.json    # gpt-6-luna の出力（ドラフト）
├── stage2_gpt6luna_final.json # gpt-6-luna の出力（最終）
├── stage3_input.json       # STAGE3 入力（最終ストーリー）
├── stage3_current.json     # 現在モデルの出力（カスケード）
├── stage3_gpt6luna.json    # gpt-6-luna の出力（カスケード）
└── evaluation.md           # 評価結果
```

---

## 【テスト手順1】STAGE2 ドラフト生成の比較

### ステップ1: 現在のモデルで生成

```bash
# 1. 開発サーバーを起動
npm run dev

# 2. ブラウザで GROWTH SHIFT にアクセス
# http://localhost:3000/stage2

# 3. テストデータを入力（12問、MVV、SWOT）

# 4. 「ドラフト生成」ボタンをクリック

# 5. 生成結果を JSON 形式で出力
# ブラウザコンソール:
// strategyStore の storyDraft を取得
JSON.stringify(useStrategyStore.getState().storyDraft, null, 2)

# 6. 結果を test-data-001/stage2_current.json に保存
```

### ステップ2: gpt-6-luna で生成

#### 2-1. config/models.json でモデルを一時的に切り替え

```bash
# config/models.json のバックアップ作成
cp config/models.json config/models.json.backup

# models.json を編集（テンポラリ）
```

**修正内容** (config/models.json):
```json
{
  "ai_models": {
    "reasoning": "gpt-6-luna",  // gpt-5.6-luna → gpt-6-luna に変更
    "lightweight": "gpt-4o-mini"
  },
  ...
}
```

⚠️ **重要**: temperature パラメータの処理を確認
- lib/modelConfig.ts で temperature を Luna に送らないロジックが有効か確認
- 必要に応じて、テスト用に temperature 削除コードを追加

#### 2-2. テスト実行

```bash
# 1. npm run type-check で型エラーを確認
npm run type-check

# 2. 開発サーバーを再起動
npm run dev

# 3. 同じテストデータを入力

# 4. 「ドラフト生成」ボタンをクリック

# 5. 結果を test-data-001/stage2_gpt6luna.json に保存
```

**注意**:
- 生成が失敗した場合、エラーメッセージを記録
- ブラウザコンソール / サーバーログを確認

#### 2-3. config/models.json を復元

```bash
# 元に戻す
cp config/models.json.backup config/models.json

# 開発サーバーを再起動
npm run dev
```

---

## 【テスト手順2】STAGE2 最終生成の比較

### ステップ1: 現在のモデルで生成

```bash
# 1. STAGE2 画面で、ドラフト生成後に「最終版生成」をクリック

# 2. 結果を JSON 形式で取得
JSON.stringify(useStrategyStore.getState().finalStory, null, 2)

# 3. test-data-001/stage2_current_final.json に保存
```

### ステップ2: gpt-6-luna で生成

```bash
# 1. config/models.json を gpt-6-luna に切り替え
cp config/models.json config/models.json.backup
# models.json 修正

# 2. 開発サーバーを再起動
npm run dev

# 3. 「最終版生成」をクリック

# 4. 結果を test-data-001/stage2_gpt6luna_final.json に保存

# 5. config/models.json を復元
cp config/models.json.backup config/models.json
npm run dev
```

---

## 【テスト手順3】STAGE3 カスケード生成の比較

### ステップ1: 現在のモデルで生成

```bash
# 1. STAGE3 画面にアクセス
# http://localhost:3000/stage3

# 2. 「カスケード生成」ボタンをクリック

# 3. 結果を JSON 形式で取得（Supabase から）
```

### ステップ2: gpt-6-luna で生成

```bash
# 同様の手順で gpt-6-luna に切り替えて実行
```

---

## 【評価】STAGE2 品質比較

### 評価項目

各項目について、以下の基準で評価してください：

#### 1. 入力反映度

```
基準:
✅ 12の質問やSWOT等の入力内容を正しく反映している
✅ 企業固有の内容になっている
❌ 抽象論・一般論が増えている
❌ 入力と異なる内容が生成されている
```

**評価**:
- 現在モデル: A / B / C
- gpt-6-luna: A / B / C
- 差異: ①同等 ②わずかな差 ③明らかな差

#### 2. 本質課題の捉え方

```
基準:
✅ 企業の根本的な課題を識別している
✅ 市場環境と企業の強み・弱みをつなげている
❌ 表面的な課題にとどまっている
❌ 根拠の弱い解釈がある
```

**評価**: A / B / C

#### 3. 価値定義の具体性

```
基準:
✅ 顧客に提供する価値が明確に定義されている
✅ 他社との違いが明確
✅ 実現可能性がある
❌ 抽象的で曖昧
❌ 実現不可能な理想論
```

**評価**: A / B / C

#### 4. 選ぶ理由の説得力

```
基準:
✅ なぜその戦略を選ぶのか根拠が明確
✅ SWOT や市場分析とのつながりが見える
✅ 経営判断として納得できる
❌ 理由が薄い
❌ 根拠がない
```

**評価**: A / B / C

#### 5. 戦略ストーリーとしての一貫性

```
基準:
✅ 第1章（なぜ今）→ 第2章（どう戦う）→ 第3章（どんな未来）の流れが自然
✅ 各章が相互に関連している
✅ 読み手が納得できる論理構成
❌ 章と章の連関が薄い
❌ 矛盾や違和感がある
```

**評価**: A / B / C

#### 6. 現在のUI・保存形式との互換性

```
基準:
✅ JSON 形式が正しい
✅ UI で正常に表示される
✅ 保存・読み込みでエラーがない
❌ JSON パースエラー
❌ UI 表示異常
❌ 保存失敗
```

**評価**: A / B / C

---

## 【評価】STAGE3 品質比較

### 評価項目

#### 1. STAGE2 継承度

```
基準:
✅ STAGE2の全社戦略を正しく理解している
✅ 全社戦略の本質的な意図が伝わっている
❌ 全社戦略が単なる言い換えになっている
❌ 全社戦略の意図が失われている
```

**評価**: A / B / C

#### 2. 部門固有への変換

```
基準:
✅ 全社戦略を部門の役割に適切に変換
✅ 部門の文脈に合わせた表現
✅ 部門の課題・機会を反映
❌ 全社戦略の単なるコピー
❌ 部門固有性がない
```

**評価**: A / B / C

#### 3. 部門間の役割分担の明確性

```
基準:
✅ 部門Aと部門Bの役割分担が明確
✅ 部門間の相互依存関係が見える
✅ 全社目標への貢献方法が明確
❌ 部門間の役割が重複している
❌ 役割分担が不明確
```

**評価**: A / B / C

#### 4. 実行可能性への具体化

```
基準:
✅ 戦略が行動レベルに具体化されている
✅ STAGE4で実行計画に落とし込みやすい
✅ 現場が理解・実行可能
❌ 抽象的で実行方法が不明
❌ 実行困難な表現
```

**評価**: A / B / C

#### 5. 経営→部門→行動の因果関係

```
基準:
✅ 全社戦略 → 部門戦略 → 行動 の論理が一貫
✅ なぜこの行動をするのかが見える
✅ CEO の意図が現場に届きやすい
❌ 因果関係が不明確
❌ 断絶がある
```

**評価**: A / B / C

#### 6. JSON構造・UI互換性

```
基準:
✅ JSON構造が正しい
✅ UI で正常に表示される
✅ 保存・読み込みでエラーなし
❌ 構造エラー
❌ 表示異常
```

**評価**: A / B / C

---

## 【集計】最終判定

### STAGE2 総合評価

```
現在モデル: 
- 入力反映度: A / B / C
- 本質課題: A / B / C
- 価値定義: A / B / C
- 説得力: A / B / C
- 一貫性: A / B / C
- 互換性: A / B / C

gpt-6-luna:
- 入力反映度: A / B / C
- 本質課題: A / B / C
- 価値定義: A / B / C
- 説得力: A / B / C
- 一貫性: A / B / C
- 互換性: A / B / C

結論:
□ A: gpt-6-luna が現行より明確に良い（移行候補）
□ B: gpt-6-luna が現行とほぼ同等（移行候補）
□ C: gpt-6-luna が現行より悪い（移行しない）
```

### STAGE3 総合評価

```
（同様の形式で評価）

結論:
□ A: 移行候補
□ B: 移行候補
□ C: 移行しない
```

---

## 【報告書作成】

### evaluation.md テンプレート

```markdown
# STAGE2・STAGE3 品質比較評価報告書

## テスト情報
- テスト日時: YYYY-MM-DD HH:MM
- テストデータ: test-data-001 等
- 企業: ○○○
- 業種: ○○○
- テスト者: ○○○

## STAGE2 ドラフト生成

### 入力反映度
- 現在モデル: A / B / C 理由: ○○○
- gpt-6-luna: A / B / C 理由: ○○○

### 本質課題
- 現在モデル: A / B / C
- gpt-6-luna: A / B / C

... (以下、すべての項目について記入)

## STAGE2 最終生成

(同様に評価)

## STAGE3 カスケード生成

(同様に評価)

## 総合判定

### STAGE2
結論: □ A □ B □ C

### STAGE3  
結論: □ A □ B □ C

## 推奨事項

（A or B）移行候補。以下の理由から gpt-6-luna への置換を推奨
- ○○○

（C）移行は推奨しない。以下の理由から現行モデルを維持すべき
- ○○○

## 添付

- stage2_current.json
- stage2_gpt6luna.json
- stage3_current.json
- stage3_gpt6luna.json
```

---

## 【実施手順サマリー】

1. ✅ テスト用データ準備（3-5社）
2. ✅ 現在モデルで STAGE2 ドラフト生成
3. ✅ 現在モデルで STAGE2 最終生成
4. ✅ config/models.json を gpt-6-luna に切り替え
5. ✅ gpt-6-luna で STAGE2 ドラフト生成
6. ✅ gpt-6-luna で STAGE2 最終生成
7. ✅ config/models.json を復元
8. ✅ 現在モデルで STAGE3 カスケード生成
9. ✅ gpt-6-luna で STAGE3 カスケード生成
10. ✅ 各テストについて A/B/C 評価
11. ✅ 評価報告書を作成

**所要時間**: 1-2 時間

---

## 【重要】注意事項

### ⚠️ パラメータ互換性の問題

gpt-6-luna への切り替え時に、以下のエラーが発生する可能性があります：

```
❌ 400 Unsupported value: 'temperature' does not support 0.5
```

**対応**:
- lib/modelConfig.ts で temperature を Luna に送らないコードが有効か確認
- または、テスト用に一時的に temperature 削除コードを追加
- エラーが発生した場合、ブラウザコンソール / サーバーログを記録

### ⚠️ 本番データの使用禁止

- テスト環境（ローカル）のみで実施
- 本番データベースへの影響なし
- テスト用のサンプルデータを使用

### ⚠️ 結果の保存

- JSON ファイルは必ず test-data-XXX ディレクトリに保存
- Git にコミットしない（.gitignore に追加）
- 社内用の評価報告書として保管

---

**実施準備完了後、評価報告書を提出してください。**

