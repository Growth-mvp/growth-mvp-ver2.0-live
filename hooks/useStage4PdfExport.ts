/**
 * /hooks/useStage4PdfExport.ts
 *
 * 目的：
 * - STAGE4 OKR実行計画書のPDFエクスポート処理
 * - 動的import でSSR回避
 * - html2canvas + jsPDF で確実な描画
 */

import { useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { buildStage4ReportData } from '@/utils/export/buildStage4ReportData';
import {
  downloadPdfFromElement,
  generatePdfFileName,
} from '@/utils/export/downloadPdf';

/**
 * STAGE4 PDF エクスポート用カスタムフック
 */
export function useStage4PdfExport() {
  const state = useStrategyStore();

  const exportToPdf = useCallback(async () => {
    // ★ 1. データビルダーを呼び出し
    const reportData = buildStage4ReportData(state);

    // ★ 2. 動的import でSSR回避
    const { Stage4ReportView } = await import(
      '@/components/export/Stage4ReportView'
    );

    // ★ 3. 一時的なDOMを作成（stage4-pdf-export）
    // 確実性重視：画面内に配置（一瞬見えてもOK）
    const container = document.createElement('div');
    container.id = 'stage4-pdf-export';
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

      // Stage4ReportView をレンダリング
      const React = await import('react');
      reactRoot.render(
        React.createElement(Stage4ReportView, {
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

      console.log('[useStage4PdfExport] Starting PDF conversion...');

      // ★ 4. PDFダウンロード
      const fileName = generatePdfFileName(4, 'OKR実行計画書');
      await downloadPdfFromElement('stage4-pdf-export', fileName, {
        margin: [10, 10, 10, 10],
        jsPDF: {
          orientation: 'p',
          unit: 'mm',
          format: 'a4',
        },
      });

      console.log('[useStage4PdfExport] PDF generation completed');

      // ★ 5. クリーンアップ
      reactRoot.unmount();
      container.remove();
    } catch (error) {
      // ★ 5. エラー時もクリーンアップ
      if (document.body.contains(container)) {
        container.remove();
      }
      console.error('[useStage4PdfExport] Error:', error);
      throw error;
    }
  }, [state]);

  return { exportToPdf };
}
