import { diffLines } from 'diff';

export type DiffRowKind = 'add' | 'del' | 'same';

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
}

/**
 * diffLines treats "b" and "b\n" as different lines, so a snippet without a trailing
 * newline reports its unchanged last line as removed and re-added whenever lines are
 * appended or dropped after it. Ending both sides with a newline avoids that.
 */
function withTrailingNewline(text: string): string {
  return text === '' || text.endsWith('\n') ? text : text + '\n';
}

/** Flattens a line diff of two snippets into one row per line. */
export function diffRows(oldText: string, newText: string): DiffRow[] {
  return diffLines(withTrailingNewline(oldText), withTrailingNewline(newText)).flatMap(part => {
    const lines = part.value.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const kind: DiffRowKind = part.added ? 'add' : part.removed ? 'del' : 'same';
    return lines.map(text => ({ kind, text }));
  });
}
