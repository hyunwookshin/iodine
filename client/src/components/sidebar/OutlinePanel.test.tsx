// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlinePanel } from './OutlinePanel';

afterEach(cleanup);

const headingNames = () => screen.queryAllByRole('button').map(button => button.textContent);

describe('OutlinePanel', () => {
  it.each([
    ['backtick fences', '```python\n# Code comment\n```'],
    ['tilde fences', '~~~bash\n# Code comment\n~~~'],
    ['indented fences', '   ```python\n# Code comment\n   ```'],
    ['longer closing fences', '```python\n# Code comment\n````'],
    ['shorter fences inside code', '````markdown\n```\n# Code comment\n````'],
    ['different fences inside code', '```python\n~~~\n# Code comment\n```'],
    ['fences followed by code', '```python\n```example\n# Code comment\n```'],
    ['Windows line endings', '```python\r\n# Code comment\r\n```'],
  ])('excludes code comments inside %s', (_name, code) => {
    render(<OutlinePanel content={`# Before\n\n${code}\n\n## After`} />);
    expect(headingNames()).toEqual(['Before', 'After']);
  });

  it.each(['    ```python', '```py`thon'])('does not hide headings after a non-fence line: %s', line => {
    render(<OutlinePanel content={`${line}\n\n# Actual heading`} />);
    expect(headingNames()).toEqual(['Actual heading']);
  });

  it('excludes comments while a code block is still being streamed', () => {
    const content = '# Before\n\n```python\n# Code comment';
    const { rerender } = render(<OutlinePanel content={content} />);
    expect(headingNames()).toEqual(['Before']);

    rerender(<OutlinePanel content={`${content}\n\`\`\`\n\n## After`} />);
    expect(headingNames()).toEqual(['Before', 'After']);
  });

  it('shows the empty state when all heading-like lines are code', () => {
    render(<OutlinePanel content={'```python\n# Code comment\n```'} />);
    expect(headingNames()).toEqual([]);
    expect(screen.getByText('No headings found.')).toBeTruthy();
  });

  it('keeps duplicate heading links correct when code contains the same text', () => {
    const navigate = vi.fn();
    render(<OutlinePanel content={'# Repeat\n\n```python\n# Repeat\n```\n\n# Repeat'} onNavigate={navigate} />);
    const headings = screen.getAllByRole('button', { name: 'Repeat' });
    expect(headings).toHaveLength(2);

    fireEvent.click(headings[0]);
    fireEvent.click(headings[1]);
    expect(navigate.mock.calls).toEqual([['repeat'], ['repeat-1']]);
  });
});
