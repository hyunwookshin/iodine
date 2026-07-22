import { createServer } from 'http';
import { createApp } from './app';
import { setupTerminalWebSocket } from './terminal';

const PORT = 3001;
const app = createApp();
const server = createServer(app);
setupTerminalWebSocket(server);

// Disable the default socket timeout so long-running SSE streams (agent loops,
// AI summary generation) are not dropped while the server is working silently.
server.timeout = 0;
server.requestTimeout = 0;

server.listen(PORT, () => {
  console.log(`Iodine server running at http://localhost:${PORT}`);
});
