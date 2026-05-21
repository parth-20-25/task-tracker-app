#!/usr/bin/env node
const path = require('path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/dummy';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummysecret';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
process.env.PORT = process.env.PORT || '0';

// Patch bootstrapService.initDatabase to a no-op before requiring server
const bootstrapServicePath = path.resolve(__dirname, '../backend/services/bootstrapService.js');
const bootstrapService = require(bootstrapServicePath);
bootstrapService.initDatabase = async () => {
  console.log('[mock] initDatabase called (no-op)');
};

const serverModule = require('../backend/server');

(async () => {
  try {
    const server = await serverModule.startServer();
    const addr = server.address();
    const port = addr && addr.port ? addr.port : process.env.PORT;
    console.log(`Mock server started on port ${port}`);
    // Keep server running briefly then exit
    setTimeout(() => {
      server.close(() => {
        console.log('Mock server closed');
        process.exit(0);
      });
    }, 2000);
  } catch (err) {
    console.error('Failed to start mock server:', err);
    process.exit(1);
  }
})();
