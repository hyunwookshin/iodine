import { createServer } from 'http';
import { createApp } from './app';
import { setupTerminalWebSocket } from './terminal';

const PORT = 3001;
const app = createApp();
const server = createServer(app);
setupTerminalWebSocket(server);

server.listen(PORT, () => {
  console.log(`Iodine server running at http://localhost:${PORT}`);
});
