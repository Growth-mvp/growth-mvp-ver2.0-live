// /lib/winPatterns.ts
import type { WinPattern, WinPatternId } from '@/types/strategy';

/**
 * 勝ち筋マスタ定義
 *
 * - SHORT_REVENUE       : 短期で売上を伸ばす
 * - FUTURE_INVEST       : 未来への投資・新規事業
 * - INDIRECT_PEOPLE     : 人材・組織力を高める
 * - INDIRECT_PROCESS    : プロセス・生産性を高める
 * - COST_FOCUS          : コスト削減・効率化
 * - QUALITY_STABILITY   : 品質・安定運行
 * - HR_DEVELOPMENT      : 人材育成・エンゲージメント
 * - OPERATION_EFFICIENCY: 業務プロセス効率化
 */
const WIN_PATTERN_MASTER: Record<WinPatternId, WinPattern> = {
  SHORT_REVENUE: {
    id: 'SHORT_REVENUE',
    label: '短期で売上を伸ばす',
    description:
      '既存事業・既存顧客を起点に、3〜12ヶ月で売上・利益を底上げするための勝ち筋です。単価向上・既存深耕・CVR改善・チャネル強化などを軸に設計します。',
    timeHorizon: 'short',
    focus: 'revenue',
    directness: 'direct',
    tags: ['営業', 'マーケティング', '既存顧客', '短期インパクト'],
  },
  FUTURE_INVEST: {
    id: 'FUTURE_INVEST',
    label: '未来への投資・新規事業',
    description:
      '3〜5年後の成長エンジンをつくるための新規事業・新サービス・ビジネスモデル転換に投資する勝ち筋です。短期の利益よりも、将来のポジションと学習を優先します。',
    timeHorizon: 'long',
    focus: 'product',
    directness: 'direct',
    tags: ['新規事業', 'R&D', '事業開発', '将来成長'],
  },
  INDIRECT_PEOPLE: {
    id: 'INDIRECT_PEOPLE',
    label: '人材・組織力を高める',
    description:
      '採用・育成・配置・評価・カルチャーを通じて、社員の主体性とパフォーマンスを高める勝ち筋です。人材定着・オンボーディング・リーダーシップ開発などが軸になります。',
    timeHorizon: 'mid',
    focus: 'people',
    directness: 'indirect',
    tags: ['人事', '組織開発', 'オンボーディング', 'エンゲージメント'],
  },
  INDIRECT_PROCESS: {
    id: 'INDIRECT_PROCESS',
    label: 'プロセス・生産性を高める',
    description:
      '業務プロセス・情報の流れ・システム連携を見直し、全社の生産性を底上げする勝ち筋です。属人化の解消・標準化・ミス削減・リードタイム短縮などが狙いです。',
    timeHorizon: 'mid',
    focus: 'process',
    directness: 'indirect',
    tags: ['総務', '生産管理', 'バックオフィス', '標準化'],
  },
  COST_FOCUS: {
    id: 'COST_FOCUS',
    label: 'コスト削減・効率化',
    description:
      '固定費・変動費・間接コストを構造的に見直し、資本効率を高める勝ち筋です。単なるコストカットではなく、「やらないこと」を決めて集中と選択を進めます。',
    timeHorizon: 'short',
    focus: 'cost',
    directness: 'direct',
    tags: ['経理・財務', '経営企画', '選択と集中'],
  },
  QUALITY_STABILITY: {
    id: 'QUALITY_STABILITY',
    label: '品質・安定運行を高める',
    description:
      '品質・安全・安定供給を強みにし、信頼とリピートを高める勝ち筋です。クレーム削減・欠品ゼロ・事故ゼロなど、信用を積み上げることに重きを置きます。',
    timeHorizon: 'mid',
    focus: 'process',
    directness: 'indirect',
    tags: ['生産', '物流', 'オペレーション', '品質保証'],
  },
  HR_DEVELOPMENT: {
    id: 'HR_DEVELOPMENT',
    label: '人材育成・エンゲージメント',
    description:
      '管理職・次世代リーダー・専門人材の育成を通じて、中長期の競争力を高める勝ち筋です。キャリアパス・評価制度・学習機会の設計などが含まれます。',
    timeHorizon: 'long',
    focus: 'people',
    directness: 'indirect',
    tags: ['人事', '教育', 'リーダー育成'],
  },
  OPERATION_EFFICIENCY: {
    id: 'OPERATION_EFFICIENCY',
    label: '業務プロセス効率化',
    description:
      '現場のムダ・ムリ・ムラを減らし、同じリソースでより多くの価値を生み出す勝ち筋です。DX・自動化・業務棚卸し・権限委譲などを組み合わせます。',
    timeHorizon: 'short',
    focus: 'process',
    directness: 'indirect',
    tags: ['DX', '業務改革', '生産性向上'],
  },
};

/** 全勝ち筋の配列（UI一覧表示など用） */
export const ALL_WIN_PATTERNS: WinPattern[] = Object.values(
  WIN_PATTERN_MASTER,
);

/** ID配列から WinPattern 配列へ（重複除去） */
export function buildWinPatternsFromIds(ids: WinPatternId[]): WinPattern[] {
  const out: WinPattern[] = [];
  const seen = new Set<WinPatternId>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const p = WIN_PATTERN_MASTER[id];
    if (p) {
      out.push(p);
      seen.add(id);
    }
  }
  return out;
}
