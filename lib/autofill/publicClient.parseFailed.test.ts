import { runDocumentFinance } from './publicClient';

const file = new File(['%PDF-1.4'], 'sample.pdf', { type: 'application/pdf' });

describe('資料の解析が異常終了したときは、取り込める内容なしと区別する', () => {
  it('解析が失敗した（success:false / parse_failed）時は、0件として扱わず例外にする', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ success: false, error: 'parse_failed', failedFiles: ['sample.pdf'], candidates: [] }),
    })) as unknown as typeof fetch;

    await expect(runDocumentFinance({ files: [file], token: 't', fetchImpl })).rejects.toThrow('parse_failed');
  });

  it('解析が正常に終わり候補が0件の時は、従来どおり「取り込める内容がない」の結果にする', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, candidates: [], documentProfiles: [] }),
    })) as unknown as typeof fetch;

    const r = await runDocumentFinance({ files: [file], token: 't', fetchImpl });
    expect(r.status).toBe('NOT_CONFIRMED');
    if (r.status === 'NOT_CONFIRMED') expect(r.message).toContain('資料から取り込める内容がありませんでした');
  });
});
