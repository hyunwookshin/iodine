# Source Control Integration

Iodine provides two layers of live git integration: **file tree status indicators** (showing which files have changed) and **inline editor diff decorations** (showing exactly which lines changed, with expandable deleted-line views).

---

## File Tree Status Indicators

Files in the explorer are styled to reflect their git index and working tree state.

| State | Appearance | Meaning |
|---|---|---|
| Modified, not staged | **Bold** | Working tree has changes not yet `git add`-ed |
| Staged | Underlined | File is in the index (`git add`-ed) |
| Staged + further modified | **Bold + underlined** | Staged, but additional working tree changes on top |
| Clean | Normal | No changes relative to HEAD |

Untracked (`??`) files are not highlighted — only already-tracked files.

### How It Works

**Server: `GET /api/git/status`** (`server/src/routes/files.ts`)

1. Runs `git rev-parse --show-toplevel` to find the true repo root (handles workspaces that are subdirectories of a larger repo).
2. Runs `git status --porcelain` for compact machine-readable output.
3. Parses each line — column 1 (`X`) is the index state, column 2 (`Y`) is the working tree state. A non-space, non-`?` character means that side has changes. Rename lines use the destination path.
4. Returns absolute paths mapped to `'staged'`, `'unstaged'`, or `'both'`. Returns `{ status: {} }` if the workspace is not a git repo.

```json
{
  "status": {
    "/abs/path/to/file.ts": "unstaged",
    "/abs/path/to/other.ts": "staged",
    "/abs/path/to/third.ts": "both"
  }
}
```

**Client: `useGitStatus` hook** (`client/src/hooks/useGitStatus.ts`)

Polls `GET /api/git/status` every 3 seconds and on `window focus`. Returns a `Record<string, GitFileStatus>` keyed by absolute path. Resets to `{}` when no workspace is open.

**Client: rendering** (`FileTreeNode.tsx`)

`gitStatus` is threaded from `FileExplorer` → `FileTreeNode` and recursively to all children. Each node looks up its path in the map and applies inline styles:

| Value | `fontWeight` | `textDecoration` |
|---|---|---|
| `'unstaged'` | `bold` | — |
| `'staged'` | — | `underline` |
| `'both'` | `bold` | `underline` |

---

## Inline Editor Diff Decorations

When a file is open in the Monaco editor, changed lines are decorated in real time based on `git diff HEAD`.

### Visual Key

| Decoration | Gutter | Line background | Meaning |
|---|---|---|---|
| Added | Green bar (`#2ea043`) | Green tint | Line exists in working tree but not in HEAD |
| Modified | Yellow bar (`#e9b44c`) | Yellow tint | Line exists in both but content has changed |
| Deleted | Red `▸` glyph | — | Lines were removed; click glyph to expand |

Clicking a **`▸`** glyph toggles an inline view zone showing the deleted lines in red below the marker. Click **`▾`** to collapse it. All three types also appear as colored marks in the scrollbar **overview ruler**.

### How It Works

**Server: `GET /api/git/diff?path=`** (`server/src/routes/files.ts`)

Runs `git diff HEAD -- <file>` via `execFile` (no shell injection risk). The response is parsed by `parseDiff()`:

- Each hunk header (`@@`) sets the current new-file line counter.
- Contiguous blocks of `−`/`+` lines are classified as a *change block*:
  - Only `+` lines → **added** (each line recorded individually)
  - Only `−` lines → **deleted** block (content preserved, position = after current new line)
  - Mixed `−` and `+` → first `min(m, p)` additions are **modified**; extra additions are **added**; extra deletions form an additional **deleted** block

```json
{
  "added":    [5, 6],
  "modified": [12],
  "deleted":  [{ "afterLine": 8, "lines": ["old line content"] }]
}
```

Returns `{ added: [], modified: [], deleted: [] }` if the file is untracked, clean, or git is unavailable.

**Client: `useFileDiff` hook** (`client/src/hooks/useFileDiff.ts`)

Fetches `GET /api/git/diff` for the currently active file path. Polls every 3 seconds and on `window focus`. Returns `DiffData | null`.

**Client: `MonacoEditor`** (`client/src/components/editor/MonacoEditor.tsx`)

Decorations are applied via the Monaco `deltaDecorations` API after the editor mounts. Key implementation details:

- `onMount` captures the editor and monaco instances in refs and fires a state flag (`mounted`) to trigger the decoration effect.
- A `diffDataRef` ref keeps the glyph-click handler pointing at the latest diff data without re-subscribing.
- Expanded deleted blocks are tracked in a `Set<number>` (keyed by `afterLine`). State resets when the active file changes.
- Glyph clicks are detected via `editor.onMouseDown` checking `MouseTargetType.GUTTER_GLYPH_MARGIN`, then matched to a deleted block by line number.
- Expanded blocks are rendered as Monaco **ViewZones** (`editor.changeViewZones`) — DOM nodes inserted as virtual lines in the editor, styled with red text and a red left border.

**CSS** (`client/src/index.css`)

`.git-added-glyph`, `.git-modified-glyph`, `.git-deleted-glyph`, `.git-deleted-glyph-open` — gutter bar/icon styles. `.git-added-line`, `.git-modified-line` — 12% opacity background tints.

---

## Polling Summary

Both features share the same refresh strategy:

| Trigger | Status indicators | Diff decorations |
|---|---|---|
| Interval | Every 3 s | Every 3 s |
| Window focus | Yes | Yes |
| Workspace change | Yes (hook re-runs) | Yes (file path changes) |
| File switch | — | Yes (hook re-runs on new path) |

---

## Extending

### Add more file tree states (e.g. untracked files)

1. Extend `GitFileStatus` in `client/src/api/files.ts` and `client/src/hooks/useGitStatus.ts`.
2. Update the porcelain parser in `server/src/routes/files.ts` (detect `??` lines).
3. Add a style branch in `FileTreeNode.tsx`.

### Add more diff decoration types (e.g. conflict markers)

1. Extend `DiffResult` / `DiffData` types in `server/src/routes/files.ts` and `client/src/api/files.ts`.
2. Update `parseDiff()` on the server.
3. Add decoration entries in the `useEffect` inside `MonacoEditor.tsx`.
4. Add CSS classes in `index.css`.
