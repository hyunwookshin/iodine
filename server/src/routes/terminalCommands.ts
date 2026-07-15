import { Router } from 'express';
import { resolveTerminalApproval } from '../services/terminalCommands';

const router = Router();

router.post('/agent/terminal/approval', (req, res) => {
  const { id, approved } = req.body as { id?: string; approved?: boolean };
  if (!id || typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'id and approved are required' });
  }

  if (!resolveTerminalApproval(id, approved)) {
    return res.status(404).json({ error: 'Command approval request was not found or has expired' });
  }

  return res.json({ ok: true });
});

export default router;
