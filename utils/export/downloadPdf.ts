/**
 * /utils/export/downloadPdf.ts
 *
 * 目的：
 * - クライアント側でHTMLをPDFに変換してダウンロード
 * - html2canvas + jsPDF で確実な描画を実現
 * - SSR対応（dynamic import）
 * - 読み取り専用（データ変更なし）
 */

/**
 * HTML要素をPDFとしてダウンロード
 *
 * @param elementId - PDFに変換する要素のID
 * @param fileName - ダウンロードファイル名（.pdfは自動付与）
 * @param options - PDFオプション
 */
export async function downloadPdfFromElement(
  elementId: string,
  fileName: string,
  options?: {
    margin?: number;
    filename?: string;
    image?: { type: string; quality: number };
    html2canvas?: { scale: number };
    jsPDF?: { orientation: string; unit: string; format: string };
  },
): Promise<void> {
  const element = document.getElementById(elementId);

  if (!element) {
    throw new Error(`Element with id "${elementId}" not found`);
  }

  // ★ 診断1: DOM要素の確認
  const innerHtml = element.innerHTML;
  const textContent = element.textContent?.substring(0, 200);
  const rect = element.getBoundingClientRect();
  const scrollWidth = element.scrollWidth;
  const scrollHeight = element.scrollHeight;

  console.log('[downloadPdf] Pre-canvas diagnosis:', {
    elementId,
    htmlLength: innerHtml.length,
    hasContent: innerHtml.length > 100,
    textContent,
    rect: { width: rect.width, height: rect.height, x: rect.x, y: rect.y },
    scroll: { width: scrollWidth, height: scrollHeight },
    styleDisplay: window.getComputedStyle(element).display,
    styleVisibility: window.getComputedStyle(element).visibility,
    styleOpacity: window.getComputedStyle(element).opacity,
    stylePosition: window.getComputedStyle(element).position,
  });

  try {
    // SSR回避のため動的import
    const html2canvas = await import('html2canvas');
    const jsPDF = await import('jspdf');

    const html2canvasFn = html2canvas.default;
    const PDFClass = jsPDF.jsPDF;

    // デフォルトオプション
    const defaultMargin = [10, 10, 10, 10]; // mm
    const defaultJsPdfOptions = {
      orientation: 'p' as const,
      unit: 'mm' as const,
      format: 'a4',
    };

    const margin = options?.margin ?? defaultMargin;
    const jsPdfOpts = { ...defaultJsPdfOptions, ...options?.jsPDF };
    const html2CanvasScale = options?.html2canvas?.scale ?? 2;

    // ★ html2canvas でキャンバス化
    console.log('[downloadPdf] Starting html2canvas conversion...');
    const canvas = await html2canvasFn(element, {
      scale: html2CanvasScale,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: Math.max(element.scrollWidth, 794),
      windowHeight: element.scrollHeight,
      scrollX: 0,
      scrollY: 0,
    });

    // ★ 診断2: Canvas の確認
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const dataUrl = canvas.toDataURL('image/png');
    const isEmptyImage = dataUrl.length < 500; // 基本的なPNG header + 最小限のデータ

    console.log('[downloadPdf] Canvas diagnosis:', {
      canvasWidth,
      canvasHeight,
      dataUrlLength: dataUrl.length,
      isEmptyImage,
      hasPixelData: canvasWidth > 0 && canvasHeight > 0,
    });

    if (isEmptyImage) {
      console.warn('[downloadPdf] WARNING: Canvas appears to be empty image');
    }

    // ★ jsPDF で複数ページPDF化
    const pdf = new PDFClass(jsPdfOpts);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Canvas を PDF サイズに適合
    const imgWidth = pageWidth - (Array.isArray(margin) ? margin[1] + margin[3] : margin * 2);
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let yPosition = Array.isArray(margin) ? margin[0] : margin;
    let remainingHeight = imgHeight;

    // 複数ページに分割
    let pageIndex = 0;
    while (remainingHeight > 0) {
      if (pageIndex > 0) {
        pdf.addPage([pageWidth, pageHeight]);
      }

      const canvasHeightForThisPage = Math.min(
        remainingHeight,
        pageHeight - (Array.isArray(margin) ? margin[0] + margin[2] : margin * 2),
      );

      // Canvas を切り出してPDFに貼り付け（複数ページの場合）
      const sourceY = (canvas.height / imgHeight) * (imgHeight - remainingHeight);
      const sourceHeight =
        (canvasHeightForThisPage / imgHeight) * canvas.height;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = sourceHeight;

      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(
          canvas,
          0,
          sourceY,
          canvas.width,
          sourceHeight,
          0,
          0,
          canvas.width,
          sourceHeight,
        );
      }

      const pageImgData = tempCanvas.toDataURL('image/png');
      const marginLeft = Array.isArray(margin) ? margin[3] : margin;
      pdf.addImage(pageImgData, 'PNG', marginLeft, 10, imgWidth, canvasHeightForThisPage);

      remainingHeight -= canvasHeightForThisPage;
      pageIndex++;

      if (pageIndex > 100) {
        // 無限ループ防止
        console.warn('[downloadPdf] Exceeded 100 pages, stopping');
        break;
      }
    }

    // ★ PDF保存
    console.log('[downloadPdf] Saving PDF as:', `${fileName}.pdf`);
    pdf.save(`${fileName}.pdf`);
    console.log('[downloadPdf] PDF saved successfully');
  } catch (error) {
    console.error('[downloadPdf] Error:', error);
    throw error;
  }
}

/**
 * 日付をYYYYMMDD形式で返す
 */
export function formatDateForFileName(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * STAGE別のPDFファイル名を生成
 */
export function generatePdfFileName(
  stage: 1 | 2 | 3 | 4 | 5 | 6,
  reportType: string,
): string {
  const date = formatDateForFileName();
  const stageLabels: Record<number, string> = {
    1: 'STAGE1',
    2: 'STAGE2',
    3: 'STAGE3',
    4: 'STAGE4',
    5: 'STAGE5',
    6: 'STAGE6',
  };
  return `GROWTH_${stageLabels[stage]}_${reportType}_${date}`;
}
