#!/usr/bin/env node
import { startHubSpotMcpServer } from '../mcp.js';
startHubSpotMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
