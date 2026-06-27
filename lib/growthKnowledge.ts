// lib/growthKnowledge.ts
// Sprint 5-5.3: GROWTH Q&A ナレッジベース - 単一ソース + UI定義同期

export interface KnowledgeSection {
  id: string;
  title: string;
  keywords: string[];
  content: string;
}

/**
 * GROWTH Q&A ナレッジセクション
 * 各セクションは 10-25行程度、Markdown形式
 * Sprint 5.3: STAGE4-6 追加、既存セクション修正（UI定義に同期）
 */
const KNOWLEDGE_SECTIONS: KnowledgeSection[] = [
  {
    id: 'GENERAL_OVERVIEW',
    title: 'GROWTH - 企業価値分析ツールの全体像',
    keywords: ['GROWTH', '目的', '何', 'ツール', 'ステージ', 'stage', '手順', 'どんな', 'とは', 'できること', '機能', '全体像', '流れ', '一気通貫'],
    content: `## GROWTH とは

**GROWTH は企業価値分析ツールです。** 経営者が企業価値を把握・向上させるために、以下の一気通貫サイクルを回します：

1. **Stage 1: 企業価値分析** → 財務数値から5つの指標を計算、強化項目を特定
2. **Stage 2: 全社戦略** → 勝ち筋・中計の方向性を定義し、AI との12問仮説検証で磨く
3. **Stage 3: 事業・部門別戦略** → 全社戦略を各事業・部門のミッション・プロジェクト・OKR に展開
4. **Stage 4: 実行計画策定** → OKR をマイルストーン・優先順位・リソース計画に落とす
5. **Stage 5: 実行支援** → 進捗追跡・チェックイン・フィードバック・評価
6. **Stage 6: 業績シミュレーション** → 実行計画が業績（PL等）にどう効くかを試算

各 Stage は「入力 → AI分析 → 改善」を繰り返し、企業価値を段階的に高めます。`,
  },

  {
    id: 'STAGE1_INPUT',
    title: 'Stage 1: 財務入力の流れ',
    keywords: ['stage1', 'STAGE1', 'ステージ1', '入力', '財務', 'PL', 'BS', '事業部', '全社', 'データ', '何をする', 'やること'],
    content: `## Stage 1 財務データ入力

**入力対象:**
1. **全社 PL/BS**: メニューの「基本情報」→ 全社財務を3年分
2. **事業部別 PL/BS**: 「事業部別」タブから各事業部の3年分
3. **スナップショット（任意）**: 将来予測や特定の見立てを入力

**データ形式:**
- 数値は「万円」単位で整数（カンマ不要）
- 3年分必須（直近3期の実績推奨）
- 各項目の定義は「ヘルプ」ボタンで確認可能

**確認:**
入力後、5つの指標（ROIC, WACC, PBR, 成長率, 利益率）が自動計算され、業界ベンチマークと比較されます。`,
  },

  {
    id: 'STAGE1_CSV',
    title: 'Stage 1: CSV アップロードの形式',
    keywords: ['CSV', 'アップロード', '形式', 'ヘッダ', '列', 'エラー', 'インポート'],
    content: `## CSV アップロード ガイド

**前提条件:**
- ファイル形式: CSV（UTF-8）
- 1行目: ヘッダ（必須列: 年度, 売上, 営業利益など）
- ヘッダ名の揺らぎは吸収（「売上」「Revenue」など対応）

**必須列:**
年度, 売上, 営業利益, 税引前当期利益（または EBIT など）

**よくある失敗:**
- ヘッダが日本語と英語混在 → 正規化で対応
- 数値にカンマやスペース → 削除して再試行
- 行が不足（3年未満） → エラー表示、補足入力を案内

**対処:**
エラー表示を確認し、該当セルを修正して再アップロード。`,
  },

  {
    id: 'STAGE1_METRICS',
    title: 'Stage 1: 5 指標とベンチマーク',
    keywords: ['指標', 'ROIC', 'WACC', 'PBR', '成長率', '利益率', 'ベンチマーク'],
    content: `## 5つの主要指標

1. **ROIC（投下資本利益率）**: 企業がどれだけ効率的に資本を使っているか
2. **WACC（加重平均資本コスト）**: 企業の資本調達コスト（低いほど効率的）
3. **PBR（株価純資産倍率）**: 時価総額 ÷ 純資産（成長期待を反映）
4. **成長率**: 売上 or 利益の年成長率（%）
5. **利益率**: 営業利益 ÷ 売上（経営効率）

**ベンチマーク:**
業界平均値と自社値の比較チャート表示。赤旗（改善余地大）と緑（優良）で可視化。

**使い方:**
各指標をクリックすると、詳細説明と改善示唆が出ます。`,
  },

  {
    id: 'STAGE2_FLOW',
    title: 'Stage 2: 全社戦略',
    keywords: ['stage2', 'STAGE2', 'ステージ2', 'ストーリー', '勝ち筋', '12問', '仮説', 'QA', 'シナリオ', '戦略', '経営戦略', 'SWOT', 'ビジョン'],
    content: `## Stage 2 経営戦略策定

**目的:** 全社の勝ち筋を定義し、AI との12問仮説検証で戦略を磨く

**ステップ:**
1. **基本情報入力**: ミッション / ビジョン / バリュー
2. **SWOT 分析**: 強み / 弱み / 機会 / 脅威（3件以上推奨）
3. **勝ち筋定義**: 経営課題に対する 3-5 の打ち手（例: M&A, DX, 新事業）
4. **12 の質問**: AI が生成した質問に回答（仮説検証）
5. **最終ストーリー**: AI がユーザー回答を整理し、1 つの統合ストーリーを生成

**出力:**
統合戦略ストーリー。これを Stage 3 で部門・プロジェクト・OKR に展開します。`,
  },

  {
    id: 'STAGE3_CASCADE',
    title: 'Stage 3: 事業・部門別戦略',
    keywords: ['stage3', 'STAGE3', 'ステージ3', 'カスケード', 'cascade', 'OKR', 'ミッション', 'プロジェクト', '展開', '部門', '事業', '戦略'],
    content: `## Stage 3 事業・部門別戦略

**目的:** 全社戦略（Stage 2）を各事業・部門の戦略・プロジェクト・OKR に展開

**構造:**
全社戦略ストーリー → 部門ミッション → プロジェクト → OKR

**ステップ:**
1. 各部門の「ミッション」を Stage 2 戦略ストーリーから継承
2. プロジェクト化：「何をするか」を具体化
3. OKR（Objective + Key Results）：目標と成功基準を定義

**AI補助:**
「AI 要約 / 生成」ボタンで OKR の下書きを自動作成。修正・確定後に保存。

**出力:**
部門別の戦略・プロジェクト・OKR。これを Stage 4 で実行計画に落とします。`,
  },

  {
    id: 'STAGE4_EXEC_PLAN',
    title: 'Stage 4: 実行計画策定',
    keywords: ['stage4', 'STAGE4', 'ステージ4', '実行計画', '計画', 'マイルストーン', '担当', '優先順位', 'リソース'],
    content: `## Stage 4 実行計画策定

**目的:** Stage 3 で定めた事業・部門別戦略・プロジェクト・OKR を、実行可能な計画に落とす

**ステップ:**
1. **優先順位付け**: プロジェクト・OKR の重要度・緊急度から優先順位を決定
2. **マイルストーン定義**: 各プロジェクトの目標・完了時期・中間成果物を明記
3. **担当者配置**: 各プロジェクト・タスクの所有者・メンバーを割り当て
4. **リソース計画**: 予算・人員・ツール等の必要リソースを定義
5. **実行方法**: スプリント・段階的実行・依存関係を明確化

**出力:**
実行計画書（誰が・いつまでに・何を・どうやる）。これを Stage 5 で進捗追跡します。`,
  },

  {
    id: 'STAGE5_EXEC_SUPPORT',
    title: 'Stage 5: 実行支援',
    keywords: ['stage5', 'STAGE5', 'ステージ5', '進捗', 'チェックイン', 'コメント', '評価', 'アドバイス', '協力要請', 'フィードバック'],
    content: `## Stage 5 実行支援

**目的:** Stage 4 で策定した実行計画を回す。進捗追跡・課題解決・リアルタイム支援

**やること:**
1. **進捗入力**: 各プロジェクト・タスクの進捗状況（達成度 %、課題、成果物）をログ
2. **チェックイン**: 定期的に進捗を確認し、AI がフィードバック・次アクションを提示
3. **評価・アドバイス**: AI が進捗から課題を診断し、改善示唆を返す
4. **協力要請**: チーム間の依存関係や調整が必要な場合、AI が支援を促す

**出力:**
進捗ログ、評価コメント、可視化（進捗率、課題一覧、リスク）。リアルタイムに戦略実行の状態把握。`,
  },

  {
    id: 'STAGE6_PERFORMANCE_SIM',
    title: 'Stage 6: 業績シミュレーション',
    keywords: ['stage6', 'STAGE6', 'ステージ6', '業績', 'シミュレーション', 'PL', '売上', '利益', '前提', 'シナリオ', '感度'],
    content: `## Stage 6 業績シミュレーション

**目的:** 実行計画・OKR が業績（PL 等）にどう効くかを試算する

**ステップ:**
1. **前提入力**: 単価×数量、継続率、原価率、固定費、投資額等を設定
2. **シナリオ作成**: 楽観・基本・悲観の複数シナリオで試算
3. **感度分析**: 各前提が業績にどれだけ影響するかを可視化
4. **比較検証**: 計画前後での業績見通しの変化を把握

**出力:**
業績見通し（売上・営業利益・ROIC 等）、シナリオ比較、感度分析。戦略実行の経営インパクトが数字で見える。`,
  },

  {
    id: 'CHAT_AGENT',
    title: 'AI経営コンサルタント (CEOChat)',
    keywords: ['chat', 'Enter', 'Shift', 'Enter', '診断', '自動', 'チェックイン', '操作'],
    content: `## CEOChat の使い方

**通常送信:**
- 入力欄に質問を入力 → Enter キーで送信
- 戦略的な質問 → advisor モード（示唆・分析）
- 操作Q&A → help モード（手順ガイド）自動判定

**AI 診断（Shift+Enter）:**
- 現在のデータから「課題の指摘」と「推奨アクション」を AI が提示
- 実装/facilitator 分析モード
- 10分で1回、セッション中最大2回

**自動チェックイン:**
- 3分間操作がない → バックグラウンドで自動診断
- ユーザーが明示的にチェックインしなくても定期的に状態をスキャン
- エラー時は黙ってスキップ（UI 落ちない）

**ショートカット:**
- Enter: 通常送信
- Shift+Enter: AI 診断
- Ctrl+D: チャット履歴クリア（実装があれば）`,
  },

  {
    id: 'AUTH_ACCESS',
    title: 'アクセス権限 と RLS',
    keywords: ['role', 'admin', 'manager', 'member', 'companyId', 'strategyId', 'RLS', '権限', 'ログイン'],
    content: `## ロールと権限

**役割:**
- **Admin**: 会社全体の戦略・メンバー管理
- **Manager**: 配下の戦略を編集・閲覧
- **Member**: 割り当てられた戦略を閲覧

**データアクセス:**
- **companyId**: 所属会社を特定（RLS で制御）
- **strategyId**: 特定戦略へのアクセス
- **RLS（Row Level Security）**: DB レベルで権限チェック

**ログイン関連:**
- Supabase Auth を使用
- セッション有効期間: 24 時間
- トークン期限切れ → 再ログイン促告

**問題発生時:**
「権限がありません」エラー → admin に companyId/strategyId のアクセス設定を依頼。`,
  },

  {
    id: 'SAVE_SYNC',
    title: '保存と反映のトラブル対処',
    keywords: ['保存', '反映', '同期', 'sync', 'リロード', '消える', 'タイムアウト', 'エラー'],
    content: `## 保存が反映しない場合

**最初に確認:**
1. 右上に「保存中...」が消えているか（完了まで待つ）
2. ネットワーク接続は正常か
3. ブラウザのコンソール（F12）でエラーは無いか

**対処手順:**
1. ページをリロード（Ctrl+R）
   - キャッシュをクリア（Ctrl+Shift+R）推奨
2. 別タブで同じ strategy を開き、データ確認
3. 数分待ってから再度リロード（サーバー同期の遅延）

**仕様:**
- 保存は非同期（ローカルキャッシュで即座に見え、サーバー反映に若干遅延）
- ローカルストレージとサーバーの同期が必要な場合は「同期」ボタンで明示的に実行

**それでも反映しない:**
エラーログを admin/support に報告。`,
  },

  {
    id: 'COMMON_ERRORS',
    title: 'よくあるエラーと確認手順',
    keywords: ['エラー', 'AuthSession', 'Chunk', 'PGRST', '22P02', 'バグ', 'コンソール', 'ログ'],
    content: `## 代表的なエラーと対処

**AuthSessionMissingError**
- 原因: ログイン状態の喪失
- 対処: ログアウト → ログイン


**ChunkLoadError**
- 原因: 大規模データ読み込み時のメモリ圧迫
- 対処: ページリロード or 別タブで再試行

**PGRST116**
- 原因: JWT トークン期限切れ or パース失敗
- 対処: ページリロード（再認証）

**22P02 (PostgreSQL エラー)**
- 原因: データ型不正（例: 数値フィールドに文字列）
- 対処: データ形式確認 → 修正再送信

**全般的な確認:**
1. ブラウザのコンソール（F12）でエラー内容を確認
2. ネットワークタブ（Network）で API レスポンス確認
3. 必要に応じてエラーメッセージ全文をサポートに報告`,
  },
];

/**
 * ナレッジインデックスを返す（検索用）
 */
export function getKnowledgeIndex(): Array<{
  id: string;
  title: string;
  keywords: string[];
}> {
  return KNOWLEDGE_SECTIONS.map(({ id, title, keywords }) => ({
    id,
    title,
    keywords,
  }));
}

/**
 * 質問テキストに基づいて関連ナレッジを返す
 *
 * @param question - ユーザーの質問テキスト
 * @param maxSections - 返すセクション数上限（デフォルト: 3）
 * @returns 関連度順のナレッジセクション
 */
export function pickRelevantKnowledge(
  question: string,
  maxSections: number = 3
): Array<{ id: string; title: string; content: string }> {
  if (!question || question.trim().length === 0) {
    // 空の質問 → GENERAL_OVERVIEW のみ返す
    const overview = KNOWLEDGE_SECTIONS.find((s) => s.id === 'GENERAL_OVERVIEW');
    return overview
      ? [{ id: overview.id, title: overview.title, content: overview.content }]
      : [];
  }

  const questionLower = question.toLowerCase();

  // ★ Sprint 5.3: STAGE番号を正規表現で検出（最優先）
  const stageMatch = questionLower.match(/stage\s*([1-6])|ステージ\s*([1-6])/);
  if (stageMatch) {
    const stageNum = stageMatch[1] || stageMatch[2];
    const stageMap: Record<string, string> = {
      '1': 'STAGE1_INPUT',
      '2': 'STAGE2_FLOW',
      '3': 'STAGE3_CASCADE',
      '4': 'STAGE4_EXEC_PLAN',
      '5': 'STAGE5_EXEC_SUPPORT',
      '6': 'STAGE6_PERFORMANCE_SIM',
    };
    const stageSectionId = stageMap[stageNum];
    if (stageSectionId) {
      const stageSection = KNOWLEDGE_SECTIONS.find((s) => s.id === stageSectionId);
      const result: Array<{ id: string; title: string; content: string }> = [];
      if (stageSection) {
        result.push({ id: stageSection.id, title: stageSection.title, content: stageSection.content });
      }
      // 残り枠を keyword スコアで埋める
      const scored = KNOWLEDGE_SECTIONS.map((section) => {
        const hitCount = section.keywords.filter((kw) =>
          questionLower.includes(kw.toLowerCase())
        ).length;
        return { ...section, score: hitCount };
      })
        .filter((s) => s.id !== stageSectionId)
        .sort((a, b) => b.score - a.score);
      result.push(
        ...scored
          .slice(0, maxSections - 1)
          .map((s) => ({ id: s.id, title: s.title, content: s.content }))
      );
      return result;
    }
  }

  // 各セクションのスコア計算
  const scored = KNOWLEDGE_SECTIONS.map((section) => {
    const hitCount = section.keywords.filter((kw) =>
      questionLower.includes(kw.toLowerCase())
    ).length;
    return { ...section, score: hitCount };
  });

  // スコアでソート（高い順）
  const sorted = scored.sort((a, b) => b.score - a.score);

  // スコア 0 なら GENERAL_OVERVIEW を返す
  if (sorted[0].score === 0) {
    const overview = sorted.find((s) => s.id === 'GENERAL_OVERVIEW');
    return overview
      ? [{ id: overview.id, title: overview.title, content: overview.content }]
      : [];
  }

  // スコアがある上位 maxSections を返す
  return sorted
    .slice(0, maxSections)
    .map((s) => ({ id: s.id, title: s.title, content: s.content }));
}
