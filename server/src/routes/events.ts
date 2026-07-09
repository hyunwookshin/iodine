import { Router } from 'express';
import { addClient } from '../events';

const router = Router();

router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send a comment to keep connection open in some proxies
  res.write(': connected\n\n');

  addClient(res);
});

export default router;