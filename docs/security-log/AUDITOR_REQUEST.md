# Supabase DBスキーマダンプ取得 - 監査担当者への依頼

**日付:** 2026-07-08  
**プロジェクト:** growth-mvp-ver2.0  
**対象:** Supabase 本番プロジェクト (yuerkbxpivdhaikrnsar)

## 依頼内容

セキュリティ監査のため、下記Supabaseプロジェクトの **DBスキーマダンプ** を取得し、本リポジトリに保存していただきたくお願いします。

## 取得対象

**スキーマのみ** (実データ・シークレット除外)

- RLS ポリシー定義
- テーブル定義
- カスタム関数定義
- トリガー定義

## 取得方法

以下のいずれかの環境で実行してください：

### 前提条件
- Docker Desktop がインストール・起動されている
- Supabase CLI (`npx supabase` または `supabase` コマンド) が利用可能
- プロジェクトリポジトリにアクセス可能

### コマンド
```bash
cd C:\dev\growth-mvp-ver2.0
npx supabase link --project-ref yuerkbxpivdhaikrnsar
npx supabase db dump --linked --schema public --file supabase/schema_remote_20260708.sql
```

または

```bash
cd C:\dev\growth-mvp-ver2.0
supabase link --project-ref yuerkbxpivdhaikrnsar
supabase db dump --linked --schema public --file supabase/schema_remote_20260708.sql
```

## 検証手順（取得後）

生成ファイル `supabase/schema_remote_20260708.sql` に対して、以下を確認してください：

### 実データが含まれていないか
```powershell
Select-String -Path supabase/schema_remote_20260708.sql -Pattern "INSERT INTO|COPY "
```
結果がなければOK（実データ非含有）

### APIキー・シークレットが含まれていないか
```powershell
Select-String -Path supabase/schema_remote_20260708.sql -Pattern "sk_|pk_|secret|password|token"
```
（ただしコメント内のスキーマ説明での出現は無視可能）

## コミット方法

検証後、下記の手順で本リポジトリにコミットしてください：

```bash
git add supabase/schema_remote_20260708.sql
git add docs/security-log/supabase_schema_dump_status_20260708.md
git commit -m "Add Supabase remote DB schema dump for security audit (2026-07-08)"
git push origin main
```

## 注記

- 本ファイルは **監査用の控え** です
- リポジトリに保存するのはスキーマ定義のみです
- 実データ、APIキー、シークレット、認証情報の含有は厳禁です
- Docker Desktop は Windows 11 でも利用可能です（WSL 2 バックエンド推奨）

---

**ご不明な点がございましたら、お気軽にお声がけください。**
