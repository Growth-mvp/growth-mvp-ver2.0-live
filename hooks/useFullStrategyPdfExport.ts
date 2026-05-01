/**
 * /hooks/useFullStrategyPdfExport.ts
 *
 * 目的：
 * - GROWTH統合レポートのPDFエクスポート処理
 * - 動的import でSSR回避
 * - html2canvas + jsPDF で確実な描画
 */

import { useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { buildStrategyReportData } from '@/utils/export/buildStrategyReportData';
import {
  downloadPdfFromElement,
} from '@/utils/export/downloadPdf';

/**
 * GROWTH統合レポート PDF エクスポート用カスタムフック
 */
export function useFullStrategyPdfExport() {
  const state = useStrategyStore();

  const exportToPdf = useCallback(async () => {
    // ★ 1. データビルダーを呼び出し
    const reportData = buildStrategyReportData(state);

    // ★ 2. 動的import でSSR回避
    const { StrategyReportView } = await import(
      '@/components/export/StrategyReportView'
    );

    // ★ 3. 一時的なDOMを作成（full-strategy-pdf-export）
    const container = document.createElement('div');
    container.id = 'full-strategy-pdf-export';
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

      // StrategyReportView をレンダリング
      const React = await import('react');
      reactRoot.render(
        React.createElement(StrategyReportView, {
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

      console.log('[useFullStrategyPdfExport] Starting PDF conversion...');

      // ★ 4. PDFダウンロード
      const fileName = generateFullStrategyPdfFileName();
      await downloadPdfFromElement('full-strategy-pdf-export', fileName, {
        margin: [10, 10, 10, 10],
        jsPDF: {
          orientation: 'p',
          unit: 'mm',
          format: 'a4',
        },
      });

      console.log('[useFullStrategyPdfExport] PDF generation completed');

      // ★ 5. クリーンアップ
      reactRoot.unmount();
      container.remove();
    } catch (error) {
      // ★ 5. エラー時もクリーンアップ
      if (document.body.contains(container)) {
        container.remove();
      }
      console.error('[useFullStrategyPdfExport] Error:', error);
      throw error;
    }
  }, [state]);

  return { exportToPdf };
}

/**
 * GROWTH統合レポート用 PDFファイル名を生成
 * 形式: GROWTH_戦略実行レポート_YYYYMMDD.pdf
 */
function generateFullStrategyPdfFileName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;
  return `GROWTH_戦略実行レポート_${dateStr}`;
}
