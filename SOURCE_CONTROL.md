# Source Control Integration

Iodine displays live git status indicators directly in the file explorer tree, giving a quick visual summary of what has changed since the last commit.

## Visual Indicators

| State | Appearance | Meaning |
|---|---|---|
| Modified, not staged | **Bold** | File has unsaved-to-git changes in the working tree |
| Staged | Underlined | File has been `git add`-ed to the index |
| Staged + further modified | **Bold + underlined** | File is staged but has additional unstaged changes on top |
| Clean | Normal | No changes relative to HEAD |

Untracked (`??`) files are not highlighted — only files that git is already tracking.

## Polling Behavior

The file tree refreshes git status:

- Every **3 seconds** automatically
- Immediately when the **browser window regains focus**
- When the **workspace is changed**

This means the indicators update within a few seconds of running `git add`, `git commit`, or editing a file outside the IDE.

## How It Works

### Server: `GET /api/git/status`

Located in `server/src/routes/files.ts`. When called:

1. Runs `git rev-parse --show-toplevel` in the workspace root to find the true git repository root (handles workspaces that are subdirectories of a repo).
2. Runs `git status --porcelain` to get a compact machine-readable status.
3. Parses each line:
   - Column 1 (`X`) — index/staged status
   - Column 2 (`Y`) — working tree/unstaged status
   - A character other than space or `?` in `X` means the file is staged.
   - A character other than space or `?` in `Y` means the file has unstaged changes.
   - Rename lines (`old -> new`) use the destination path.
4. Returns absolute paths mapped to `'staged'`, `'unstaged'`, or `'both'`.

If the workspace is not a git repository (or git is not installed), the endpoint returns `{ status: {} }` without an error — the file tree simply shows no indicators.

**Response shape:**
```json
{
  "status": {
    "/abs/path/to/file.ts": "unstaged",
    "/abs/path/to/other.ts": "staged",
    "/abs/path/to/third.ts": "both"
  }
}
```

### Client: `useGitStatus` hook (`client/src/hooks/useGitStatus.ts`)

```
useGitStatus(workspacePath) → Record<string, 'unstaged' | 'staged' | 'both'>
```

Calls `fetchGitStatus()` from `api/files.ts`, stores the result in state, and sets up a 3-second polling interval plus a `window focus` listener. Both are cleaned up on unmount. Returns an empty object when no workspace is open or when the fetch fails.

### Client: rendering (`FileTreeNode.tsx`)

The `gitStatus` map is threaded from `FileExplorer` → `FileTreeNode` (and down recursively to all child nodes). Each node looks up its absolute path in the map and applies inline styles to the filename `<span>`:

| Value | `fontWeight` | `textDecoration` |
|---|---|---|
| `'unstaged'` | `bold` | — |
| `'staged'` | — | `underline` |
| `'both'` | `bold` | `underline` |

## Adding More Indicators

To show additional states (e.g. untracked files, merge conflicts, deleted files):

1. Extend the `GitFileStatus` type in `client/src/api/files.ts` and `client/src/hooks/useGitStatus.ts`.
2. Update the porcelain parser in `server/src/routes/files.ts` to emit the new value (e.g. detect `??` lines for untracked).
3. Add the corresponding style branch in `FileTreeNode.tsx`.
