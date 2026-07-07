import { createApp } from './app';

const PORT = 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Iodine server running at http://localhost:${PORT}`);
});
