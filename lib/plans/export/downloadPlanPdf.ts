import { saveBlob } from '@/lib/plans/export/download';
import { buildPlanPdfDefinition, PDF_FONTS, PDF_FONT_FILES } from '@/lib/plans/export/toPdf';
import type { PlanExportDocument } from '@/lib/plans/export/planExportDocument';

let fontFiles: Promise<Record<string, string>> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function loadFontFiles(): Promise<Record<string, string>> {
  if (!fontFiles) {
    fontFiles = Promise.all(
      Object.values(PDF_FONT_FILES).map(async (name) => {
        const response = await fetch(`/fonts/${name}`);
        if (!response.ok) throw new Error(`font load failed: ${name}`);
        return [name, toBase64(await response.arrayBuffer())] as const;
      })
    )
      .then((entries) => Object.fromEntries(entries))
      .catch((error: unknown) => {
        fontFiles = null;
        throw error;
      });
  }
  return fontFiles;
}

export async function downloadPlanPdf(doc: PlanExportDocument, fileName: string): Promise<void> {
  const [{ default: pdfMake }, vfs] = await Promise.all([
    import('pdfmake/build/pdfmake.js'),
    loadFontFiles(),
  ]);
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.addFonts(PDF_FONTS);
  const blob = await pdfMake.createPdf(buildPlanPdfDefinition(doc)).getBlob();
  saveBlob(blob, fileName);
}
