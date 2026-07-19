import express from 'express';
import cors from 'cors';
import filesRouter from './routes/files';
import deleteRouter from './routes/delete';
import createRouter from './routes/create';
import agentRouter from './routes/agent';
import terminalCommandsRouter from './routes/terminalCommands';
import aiSummaryRouter from './routes/aiSummary';
import buildConfigRouter from './routes/buildConfig';

export function createApp() {
  const app = express();

  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', filesRouter);
  app.use('/api', deleteRouter);
  app.use('/api', createRouter);
  app.use('/api', agentRouter);
  app.use('/api', terminalCommandsRouter);
  app.use('/api', aiSummaryRouter);
  app.use('/api', buildConfigRouter);

  return app;
}
