import express from 'express';
import cors from 'cors';
import filesRouter from './routes/files';
import agentRouter from './routes/agent';

export function createApp() {
  const app = express();

  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', filesRouter);
  app.use('/api', agentRouter);

  return app;
}
