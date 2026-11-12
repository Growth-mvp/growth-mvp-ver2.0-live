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
import type { StrategyDocumentProps } from '@/components/stage3/StrategyBookDocument';
import { buildDeptStrategyBookPdfData, buildDeptWorkingPdfData } from '@/utils/export/buildDeptStrategyBookPdf';
import {
  downloadPdfFromElement,
  generatePdfFileName,
} from '@/utils/export/downloadPdf';

/**
 * 事業・部門戦略書のPDF出力。
 * - 確定版（既定）：確定済みの正式データだけを使う。
 * - 作業版（working を渡す）：画面の作業内容を使う。正式データは読まず、変更もしない。
 */
export async function exportDeptStrategyBookPdf(
  state: { companyName?: unknown; departments?: unknown },
  options: { departmentName: string; confirmedAt?: string; working?: StrategyDocumentProps },
): Promise<void> {
  const data = options.working
    ? buildDeptWorkingPdfData(options.working, state)
    : buildDeptStrategyBookPdfData(state, options.departmentName, options.confirmedAt);
  if (!data) throw new Error('department_not_found');
  const fileName = data.status === 'working'
    ? `GROWTHSHIFT_${data.departmentName}_事業戦略書_作業版`
    : `GROWTHSHIFT_${data.departmentName}_事業戦略書`;
  const statusLabel = data.status === 'working' ? '作業版・未確定' : '確定版';

  const { DeptStrategyBookPdfView } = await import('@/components/export/DeptStrategyBookPdfView');
  const { createRoot } = await import('react-dom/client');
  const React = await import('react');

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  container.style.zIndex = '99999';
  container.style.pointerEvents = 'none';
  container.style.background = '#ffffff';
  const root = document.createElement('div');
  container.appendChild(root);
  document.body.appendChild(container);
  const reactRoot = createRoot(root);
  try {
    reactRoot.render(React.createElement(DeptStrategyBookPdfView, { data }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 300))));
    await downloadPdfFromElement('dept-strategy-book-pdf', fileName, {
      margin: [10, 10, 14, 10],
      jsPDF: { orientation: 'p', unit: 'mm', format: 'a4' },
      image: { type: 'jpeg', quality: 0.92 },
      avoidBreakSelector: '.report-h2, .report-h3, .report-text',
      footer: (pageNo, pageCount) => ({ label: statusLabel, text: `${pageNo} / ${pageCount}` }),
    });
  } finally {
    reactRoot.unmount();
    container.remove();
  }
}

/**
 * STAGE3 PDF エクスポート用カスタムフック
 */
export function useStage3PdfExport() {
  const state = useStrategyStore();

  const exportToPdf = useCallback(async (options?: { departmentName?: string }) => {
    const departmentName = typeof options?.departmentName === 'string' ? options.departmentName : null;
    const scoped = departmentName
      ? { ...state, departments: (state.departments ?? []).filter((d) => d.name === departmentName) }
      : state;
    if (departmentName && scoped.departments.length === 0) throw new Error('department_not_found');

    // ★ 1. データビルダーを呼び出し
    const reportData = buildStage3ReportData(scoped);

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
      const fileName = generatePdfFileName(
        3,
        departmentName ? `事業・部門別戦略レポート_${departmentName}` : '事業・部門別戦略レポート',
      );
      await downloadPdfFromElement('stage3-pdf-export', fileName, {
        margin: [10, 10, 10, 10],
        jsPDF: {
          orientation: 'p',
          unit: 'mm',
          format: 'a4',
        },
        image: { type: 'jpeg', quality: 0.92 },
        avoidBreakSelector: '.report-section, .report-card, .report-h2, .report-h3, .report-h4, .report-list, .report-text',
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

  const exportDepartmentStrategyBookPdf = useCallback(
    (options: { departmentName: string; confirmedAt?: string; working?: StrategyDocumentProps }) => exportDeptStrategyBookPdf(state, options),
    [state],
  );

  return { exportToPdf, exportDepartmentStrategyBookPdf };
}
