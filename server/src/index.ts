import path from 'path';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { createApp } from './app';
import { setupTerminalWebSocket } from './terminal';
import { setupMeetingRelay } from './meeting';

// The server runs from server/, but the .env documented in .env.example sits at the repo root.
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const PORT = 3001;
const app = createApp();
const server = createServer(app);
setupTerminalWebSocket(server);
setupMeetingRelay(server);

// Disable the default socket timeout so long-running SSE streams (agent loops,
// AI summary generation) are not dropped while the server is working silently.
server.timeout = 0;
server.requestTimeout = 0;

server.listen(PORT, () => {
  console.log(`Iodine server running at http://localhost:${PORT}`);
});
