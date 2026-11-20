/* /api/stage1/import が検証用PDF（test-files/ph52b2-company-statement.pdf）に対して返した応答（開発サーバーでの実測値）。 */
const PDF = 'ph52b2-company-statement.pdf';
const CONFIDENCE = 0.5;

const companyPL = [
  { year: 2022, fields: { revenue: 1000, operatingIncome: 200, netIncome: 130 } },
  { year: 2023, fields: { revenue: 1200, operatingIncome: 240, netIncome: 160 } },
  { year: 2024, fields: { revenue: 1400, operatingIncome: 280, netIncome: 190 } },
].map((c) => ({ kind: 'companyPL', ...c, confidence: CONFIDENCE, sourceRef: 'PDF:P2', sheetUnit: '百万円', fieldUnits: {}, source: PDF }));

const companyBS = [
  { year: 2022, fields: { totalAssets: 2150, netAssets: 1350 } },
  { year: 2023, fields: { totalAssets: 2380, netAssets: 1580 } },
  { year: 2024, fields: { totalAssets: 2640, netAssets: 1840 } },
].map((c) => ({ kind: 'companyBS', ...c, confidence: CONFIDENCE, sourceRef: 'PDF:P3', sheetUnit: '百万円', fieldUnits: {}, source: PDF }));

const segmentPL = [
  { segmentName: '事業部A', page: 'PDF:P4', year: 2022, fields: { revenue: 500, operatingIncome: 100 } },
  { segmentName: '事業部A', page: 'PDF:P4', year: 2023, fields: { revenue: 600, operatingIncome: 120 } },
  { segmentName: '事業部A', page: 'PDF:P4', year: 2024, fields: { revenue: 700, operatingIncome: 140 } },
  { segmentName: '事業部B', page: 'PDF:P5', year: 2022, fields: { revenue: 500, operatingIncome: 100 } },
  { segmentName: '事業部B', page: 'PDF:P5', year: 2023, fields: { revenue: 600, operatingIncome: 120 } },
  { segmentName: '事業部B', page: 'PDF:P5', year: 2024, fields: { revenue: 700, operatingIncome: 140 } },
].map(({ page, ...c }) => ({ kind: 'segmentPL', ...c, confidence: CONFIDENCE, sourceRef: page, sheetUnit: '百万円', fieldUnits: {}, source: PDF }));

export const PDF_IMPORT_RESPONSE = {
  success: true,
  documentProfiles: [
    {
      fileName: PDF,
      profile: {
        companyName: { value: '株式会社サンプル製作所', where: `${PDF}（1ページ）` },
        location: { value: '東京都千代田区1-1-1', where: `${PDF}（1ページ）` },
        employees: { value: 120, where: `${PDF}（1ページ）` },
        businessContent: { value: '産業用機械の設計・製造', where: `${PDF}（1ページ）` },
      },
    },
  ],
  candidates: [...companyPL, ...companyBS, ...segmentPL],
  tableHints: [`${PDF}: PDF（5/5ページ解析）`],
};
