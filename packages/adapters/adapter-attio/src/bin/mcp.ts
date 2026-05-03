#!/usr/bin/env node
import { startAttioMcpServer } from '../mcp.js';
startAttioMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
