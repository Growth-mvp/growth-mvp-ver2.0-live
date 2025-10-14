// /app/api/okr-from-exec/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { execPatterns } from '@/lib/strategyPatterns.exec';
import { EXEC_IDS, type ExecPatternId } from '@/lib/strategyPatterns.map';

/** ===== 入力 ===== */
type OKRInput = {
  execIds?: string[]; // e1..e10
  context?: {
    departmentName?: string;
    industry?: string;
    mission?: string;
  };
};

/** ===== 出力 ===== */
type OKR = { objective: string; keyResults: string[]; owner?: string };
type OKRItem = { id: ExecPatternId; title: string; okr: OKR };
type OKRResponse = { items: OKRItem[] };

/** ====== ユーティリティ ====== */
const titleDict: Record<ExecPatternId, string> = Object.fromEntries(
  execPatterns
    .filter(p => EXEC_IDS.includes(p.id as ExecPatternId))
    .map(p => [p.id as ExecPatternId, p.title || (p.id as string)])
) as Record<ExecPatternId, string>;

const clampStr = (s?: string) => (s ?? '').trim();
const pick = <T,>(arr: T[], n: number) => arr.slice(0, Math.max(0, Math.min(arr.length, n)));
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

/** 文章整形（軽くミッション/部門名を織り込む） */
function ctxLine(ctx?: OKRInput['context']) {
  const dept = clampStr(ctx?.departmentName);
  const miss = clampStr(ctx?.mission);
  if (dept && miss) return `${dept}の文脈（${miss}）`;
  if (dept) return `${dept}の文脈`;
  if (miss) return miss;
  return '';
}

/** ====== e系 → OKR 雛形定義 ======
 * 必要に応じてここを育てる想定。KRは数値化しやすい表現を意識。
 */
function templatesForExec(id: ExecPatternId, ctx?: OKRInput['context']): OKRItem {
  const t = titleDict[id] ?? id;
  const note = ctxLine(ctx);

  switch (id) {
    case 'e1':
      return {
        id, title: '一点突破スケール',
        okr: {
          objective: `特定セグメントで勝率>60%の型を確立し、同一プロファイルへ水平展開する${note ? `（${note}）` : ''}`,
          keyResults: [
            '重点セグメントの成約率を60%→70%に引き上げる',
            '標準プレイブックを策定し、3案件で検証完了',
            '横展開候補セグメントを2つ選定し、初期受注2件以上',
          ],
        },
      };
    case 'e2':
      return {
        id, title: '価格と価値の再設計',
        okr: {
          objective: `価値バンドル/サブスク再設計によりARPUと粗利を改善する${note ? `（${note}）` : ''}`,
          keyResults: [
            '新価格パッケージ3案を作成しA/Bテスト完了',
            'ARPUを現状比+15%に引き上げる',
            '値引き率の中央値を現状比▲30%削減',
          ],
        },
      };
    case 'e3':
      return {
        id, title: '既存深耕・チャーン低減',
        okr: {
          objective: `解約要因Top3への対策でチャーンを抑え、紹介経路を強化する${note ? `（${note}）` : ''}`,
          keyResults: [
            '解約率を今期比▲30%改善',
            'NPSを+10pt改善',
            '紹介率を2倍（%→%）に引き上げる',
          ],
        },
      };
    case 'e4':
      return {
        id, title: 'ファネル摩擦の除去',
        okr: {
          objective: `最重摩擦1箇所を特定し、1スプリントで除去してCVRを改善する${note ? `（${note}）` : ''}`,
          keyResults: [
            '到達率を+20%改善（該当ステップ）',
            '平均リードタイムを▲30%短縮',
            'ドロップ率を▲25%改善',
          ],
        },
      };
    case 'e5':
      return {
        id, title: '週次改善WBRの定着',
        okr: {
          objective: `現場主導の週次改善ループを定着させ、ベロシティを底上げする${note ? `（${note}）` : ''}`,
          keyResults: [
            'WBR出席率90%以上を4週連続達成',
            '週次小改善の実施数を合計12件以上',
            'サイクルタイムを▲20%短縮',
          ],
        },
      };
    case 'e6':
      return {
        id, title: '前倒し価値供給（試供）',
        okr: {
          objective: `導入前に価値を体感できるデモ/試算を提供し、意思決定を加速する${note ? `（${note}）` : ''}`,
          keyResults: [
            'デモ/試算の標準キットを構築し、全商談に適用',
            '商談→成約率を+15%改善',
            '平均稟議期間を▲25%短縮',
          ],
        },
      };
    case 'e7':
      return {
        id, title: '非コア凍結・集中',
        okr: {
          objective: `主要利用シーンを1つに絞り、非コア機能を凍結して満足度を最大化${note ? `（${note}）` : ''}`,
          keyResults: [
            'コア機能DAUを+20%増',
            '非コアの開発工数を0に（四半期）',
            '主要シーンの満足度を+10pt改善',
          ],
        },
      };
    case 'e8':
      return {
        id, title: '直販×間接の役割設計',
        okr: {
          objective: `直販で型を確立し、間接チャネルへ移植。責任分界を明文化${note ? `（${note}）` : ''}`,
          keyResults: [
            'パートナー経由の成約率を25%以上で安定',
            '新規パートナーの立上期間を2ヶ月以内に短縮',
            'チャネル衝突ゼロ（RACI合意済み）',
          ],
        },
      };
    case 'e9':
      return {
        id, title: '原価の物語化（納得価格）',
        okr: {
          objective: `品質/安全/安定の裏側を可視化し、価格の納得感を醸成する${note ? `（${note}）` : ''}`,
          keyResults: [
            '価値の裏側ストーリー資料を3本作成（営業/サイト/提案）',
            '値引き率中央値を▲30%改善',
            '粗利率を+5pt改善',
          ],
        },
      };
    case 'e10':
      return {
        id, title: '勝ち筋の標準化（オンボ90点）',
        okr: {
          objective: `トップの型をSOP/プレイブック化し、新人オンボを加速${note ? `（${note}）` : ''}`,
          keyResults: [
            'オンボ期間を現状比▲40%短縮',
            '初月生産性を+20%向上',
            'SOP更新を月1回以上継続',
          ],
        },
      };
    default:
      return {
        id, title: t,
        okr: {
          objective: `${t} を推進する${note ? `（${note}）` : ''}`,
          keyResults: ['KR1 を定義', 'KR2 を定義', 'KR3 を定義'],
        },
      };
  }
}

/** ====== メイン ====== */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as OKRInput;

    const rawIds = Array.isArray(body?.execIds) ? body.execIds : [];
    const execIds = uniq(
      rawIds
        .map(id => String(id).toLowerCase().trim())
        .filter((id): id is ExecPatternId => EXEC_IDS.includes(id as ExecPatternId))
    );

    if (execIds.length === 0) {
      return NextResponse.json<OKRResponse>({ items: [] }, { status: 200 });
    }

    // 雛形を生成（必要に応じて上位N件などに制限）
    const items = pick(execIds, 6).map((id) => templatesForExec(id, body?.context));

    return NextResponse.json<OKRResponse>({ items }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: 'server_error', detail: e?.message || String(e) }, { status: 500 });
  }
}
