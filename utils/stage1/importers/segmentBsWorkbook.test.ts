/* 事業部別の貸借対照表（事業名×年度の縦持ちの表）を、実ファイル形式で読み、事業部別BSの候補にする。 */
jest.mock('server-only', () => ({}));

import * as XLSX from 'xlsx';
import { buildCandidatesFromTable, normalizeCandidates } from './candidateBuilder';
import { parseExcel } from './excelCsvImporter';
import { extractProfileFromTable, mergeProfiles, type DocumentProfile } from './profileExtract';
import { buildDocumentCandidate } from '@/lib/autofill/publicCandidate';

const SHEET: unknown[][] = [
  ['1. 事業別貸借対照表（BS）　単位：千円'],
  ['事業名', '年度', '売掛金', '棚卸資産', '買掛金', '固定資産', '有利子負債'],
  ['新聞販売・配達事業', 2026, 1200, 300, 800, 5000, 0],
  ['宅配事業', 2026, 400, 0, 200, 900, 1500],
];

function workbook(aoa: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '企業資料');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array);
}

describe('事業部別の貸借対照表を、事業部別BSの候補にする', () => {
  it('事業名ごとに、売掛金・棚卸資産・買掛金・固定資産・有利子負債を円で読む（0も保持）', () => {
    const tables = parseExcel(workbook(SHEET));
    const candidates = tables.flatMap((t) => buildCandidatesFromTable(t));
    const profiles: DocumentProfile[] = tables.map((t) => extractProfileFromTable(t, 'x.xlsx'));
    const r = buildDocumentCandidate({ candidates: normalizeCandidates(candidates), profiles: [mergeProfiles(profiles)], fetchedAt: '2026-11-26T00:00:00.000Z' });
    if (r.status !== 'FOUND') throw new Error('expected FOUND');

    expect(r.candidate.segmentBS).toEqual([
      { name: '新聞販売・配達事業', byYear: [{ year: 2026, ar: 1_200_000, inventory: 300_000, ap: 800_000, fixedAssets: 5_000_000, interestBearingDebt: 0 }] },
      { name: '宅配事業', byYear: [{ year: 2026, ar: 400_000, inventory: 0, ap: 200_000, fixedAssets: 900_000, interestBearingDebt: 1_500_000 }] },
    ]);
    expect(r.candidate.segments).toBeNull();
    expect(r.candidate.issues.some((m) => m.includes('単位を換算して円で取り込みました'))).toBe(true);
  });
});
