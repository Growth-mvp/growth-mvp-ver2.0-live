/* STAGE4 実行計画要約の規模別・架空フィクスチャ（実在しない企業・部門・施策）。
 * KR の単位はラベルごとに固定し、数値KRに一律の単位を付けないようにする。 */

type KrSpec = { label: string; unit: string };
type Theme = { title: string; krs: [KrSpec, KrSpec, KrSpec] };

const THEMES: Theme[] = [
  { title: '新規顧客開拓', krs: [{ label: '新規商談数', unit: '件' }, { label: '新規受注率', unit: '%' }, { label: '初回提案までの日数', unit: '日' }] },
  { title: '既存顧客の保守契約更新', krs: [{ label: '保守契約の継続率', unit: '%' }, { label: '契約更新件数', unit: '件' }, { label: '更新手続きの所要日数', unit: '日' }] },
  { title: '点検工程の標準化', krs: [{ label: '点検報告の当日提出率', unit: '%' }, { label: '標準手順の適用率', unit: '%' }, { label: '点検報告の再作業件数', unit: '件' }] },
  { title: '見積もり回答の短縮', krs: [{ label: '回答所要日数', unit: '日' }, { label: '見積もり件数', unit: '件' }, { label: '見積もりの受注率', unit: '%' }] },
  { title: '部品在庫の適正化', krs: [{ label: '欠品件数', unit: '件' }, { label: '在庫回転率', unit: '回' }, { label: '在庫の差異率', unit: '%' }] },
  { title: '不良率の低減', krs: [{ label: '不良率', unit: '%' }, { label: '再作業件数', unit: '件' }, { label: '出荷前検査の合格率', unit: '%' }] },
  { title: '設備稼働率の向上', krs: [{ label: '稼働率', unit: '%' }, { label: '計画外停止時間', unit: '時間' }, { label: '故障件数', unit: '件' }] },
  { title: '新製品の試作評価', krs: [{ label: '試作評価の完了件数', unit: '件' }, { label: '評価指摘件数', unit: '件' }, { label: '評価完了までの日数', unit: '日' }] },
  { title: '海外代理店の開拓', krs: [{ label: '代理店契約数', unit: '件' }, { label: '問い合わせ件数', unit: '件' }, { label: '契約までの日数', unit: '日' }] },
  { title: '社内データの一元化', krs: [{ label: 'データ登録の網羅率', unit: '%' }, { label: '重複登録件数', unit: '件' }, { label: 'データ検索の所要時間', unit: '分' }] },
  { title: '人材の計画的育成', krs: [{ label: '育成計画の作成率', unit: '%' }, { label: '資格取得者数', unit: '人' }, { label: '研修の実施回数', unit: '回' }] },
  { title: '購買先の再評価', krs: [{ label: '再評価の完了率', unit: '%' }, { label: 'コスト削減額', unit: '万円' }, { label: '納期遵守率', unit: '%' }] },
  { title: '物流コストの見直し', krs: [{ label: '物流コスト率', unit: '%' }, { label: '配送回数', unit: '回' }, { label: '配送の遅延件数', unit: '件' }] },
  { title: '月次原価の可視化', krs: [{ label: '原価の確定日数', unit: '日' }, { label: '原価差異の説明率', unit: '%' }, { label: '原価の修正件数', unit: '件' }] },
  { title: '保守人材の確保', krs: [{ label: '採用充足率', unit: '%' }, { label: '定着率', unit: '%' }, { label: '採用の応募件数', unit: '件' }] },
];

const BASE_NAMES = ['営業部', '製造部', '品質保証部', '技術開発部', '経営企画部', '人事部', '購買部', '物流部', '情報システム部', '海外事業部'];

export function fixtureDeptName(i: number): string {
  return BASE_NAMES[i % 10] + (i >= 10 ? `第${Math.floor(i / 10) + 1}課` : '');
}

function targetFor(unit: string, seed: number): number {
  const base: Record<string, number> = { '%': 60, '件': 10, '日': 3, '時間': 10, '回': 4, '人': 2, '万円': 100, '分': 5 };
  const span: Record<string, number> = { '%': 30, '件': 100, '日': 25, '時間': 90, '回': 20, '人': 18, '万円': 900, '分': 55 };
  return base[unit] + (seed % 5) * (span[unit] / 5);
}

export function makeFixtureDepts(nDept: number, nProj: number, nKr: number) {
  return Array.from({ length: nDept }, (_, i) => ({
    id: `dept-${i}`,
    name: fixtureDeptName(i),
    mission: `${fixtureDeptName(i)}の役割として、担当範囲の成果を積み上げる`,
    projects: Array.from({ length: nProj }, (_, j) => {
      const theme = THEMES[(i * 3 + j) % THEMES.length];
      return {
        id: `proj-${i}-${j}`,
        title: `${theme.title}（${i + 1}-${j + 1}）`,
        ownerName: `担当者${String.fromCharCode(65 + ((i + j) % 26))}`,
        planStatus: ['approved', 'review', 'draft'][(i + j) % 3],
        valueDriverLinks: ['売上成長'],
        okrsV2: Array.from({ length: nKr }, (_, k) => {
          const spec = theme.krs[k % 3];
          const suffix = k >= 3 ? `（補助${k}）` : '';
          return {
            label: `${spec.label}${suffix}`,
            target: targetFor(spec.unit, i + j + k),
            unit: spec.unit,
            owner: `担当者${String.fromCharCode(65 + ((i + j + k) % 26))}`,
            due: `2027-${String(((j + k) % 12) + 1).padStart(2, '0')}`,
          };
        }),
      };
    }),
  }));
}

/** 規模別の評価ケース（前回の比較と同じ部門数・施策数・KR数） */
export const STAGE4_SCALE_FIXTURES = {
  '3部門・15施策': () => makeFixtureDepts(3, 5, 2),
  '10部門・80施策': () => makeFixtureDepts(10, 8, 3),
  '40部門・600施策': () => makeFixtureDepts(40, 15, 4),
} as const;
