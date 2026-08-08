import app, { initialization } from './index.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3001');

let server: ReturnType<typeof app.listen> | null = null;

initialization
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Health: http://localhost:${PORT}/api/health`);
      console.log(`API Base: http://localhost:${PORT}/api`);
    });
  })
  .catch((error) => {
    console.error('Fatal initialization error:', error);
    process.exit(1);
  });

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (!server) {
    process.exit(0);
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
