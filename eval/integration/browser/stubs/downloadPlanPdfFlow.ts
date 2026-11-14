/* 検証用：PDFは作らず、渡された文書を記録する（評価専用）。内容は実装の文書モデルそのもの。 */
const w: any = typeof window !== 'undefined' ? window : globalThis;
w.__pdfDocs = w.__pdfDocs || [];

export async function downloadPlanPdf(doc: unknown, fileName: string): Promise<void> {
  w.__pdfDocs.push({ doc, fileName });
}
