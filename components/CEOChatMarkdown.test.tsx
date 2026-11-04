/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react';
import CEOChatMarkdown from './CEOChatMarkdown';

describe('CEOChatMarkdown', () => {
  it('Markdown の記号を露出させず、強調・見出し・箇条書きとして表示する', () => {
    const { container } = render(
      <CEOChatMarkdown content={'**重要な点**は次の通りです。\n\n## 進め方\n\n- 売上を確認する\n- 原価を確認する'} />
    );

    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('##');
    expect(container.querySelector('strong')?.textContent).toBe('重要な点');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).toContain('進め方');
  });

  it('HTML として解釈せず、テキストとして表示する', () => {
    const { container } = render(
      <CEOChatMarkdown content={'<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">'} />
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('危険なリンク先を href に出力しない', () => {
    const { container } = render(<CEOChatMarkdown content={'[クリック](javascript:alert(1))'} />);

    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });
});
