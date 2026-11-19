/* 試験用：入口（identify・report）の応答を、実データ（日本製罐の抽出結果）から作る。 */
import fs from 'node:fs';
import path from 'node:path';
import { parseEdinetCsv } from '../edinetZip';
import { extractFacts } from '../xbrlFacts';
import { extractSegments } from '../segments';

const FIX = path.join(__dirname);

export const NISSHIN_FILER = {
  name: '日本製罐株式会社',
  secCode: '5905',
  edinetCode: 'E01408',
  listed: true,
  industryName: '金属製品',
  address: 'さいたま市北区吉野町２丁目２７５番地',
  consolidated: true,
  corporateNumber: '4030001006527',
  fiscalYearEndMonth: 3,
  fiscalYearEndDay: 31,
};

export function nisshinReport() {
  const rows = parseEdinetCsv(fs.readFileSync(path.join(FIX, 'nisshin-s100yk2j-main-subset.tsv'), 'utf8'));
  const facts = extractFacts(rows);
  return {
    docId: 'S100YK2J',
    docTypeCode: '120',
    periodEnd: '2026-03-31',
    submitDate: '2026-06-25 11:11',
    amendedFromDocId: null,
    facts,
    segments: extractSegments(rows, facts.periodEnd),
  };
}

export function identifyFound(periods: string[] = ['2026-03-31']) {
  return { status: 'FOUND', filer: NISSHIN_FILER, periods };
}

export function reportFound() {
  return { status: 'FOUND', periodEnd: '2026-03-31', scannedDays: 3, report: nisshinReport() };
}

export function jsonRes(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
