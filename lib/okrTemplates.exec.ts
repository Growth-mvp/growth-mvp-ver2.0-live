// /lib/okrTemplates.exec.ts
import type { ExecPatternId } from '@/lib/strategyPatterns.map';
import type { OKR as DeptOKR } from '@/types/strategy';

export type OKRCtx = {
  departmentName?: string;
  industry?: string;
  mission?: string;
};

/** OKRテンプレートの型 */
type OKRTemplate = {
  /** プロジェクト名（カードの見出し） */
  projectTitle: (ctx: OKRCtx) => string;
  /** Objective 文 */
  objective: (ctx: OKRCtx) => string;
  /** KR 群 */
  keyResults: (ctx: OKRCtx) => string[];
};

const jp = (s: string) => s.replace(/\s+/g, ' ').trim();

/** e1〜e10 の OKRテンプレ集 */
export const OKR_TEMPLATES: Record<ExecPatternId, OKRTemplate> = {
  e1: {
    projectTitle: (c) => `${c.departmentName ?? '部門'}：一点突破→水平展開`,
    objective: (c) =>
      jp(`優先セグメントで勝率>60%の型を確立し、同一特徴群へ水平展開する`),
    keyResults: () => [
      '優先セグメントの成約率 60%以上',
      '初回リードタイム 30%短縮',
      '標準プレイブック版数 v1.0 を公開',
    ],
  },
  e2: {
    projectTitle: () => '単価×価値の再定義（パッケージ/サブスク）',
    objective: () => jp(`価値バンドルの再設計によりARPUと粗利率を同時に改善する`),
    keyResults: () => [
      '新価格パッケージ A/B 3案のCVR比較を完了',
      'ARPU +15%以上 / 粗利率 +8pt',
      '値引き率 中央値 30%→15%へ',
    ],
  },
  e3: {
    projectTitle: () => '既存深耕と紹介創出',
    objective: () => jp(`解約ドライバーの先回り改善でLTVを最大化し紹介フローを定着させる`),
    keyResults: () => [
      '解約率 月次 -30%',
      'NPS +10pt',
      '紹介経由の新規比率 20%以上',
    ],
  },
  e4: {
    projectTitle: () => 'フリクション撲滅ファネル',
    objective: () => jp(`最重フリクションを特定し1スプリントで除去してCVRを高める`),
    keyResults: () => [
      '最重フリクション 1件の到達率 +20pt',
      '商談〜成約の所要日数 -30%',
      'ドロップ率 -25%',
    ],
  },
  e5: {
    projectTitle: () => '現場主導の週次改善（WBR）',
    objective: () => jp(`小さな改善を週次で積み上げ、ベロシティと定着を高める`),
    keyResults: () => [
      '週次改善 8件/四半期',
      '平均サイクルタイム -25%',
      '改善ログ定着率 90%以上',
    ],
  },
  e6: {
    projectTitle: () => '試供体験（デモ/試算）で前倒し価値提供',
    objective: () => jp(`導入前に成果の片鱗を提示し意思決定を前倒しする`),
    keyResults: () => [
      'PoC/デモ経由の成約率 +20pt',
      '営業リードタイム -30%',
      '評価指標/合意済みの検証計画を標準化',
    ],
  },
  e7: {
    projectTitle: () => 'やらないこと宣言とコア集中',
    objective: () => jp(`非コア機能を凍結し主要利用シーンに資源集中する`),
    keyResults: () => [
      '凍結対象の合意と実施（機能/施策 5件）',
      'コア機能のDAU +20%',
      'ロードマップから非コアの比率 0%へ',
    ],
  },
  e8: {
    projectTitle: () => 'チャネル二刀流（直販×間接）の役割分担',
    objective: () => jp(`直販で型を確立し間接へ移植、チャネル競合を最小化する`),
    keyResults: () => [
      'パートナー成約率 直販比 80%以上',
      '新規パートナーの立ち上がり 60日以内',
      '役割分担SLAの策定と遵守率 95%',
    ],
  },
  e9: {
    projectTitle: () => '原価の物語化（納得価格）',
    objective: () => jp(`品質/安全/安定の裏側を可視化し価格の納得感を高める`),
    keyResults: () => [
      '値引き要求率 -30%',
      '粗利率 +5pt',
      'ストーリーデッキ/動画 完成＆商談カバレッジ 80%',
    ],
  },
  e10: {
    projectTitle: () => '勝ち筋の標準化（オンボ90点）',
    objective: () => jp(`トップの型をSOP化し新人の立ち上がりを加速する`),
    keyResults: () => [
      '新人オンボ期間 -30%',
      '初月生産性 +20%',
      'SOP/プレイブック v1.0 リリース & 更新ポリシー運用',
    ],
  },
};

/** 実行：テンプレを文脈で解決してOKR化 */
export function buildOKRFromExec(
  execIds: ExecPatternId[],
  ctx: OKRCtx = {},
): { id: ExecPatternId; title: string; okr: DeptOKR }[] {
  const out: { id: ExecPatternId; title: string; okr: DeptOKR }[] = [];
  const seen = new Set<string>();
  for (const id of execIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const t = OKR_TEMPLATES[id];
    if (!t) continue;
    out.push({
      id,
      title: t.projectTitle(ctx),
      okr: {
        objective: t.objective(ctx),
        keyResults: t.keyResults(ctx),
        owner: ctx.departmentName,
      },
    });
  }
  return out;
}
