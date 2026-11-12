/**
 * /utils/export/downloadPdf.ts
 *
 * 目的：
 * - クライアント側でHTMLをPDFに変換してダウンロード
 * - html2canvas + jsPDF で確実な描画を実現
 * - SSR対応（dynamic import）
 * - 読み取り専用（データ変更なし）
 */

type BreakBlock = { top: number; bottom: number; keepWithNext: boolean };

/** html2canvas が描画するクローン上で、要素の位置（CSS px）を測る */
function measureBreakBlocks(cloneEl: HTMLElement, selector: string): { width: number; blocks: BreakBlock[] } {
  const rect = cloneEl.getBoundingClientRect();
  const blocks = Array.from(cloneEl.querySelectorAll<HTMLElement>(selector)).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top - rect.top,
      bottom: r.bottom - rect.top,
      keepWithNext: /^H[1-6]$/.test(el.tagName),
    };
  });
  return { width: rect.width, blocks };
}

/** 日本語の文字は、PDFの標準フォントでは描けないため、ブラウザの日本語フォントで描いた画像にする */
function footerLabelImage(label: string): { dataUrl: string; ratio: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '28px "Yu Gothic", "Hiragino Sans", "Meiryo", "Noto Sans JP", sans-serif';
  if (!ctx) return { dataUrl: '', ratio: 1 };
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(label).width) + 8;
  canvas.height = 40;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = font;
  ctx.fillStyle = '#5a5a5a';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 4, canvas.height / 2);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), ratio: canvas.width / canvas.height };
}

/** 行・段落の途中を避け、ページ末尾に収まる最も後ろの境界で切る。収まらない場合は強制的に切る */
function chooseCutPx(startPx: number, endPx: number, blocks: BreakBlock[]): number {
  const minPageGapPx = 40;
  const sorted = [...blocks].sort((a, b) => a.top - b.top);
  const forbidden: Array<[number, number]> = [];
  for (const h of sorted) {
    if (!h.keepWithNext) continue;
    const next = sorted.find((x) => x.top > h.top + 0.5);
    if (next) forbidden.push([h.top, next.top]);
  }
  const candidates: number[] = [];
  for (const b of blocks) {
    if (b.top > startPx + minPageGapPx && b.top <= endPx) candidates.push(b.top);
    if (!b.keepWithNext && b.bottom > startPx + minPageGapPx && b.bottom <= endPx) candidates.push(b.bottom);
  }
  candidates.sort((a, b) => b - a);
  const cut = candidates.find(
    (c) =>
      !blocks.some((b) => b.top < c && c < b.bottom) &&
      !forbidden.some(([from, to]) => from < c && c <= to),
  );
  return cut ?? endPx;
}

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
    margin?: number | number[];
    filename?: string;
    image?: { type: string; quality: number };
    html2canvas?: { scale: number };
    jsPDF?: { orientation: string; unit: string; format: string };
    /** 指定した要素の境界でだけ改ページする（段落・行の途中で切らない） */
    avoidBreakSelector?: string;
    /** 各ページの下の文字。text は欧文・数字（ページ番号など）、label は日本語の表示（画像で描く） */
    footer?: (pageNo: number, pageCount: number) => { label?: string; text: string };
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
    let cloneMeasure: { width: number; blocks: BreakBlock[] } | null = null;
    const canvas = await html2canvasFn(element, {
      scale: html2CanvasScale,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: Math.max(element.scrollWidth, 794),
      windowHeight: element.scrollHeight,
      scrollX: 0,
      scrollY: 0,
      onclone: (doc: Document) => {
        const cloneEl = doc.getElementById(elementId);
        if (cloneEl && options?.avoidBreakSelector) {
          cloneMeasure = measureBreakBlocks(cloneEl as HTMLElement, options.avoidBreakSelector);
        }
      },
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

    // Canvas を PDF サイズに適合（1mm あたりのキャンバス px）
    const imgWidth = pageWidth - (Array.isArray(margin) ? margin[1] + margin[3] : margin * 2);
    const pxPerMm = canvas.width / imgWidth;
    const pageCapacityPx = (pageHeight - (Array.isArray(margin) ? margin[0] + margin[2] : margin * 2)) * pxPerMm;
    const measured = cloneMeasure as { width: number; blocks: BreakBlock[] } | null;
    const cssToCanvasPx = measured ? canvas.width / measured.width : 1;
    const breakBlocks: BreakBlock[] = (measured?.blocks ?? []).map((b) => ({
      top: b.top * cssToCanvasPx,
      bottom: b.bottom * cssToCanvasPx,
      keepWithNext: b.keepWithNext,
    }));

    // 複数ページに分割（指定があれば段落・行の境界で切る）
    let startPx = 0;
    let pageIndex = 0;
    while (startPx < canvas.height) {
      if (pageIndex > 0) {
        pdf.addPage([pageWidth, pageHeight]);
      }

      const endPx = Math.min(canvas.height, startPx + pageCapacityPx);
      const cutPx = endPx < canvas.height ? chooseCutPx(startPx, endPx, breakBlocks) : endPx;
      const sliceHeightPx = cutPx - startPx;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = sliceHeightPx;

      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(canvas, 0, startPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
      }

      const marginLeft = Array.isArray(margin) ? margin[3] : margin;
      if (options?.image?.type === 'jpeg') {
        const pageImgData = tempCanvas.toDataURL('image/jpeg', options.image.quality);
        pdf.addImage(pageImgData, 'JPEG', marginLeft, 10, imgWidth, sliceHeightPx / pxPerMm);
      } else {
        const pageImgData = tempCanvas.toDataURL('image/png');
        pdf.addImage(pageImgData, 'PNG', marginLeft, 10, imgWidth, sliceHeightPx / pxPerMm);
      }

      startPx = cutPx;
      pageIndex++;

      if (pageIndex > 100) {
        // 無限ループ防止
        console.warn('[downloadPdf] Exceeded 100 pages, stopping');
        break;
      }
    }

    if (options?.footer) {
      const pageCount = pdf.getNumberOfPages();
      const footerMarginLeft = Array.isArray(margin) ? margin[3] : margin;
      for (let p = 1; p <= pageCount; p++) {
        pdf.setPage(p);
        const { label, text } = options.footer(p, pageCount);
        pdf.setFontSize(8);
        pdf.setTextColor(90, 90, 90);
        pdf.text(text, pageWidth / 2, pageHeight - 5, { align: 'center' });
        if (label) {
          const image = footerLabelImage(label);
          const heightMm = 3.2;
          const widthMm = heightMm * image.ratio;
          pdf.addImage(image.dataUrl, 'JPEG', footerMarginLeft, pageHeight - 5 - heightMm + 0.6, widthMm, heightMm);
        }
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
