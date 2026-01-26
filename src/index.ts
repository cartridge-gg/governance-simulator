import { createApp } from './api.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`Governance simulator API running at http://${HOST}:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /health    - Health check`);
  console.log(`  POST /simulate  - Simulate a governance proposal`);
  console.log(`  POST /simulate-batch - Simulate multiple proposals`);
  console.log('');
  console.log('Example request:');
  console.log(`  curl -X POST http://localhost:${PORT}/simulate \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{`);
  console.log(`      "timelockAddress": "0x123...",`);
  console.log(`      "calls": [{`);
  console.log(`        "to": "0x456...",`);
  console.log(`        "selector": "transfer",`);
  console.log(`        "calldata": ["0x789...", "1000000000000000000"]`);
  console.log(`      }]`);
  console.log(`    }'`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  process.exit(0);
});

// Export for testing
export { createApp };
