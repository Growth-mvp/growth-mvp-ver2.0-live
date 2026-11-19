import {
  EDINET_DOCUMENTS_URL,
  EdinetHttpError,
  downloadEdinetCsvZip,
  findDocumentsForTicker,
  listEdinetDocumentsForDate,
  listEdinetDocumentsForRange,
  parseEdinetDocuments,
  validateRange,
} from './edinetDocuments';
import type { EdinetDocument } from './companyCandidates';

function jsonFetch(body: unknown, status = 200) {
  return jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as jest.Mock & typeof fetch;
}

const ROW = (over: Record<string, unknown>) => ({
  docID: 'S1',
  secCode: '59050',
  edinetCode: 'E1',
  filerName: '日本製罐株式会社',
  docTypeCode: '120',
  docDescription: '有価証券報告書',
  periodEnd: '2026-03-31',
  submitDateTime: '2026-06-20 15:00',
  withdrawalStatus: '0',
  ...over,
});

describe('EDINETの提出書類一覧の読み取り', () => {
  it('日付と鍵で1回だけ読む（再試行しない）', async () => {
    const f = jsonFetch({ results: [ROW({})] });
    const docs = await listEdinetDocumentsForDate('2026-06-20', 'KEY', f);
    expect(docs).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
    const url = String((f as unknown as jest.Mock).mock.calls[0][0]);
    expect(url.startsWith(EDINET_DOCUMENTS_URL)).toBe(true);
    expect(url).toContain('date=2026-06-20');
    expect(url).toContain('type=2');
  });

  it('429などのエラーは、そのまま投げる（過剰な再試行をしない）', async () => {
    const f = jsonFetch({}, 429);
    await expect(listEdinetDocumentsForDate('2026-06-20', 'KEY', f)).rejects.toBeInstanceOf(EdinetHttpError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('項目が欠けた行は捨て、書類ID（docID）のある行だけを読む', () => {
    const docs = parseEdinetDocuments({ results: [ROW({}), ROW({ docID: '' }), 'x', null] });
    expect(docs.map((d) => d.docId)).toEqual(['S1']);
    expect(parseEdinetDocuments({})).toEqual([]);
  });

  it('期間は31日以内・日付の形式が正しいものだけ', () => {
    expect(validateRange('2026-06-01', '2026-06-30')).toBeNull();
    expect(validateRange('2026-06-01', '2026-07-05')).toContain('31日以内');
    expect(validateRange('2026-06-10', '2026-06-01')).toContain('開始日');
    expect(validateRange('2026/06/01', '2026-06-02')).toContain('YYYY-MM-DD');
  });

  it('期間の読み取りは1日ずつ行い、途中でエラーになったら止める', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [ROW({ docID: 'A' })] }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }) as unknown as jest.Mock & typeof fetch;
    await expect(listEdinetDocumentsForRange('2026-06-01', '2026-06-03', 'KEY', f)).rejects.toBeInstanceOf(EdinetHttpError);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('証券コードでの書類の選び方', () => {
  const doc = (over: Partial<EdinetDocument>): EdinetDocument => ({
    docId: 'D',
    secCode: '59050',
    edinetCode: 'E1',
    filerName: '日本製罐株式会社',
    docTypeCode: '120',
    docDescription: null,
    periodStart: null,
    periodEnd: '2026-03-31',
    submitDate: null,
    withdrawn: false,
    ...over,
  });

  it('有価証券報告書を優先し、取下げの書類は除く', () => {
    const docs = [
      doc({ docId: 'Q', docTypeCode: '140', periodEnd: '2026-06-30' }),
      doc({ docId: 'OLD', periodEnd: '2025-03-31' }),
      doc({ docId: 'NEW', periodEnd: '2026-03-31' }),
      doc({ docId: 'WD', withdrawn: true }),
      doc({ docId: 'OTHER', secCode: '13000' }),
    ];
    expect(findDocumentsForTicker(docs, '5905').map((d) => d.docId)).toEqual(['NEW', 'OLD', 'Q']);
  });
});

describe('書類の取得（書類ID の形式）', () => {
  it('EDINETの書類ID（S＋7文字）は受け付け、それ以外は問い合わせずに拒否する', async () => {
    const f = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }));
    await downloadEdinetCsvZip('S100YK2J', 'k', f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    await expect(downloadEdinetCsvZip('100YK2J', 'k', f as unknown as typeof fetch)).rejects.toThrow('invalid_doc_id');
    await expect(downloadEdinetCsvZip('S100YK2J/../x', 'k', f as unknown as typeof fetch)).rejects.toThrow('invalid_doc_id');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
