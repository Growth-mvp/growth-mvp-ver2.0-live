const mockSaveBlob = jest.fn();
const mockBuildDefinition = jest.fn((_doc: unknown) => ({}));
let mockOutput: Blob = new Blob([]);

jest.mock('@/lib/plans/export/download', () => ({ saveBlob: (...args: unknown[]) => mockSaveBlob(...args) }));
jest.mock('@/lib/plans/export/toPdf', () => ({
  buildPlanPdfDefinition: (doc: unknown) => mockBuildDefinition(doc),
  PDF_FONTS: {},
  PDF_FONT_FILES: { regular: 'regular.ttf' },
}));
jest.mock('pdfmake/build/pdfmake.js', () => ({
  __esModule: true,
  default: {
    addVirtualFileSystem: () => {},
    addFonts: () => {},
    createPdf: () => ({ getBlob: async () => mockOutput }),
  },
}));

import { downloadPlanPdf } from './downloadPlanPdf';

const doc = {} as Parameters<typeof downloadPlanPdf>[0];

beforeAll(() => {
  global.fetch = jest.fn(async () => new Response(new Uint8Array([0]), { status: 200 })) as unknown as typeof fetch;
});

beforeEach(() => {
  mockSaveBlob.mockReset();
  mockBuildDefinition.mockClear();
});

test('PDFとして正しいデータは、application/pdfとして保存される', async () => {
  mockOutput = new Blob(['%PDF-1.7\n%%EOF'], { type: 'application/octet-stream' });

  await downloadPlanPdf(doc, 'plan.pdf');

  expect(mockSaveBlob).toHaveBeenCalledTimes(1);
  const [saved, fileName] = mockSaveBlob.mock.calls[0] as [Blob, string];
  expect(fileName).toBe('plan.pdf');
  expect(saved.type).toBe('application/pdf');
  expect(await saved.text()).toBe('%PDF-1.7\n%%EOF');
});

test('PDFの先頭でないデータは保存せず、エラーにする', async () => {
  mockOutput = new Blob(['<html>error</html>']);

  await expect(downloadPlanPdf(doc, 'plan.pdf')).rejects.toThrow('PDFとして作れませんでした');
  expect(mockSaveBlob).not.toHaveBeenCalled();
});

test('空のデータは保存せず、エラーにする', async () => {
  mockOutput = new Blob([]);

  await expect(downloadPlanPdf(doc, 'plan.pdf')).rejects.toThrow('PDFとして作れませんでした');
  expect(mockSaveBlob).not.toHaveBeenCalled();
});
