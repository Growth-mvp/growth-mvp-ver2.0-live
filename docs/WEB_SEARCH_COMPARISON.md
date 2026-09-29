# Web 検索実装の比較：OpenAI API vs Tavily Search API

## OpenAI API（現在のモデル：gpt-5.6-luna）

### 対応状況
- **Web 検索**: ❌ 非対応
- **理由**: 推論モデル（gpt-5.6-luna）は Web アクセス機能なし
- **ChatGPT Web Search**: API 未公開（ブラウザ版のみ）

### 実装方法
- OpenAI API 単体では Web 検索不可
- 外部検索 API が必須

---

## Tavily Search API

### 対応状況
- **Web 検索**: ✅ 対応
- **特徴**: Web ページ検索、URL 取得可能

### 実装方法
```typescript
// Tavily API 呼び出し
const response = await fetch('https://api.tavily.com/search', {
  method: 'POST',
  body: JSON.stringify({
    api_key: TAVILY_API_KEY,
    query: "日本製罐 決算説明資料",
    max_results: 5,
  })
});
```

### 費用体系
- 詳細は https://tavily.com を参照
- 無料枠あり

---

## 実装比較表

| 項目 | OpenAI API | Tavily |
|------|-----------|--------|
| Web 検索 | ❌ 非対応 | ✅ 対応 |
| 決算資料取得 | ❌ 不可 | ✅ 可 |
| URL 取得 | ❌ 不可 | ✅ 可 |
| セットアップ | 既存 | API キー取得要 |

---

## 現在の実装状況

**コードは実装済み、外部検索は未検証**:
- ✅ Tavily API 呼び出しコード追加
- ⚙️ TAVILY_API_KEY 環境変数で有効化
- ❌ API キー未設定のため動作未確認
- ⚙️ 検索結果フィルタリングロジック実装済み

**フィルタリング条件**:
- 会社名が一致すること
- 決算期 (YYYY年M月期形式) が抽出可能
- 開示日 (YYYY-MM-DD形式) が抽出可能
- 決算期・開示日がない場合は数値を引用しない

**データフロー**:
```
質問「日本製罐の業績？」
  ↓
STAGE1登録データ取得 ✅ (Supabase)
  ↓
Tavily で決算資料検索（API キー設定時のみ） ⚙️ 未検証
  ↓
OpenAI で総合分析・提案 ✅ (gpt-5.6-luna)
```

---

## 次のステップ

1. **Tavily API キー取得**
   - https://tavily.com にアクセス
   - API キーを取得

2. **環境変数設定**
   ```
   TAVILY_API_KEY=your_key_here
   ```

3. **検証**
   - 「日本製罐の業績は？」テスト
   - ログで検索結果フィルタリングを確認

---

**注記**: 外部検索は API キー未設定のため未検証です。
