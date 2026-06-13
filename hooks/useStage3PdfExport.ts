/**
 * /hooks/useStage3PdfExport.ts
 *
 * 目的：
 * - STAGE3 部門戦略レポートのPDFエクスポート処理
 * - 動的import でSSR回避
 * - html2canvas + jsPDF で確実な描画
 */

import { useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { buildStage3ReportData } from '@/utils/export/buildStage3ReportData';
import {
  downloadPdfFromElement,
  generatePdfFileName,
} from '@/utils/export/downloadPdf';

/**
 * STAGE3 PDF エクスポート用カスタムフック
 */
export function useStage3PdfExport() {
  const state = useStrategyStore();

  const exportToPdf = useCallback(async () => {
    // ★ 1. データビルダーを呼び出し
    const reportData = buildStage3ReportData(state);

    // ★ 2. 動的import でSSR回避
    const { Stage3ReportView } = await import(
      '@/components/export/Stage3ReportView'
    );

    // ★ 3. 一時的なDOMを作成（stage3-pdf-export）
    // 確実性重視：画面内に配置（一瞬見えてもOK）
    const container = document.createElement('div');
    container.id = 'stage3-pdf-export';
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

    // React要素をレンダリング
    const root = document.createElement('div');
    container.appendChild(root);
    document.body.appendChild(container);

    try {
      const { createRoot } = await import('react-dom/client');
      const reactRoot = createRoot(root);

      // Stage3ReportView をレンダリング
      const React = await import('react');
      reactRoot.render(
        React.createElement(Stage3ReportView, {
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

      console.log('[useStage3PdfExport] Starting PDF conversion...');

      // ★ 4. PDFダウンロード
      const fileName = generatePdfFileName(3, '事業・部門別戦略レポート');
      await downloadPdfFromElement('stage3-pdf-export', fileName, {
        margin: [10, 10, 10, 10],
        jsPDF: {
          orientation: 'p',
          unit: 'mm',
          format: 'a4',
        },
      });

      console.log('[useStage3PdfExport] PDF generation completed');

      // ★ 5. クリーンアップ
      reactRoot.unmount();
      container.remove();
    } catch (error) {
      // ★ 5. エラー時もクリーンアップ
      if (document.body.contains(container)) {
        container.remove();
      }
      console.error('[useStage3PdfExport] Error:', error);
      throw error;
    }
  }, [state]);

  return { exportToPdf };
}
