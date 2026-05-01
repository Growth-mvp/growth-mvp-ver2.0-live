/**
 * /hooks/useStage1PdfExport.ts
 *
 * 目的：
 * - STAGE1 現状分析レポートのPDFエクスポート処理
 * - 動的import でSSR回避
 * - html2canvas + jsPDF で確実な描画
 */

import { useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { buildStage1ReportData } from '@/utils/export/buildStage1ReportData';
import {
  downloadPdfFromElement,
  generatePdfFileName,
} from '@/utils/export/downloadPdf';

/**
 * STAGE1 PDF エクスポート用カスタムフック
 */
export function useStage1PdfExport() {
  const state = useStrategyStore();

  const exportToPdf = useCallback(async () => {
    // ★ 1. データビルダーを呼び出し
    const reportData = buildStage1ReportData(state);

    // ★ 2. 動的import でSSR回避
    const { Stage1ReportView } = await import(
      '@/components/export/Stage1ReportView'
    );

    // ★ 3. 一時的なDOMを作成（stage1-pdf-export）
    const container = document.createElement('div');
    container.id = 'stage1-pdf-export';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '794px';
    container.style.minHeight = '1123px';
    container.style.background = '#ffffff';
    container.style.color = '#111111';
    container.style.opacity = '1';
    container.style.visibility = 'visible';
    container.style.zIndex = '99999';
    container.style.pointerEvents = 'none';
    container.style.overflow = 'visible';

    const root = document.createElement('div');
    container.appendChild(root);
    document.body.appendChild(container);

    try {
      const { createRoot } = await import('react-dom/client');
      const reactRoot = createRoot(root);

      // Stage1ReportView をレンダリング
      const React = await import('react');
      reactRoot.render(
        React.createElement(Stage1ReportView, {
          data: reportData,
        }),
      );

      // レンダリング完了を待つ（requestAnimationFrame x2 + 500ms）
      await new Promise((resolve) => {
        let frameCount = 0;
        const checkFrame = () => {
          frameCount++;
          if (frameCount >= 2) {
            setTimeout(resolve, 500);
          } else {
            requestAnimationFrame(checkFrame);
          }
        };
        requestAnimationFrame(checkFrame);
      });

      console.log('[useStage1PdfExport] Starting PDF conversion...');

      // ★ 4. PDFダウンロード
      const fileName = generatePdfFileName(1, '現状分析レポート');
      await downloadPdfFromElement('stage1-pdf-export', fileName, {
        margin: [10, 10, 10, 10],
        jsPDF: {
          orientation: 'p',
          unit: 'mm',
          format: 'a4',
        },
      });

      console.log('[useStage1PdfExport] PDF generation completed');

      // ★ 5. クリーンアップ
      reactRoot.unmount();
      container.remove();
    } catch (error) {
      // ★ 5. エラー時もクリーンアップ
      if (document.body.contains(container)) {
        container.remove();
      }
      console.error('[useStage1PdfExport] Error:', error);
      throw error;
    }
  }, [state]);

  return { exportToPdf };
}
