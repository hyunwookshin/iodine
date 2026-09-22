import { Router } from 'express';
import { resolveTerminalApproval } from '../services/terminalCommands';

const router = Router();

router.post('/agent/terminal/approval', async (req, res) => {
  const { id, approved, remember } = req.body as { id?: string; approved?: boolean; remember?: boolean };
  if (!id || typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'id and approved are required' });
  }

  if (!await resolveTerminalApproval(id, approved, remember === true)) {
    return res.status(404).json({ error: 'Command approval request was not found or has expired' });
  }

  return res.json({ ok: true });
});

export default router;
