import { Response } from 'express';

export interface EditApprovalRequest {
  id: string;
  op: 'edit' | 'write';
  path: string;
  preview: string;
}

interface PendingEditApproval extends EditApprovalRequest {
  createdAt: number;
  resolve: (approved: boolean) => void;
}

const pendingEditApprovals = new Map<string, PendingEditApproval>();
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Pauses execution until the user approves or skips a proposed file change.
 * Mirrors the terminal-command approval flow: emits an SSE event carrying the
 * proposal, parks a resolver keyed by id, and settles via resolveEditApproval
 * (or times out / aborts as a rejection).
 */
export function requestEditApproval(
  request: EditApprovalRequest,
  res: Response,
  abortSignal: { aborted: boolean },
): Promise<boolean> {
  const { id } = request;

  res.write(`event: edit_approval\ndata: ${JSON.stringify({ id, op: request.op, path: request.path, preview: request.preview })}\n\n`);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingEditApprovals.delete(id);
      resolve(approved);
    };

    const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
    pendingEditApprovals.set(id, { ...request, createdAt: Date.now(), resolve: finish });

    const poll = setInterval(() => {
      if (settled) {
        clearInterval(poll);
      } else if (abortSignal.aborted) {
        clearInterval(poll);
        finish(false);
      }
    }, 250);
  });
}

export function resolveEditApproval(id: string, approved: boolean): boolean {
  const pending = pendingEditApprovals.get(id);
  if (!pending) return false;
  pending.resolve(approved);
  return true;
}

/** Builds a short human-readable preview of a proposed change for the approval card. */
export function describeProposedChange(op: 'edit' | 'write', path: string, input: Record<string, unknown>): string {
  const MAX_PREVIEW_CHARS = 2000;
  const body = typeof input.content === 'string' && input.content
    ? input.content
    : typeof input.new_string === 'string' ? input.new_string : '';
  const label = op === 'write' ? 'Create file' : 'Apply edit';
  const head = `${label}: ${path}`;
  if (!body) return head;
  const trimmed = body.length > MAX_PREVIEW_CHARS ? `${body.slice(0, MAX_PREVIEW_CHARS)}\n… (${body.length - MAX_PREVIEW_CHARS} more chars)` : body;
  return `${head}\n${trimmed}`;
}
